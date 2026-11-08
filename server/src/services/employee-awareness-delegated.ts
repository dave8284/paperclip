import { and, asc, eq, inArray } from "drizzle-orm";
import { agents, agentosAssignments, agentosEmployees, agentosPortfolioMandates, companies, type Db } from "@paperclipai/db";
import { portfolioReadScopeSchema, type EmployeeAwareness, type EmployeeAwarenessQuery } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { agentosPortfolioMandateService, assertPortfolioMandateActor } from "./agentos-portfolio-mandates.js";
import { fridayAwarenessService } from "./friday-awareness.js";
import { persistActivity, type ActivityPublication } from "./activity-log.js";
import { publishAccountingActivities } from "./accounting-transaction.js";

/** Explicit status visibility for the same employee's separate assignments.
 * Mandates own authority; native work owns privacy/counts. No actor, execution
 * context, task body, credentials or private transcript crosses companies. */
export async function readDelegatedEmployeeAwareness(db: Db, companyId: string, agentId: string,
  actor: AuthorizationActor, query: EmployeeAwarenessQuery): Promise<EmployeeAwareness> {
  if (actor.type !== "agent" || actor.companyId !== companyId || actor.agentId !== agentId
    || (actor.keyScope && actor.keyScope.kind !== "standard") || !query.mandateId || !query.revision) {
    throw forbidden("Delegated awareness requires your own assignment and an exact read mandate");
  }
  const publications: ActivityPublication[] = [];
  const result = await db.transaction(async connection => {
    const tx = connection as unknown as Db, lock = { noWait: true } as const;
    const [source] = await tx.select().from(agentosAssignments).where(and(eq(agentosAssignments.companyId, companyId),
      eq(agentosAssignments.agentId, agentId), eq(agentosAssignments.status, "active"))).for("share", lock);
    if (!source) throw notFound("Active employee assignment not found");
    const [employee] = await tx.select().from(agentosEmployees).where(and(eq(agentosEmployees.id, source.employeeId),
      eq(agentosEmployees.portfolioId, source.portfolioId))).for("share", lock);
    if (!employee) throw notFound("Employee not found");
    const [mandate] = await tx.select().from(agentosPortfolioMandates).where(and(eq(agentosPortfolioMandates.id, query.mandateId!),
      eq(agentosPortfolioMandates.sourceCompanyId, companyId), eq(agentosPortfolioMandates.sourceAgentId, agentId),
      eq(agentosPortfolioMandates.portfolioId, source.portfolioId))).for("share", lock);
    if (!mandate || !mandate.targetCompanyIds.length) throw notFound("Mandate not found");
    const authority = agentosPortfolioMandateService(tx);
    const authorized = await authority.authorizeReads(tx, actor, companyId, {
      mandateId: mandate.id, revision: query.revision!,
    });
    const readScope = portfolioReadScopeSchema.parse(authorized.row.readScope);
    // At most one active assignment per employee/company; the mandate admits
    // at most 50 targets. Pin bindings and labels before checking/paging them.
    const candidates = await tx.select({ assignmentId: agentosAssignments.id, assignmentRevision: agentosAssignments.revision,
      companyId: companies.id, companyName: companies.name, agentId: agents.id, agentName: agents.name,
      agentStatus: agents.status, department: agentosAssignments.department,
    }).from(agentosAssignments).innerJoin(agents, and(eq(agents.id, agentosAssignments.agentId), eq(agents.companyId, agentosAssignments.companyId)))
      .innerJoin(companies, eq(companies.id, agentosAssignments.companyId))
      .where(and(eq(agentosAssignments.employeeId, employee.id), eq(agentosAssignments.portfolioId, source.portfolioId),
        eq(agentosAssignments.status, "active"), inArray(agentosAssignments.companyId, [...new Set([companyId, ...authorized.targetCompanyIds])])))
      .orderBy(asc(companies.name), asc(companies.id), asc(agentosAssignments.id))
      .for("share", { ...lock, of: [agentosAssignments, agents, companies] });
    let selected = candidates.slice(query.offset, query.offset + query.limit);
    if (query.assignmentId) {
      const assignment = candidates.find(candidate => candidate.assignmentId === query.assignmentId);
      if (!assignment) throw notFound("Authorized employee assignment not found");
      if (assignment.assignmentRevision !== query.assignmentRevision) throw conflict("Employee assignment changed. Refresh its awareness before continuing.");
      selected = [assignment];
    }
    const work = fridayAwarenessService(tx), assignments: EmployeeAwareness["assignments"] = [];
    for (const candidate of selected) {
      const local = candidate.companyId === companyId;
      assignments.push({ assignmentId: candidate.assignmentId, assignmentRevision: candidate.assignmentRevision,
        readScope: local ? "current_company" : readScope,
        company: { id: candidate.companyId, name: candidate.companyName },
        agent: { id: candidate.agentId, name: candidate.agentName, status: candidate.agentStatus }, department: candidate.department,
        work: await work.work(candidate.companyId, authorized.actor, { agentId: candidate.agentId,
          offset: query.workOffset ?? 0, projectOffset: query.projectOffset ?? 0, limit: 25, status: "all" },
          local ? undefined : { portfolioReadScope: readScope }),
      });
    }
    assertPortfolioMandateActor(mandate, actor, authorized.targetCompanyIds[0]!, query.revision!);
    const audit = await persistActivity(tx, { companyId, actorType: "agent", actorId: agentId, agentId, runId: actor.runId,
      action: "agentos.employee_awareness_read", entityType: "agentos_employee", entityId: employee.id,
      details: { mandateId: mandate.id, revision: mandate.revision, readScope,
        assignmentIds: assignments.map(assignment => assignment.assignmentId), offset: query.offset,
        workOffset: query.workOffset ?? 0, projectOffset: query.projectOffset ?? 0 } });
    publications.push(audit.publication);
    return { observedAt: new Date().toISOString(), scope: "authorized_assignments" as const,
      mandate: { id: mandate.id, revision: mandate.revision, readScope },
      employee: { id: employee.id, name: employee.name, specialty: employee.specialty }, assignments,
      nextOffset: !query.assignmentId && candidates.length > query.offset + query.limit ? query.offset + query.limit : null };
  }).catch((error: unknown) => {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure.cause?.code ?? failure.code) === "55P03") throw conflict("Employee or portfolio authority is changing. Retry the read.", { retryable: true });
    throw error;
  });
  publishAccountingActivities(companyId, publications);
  return result;
}
