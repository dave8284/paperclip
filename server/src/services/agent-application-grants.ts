import { and, eq, inArray } from "drizzle-orm";
import { agents, authUsers, companyMemberships, instanceUserRoles, principalPermissionGrants, type Db } from "@paperclipai/db";
import { conflict, forbidden, notFound } from "../errors.js";
import { accessService } from "./access.js";
import type { AuthorizationActor } from "./authorization.js";
import { persistActivity, publishActivity } from "./activity-log.js";

/** The caller owns the transaction. Both direct grants and imports retain the
 * same current board authority until their writes commit. */
export async function authorizeBoardAgentPermissionGrant(tx: Db, input: {
  companyId: string; actor: AuthorizationActor; requireApplicationManagement: boolean;
}): Promise<AuthorizationActor> {
  if (input.actor.type !== "board") throw forbidden("Only board members can manage application permissions.");
  const lock = { noWait: true } as const;
  // Authentication may predate a wait. Pin current approval, membership and
  // every existing grant through commit; native grant writers lock the
  // membership parent even before inserting the first scoped rule.
  const actor: AuthorizationActor = { ...input.actor, memberships: undefined, onBehalfOfMemberships: undefined };
  Reflect.deleteProperty(actor, "__responsibleUserSnapshotMemo");
  if (actor.source !== "local_implicit") {
    if (!actor.userId) throw forbidden("An authenticated board member is required.");
    const userIds = [...new Set([actor.userId, actor.onBehalfOfUserId, actor.authorizingUserId].filter((id): id is string => !!id))];
    const users = await tx.select({ approvalStatus: authUsers.approvalStatus }).from(authUsers)
      .where(inArray(authUsers.id, userIds)).orderBy(authUsers.id).for("share", lock);
    if (users.length !== userIds.length || users.some(user => user.approvalStatus !== "approved")) throw forbidden("Current approved board access is required.");
    const roles = await tx.select({ userId: instanceUserRoles.userId, role: instanceUserRoles.role }).from(instanceUserRoles)
      .where(inArray(instanceUserRoles.userId, userIds)).orderBy(instanceUserRoles.id).for("share", lock);
    if (actor.source !== "cloud_tenant") actor.isInstanceAdmin = actor.source !== "mcp_oauth"
      && roles.some(role => role.userId === actor.userId && role.role === "instance_admin");
    await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "user"),
      inArray(companyMemberships.principalId, userIds),
    )).orderBy(companyMemberships.id).for("share", lock);
    await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, input.companyId), eq(principalPermissionGrants.principalType, "user"),
      inArray(principalPermissionGrants.principalId, userIds),
    )).orderBy(principalPermissionGrants.id).for("share", lock);
  }
  const access = accessService(tx);
  const actions = input.requireApplicationManagement ? ["users:manage_permissions", "applications:manage"] as const : ["users:manage_permissions"] as const;
  for (const action of actions) {
    const decision = await access.decide({ actor, action, resource: { type: "company", companyId: input.companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation);
  }
  return actor;
}

/** Explicit company authority is granted by the board, never inferred from an
 * employee's title or the legacy canCreateAgents configuration flag. */
export async function setAgentApplicationManagementGrant(db: Db, input: {
  companyId: string; agentId: string; actor: AuthorizationActor; enabled: boolean;
}) {
  if (input.actor.type !== "board") throw forbidden("Only board members can manage application permissions.");
  const publication = await db.transaction(async connection => {
    const tx = connection as unknown as Db;
    const lock = { noWait: true } as const;
    const [target] = await tx.select().from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId))).for("update", lock);
    if (!target) throw notFound("Agent not found");
    if (input.enabled && ["pending_approval", "terminated"].includes(target.status)) {
      throw conflict("Approve or restore this employee before granting application permissions.");
    }
    const actor = await authorizeBoardAgentPermissionGrant(tx, {
      companyId: input.companyId, actor: input.actor, requireApplicationManagement: input.enabled,
    });
    const access = accessService(tx);
    // Avoid reversing a concurrent member/lifecycle writer's lock order. The
    // native single-key writer below preserves membership role and status.
    await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "agent"),
      eq(companyMemberships.principalId, input.agentId),
    )).for("update", lock);
    await access.setPrincipalPermission(input.companyId, "agent", input.agentId, "applications:manage", input.enabled, actor.userId ?? null);
    return (await persistActivity(tx, {
      companyId: input.companyId, actorType: "user", actorId: actor.userId ?? "local-board",
      action: "agent.permissions_updated", entityType: "agent", entityId: input.agentId,
      details: { permissionKey: "applications:manage", enabled: input.enabled, scope: null },
    })).publication;
  }).catch((error: unknown) => {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure?.cause?.code ?? failure?.code) === "55P03") throw conflict("Permission authority is changing. Retry the request.", { retryable: true });
    throw error;
  });
  publishActivity(publication);
}
