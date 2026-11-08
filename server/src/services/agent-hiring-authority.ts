import { and, eq, inArray, or, sql } from "drizzle-orm";
import { agents, agentosDepartments, authUsers, companyMemberships, companyOperatingProfiles, principalPermissionGrants, type Db } from "@paperclipai/db";
import { conflict, forbidden } from "../errors.js";
import { accessService } from "./access.js";
import type { AuthorizationActor } from "./authorization.js";

/** Native hiring remains available under its existing grants. An appointed
 * department head and employees below it additionally own only their own
 * current reporting subtree. The internal departmentHead admission flag pins
 * this department boundary for both heads and their descendants. */
export async function resolveAgentHiringAuthority(db: Db, companyId: string, actor: AuthorizationActor,
  input: { role?: string | null; reportsTo?: string | null }, options: {
    lock?: boolean; requireDepartmentHead?: boolean; configurationTargetId?: string; configurationRequiresChangeGrant?: boolean;
    /** A consent receipt consumed by this server request, never request JSON. */
    configurationConsentedChange?: boolean;
    /** Route preflight only; native authorization remains in the locked writer. */
    configurationScopeOnly?: boolean;
    targetAction?: "agent_config:update" | "agent_instructions:update" | "workforce:retire";
    /** IDs created by this server-side import, never taken from request data. */
    importedManagerIds?: readonly string[];
  } = {}) {
  if (actor.type !== "agent" || actor.companyId !== companyId || !actor.agentId) throw forbidden("A same-company hiring agent is required.");
  if (options.configurationScopeOnly && (options.lock || !options.configurationTargetId))
    throw forbidden("Department scope preflight cannot authorize a mutation.");
  try {
    if (options.lock) {
      await db.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`department-management:${companyId}`}, 0))`);
      await db.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`operating-profile:${companyId}`}, 0))`);
    }
    const actorQuery = db.select().from(agents).where(and(eq(agents.id, actor.agentId), eq(agents.companyId, companyId)));
    const [hiringAgent] = await (options.lock ? actorQuery.for("share", { noWait: true }) : actorQuery);
    if (!hiringAgent || (!options.configurationTargetId && (hiringAgent.lifecycleState !== "ready" || !["active", "idle", "running", "error"].includes(hiringAgent.status))))
      throw forbidden("The hiring employee is unavailable.");
    actor = { ...actor, onBehalfOfMemberships: undefined };
    Reflect.deleteProperty(actor, "__responsibleUserSnapshotMemo");
    if (options.lock) {
      const users = [...new Set([actor.onBehalfOfUserId, actor.authorizingUserId].filter((id): id is string => !!id))];
      if (users.length) {
        const approved = await db.select().from(authUsers).where(inArray(authUsers.id, users)).orderBy(authUsers.id).for("share", { noWait: true });
        if (approved.length !== users.length || approved.some(user => user.approvalStatus !== "approved")) throw forbidden("Current approved hiring authority is required.");
      }
      await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), or(
        and(eq(companyMemberships.principalType, "agent"), eq(companyMemberships.principalId, actor.agentId!)),
        users.length ? and(eq(companyMemberships.principalType, "user"), inArray(companyMemberships.principalId, users)) : undefined,
      ))).orderBy(companyMemberships.id).for("share", { noWait: true });
      await db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), or(
        and(eq(principalPermissionGrants.principalType, "agent"), eq(principalPermissionGrants.principalId, actor.agentId!)),
        users.length ? and(eq(principalPermissionGrants.principalType, "user"), inArray(principalPermissionGrants.principalId, users)) : undefined,
      ))).orderBy(principalPermissionGrants.id).for("share", { noWait: true });
    }
    const [profile] = await db.select().from(companyOperatingProfiles).where(eq(companyOperatingProfiles.companyId, companyId));
    if (profile?.fridayAgentId === hiringAgent.id && options.configurationTargetId !== hiringAgent.id)
      throw forbidden("Friday directs company executives; they hire and configure their teams.");
    const request = options.configurationTargetId
      ? { actor, action: options.targetAction ?? "agent_config:update", resource: { type: "agent" as const, companyId, agentId: options.configurationTargetId }, scope: {
        targetAgentId: options.configurationTargetId, ...(options.configurationRequiresChangeGrant ? { requiresChangeGrant: true } : {}),
        ...(options.configurationConsentedChange ? { consentedChange: true } : {}),
      } }
      : { actor, action: "agents:create" as const, resource: { type: "company" as const, companyId } };
    if (!options.configurationScopeOnly) {
      const native = await accessService(db).decide(request);
      if (!native.allowed) throw forbidden(native.explanation);
    }
    const departmentQuery = db.select({ id: agentosDepartments.id }).from(agentosDepartments)
      .where(and(eq(agentosDepartments.companyId, companyId), eq(agentosDepartments.leadAgentId, hiringAgent.id)));
    const departments = await (options.lock ? departmentQuery.for("share", { noWait: true }) : departmentQuery);
    let departmentHead = hiringAgent.role !== "ceo" && departments.length > 0;
    // A head's ordinary new employee has native creator/configuration grants.
    // Those grants cannot be used to escape the parent's company department.
    // Resolve current ancestry, without inventing a historical role or granting
    // departmental authority to a specialist who reports directly to the CEO.
    if (!departmentHead && hiringAgent.role !== "ceo") {
      let ancestorId: string | null = hiringAgent.reportsTo;
      const ancestry = new Set([hiringAgent.id]);
      while (ancestorId) {
        if (ancestry.has(ancestorId) || ancestry.size >= 100) throw forbidden("The reporting team contains a cycle or is too deep.");
        ancestry.add(ancestorId);
        const ancestorQuery = db.select({ id: agents.id, role: agents.role, reportsTo: agents.reportsTo }).from(agents)
          .where(and(eq(agents.id, ancestorId), eq(agents.companyId, companyId)));
        const [ancestor] = await (options.lock ? ancestorQuery.for("share", { noWait: true }) : ancestorQuery);
        if (!ancestor) throw forbidden("The employee's reporting team must remain in the current company.");
        if (ancestor.role === "ceo") break;
        const appointmentQuery = db.select({ id: agentosDepartments.id }).from(agentosDepartments)
          .where(and(eq(agentosDepartments.companyId, companyId), eq(agentosDepartments.leadAgentId, ancestor.id)));
        const appointments = await (options.lock ? appointmentQuery.for("share", { noWait: true }) : appointmentQuery);
        if (appointments.length) { departmentHead = true; break; }
        ancestorId = ancestor.reportsTo;
      }
    }
    if (options.requireDepartmentHead && !departmentHead) throw conflict("The department appointment changed or the reporting assignment moved. Retry the request.");
    if (!departmentHead) return { reportsTo: input.reportsTo, departmentHead: false };
    if (hiringAgent.lifecycleState !== "ready" || !["active", "idle", "running", "error"].includes(hiringAgent.status)) throw forbidden("The department employee is unavailable.");
    if (input.role === "ceo" || input.reportsTo === null) throw forbidden("Department employees hire staff within their own reporting team.");
    const reportsTo = input.reportsTo ?? hiringAgent.id;
    let cursor: string | null = reportsTo;
    const visited = new Set<string>();
    while (cursor && cursor !== hiringAgent.id && visited.size < 100) {
      if (visited.has(cursor)) throw forbidden("The reporting team contains a cycle.");
      visited.add(cursor);
      const managerQuery = db.select({ id: agents.id, reportsTo: agents.reportsTo, status: agents.status, lifecycleState: agents.lifecycleState })
        .from(agents).where(and(eq(agents.id, cursor), eq(agents.companyId, companyId)));
      const [manager] = await (options.lock ? managerQuery.for("share", { noWait: true }) : managerQuery);
      const retiringTarget = options.targetAction === "workforce:retire" && cursor === options.configurationTargetId;
      const importingManager = manager?.lifecycleState === "preparing" && options.importedManagerIds?.includes(manager.id);
      const currentEmployee = manager && (retiringTarget || importingManager || manager.lifecycleState === "ready"
        || (manager.status === "paused" && manager.lifecycleState === "paused"));
      if (!currentEmployee || (!retiringTarget && !["active", "idle", "running", "error", "paused"].includes(manager.status)))
        throw forbidden("The hiring manager must be a current employee in this department's reporting team.");
      cursor = manager.reportsTo;
    }
    if (cursor !== hiringAgent.id) throw forbidden("Department employees hire staff within their own reporting team.");
    if (visited.size) {
      const otherDepartmentsQuery = db.select({ id: agentosDepartments.id }).from(agentosDepartments)
        .where(and(eq(agentosDepartments.companyId, companyId), inArray(agentosDepartments.leadAgentId, [...visited])));
      const otherDepartments = await (options.lock ? otherDepartmentsQuery.for("share", { noWait: true }) : otherDepartmentsQuery);
      if (otherDepartments.length) throw forbidden("Department employees cannot hire into another department head's team.");
    }
    return { reportsTo, departmentHead: true };
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure?.cause?.code ?? failure?.code) === "55P03") throw conflict("Hiring authority is changing. Retry the request.", { retryable: true });
    throw error;
  }
}

export async function assertDepartmentWorkforceTarget(db: Db, companyId: string, actor: AuthorizationActor,
  targetAgentId: string, action: "agent_config:update" | "workforce:retire", requireDepartmentHead: boolean) {
  if (actor.type !== "agent") return;
  const [target] = await db.select({ id: agents.id, role: agents.role }).from(agents)
    .where(and(eq(agents.id, targetAgentId), eq(agents.companyId, companyId))).for("share", { noWait: true });
  if (!target) throw forbidden("The employee must belong to this company.");
  const authority = await resolveAgentHiringAuthority(db, companyId, actor, { role: target.role, reportsTo: target.id },
    { lock: true, requireDepartmentHead, configurationTargetId: target.id, targetAction: action });
  if (authority.departmentHead && action === "workforce:retire" && target.id === actor.agentId)
    throw forbidden("The company CEO or board retires a department head.");
}

/** A graph edit cannot evade the same boundary by hiring first and promoting or
 * moving the employee afterward. Existing native configure/consent checks stay
 * with their caller; this is the department ownership ceiling. */
export async function resolveDepartmentConfigurationAuthority(db: Db,
  existing: { id: string; companyId: string; role: string; reportsTo: string | null }, actor: AuthorizationActor,
  patch: { role?: string | null; reportsTo?: string | null }, options: {
    lock?: boolean; requireDepartmentHead?: boolean; configurationRequiresChangeGrant?: boolean;
    configurationConsentedChange?: boolean; configurationScopeOnly?: boolean;
    targetAction?: "agent_config:update" | "agent_instructions:update";
  } = {}) {
  const configOptions = { ...options, configurationTargetId: existing.id };
  // Walking from the target itself proves it is already in this team and is
  // not a separately appointed head beneath the caller's reporting chain.
  const current = await resolveAgentHiringAuthority(db, existing.companyId, actor,
    { role: existing.role, reportsTo: existing.id }, configOptions);
  if (!current.departmentHead) return current;
  const self = existing.id === actor.agentId;
  if (self && patch.reportsTo !== undefined && patch.reportsTo !== existing.reportsTo)
    throw forbidden("The company CEO or board changes a department head's reporting line.");
  return resolveAgentHiringAuthority(db, existing.companyId, actor, {
    role: patch.role ?? existing.role,
    reportsTo: self ? existing.id : patch.reportsTo === undefined ? existing.reportsTo : patch.reportsTo,
  }, { ...configOptions, requireDepartmentHead: true });
}
