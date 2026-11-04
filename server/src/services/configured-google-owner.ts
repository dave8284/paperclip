import { and, eq, inArray, sql } from "drizzle-orm";
import { agentosAdminEvents, authAccounts, authUsers, companyMemberships, instanceUserRoles, type Db } from "@paperclipai/db";
import { claimLocalBoardOwnershipInTransaction, completeLocalBoardTransferInTransaction, markBoardOwnershipClaimed } from "../board-claim.js";
import { accessService } from "./access.js";
import { publishActivity, type ActivityPublication } from "./activity-log.js";
import { logger } from "../middleware/logger.js";
import { conflict, forbidden } from "../errors.js";

export interface VerifiedGoogleOwnerIdentity { email: string; subject: string }

function isMembershipLockBusy(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const value = error as { code?: string; cause?: unknown };
    if (value.code === "55P03") return true;
    error = value.cause;
  }
  return false;
}

/** Called only by the auth owner's fresh verified Google sign-in hook. There is
 * no HTTP/email-only approval endpoint. Configuration identifies an owner; the
 * native account binding still proves which persisted user may receive access. */
export async function provisionConfiguredGoogleOwner(db: Db, userId: string, identity: VerifiedGoogleOwnerIdentity) {
  const publications: ActivityPublication[] = [];
  const result = await db.transaction(async transaction => {
    const tx = transaction as unknown as Db;
    // Share the lock order used by bootstrap and administrator changes.
    await tx.execute(sql`lock table ${instanceUserRoles} in share row exclusive mode`);
    const [user] = await tx.select({ id: authUsers.id, email: authUsers.email, emailVerified: authUsers.emailVerified,
      approvalStatus: authUsers.approvalStatus, approvalRevision: authUsers.approvalRevision })
      .from(authUsers).where(eq(authUsers.id, userId)).for("update");
    if (!user || !user.emailVerified || user.email.trim().toLowerCase() !== identity.email) {
      throw forbidden("Configured Google owner identity does not match the registered account.");
    }
    const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts).where(and(
      eq(authAccounts.userId, userId), eq(authAccounts.providerId, "google"),
      eq(authAccounts.issuer, "https://accounts.google.com"), eq(authAccounts.accountId, identity.subject),
    )).for("update").limit(1);
    if (!account) throw forbidden("Configured Google owner identity does not match the registered account.");
    // A configured bootstrap identity never overrides an administrator's later
    // suspension/rejection or restores a role deliberately removed after setup.
    if (!["pending", "approved"].includes(user.approvalStatus)) return { status: "restricted" as const };
    const [previous] = await tx.select({ id: agentosAdminEvents.id }).from(agentosAdminEvents).where(and(
      eq(agentosAdminEvents.targetUserId, userId), eq(agentosAdminEvents.action, "user.google_owner_provisioned"),
    )).limit(1);
    if (previous) return { status: "already_provisioned" as const };
    // Older native claims already approved/promoted the user, but did not move
    // local conversations and operational responsibility. Fresh Google proof
    // alone cannot authorize this repair: require the prior self-claim audit
    // and retain only currently active owner memberships, locked against revoke.
    const [nativeClaim] = await tx.select({ id: agentosAdminEvents.id }).from(agentosAdminEvents).where(and(
      eq(agentosAdminEvents.actorUserId, userId), eq(agentosAdminEvents.targetUserId, userId),
      eq(agentosAdminEvents.action, "user.local_board_claimed"),
    )).limit(1);
    if (nativeClaim) {
      const [admin] = await tx.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(
        eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin"),
      )).limit(1);
      if (user.approvalStatus !== "approved" || !admin) return { status: "restricted" as const };
      let companyIds: string[];
      try {
        const memberships = await tx.select({ companyId: companyMemberships.companyId }).from(companyMemberships).where(and(
          eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"), eq(companyMemberships.membershipRole, "owner"),
        )).orderBy(companyMemberships.companyId, companyMemberships.id).for("update", { noWait: true });
        companyIds = memberships.map(membership => membership.companyId);
        // Native membership changes may lock all company owners in a different
        // order. Acquire the bootstrap rows without waiting before archiving, so
        // competing access changes cause a clean rollback rather than a cycle.
        if (companyIds.length) await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
          inArray(companyMemberships.companyId, companyIds), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, "local-board"), eq(companyMemberships.status, "active"),
        )).orderBy(companyMemberships.companyId, companyMemberships.id).for("update", { noWait: true });
      } catch (error) {
        if (isMembershipLockBusy(error)) throw conflict("Company access is changing. Retry Google sign-in after the change finishes.");
        throw error;
      }
      await completeLocalBoardTransferInTransaction(tx, { userId, companyIds });
      await tx.insert(agentosAdminEvents).values({ actorUserId: "system", targetUserId: userId,
        action: "user.google_owner_provisioned", details: { policy: "configured_google_owner", provider: "google",
          source: "legacy_native_claim", nativeClaimEventId: nativeClaim.id, companyIds, transferredLocalBoard: false } });
      return { status: "provisioned" as const, transferredLocalBoard: false, completedLegacyClaim: true };
    }
    const transferredLocalBoard = await claimLocalBoardOwnershipInTransaction(tx, { userId }, publications);
    if (!transferredLocalBoard) {
      await tx.update(authUsers).set({ approvalStatus: "approved", approvalRevision: user.approvalRevision + 1, updatedAt: new Date() }).where(eq(authUsers.id, userId));
      await accessService(tx).promoteInstanceAdmin(userId);
    }
    await tx.insert(agentosAdminEvents).values({ actorUserId: "system", targetUserId: userId,
      action: "user.google_owner_provisioned", details: { policy: "configured_google_owner", provider: "google", transferredLocalBoard } });
    return { status: "provisioned" as const, transferredLocalBoard };
  });
  if (result.status === "provisioned" && result.transferredLocalBoard) markBoardOwnershipClaimed(userId);
  for (const publication of publications) {
    try { publishActivity(publication); }
    catch (error) { logger.warn({ err: error }, "Configured owner committed; live activity publication failed"); }
  }
  return result;
}
