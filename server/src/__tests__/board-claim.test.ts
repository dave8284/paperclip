import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  authUsers,
  companies,
  companyMemberships,
  createDb,
  instanceUserRoles,
  principalPermissionGrants,
  agentosPortfolios,
  activityLog,
} from "@paperclipai/db";
import {
  claimBoardOwnership,
  getBoardClaimWarningUrl,
  initializeBoardClaimChallenge,
  inspectBoardClaimChallenge,
} from "../board-claim.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("board claim", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-board-claim-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await initializeBoardClaimChallenge(db, { deploymentMode: "local_trusted" });
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(activityLog);
    await db.delete(agentosPortfolios);
    await db.delete(companies);
    await db.delete(instanceUserRoles);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it.each([false, true])("claims a local board and its portfolios, including an existing viewer (%s)", async (existingViewer) => {
    const now = new Date();
    const userId = `claim-user-${randomUUID()}`;
    const company = await db
      .insert(companies)
      .values({
        name: "Board Claim Co",
        issuePrefix: `BC${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);

    const [localPortfolio, otherPortfolio] = await db.insert(agentosPortfolios).values([
      { homeCompanyId: company.id, ownerUserId: "local-board", name: "Local portfolio" },
      { homeCompanyId: company.id, ownerUserId: "another-owner", name: "Other owner's portfolio" },
    ]).returning();
    if (existingViewer) await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, status: "active", membershipRole: "viewer" });

    await db.insert(authUsers).values({
      id: userId,
      name: "Board Claim User",
      email: "board-claim@example.test",
      emailVerified: true,
      approvalStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(instanceUserRoles).values({
      userId: "local-board",
      role: "instance_admin",
    });

    await initializeBoardClaimChallenge(db, { deploymentMode: "authenticated" });
    const warningUrl = getBoardClaimWarningUrl("127.0.0.1", 3197);
    expect(warningUrl).toBeTruthy();

    const parsed = new URL(warningUrl!);
    const token = parsed.pathname.split("/").pop()!;
    const code = parsed.searchParams.get("code")!;

    expect(inspectBoardClaimChallenge(token, code)).toMatchObject({
      status: "available",
      requiresSignIn: true,
      claimedByUserId: null,
    });
    await expect(claimBoardOwnership(db, { token, code: "incorrect", userId })).resolves.toEqual({ status: "invalid" });
    const [beforeClaim] = await db.select().from(agentosPortfolios).where(eq(agentosPortfolios.id, localPortfolio.id));
    expect(beforeClaim.ownerUserId).toBe("local-board");

    await expect(
      claimBoardOwnership(db, { token, code, userId }),
    ).resolves.toEqual({
      status: "claimed",
      claimedByUserId: userId,
    });
    const [approvedOwner] = await db.select().from(authUsers).where(eq(authUsers.id, userId));
    expect(approvedOwner.approvalStatus).toBe("approved");

    await expect(
      db
        .select()
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, "local-board"), eq(instanceUserRoles.role, "instance_admin"))),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select()
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin"))),
    ).resolves.toHaveLength(1);
    await expect(
      db
        .select()
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, company.id),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
          ),
        ),
    ).resolves.toMatchObject([
      {
        status: "active",
        membershipRole: "owner",
      },
    ]);
    expect(inspectBoardClaimChallenge(token, code)).toMatchObject({
      status: "claimed",
      claimedByUserId: userId,
    });
    const [claimed] = await db.select().from(agentosPortfolios).where(eq(agentosPortfolios.id, localPortfolio.id));
    const [untouched] = await db.select().from(agentosPortfolios).where(eq(agentosPortfolios.id, otherPortfolio.id));
    expect(claimed).toMatchObject({ ownerUserId: userId, revision: 2 });
    expect(untouched).toMatchObject({ ownerUserId: "another-owner", revision: 1 });
    await expect(claimBoardOwnership(db, { token, code, userId })).resolves.toEqual({ status: "claimed" });
    const audit = await db.select().from(activityLog).where(eq(activityLog.action, "agentos.portfolio_claimed"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: userId, companyId: company.id, entityId: localPortfolio.id });
  });
});
