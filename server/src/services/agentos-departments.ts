import { and, eq, inArray, or, sql } from "drizzle-orm";
import { agentosDepartments as departments, agentosDepartmentProjects as memberships, projects, agents, companyOperatingProfiles,
  authUsers, companyMemberships, instanceUserRoles, principalPermissionGrants, type Db } from "@paperclipai/db";
import type { AgentOSDepartment } from "@paperclipai/shared";
import { accessService } from "./access.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { persistActivity, publishActivity, type LogActivityInput } from "./activity-log.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";

type Who = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;
export function departmentService(db: Db) {
  async function manage(tx: Db, actor: AuthorizationActor, companyId: string) {
    // The product role only narrows native authority. Keep head appointment and
    // project moves stable while checking the current actor after lock waits.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`department-management:${companyId}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`operating-profile:${companyId}`}, 0))`);
    actor = { ...actor, memberships: undefined, onBehalfOfMemberships: undefined };
    Reflect.deleteProperty(actor, "__responsibleUserSnapshotMemo");
    const userIds = [...new Set([actor.userId, actor.onBehalfOfUserId, actor.authorizingUserId].filter((id): id is string => !!id))];
    const lock = { noWait: true } as const;
    if (userIds.length && actor.source !== "local_implicit") {
      const users = await tx.select().from(authUsers).where(inArray(authUsers.id, userIds)).orderBy(authUsers.id).for("share", lock);
      if (users.length !== userIds.length || users.some(user => user.approvalStatus !== "approved")) throw forbidden("Current approved company access is required.");
      const roles = await tx.select().from(instanceUserRoles).where(inArray(instanceUserRoles.userId, userIds)).orderBy(instanceUserRoles.id).for("share", lock);
      if (actor.type === "board" && actor.source !== "cloud_tenant") actor.isInstanceAdmin = actor.source !== "mcp_oauth"
        && roles.some(role => role.userId === actor.userId && role.role === "instance_admin");
    }
    const principals = or(
      actor.type === "agent" && actor.agentId ? and(eq(companyMemberships.principalType, "agent"), eq(companyMemberships.principalId, actor.agentId)) : undefined,
      userIds.length ? and(eq(companyMemberships.principalType, "user"), inArray(companyMemberships.principalId, userIds)) : undefined,
    );
    if (principals) await tx.select({ id: companyMemberships.id }).from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, companyId), principals)).orderBy(companyMemberships.id).for("share", lock);
    const grantPrincipals = or(
      actor.type === "agent" && actor.agentId ? and(eq(principalPermissionGrants.principalType, "agent"), eq(principalPermissionGrants.principalId, actor.agentId)) : undefined,
      userIds.length ? and(eq(principalPermissionGrants.principalType, "user"), inArray(principalPermissionGrants.principalId, userIds)) : undefined,
    );
    if (grantPrincipals) await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants)
      .where(and(eq(principalPermissionGrants.companyId, companyId), grantPrincipals)).orderBy(principalPermissionGrants.id).for("share", lock);
    const [profile] = await tx.select().from(companyOperatingProfiles).where(eq(companyOperatingProfiles.companyId, companyId));
    let executive = actor.type === "board";
    if (actor.type === "agent") {
      if (actor.companyId !== companyId || !actor.agentId || (actor.keyScope && actor.keyScope.kind !== "standard"))
        throw forbidden("Company executive or department head access is required.");
      const [manager] = await tx.select().from(agents).where(and(eq(agents.id, actor.agentId), eq(agents.companyId, companyId))).for("share", { noWait: true });
      if (!manager || manager.lifecycleState !== "ready" || !["active", "idle", "running", "error"].includes(manager.status)
        || profile?.fridayAgentId === manager.id) throw forbidden("An available company CEO or department head is required.");
      executive = manager.role === "ceo";
    }
    const decision = await accessService(tx).decide({ actor, action: "applications:manage", resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation);
    return { actor, executive, fridayAgentId: profile?.fridayAgentId ?? null };
  }
  function ownDepartment(authority: Awaited<ReturnType<typeof manage>>, department?: typeof departments.$inferSelect) {
    if (!authority.executive && (!department || department.leadAgentId !== authority.actor.agentId))
      throw forbidden("Department heads can manage only their own departments.");
  }
  function mutationFailure(error: unknown): never {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure?.cause?.code ?? failure?.code) === "55P03") throw conflict("Department authority is changing. Retry the request.", { retryable: true });
    if ((failure?.cause?.code ?? failure?.code) === "23505") throw conflict("A department with this name already exists in the company.");
    throw error;
  }
  return {
    async list(companyId: string, actor: AuthorizationActor): Promise<AgentOSDepartment[]> {
      const rows = await db.select().from(departments).where(eq(departments.companyId, companyId));
      const links = await db.select().from(memberships).where(eq(memberships.companyId, companyId));
      const decisions = await authorizationService(db).decideReads(actor, links.map(link => ({ type: "project" as const, companyId, projectId: link.projectId })));
      const visible = links.filter((_, index) => decisions[index]?.allowed);
      return rows.map(row => ({ ...row, projectIds: visible.filter(link => link.departmentId === row.id).map(link => link.projectId) }));
    },
    async save(companyId: string, actor: AuthorizationActor, who: Who, input: { name: string; description: string; leadAgentId?: string | null; expectedRevision?: number }, id?: string) {
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const authority = await manage(tx, actor, companyId);
        const [previous] = id ? await tx.select().from(departments).where(and(eq(departments.id, id), eq(departments.companyId, companyId))).for("update") : [];
        if (id && (!previous || previous.revision !== input.expectedRevision)) throw conflict("Department changed. Refresh before saving.");
        ownDepartment(authority, previous);
        const leadAgentId = input.leadAgentId === undefined ? previous?.leadAgentId ?? null : input.leadAgentId;
        if (!authority.executive && leadAgentId !== previous?.leadAgentId) throw forbidden("The company CEO or board appoints department heads.");
        if (leadAgentId && leadAgentId !== previous?.leadAgentId) {
          if (leadAgentId === authority.fridayAgentId) throw badRequest("Friday directs company executives and cannot be a department head.");
          const [lead] = await tx.select().from(agents).where(and(eq(agents.id, leadAgentId), eq(agents.companyId, companyId))).for("share");
          // Pausing execution does not retire an employee or remove ownership.
          // This lets an operator prepare a team without waking its agents.
          const currentEmployee = lead && (
            lead.lifecycleState === "ready"
            || (lead.status === "paused" && lead.lifecycleState === "paused")
          );
          if (!currentEmployee || !["active", "idle", "running", "error", "paused"].includes(lead.status)) throw badRequest("Department head must be a current employee in this company.");
        }
        const [row] = id ? await tx.update(departments).set({ name: input.name, description: input.description, leadAgentId, revision: (input.expectedRevision ?? 0) + 1 })
          .where(and(eq(departments.id, id), eq(departments.companyId, companyId), eq(departments.revision, input.expectedRevision ?? 0))).returning()
          : await tx.insert(departments).values({ companyId, name: input.name, description: input.description, leadAgentId }).returning();
        if (!row) throw conflict("Department changed. Refresh before saving.");
        const { publication } = await persistActivity(tx, { ...who, companyId, action: id ? "department.updated" : "department.created", entityType: "department", entityId: row.id, details: { name: row.name, revision: row.revision, leadAgentId: row.leadAgentId, previousLeadAgentId: previous?.leadAgentId ?? null } });
        return { row, publication };
      }).catch(mutationFailure);
      publishActivity(result.publication);
      return result.row;
    },
    async assign(companyId: string, projectId: string, departmentId: string | null, actor: AuthorizationActor, who: Who) {
      const publication = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const authority = await manage(tx, actor, companyId);
        const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.companyId, companyId))).for("update");
        if (!project) throw notFound("Project not found");
        const [read] = await authorizationService(tx).decideReads(authority.actor, [{ type: "project", companyId, projectId }]);
        if (!read.allowed) throw notFound("Project not found");
        const [previous] = await tx.select({ department: departments }).from(memberships)
          .innerJoin(departments, and(eq(departments.companyId, memberships.companyId), eq(departments.id, memberships.departmentId)))
          .where(and(eq(memberships.companyId, companyId), eq(memberships.projectId, projectId))).for("share");
        if (previous) ownDepartment(authority, previous.department);
        if (departmentId) {
          const [department] = await tx.select().from(departments).where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId))).for("share");
          if (!department) throw notFound("Department not found");
          ownDepartment(authority, department);
          await tx.insert(memberships).values({ companyId, projectId, departmentId }).onConflictDoUpdate({ target: [memberships.companyId, memberships.projectId], set: { departmentId } });
        } else {
          ownDepartment(authority, previous?.department);
          await tx.delete(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.projectId, projectId)));
        }
        return (await persistActivity(tx, { ...who, companyId, action: "project.department_changed", entityType: "project", entityId: projectId, details: { departmentId } })).publication;
      }).catch(mutationFailure);
      publishActivity(publication);
      return { projectId, departmentId };
    },
    async remove(companyId: string, id: string, expectedRevision: number, actor: AuthorizationActor, who: Who) {
      const publication = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const authority = await manage(tx, actor, companyId);
        const [previous] = await tx.select().from(departments).where(and(eq(departments.id, id), eq(departments.companyId, companyId))).for("update");
        if (!previous || previous.revision !== expectedRevision) throw conflict("Department changed. Refresh before deleting.");
        ownDepartment(authority, previous);
        // Removing the department also removes its head appointment. A head
        // cannot erase the very appointment that narrows its staffing scope.
        if (!authority.executive) throw forbidden("The company CEO or board removes departments and their head appointments.");
        const [row] = await tx.delete(departments).where(and(eq(departments.id, id), eq(departments.companyId, companyId), eq(departments.revision, expectedRevision))).returning();
        if (!row) throw conflict("Department changed. Refresh before deleting.");
        return (await persistActivity(tx, { ...who, companyId, action: "department.deleted", entityType: "department", entityId: id, details: { name: row.name } })).publication;
      }).catch(mutationFailure);
      publishActivity(publication);
    },
  };
}
