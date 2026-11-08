import { and, eq } from "drizzle-orm";
import { activityLog, authUsers, companyMemberships, instanceUserRoles, type Db } from "@paperclipai/db";
import type { RoutingPolicy } from "@agentos/model-intelligence";
import { modelProfileDigest } from "./model-profile-binding.js";

/** A SQLite policy alone cannot authorize native execution. Require its exact
 * committed host audit plus the configuring owner's current authority. An
 * acknowledgement gap across databases therefore leaves alternatives disabled. */
export async function nativeModelRoutingAuthority(db: Db, companyId: string, policy: RoutingPolicy): Promise<boolean> {
  if (policy.namespace !== companyId || !/^[0-9a-f-]{36}$/i.test(policy.id)) return false;
  const [row] = await db.select({ details: activityLog.details }).from(activityLog)
    .innerJoin(authUsers, and(eq(authUsers.id, activityLog.actorId), eq(authUsers.approvalStatus, "approved")))
    .innerJoin(instanceUserRoles, and(eq(instanceUserRoles.userId, authUsers.id), eq(instanceUserRoles.role, "instance_admin")))
    .innerJoin(companyMemberships, and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, authUsers.id), eq(companyMemberships.status, "active")))
    .where(and(eq(activityLog.id, policy.id), eq(activityLog.companyId, companyId), eq(activityLog.actorType, "user"),
      eq(activityLog.action, "model_routing.policy_configured"), eq(activityLog.entityType, "model_routing_policy"), eq(activityLog.entityId, policy.taskType))).limit(1);
  return row?.details?.policyFingerprint === modelProfileDigest(policy);
}
