import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, companyMemberships, instanceUserRoles, agentosPortfolios, authUsers, agentosAdminEvents, issues } from "@paperclipai/db";
import type { DeploymentMode } from "@paperclipai/shared";
import { ensureHumanRoleDefaultGrants } from "./services/principal-access-compatibility.js";
import { persistActivity, publishActivity, type ActivityPublication } from "./services/activity-log.js";
import { logger } from "./middleware/logger.js";
import { routineService } from "./services/routines.js";
import { conflict } from "./errors.js";

const LOCAL_BOARD_USER_ID = "local-board";
const CLAIM_TTL_MS = 1000 * 60 * 60 * 24;

type ChallengeStatus = "available" | "claimed" | "expired" | "invalid";

type ClaimChallenge = {
  token: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  claimedByUserId: string | null;
};

let activeChallenge: ClaimChallenge | null = null;

function isConversationOwnershipConflict(error: unknown) {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown };
    if (candidate.code === "23505" &&
        (candidate.constraint ?? candidate.constraint_name) === "issues_conversation_identity_idx") return true;
    current = candidate.cause;
  }
  return false;
}

function createChallenge(now = new Date()): ClaimChallenge {
  return {
    token: randomBytes(24).toString("hex"),
    code: randomBytes(12).toString("hex"),
    createdAt: now,
    expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
    claimedAt: null,
    claimedByUserId: null,
  };
}

function getChallengeStatus(token: string, code: string | undefined): ChallengeStatus {
  if (!activeChallenge) return "invalid";
  if (activeChallenge.token !== token) return "invalid";
  if (activeChallenge.code !== (code ?? "")) return "invalid";
  if (activeChallenge.claimedAt) return "claimed";
  if (activeChallenge.expiresAt.getTime() <= Date.now()) return "expired";
  return "available";
}

export async function initializeBoardClaimChallenge(
  db: Db,
  opts: { deploymentMode: DeploymentMode },
): Promise<void> {
  if (opts.deploymentMode !== "authenticated") {
    activeChallenge = null;
    return;
  }

  const admins = await db
    .select({ userId: instanceUserRoles.userId })
    .from(instanceUserRoles)
    .where(eq(instanceUserRoles.role, "instance_admin"));

  const onlyLocalBoardAdmin = admins.length === 1 && admins[0]?.userId === LOCAL_BOARD_USER_ID;
  if (!onlyLocalBoardAdmin) {
    activeChallenge = null;
    return;
  }

  if (!activeChallenge || activeChallenge.expiresAt.getTime() <= Date.now() || activeChallenge.claimedAt) {
    activeChallenge = createChallenge();
  }
}

export function getBoardClaimWarningUrl(host: string, port: number): string | null {
  if (!activeChallenge) return null;
  if (activeChallenge.claimedAt || activeChallenge.expiresAt.getTime() <= Date.now()) return null;
  const visibleHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${visibleHost}:${port}/board-claim/${activeChallenge.token}?code=${activeChallenge.code}`;
}

export function inspectBoardClaimChallenge(token: string, code: string | undefined) {
  const status = getChallengeStatus(token, code);
  return {
    status,
    requiresSignIn: true,
    expiresAt: activeChallenge?.expiresAt?.toISOString() ?? null,
    claimedByUserId: activeChallenge?.claimedByUserId ?? null,
  };
}

/** Update the in-memory ceremony only after ownership has committed. */
export function markBoardOwnershipClaimed(userId: string) {
  if (activeChallenge && !activeChallenge.claimedAt) {
    activeChallenge.claimedAt = new Date();
    activeChallenge.claimedByUserId = userId;
  }
}

/** Complete only remaining bootstrap-owned data inside an authorized company
 * scope. This never grants/reinstates membership or permissions. */
export async function completeLocalBoardTransferInTransaction(
  tx: Db, opts: { userId: string; companyIds: string[] },
): Promise<void> {
  if (!opts.companyIds.length) return;
  // Transfer only explicit operational responsibility. Null defaults still
  // resolve through active membership; retaining an active local-board owner
  // would let that fallback select the retired bootstrap identity.
  await tx.update(companyMemberships).set({ status: "archived", updatedAt: new Date() }).where(and(
    inArray(companyMemberships.companyId, opts.companyIds),
    eq(companyMemberships.principalType, "user"),
    eq(companyMemberships.principalId, LOCAL_BOARD_USER_ID),
    eq(companyMemberships.status, "active"),
  ));
  await tx.update(companies).set({ defaultResponsibleUserId: opts.userId, updatedAt: new Date() })
    .where(and(eq(companies.defaultResponsibleUserId, LOCAL_BOARD_USER_ID), inArray(companies.id, opts.companyIds)));
  // Conversation identity is also an access boundary. Keep the existing
  // thread, session and history, including hidden chats. The native unique
  // index serializes competing claimant-chat creation; never merge histories.
  try {
    await tx.update(issues).set({ conversationUserId: opts.userId })
      .where(and(eq(issues.conversationUserId, LOCAL_BOARD_USER_ID), inArray(issues.companyId, opts.companyIds)));
  } catch (error) {
    if (isConversationOwnershipConflict(error)) {
      throw conflict("Board ownership was not transferred because this account already has a chat with an agent from the local board. Both conversations have been preserved.");
    }
    throw error;
  }
  await tx.update(issues).set({ responsibleUserId: opts.userId, updatedAt: new Date() }).where(and(
    inArray(issues.companyId, opts.companyIds),
    eq(issues.responsibleUserId, LOCAL_BOARD_USER_ID),
    inArray(issues.status, ["backlog", "todo", "in_progress", "in_review", "blocked"]),
    isNull(issues.hiddenAt),
  ));
  const routineSvc = routineService(tx);
  for (const companyId of opts.companyIds) {
    await routineSvc.claimLocalBoardResponsibility(tx as unknown as Db, companyId, opts.userId);
  }
}

/** Reuse the native transfer under the caller's transaction and authorization.
 * The caller publishes returned activity only after its whole transaction commits. */
export async function claimLocalBoardOwnershipInTransaction(
  tx: Db, opts: { userId: string }, publications: ActivityPublication[],
): Promise<boolean> {
  await tx.execute(sql`lock table ${instanceUserRoles} in share row exclusive mode`);
  const admins = await tx.select({ userId: instanceUserRoles.userId }).from(instanceUserRoles).where(eq(instanceUserRoles.role, "instance_admin"));
  if (admins.length !== 1 || admins[0]?.userId !== LOCAL_BOARD_USER_ID) return false;
  const existingTargetAdmin = await tx
    .select({ id: instanceUserRoles.id })
    .from(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, opts.userId), eq(instanceUserRoles.role, "instance_admin")))
    .then((rows) => rows[0] ?? null);
  if (!existingTargetAdmin) {
    await tx.insert(instanceUserRoles).values({
      userId: opts.userId,
      role: "instance_admin",
    });
  }

  await tx
    .delete(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, LOCAL_BOARD_USER_ID), eq(instanceUserRoles.role, "instance_admin")));
  await tx.update(authUsers).set({ approvalStatus: "approved", approvalRevision: sql`${authUsers.approvalRevision} + 1`, updatedAt: new Date() }).where(eq(authUsers.id, opts.userId));
  await tx.insert(agentosAdminEvents).values({ actorUserId: opts.userId, targetUserId: opts.userId, action: "user.local_board_claimed" });

  const allCompanies = await tx.select({ id: companies.id }).from(companies);
  for (const company of allCompanies) {
    const existing = await tx
      .select({ id: companyMemberships.id, status: companyMemberships.status, membershipRole: companyMemberships.membershipRole })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, company.id),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, opts.userId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (!existing) {
      await tx.insert(companyMemberships).values({
        companyId: company.id,
        principalType: "user",
        principalId: opts.userId,
        status: "active",
        membershipRole: "owner",
      });
    } else if (existing.status !== "active" || existing.membershipRole !== "owner") {
      await tx
        .update(companyMemberships)
        .set({ status: "active", membershipRole: "owner", updatedAt: new Date() })
        .where(eq(companyMemberships.id, existing.id));
    }
  }
  await completeLocalBoardTransferInTransaction(tx, {
    userId: opts.userId, companyIds: allCompanies.map(company => company.id),
  });
  // The existing local-to-authenticated ownership ceremony also transfers
  // local portfolios. Never take a portfolio owned by another real user.
  const claimedPortfolios = await tx.update(agentosPortfolios).set({
    ownerUserId: opts.userId, revision: sql`${agentosPortfolios.revision} + 1`,
  }).where(eq(agentosPortfolios.ownerUserId, LOCAL_BOARD_USER_ID)).returning();
  for (const portfolio of claimedPortfolios) {
    const result = await persistActivity(tx as unknown as Db, {
      companyId: portfolio.homeCompanyId, actorType: "user", actorId: opts.userId,
      action: "agentos.portfolio_claimed", entityType: "agentos_workforce", entityId: portfolio.id,
      details: { previousOwner: LOCAL_BOARD_USER_ID, revision: portfolio.revision },
    });
    publications.push(result.publication);
  }
  // A failed grant insert must roll back the entire ownership ceremony, not
  // leave a committed claim whose new owner cannot administer the companies.
  for (const company of allCompanies) {
    await ensureHumanRoleDefaultGrants(tx as unknown as Db, {
      companyId: company.id,
      principalId: opts.userId,
      membershipRole: "owner",
      grantedByUserId: opts.userId,
    });
  }
  return true;
}

export async function claimBoardOwnership(
  db: Db,
  opts: { token: string; code: string | undefined; userId: string },
): Promise<{ status: ChallengeStatus; claimedByUserId?: string }> {
  const status = getChallengeStatus(opts.token, opts.code);
  if (status !== "available") return { status };

  const publications: ActivityPublication[] = [];
  const didClaim = await db.transaction(tx => claimLocalBoardOwnershipInTransaction(tx as unknown as Db, opts, publications));
  if (!didClaim) return { status: "invalid" };

  for (const publication of publications) {
    try { publishActivity(publication); }
    catch (error) { logger.warn({ err: error }, "Board ownership committed; live activity publication failed"); }
  }

  if (activeChallenge && activeChallenge.token === opts.token) {
    markBoardOwnershipClaimed(opts.userId);
  }

  return { status: "claimed", claimedByUserId: opts.userId };
}
