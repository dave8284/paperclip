import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { agents, agentApiKeys, authUsers, companies, companyMemberships, executionWorkspaces, heartbeatRuns, instanceUserRoles,
  issues, issueAccessGrants, principalPermissionGrants, projectAccessMembers, projects, projectWorkspaces,
  routines, routineTriggers, runIdentityContexts, type Db } from "@paperclipai/db";
import { conflict, forbidden, notFound } from "../errors.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { routineAccessService } from "./routine-access.js";
import { assertAssignableAgent } from "./agent-assignability.js";
import { assertExecutionWorkspaceRecordAccess, assertTaskWorkspaceSourceProjectAccess } from "./task-workspace-access.js";

type Routine = typeof routines.$inferSelect;
const definitionKeys = ["id", "companyId", "latestRevisionId", "latestRevisionNumber", "status", "assigneeAgentId", "projectId",
  "parentIssueId", "goalId", "title", "description", "priority", "concurrencyPolicy", "variables", "env", "responsibleUserId"] as const;
const definition = (row: Routine) => Object.fromEntries(definitionKeys.map(key => [key, row[key]]));

/** The routine owner pins the definition during dispatch. Admission/replay uses
 * fresh reads; the task owner repeats this with locks inside its own write
 * transaction, which commits before wakeup. Native authorization owns policy. */
export async function authorizeRoutineDispatch(db: Db, input: {
  actor: AuthorizationActor; expected: Routine; assigneeAgentId: string; projectId: string | null;
  triggerId?: string | null; projectWorkspaceId?: string | null; executionWorkspaceId?: string | null;
  lock?: boolean;
}) {
  try {
    const { companyId } = input.expected;
    const [current] = await db.select().from(routines).where(and(eq(routines.id, input.expected.id), eq(routines.companyId, companyId)));
    if (!current) throw notFound("Routine not found");
    if (!isDeepStrictEqual(definition(current), definition(input.expected))) throw conflict("Routine changed while the run was being prepared. Retry the request.");
    if (current.status === "archived") throw conflict("Routine is archived");
    let actor: AuthorizationActor = { ...input.actor, memberships: undefined, onBehalfOfMemberships: undefined };
    Reflect.deleteProperty(actor, "__responsibleUserSnapshotMemo");
    if (actor.type !== "agent" && actor.type !== "board") throw forbidden("Authenticated routine execution is required");
    if (actor.type === "agent" && (actor.companyId !== companyId || actor.agentId !== current.assigneeAgentId))
      throw forbidden("Agents can only run routines assigned to themselves");
    const read = <T>(query: PromiseLike<T> & {
      for(strength: "share" | "no key update" | "update", config: { noWait: true }): PromiseLike<T>;
    }, strength: "share" | "no key update" | "update" = "share") => input.lock === false ? query : query.for(strength, { noWait: true });
    // The outer routine receipt holds company FK KEY SHARE. A non-key lock
    // fences policy changes and the task counter without conflicting with it.
    await read(db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)), "no key update");
    if (actor.type === "agent") {
      const [employee] = await read(db.select().from(agents).where(and(eq(agents.id, actor.agentId!), eq(agents.companyId, companyId))));
      if (!employee || !["active", "idle", "running", "error"].includes(employee.status) || employee.lifecycleState !== "ready") throw forbidden("The routine owner is unavailable");
      if (actor.source === "agent_jwt" && !actor.runId) throw forbidden("The calling execution identity is missing");
      if (actor.runId) {
        const [run] = await read(db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, actor.agentId!))));
        if (!run || run.status !== "running") throw forbidden("The calling execution is no longer active");
        let responsibleUserId = run.responsibleUserId;
        if (run.activeIdentityContextId) {
          const [context] = await read(db.select().from(runIdentityContexts).where(and(eq(runIdentityContexts.id, run.activeIdentityContextId),
            eq(runIdentityContexts.runId, run.id), eq(runIdentityContexts.companyId, companyId), eq(runIdentityContexts.status, "accepted"))));
          if (!context) throw forbidden("The execution identity context changed");
          responsibleUserId = context.responsibleUserId;
        }
        if (!responsibleUserId || responsibleUserId !== actor.onBehalfOfUserId) throw forbidden("The execution responsible user changed");
      }
      if (actor.keyId) {
        const [key] = await read(db.select().from(agentApiKeys).where(and(eq(agentApiKeys.id, actor.keyId), eq(agentApiKeys.companyId, companyId), eq(agentApiKeys.agentId, actor.agentId!))));
        if (!key || key.revokedAt || key.responsibleUserId !== (actor.onBehalfOfUserId ?? null)) throw forbidden("Routine execution credentials changed");
        actor = { ...actor, keyScope: key.scopeConfig ?? undefined };
      }
    }
    const userIds = [...new Set([actor.userId, actor.onBehalfOfUserId, actor.authorizingUserId].filter((id): id is string => !!id))];
    if (userIds.length && actor.source !== "local_implicit") {
      const users = await read(db.select().from(authUsers).where(inArray(authUsers.id, userIds)).orderBy(authUsers.id));
      if (users.length !== userIds.length || users.some(user => user.approvalStatus !== "approved")) throw forbidden("Current approved routine authority is required");
      const roles = await read(db.select().from(instanceUserRoles).where(inArray(instanceUserRoles.userId, userIds)).orderBy(instanceUserRoles.id));
      if (actor.type === "board" && actor.source !== "cloud_tenant") actor.isInstanceAdmin = actor.source !== "mcp_oauth"
        && roles.some(role => role.userId === actor.userId && role.role === "instance_admin");
    }
    const principalIds = [...new Set([...userIds, ...(actor.agentId ? [actor.agentId] : [])])];
    if (principalIds.length) {
      await read(db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), inArray(companyMemberships.principalId, principalIds))).orderBy(companyMemberships.id));
      await read(db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), inArray(principalPermissionGrants.principalId, principalIds))).orderBy(principalPermissionGrants.id));
    }
    const projectIds = [...new Set([current.projectId, input.projectId].filter((id): id is string => !!id))];
    if (projectIds.length) {
      const rows = await read(db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds))).orderBy(projects.id));
      if (rows.length !== projectIds.length) throw notFound("Routine project not found");
      await read(db.select({ id: projectAccessMembers.id }).from(projectAccessMembers).where(and(eq(projectAccessMembers.companyId, companyId), inArray(projectAccessMembers.projectId, projectIds))).orderBy(projectAccessMembers.id));
    }
    const protectedProjects = new Set(projectIds);
    async function protectProject(projectId: string | null) {
      if (!projectId || protectedProjects.has(projectId)) return;
      const [project] = await read(db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, projectId))));
      if (!project) throw notFound("Routine project not found");
      await read(db.select({ id: projectAccessMembers.id }).from(projectAccessMembers).where(and(eq(projectAccessMembers.companyId, companyId), eq(projectAccessMembers.projectId, projectId))).orderBy(projectAccessMembers.id));
      protectedProjects.add(projectId);
    }
    // Native privacy can inherit access from any ancestor. Lock the existing
    // rows that confer it; a new ACL row only adds access and needs no gap lock.
    const protectedIssues = new Set<string>();
    async function protectIssuePrivacy(issueId: string | null) {
      while (issueId && !protectedIssues.has(issueId)) {
        const [task] = await read(db.select({ id: issues.id, projectId: issues.projectId, privacyParentIssueId: issues.privacyParentIssueId })
          .from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, companyId))));
        if (!task) throw notFound("Routine task scope not found");
        protectedIssues.add(task.id);
        await read(db.select({ id: issueAccessGrants.id }).from(issueAccessGrants).where(eq(issueAccessGrants.issueId, task.id)).orderBy(issueAccessGrants.id));
        await protectProject(task.projectId);
        issueId = task.privacyParentIssueId;
      }
    }
    await protectIssuePrivacy(current.parentIssueId);
    // Scoped native assignment may depend on the target's reporting ancestors.
    // Pin each current link before the owning permission evaluator reads it.
    const reportingChain = new Set<string>();
    let targetId: string | null = input.assigneeAgentId;
    while (targetId && !reportingChain.has(targetId)) {
      const [target]: Array<{ id: string; reportsTo: string | null }> = await read(db.select({ id: agents.id, reportsTo: agents.reportsTo }).from(agents)
        .where(and(eq(agents.id, targetId), eq(agents.companyId, companyId))));
      if (!target) throw notFound("Routine assignee scope not found");
      reportingChain.add(target.id);
      targetId = target.reportsTo;
    }
    if (input.triggerId) {
      const [trigger] = await read(db.select().from(routineTriggers).where(and(eq(routineTriggers.id, input.triggerId), eq(routineTriggers.routineId, current.id), eq(routineTriggers.companyId, companyId))));
      if (!trigger || !trigger.enabled || trigger.archived || trigger.setupPending) throw conflict("Routine trigger is not active");
    }
    const routineAccess = routineAccessService(db);
    if (!(await routineAccess.canRead(actor, current)) || !(await routineAccess.canRead(actor, { ...current, projectId: input.projectId }))) throw notFound("Routine scope not found");
    const scope = { projectId: input.projectId, parentIssueId: current.parentIssueId, assigneeAgentId: input.assigneeAgentId, assigneeUserId: null };
    const decision = await authorizationService(db).decide({ actor, action: "tasks:assign", resource: { type: "issue", companyId, issueId: null, ...scope }, scope });
    if (!decision.allowed) throw forbidden(decision.explanation);
    await assertAssignableAgent(db, companyId, input.assigneeAgentId, { kind: "routine" });
    if (input.projectWorkspaceId) {
      const [workspace] = await read(db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.id, input.projectWorkspaceId), eq(projectWorkspaces.companyId, companyId))));
      if (!workspace) throw notFound("Workspace source not found");
      await protectProject(workspace.projectId);
      await assertTaskWorkspaceSourceProjectAccess(db, actor, companyId, workspace.projectId);
    }
    if (input.executionWorkspaceId) {
      // A newly linked private task can narrow workspace visibility. Unlike
      // SHARE, UPDATE fences its FK insertion while inventory is authorized.
      const [workspace] = await read(db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, input.executionWorkspaceId), eq(executionWorkspaces.companyId, companyId))), "update");
      if (!workspace) throw notFound("Routine workspace not found");
      await protectProject(workspace.projectId);
      const sources = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.executionWorkspaceId, workspace.id)));
      const sourceIds = new Set([...sources.map(source => source.id), ...Object.keys(workspace.metadata?._issuePrivacySources ?? {}), ...(workspace.sourceIssueId ? [workspace.sourceIssueId] : [])]);
      for (const id of sourceIds) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw forbidden("Routine workspace source is unavailable");
        await protectIssuePrivacy(id);
      }
      await assertExecutionWorkspaceRecordAccess(db, actor, companyId, input.executionWorkspaceId);
    }
    return actor;
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure?.cause?.code ?? failure?.code) === "55P03") throw conflict("Routine execution authority is changing. Retry the request.", { retryable: true });
    throw error;
  }
}

export async function authorizeRoutineReplay(db: Db, actor: AuthorizationActor, companyId: string,
  existing: { dispatchFingerprint: string | null; linkedIssueId: string | null }, fingerprint: string) {
  if (existing.dispatchFingerprint !== fingerprint) throw conflict("This idempotency key belongs to a different routine execution request.");
  if (existing.linkedIssueId) await authorizeRoutineExecutionRead(db, actor, companyId, existing.linkedIssueId);
}

export async function authorizeRoutineExecutionRead(db: Db, actor: AuthorizationActor, companyId: string, issueId: string) {
  const [decision] = await authorizationService(db).decideReads(actor, [{ type: "issue", companyId, issueId }]);
  if (!decision?.allowed) throw notFound("Routine execution not found");
}
