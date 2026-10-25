import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { agents, companies, companyMemberships, agentosPortfolios, agentosPortfolioCompanies, agentosEmployees, agentosAssignments, type Db } from "@paperclipai/db";
import type { AgentosWorkforce, CreateAgentosPortfolio, CreateAgentosEmployee, CreateAgentosAssignment, RetireAgentosAssignment } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { accessService } from "./access.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { persistActivity, publishActivity, type ActivityPublication, type LogActivityInput } from "./activity-log.js";
import { withAccountingTransaction } from "./accounting-transaction.js";
import { terminateAgentInTransaction } from "./agent-lifecycle.js";
import { logger } from "../middleware/logger.js";

type Who = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;
type Portfolio = typeof agentosPortfolios.$inferSelect;

export function agentosWorkforceService(db: Db) {
  function ownerId(actor: AuthorizationActor) {
    if (actor.type !== "board") throw forbidden("Portfolio ownership requires an operator");
    const id = actor.userId ?? (actor.source === "local_implicit" ? "local-board" : null);
    if (!id) throw forbidden("An authenticated portfolio owner is required");
    return id;
  }

  async function companyAccess(connection: Db, actor: AuthorizationActor, companyId: string, manage = false) {
    let effectiveActor = actor;
    if (actor.type === "none" || (actor.type === "agent" && (actor.companyId !== companyId || (actor.keyScope && actor.keyScope.kind !== "standard")))) return false;
    // Recheck membership from durable state. Portfolio links are not grants.
    if (actor.type === "board" && actor.source !== "local_implicit") {
      // A session/token may be narrower than the user's memberships (e.g. a
      // company-consented MCP connection). Retain native route admission too.
      if (!actor.companyIds?.includes(companyId)) return false;
      const [member] = await connection.select().from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.userId ?? ""), eq(companyMemberships.status, "active"),
      ));
      if (!member || (manage && member.membershipRole === "viewer")) return false;
      effectiveActor = { ...actor, memberships: [{ companyId, membershipRole: member.membershipRole, status: member.status }] };
    }
    if (manage) return (await accessService(connection).decide({ actor: effectiveActor, action: "users:manage_permissions", resource: { type: "company", companyId } })).allowed;
    return (await authorizationService(connection).decideReads(effectiveActor, [{ type: "company", companyId }]))[0].allowed;
  }

  async function portfolio(connection: Db, actor: AuthorizationActor, id: string, manage = false): Promise<Portfolio> {
    const [row] = await connection.select().from(agentosPortfolios).where(and(eq(agentosPortfolios.id, id), eq(agentosPortfolios.ownerUserId, ownerId(actor))));
    if (!row || !(await companyAccess(connection, actor, row.homeCompanyId, manage))) throw notFound("Portfolio not found");
    return row;
  }

  async function audit(connection: Db, publications: ActivityPublication[], who: Who, companyId: string, action: string, id: string, details: Record<string, unknown>) {
    const result = await persistActivity(connection, { ...who, companyId, action, entityType: "agentos_workforce", entityId: id, details });
    publications.push(result.publication);
  }

  async function mutate<T>(work: (connection: Db, publications: ActivityPublication[]) => Promise<T>): Promise<T> {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(tx => work(tx as unknown as Db, publications));
    for (const publication of publications) {
      try { publishActivity(publication); }
      catch (error) { logger.warn({ err: error }, "Workforce change committed; live activity publication failed"); }
    }
    return result;
  }

  return {
    async list(actor: AuthorizationActor) {
      const rows = await db.select().from(agentosPortfolios).where(eq(agentosPortfolios.ownerUserId, ownerId(actor))).orderBy(agentosPortfolios.createdAt);
      const visible = [];
      for (const row of rows) if (await companyAccess(db, actor, row.homeCompanyId)) visible.push({ id: row.id, name: row.name, homeCompanyId: row.homeCompanyId, revision: row.revision });
      return visible;
    },

    async create(actor: AuthorizationActor, who: Who, input: CreateAgentosPortfolio) {
      return mutate(async (tx, publications) => {
        const userId = ownerId(actor);
        if (!(await companyAccess(tx, actor, input.homeCompanyId, true))) throw forbidden("Company permission management is required to create a portfolio");
        const [home] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, input.homeCompanyId)).for("no key update");
        if (!home) throw notFound("Company not found");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agentos-company:${input.homeCompanyId}`}, 0))`);
        const [existing] = await tx.select().from(agentosPortfolios).where(eq(agentosPortfolios.id, input.id));
        if (existing) {
          if (existing.ownerUserId !== userId) throw notFound("Portfolio not found");
          if (existing.homeCompanyId !== input.homeCompanyId || existing.name !== input.name) throw conflict("This request already created a different portfolio");
          return existing;
        }
        const [linked] = await tx.select().from(agentosPortfolioCompanies).where(eq(agentosPortfolioCompanies.companyId, input.homeCompanyId));
        if (linked) throw conflict("This company already belongs to a portfolio");
        const [created] = await tx.insert(agentosPortfolios).values({ ...input, ownerUserId: userId }).returning();
        await tx.insert(agentosPortfolioCompanies).values({ portfolioId: created.id, companyId: input.homeCompanyId });
        await audit(tx, publications, who, input.homeCompanyId, "agentos.portfolio_created", created.id, { name: created.name });
        return created;
      });
    },

    async linkCompany(actor: AuthorizationActor, who: Who, portfolioId: string, companyId: string) {
      return mutate(async (tx, publications) => {
        await portfolio(tx, actor, portfolioId, true);
        if (!(await companyAccess(tx, actor, companyId, true))) throw notFound("Company not found");
        const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("no key update");
        if (!company) throw notFound("Company not found");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agentos-company:${companyId}`}, 0))`);
        const [existing] = await tx.select().from(agentosPortfolioCompanies).where(eq(agentosPortfolioCompanies.companyId, companyId));
        if (existing) {
          if (existing.portfolioId !== portfolioId) throw conflict("This company already belongs to another portfolio");
          return existing;
        }
        const [created] = await tx.insert(agentosPortfolioCompanies).values({ portfolioId, companyId }).returning();
        await audit(tx, publications, who, companyId, "agentos.company_linked", created.id, { portfolioId });
        return created;
      });
    },

    async createEmployee(actor: AuthorizationActor, who: Who, portfolioId: string, input: CreateAgentosEmployee) {
      return mutate(async (tx, publications) => {
        const parent = await portfolio(tx, actor, portfolioId, true);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agentos-employee:${input.id}`}, 0))`);
        const [existing] = await tx.select().from(agentosEmployees).where(eq(agentosEmployees.id, input.id));
        if (existing) {
          if (existing.portfolioId !== portfolioId) throw notFound("Employee not found");
          if (existing.name !== input.name || existing.specialty !== input.specialty) throw conflict("This request already created a different employee");
          return existing;
        }
        const [created] = await tx.insert(agentosEmployees).values({ ...input, portfolioId }).returning();
        await audit(tx, publications, who, parent.homeCompanyId, "agentos.employee_created", created.id, { name: created.name });
        return created;
      });
    },

    async assign(actor: AuthorizationActor, who: Who, portfolioId: string, input: CreateAgentosAssignment) {
      await portfolio(db, actor, portfolioId, true);
      if (!(await companyAccess(db, actor, input.companyId, true))) throw notFound("Company not found");
      return withAccountingTransaction(db, input.companyId, async (tx, publications) => {
        await portfolio(tx, actor, portfolioId, true);
        if (!(await companyAccess(tx, actor, input.companyId, true))) throw notFound("Company not found");
        const [company] = await tx.select().from(agentosPortfolioCompanies).where(and(eq(agentosPortfolioCompanies.portfolioId, portfolioId), eq(agentosPortfolioCompanies.companyId, input.companyId)));
        const [employee] = await tx.select().from(agentosEmployees).where(and(eq(agentosEmployees.id, input.employeeId), eq(agentosEmployees.portfolioId, portfolioId)));
        if (!company || !employee) throw notFound("Employee or company not found in this portfolio");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agentos-assignment:${input.companyId}`}, 0))`);
        const [existing] = await tx.select().from(agentosAssignments).where(eq(agentosAssignments.id, input.id));
        if (existing) {
          if (existing.portfolioId !== portfolioId) throw notFound("Assignment not found");
          if (existing.companyId !== input.companyId || existing.employeeId !== input.employeeId || existing.agentId !== input.agentId || existing.department !== input.department) throw conflict("This request already created a different assignment");
          return existing;
        }
        const [agent] = await tx.select().from(agents).where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId))).for("update");
        if (!agent) throw notFound("Company agent not found");
        if (["terminated", "pending_approval"].includes(agent.status) || ["terminating", "cleaning_up", "rejected", "deleting"].includes(agent.lifecycleState)) throw conflict("Choose an approved, available company agent");
        const previous = await tx.select({ assignment: agentosAssignments, lifecycleState: agents.lifecycleState }).from(agentosAssignments)
          .innerJoin(agents, and(eq(agents.id, agentosAssignments.agentId), eq(agents.companyId, agentosAssignments.companyId)))
          .where(and(eq(agentosAssignments.companyId, input.companyId), or(eq(agentosAssignments.agentId, input.agentId), eq(agentosAssignments.employeeId, input.employeeId))));
        if (previous.some(({ assignment }) => assignment.agentId === input.agentId || assignment.status === "active")) throw conflict("This agent or employee already has a company assignment");
        if (previous.some(({ lifecycleState }) => !["terminated", "rejected"].includes(lifecycleState))) throw conflict("Wait for the previous assignment's runtime cleanup to finish before reassigning this employee in the same company");
        const [created] = await tx.insert(agentosAssignments).values({ ...input, portfolioId }).returning();
        await audit(tx, publications, who, input.companyId, "agentos.assignment_created", created.id, { employeeId: input.employeeId, agentId: input.agentId, department: input.department });
        return created;
      });
    },

    async read(actor: AuthorizationActor, portfolioId: string): Promise<AgentosWorkforce> {
      const parent = await portfolio(db, actor, portfolioId);
      const linked = await db.select({ id: companies.id, name: companies.name, issuePrefix: companies.issuePrefix, status: companies.status, description: companies.description }).from(agentosPortfolioCompanies)
        .innerJoin(companies, eq(companies.id, agentosPortfolioCompanies.companyId)).where(eq(agentosPortfolioCompanies.portfolioId, portfolioId));
      const visible = [];
      for (const company of linked) if (await companyAccess(db, actor, company.id)) visible.push({ ...company, canManage: await companyAccess(db, actor, company.id, true) });
      const employees = await db.select({ id: agentosEmployees.id, name: agentosEmployees.name, specialty: agentosEmployees.specialty, revision: agentosEmployees.revision })
        .from(agentosEmployees).where(eq(agentosEmployees.portfolioId, portfolioId)).orderBy(agentosEmployees.name);
      const assignments = visible.length ? await db.select({ assignment: agentosAssignments, agentName: agents.name, agentStatus: agents.status, lifecycleState: agents.lifecycleState, role: agents.role, managerId: agents.reportsTo, harness: agents.adapterType })
        .from(agentosAssignments).innerJoin(agents, and(eq(agents.id, agentosAssignments.agentId), eq(agents.companyId, agentosAssignments.companyId)))
        .where(and(eq(agentosAssignments.portfolioId, portfolioId), inArray(agentosAssignments.companyId, visible.map(row => row.id)))).orderBy(agentosAssignments.createdAt) : [];
      return {
        portfolio: { id: parent.id, homeCompanyId: parent.homeCompanyId, name: parent.name, revision: parent.revision }, canManage: await companyAccess(db, actor, parent.homeCompanyId, true), companies: visible, employees,
        assignments: assignments.map(({ assignment, ...agent }) => ({ ...agent, id: assignment.id, employeeId: assignment.employeeId, companyId: assignment.companyId, agentId: assignment.agentId, department: assignment.department, status: assignment.status as "active" | "retired", revision: assignment.revision, retirementReason: assignment.retirementReason, retiredAt: assignment.retiredAt?.toISOString() ?? null })),
        observedAt: new Date().toISOString(),
      };
    },

    async retire(actor: AuthorizationActor, who: Who, portfolioId: string, assignmentId: string, input: RetireAgentosAssignment) {
      await portfolio(db, actor, portfolioId, true);
      const [known] = await db.select().from(agentosAssignments).where(and(eq(agentosAssignments.portfolioId, portfolioId), eq(agentosAssignments.id, assignmentId)));
      if (!known || !(await companyAccess(db, actor, known.companyId, true))) throw notFound("Assignment not found");
      return withAccountingTransaction(db, known.companyId, async (tx, publications) => {
        await portfolio(tx, actor, portfolioId, true);
        if (!(await companyAccess(tx, actor, known.companyId, true))) throw notFound("Assignment not found");
        const [row] = await tx.select().from(agentosAssignments).where(eq(agentosAssignments.id, assignmentId)).for("update");
        if (row.status === "retired" && row.revision === input.expectedRevision + 1 && row.retirementReason === input.reason) return row;
        if (row.revision !== input.expectedRevision) throw conflict("Assignment changed. Refresh before retiring it.");
        if (row.status === "retired") throw conflict("This assignment is already retired");
        const [report] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, row.companyId), eq(agents.reportsTo, row.agentId), ne(agents.status, "terminated"))).limit(1);
        if (report) throw conflict("Reassign this agent's direct reports before retiring its assignment");
        await terminateAgentInTransaction(tx, row.companyId, row.agentId);
        const [retired] = await tx.update(agentosAssignments).set({ status: "retired", retirementReason: input.reason, retiredAt: new Date(), revision: row.revision + 1 }).where(eq(agentosAssignments.id, row.id)).returning();
        await audit(tx, publications, who, row.companyId, "agentos.assignment_retired", row.id, { employeeId: row.employeeId, agentId: row.agentId, reason: input.reason, previousRevision: row.revision, revision: retired.revision });
        return retired;
      });
    },
  };
}
