import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
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
  agentosAdminEvents,
  agentApiKeys,
  agents,
  assets,
  documents,
  heartbeatRuns,
  issues,
  issueComments,
  issueAttachments,
  routineRevisions,
  routineRuns,
  routines,
} from "@paperclipai/db";
import { createRoutineSchema } from "@paperclipai/shared";
import { routineService } from "../services/routines.js";
import { issueService } from "../services/issues.js";
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
    await db.delete(agentosAdminEvents);
    await db.delete(agentosPortfolios);
    await db.delete(routineRuns);
    await db.delete(routines);
    await db.delete(documents);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(assets);
    await db.delete(agentApiKeys);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceUserRoles);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function claimOptions(userId: string) {
    await initializeBoardClaimChallenge(db, { deploymentMode: "authenticated" });
    const url = new URL(getBoardClaimWarningUrl("127.0.0.1", 3197)!);
    return { token: url.pathname.split("/").pop()!, code: url.searchParams.get("code")!, userId };
  }

  async function seedOperationalOwnership() {
    const userId = `claim-user-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({
      id: userId, name: "New owner", email: `${userId}@example.test`, emailVerified: true,
      approvalStatus: "pending", createdAt: now, updatedAt: now,
    });
    await db.insert(instanceUserRoles).values({ userId: "local-board", role: "instance_admin" });
    const [localCompany, fallbackCompany, otherCompany] = await db.insert(companies).values(
      ["local-board", null, "another-owner"].map((defaultResponsibleUserId, index) => ({
        name: `Claim ${index}`, issuePrefix: `BC${randomUUID().slice(0, 6).toUpperCase()}`, defaultResponsibleUserId,
      })),
    ).returning();
    await db.insert(companyMemberships).values([localCompany, fallbackCompany, otherCompany].map((company) => ({
      companyId: company.id, principalType: "user", principalId: "local-board", status: "active",
      membershipRole: "owner", createdAt: new Date("2020-01-01T00:00:00Z"),
    })));
    await db.insert(companyMemberships).values({
      companyId: otherCompany.id, principalType: "user", principalId: "another-owner",
      status: "active", membershipRole: "owner",
    });
    await db.insert(agentosPortfolios).values({
      homeCompanyId: localCompany.id, ownerUserId: "local-board", name: "Bootstrap portfolio",
    });
    const [agent] = await db.insert(agents).values({
      companyId: localCompany.id, name: "Paused employee", status: "paused", createdByUserId: "local-board",
    }).returning();
    await db.insert(agentApiKeys).values({
      companyId: localCompany.id, agentId: agent.id, name: "Retained key",
      keyHash: randomUUID(), responsibleUserId: "local-board",
    });
    await db.insert(heartbeatRuns).values({
      companyId: localCompany.id, agentId: agent.id, status: "succeeded", responsibleUserId: "local-board",
    });
    await db.insert(issues).values([
      ...["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"].map((status) => ({
        companyId: localCompany.id, title: status, status, responsibleUserId: "local-board", createdByUserId: "local-board",
      })),
      { companyId: localCompany.id, title: "hidden", status: "todo", hiddenAt: now, responsibleUserId: "local-board" },
      { companyId: otherCompany.id, title: "other-owner", status: "todo", responsibleUserId: "another-owner" },
      { companyId: fallbackCompany.id, title: "unowned", status: "todo", responsibleUserId: null },
    ]);
    const svc = routineService(db, { heartbeat: { wakeup: async () => null } });
    const localRoutine = await svc.create(localCompany.id,
      createRoutineSchema.parse({ title: "Existing routine", description: "Preserve this description", status: "paused" }),
      { userId: "local-board" });
    const otherRoutine = await svc.create(otherCompany.id,
      createRoutineSchema.parse({ title: "Another owner's routine", status: "paused" }),
      { userId: "another-owner" });
    await db.insert(routineRuns).values({
      companyId: localCompany.id, routineId: localRoutine.id, source: "manual", status: "completed",
      routineRevisionId: localRoutine.latestRevisionId, responsibleUserId: "local-board",
    });
    await db.insert(activityLog).values({
      companyId: localCompany.id, actorType: "user", actorId: "local-board",
      action: "test.historical_record", entityType: "routine", entityId: localRoutine.id,
    });
    return { userId, localCompany, fallbackCompany, otherCompany, localRoutine, otherRoutine, agent, svc };
  }

  async function seedConversation(companyId: string, agentId: string, userId: string, hiddenAt: Date | null = null) {
    const [conversation] = await db.insert(issues).values({
      companyId, title: "Existing conversation", status: "todo", assigneeAgentId: agentId,
      conversationAgentId: agentId, conversationUserId: userId, conversationState: "waiting",
      conversationSessionGeneration: 3, createdByUserId: userId, responsibleUserId: userId, hiddenAt,
    }).returning();
    const [comment] = await db.insert(issueComments).values({
      companyId, issueId: conversation.id, body: "Keep our previous discussion", authorUserId: userId,
      conversationSessionGeneration: 2,
    }).returning();
    await db.update(issues).set({ conversationBoundaryCommentId: comment.id }).where(eq(issues.id, conversation.id));
    const [asset] = await db.insert(assets).values({
      companyId, provider: "local_disk", objectKey: `claim-fixture/${randomUUID()}`, contentType: "text/plain",
      byteSize: 7, sha256: "0".repeat(64), originalFilename: "notes.txt", createdByUserId: userId,
    }).returning();
    await db.insert(issueAttachments).values({ companyId, issueId: conversation.id, assetId: asset.id, issueCommentId: comment.id });
    return conversation;
  }

  async function claimState() {
    return {
      users: await db.select().from(authUsers).orderBy(asc(authUsers.id)),
      admins: await db.select().from(instanceUserRoles).orderBy(asc(instanceUserRoles.id)),
      memberships: await db.select().from(companyMemberships).orderBy(asc(companyMemberships.id)),
      grants: await db.select().from(principalPermissionGrants).orderBy(asc(principalPermissionGrants.id)),
      companies: await db.select().from(companies).orderBy(asc(companies.id)),
      portfolios: await db.select().from(agentosPortfolios).orderBy(asc(agentosPortfolios.id)),
      tasks: await db.select().from(issues).orderBy(asc(issues.id)),
      comments: await db.select().from(issueComments).orderBy(asc(issueComments.id)),
      attachments: await db.select().from(issueAttachments).orderBy(asc(issueAttachments.id)),
      assets: await db.select().from(assets).orderBy(asc(assets.id)),
      routines: await db.select().from(routines).orderBy(asc(routines.id)),
      revisions: await db.select().from(routineRevisions).orderBy(asc(routineRevisions.id)),
      runs: await db.select().from(routineRuns).orderBy(asc(routineRuns.id)),
      activity: await db.select().from(activityLog).orderBy(asc(activityLog.id)),
      adminEvents: await db.select().from(agentosAdminEvents).orderBy(asc(agentosAdminEvents.id)),
    };
  }

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

  it("transfers live responsibility and future routine revisions while preserving other owners, credentials and history", async () => {
    const fixture = await seedOperationalOwnership();
    const before = await claimState();
    const keysBefore = await db.select().from(agentApiKeys);
    const runsBefore = await db.select().from(heartbeatRuns);
    const agentsBefore = await db.select().from(agents);
    const documentsBefore = await db.select().from(documents).orderBy(asc(documents.id));
    const options = await claimOptions(fixture.userId);
    await expect(claimBoardOwnership(db, options)).resolves.toMatchObject({ status: "claimed" });
    const after = await claimState();
    expect(after.companies.find((row) => row.id === fixture.localCompany.id)?.defaultResponsibleUserId).toBe(fixture.userId);
    expect(after.companies.find((row) => row.id === fixture.fallbackCompany.id)?.defaultResponsibleUserId).toBeNull();
    expect(after.companies.find((row) => row.id === fixture.otherCompany.id)?.defaultResponsibleUserId).toBe("another-owner");
    expect(after.memberships.filter((row) => row.principalId === "local-board")).toHaveLength(3);
    expect(after.memberships.filter((row) => row.principalId === "local-board").every((row) => row.status === "archived")).toBe(true);
    expect(after.memberships.find((row) => row.principalId === "another-owner")).toEqual(before.memberships.find((row) => row.principalId === "another-owner"));
    for (const company of after.companies) {
      expect(after.grants.find((row) => row.companyId === company.id && row.principalId === fixture.userId && row.permissionKey === "users:manage_permissions")).toBeDefined();
    }
    for (const task of after.tasks) {
      const original = before.tasks.find((row) => row.id === task.id)!;
      const actionable = ["backlog", "todo", "in_progress", "in_review", "blocked"].includes(task.title);
      if (actionable) expect(task).toMatchObject({ responsibleUserId: fixture.userId, createdByUserId: "local-board" });
      else expect(task).toEqual(original);
    }
    expect(after.routines.find((row) => row.id === fixture.otherRoutine.id)).toEqual(before.routines.find((row) => row.id === fixture.otherRoutine.id));
    const claimedRoutine = after.routines.find((row) => row.id === fixture.localRoutine.id)!;
    expect(claimedRoutine).toMatchObject({ responsibleUserId: fixture.userId, createdByUserId: "local-board", latestRevisionNumber: 2 });
    const currentRevision = after.revisions.find((row) => row.id === claimedRoutine.latestRevisionId)!;
    expect(currentRevision).toMatchObject({ responsibleUserId: fixture.userId, createdByUserId: fixture.userId,
      snapshot: { routine: { responsibleUserId: fixture.userId, description: "Preserve this description" } } });
    for (const revision of before.revisions) expect(after.revisions.find((row) => row.id === revision.id)).toEqual(revision);
    expect(after.runs).toEqual(before.runs);
    expect(after.activity.find((row) => row.action === "test.historical_record")).toEqual(before.activity[0]);
    expect(await db.select().from(agentApiKeys)).toEqual(keysBefore);
    expect(await db.select().from(heartbeatRuns)).toEqual(runsBefore);
    expect(await db.select().from(agents)).toEqual(agentsBefore);
    expect(await db.select().from(documents).orderBy(asc(documents.id))).toEqual(documentsBefore);

    // Exercise the native fallback consumer, not just the membership rows: the
    // older bootstrap membership must not own newly created routine work.
    const fallbackRoutine = await fixture.svc.create(fixture.fallbackCompany.id,
      createRoutineSchema.parse({ title: "After claim", status: "paused" }), {});
    expect(fallbackRoutine.responsibleUserId).toBe(fixture.userId);
    await expect(claimBoardOwnership(db, options)).resolves.toEqual({ status: "claimed" });
    expect(await db.select().from(routineRevisions).where(eq(routineRevisions.routineId, claimedRoutine.id))).toHaveLength(2);
  });

  it.each(["principal_permission_grants", "routine_revisions"] as const)("rolls back the whole claim when %s persistence fails, then permits retry", async (tableName) => {
    const fixture = await seedOperationalOwnership();
    await seedConversation(fixture.localCompany.id, fixture.agent.id, "local-board");
    const options = await claimOptions(fixture.userId);
    const before = await claimState();
    // Real SQL faults retain transaction semantics; a mock cannot establish that
    // role transfer, routine revisions, audit and owner grants commit together.
    await db.execute(sql`create function board_claim_test_failure() returns trigger language plpgsql as $$
      begin raise exception 'injected board claim write failure'; end;
    $$`);
    await db.execute(sql.raw(`create trigger board_claim_test_failure before insert on ${tableName} for each row execute function board_claim_test_failure()`));
    try {
      await expect(claimBoardOwnership(db, options)).rejects.toMatchObject({
        cause: { message: "injected board claim write failure" },
      });
      expect(await claimState()).toEqual(before);
      expect(inspectBoardClaimChallenge(options.token, options.code)).toMatchObject({ status: "available", claimedByUserId: null });
    } finally {
      await db.execute(sql.raw(`drop trigger board_claim_test_failure on ${tableName}`));
      await db.execute(sql`drop function board_claim_test_failure()`);
    }
    await expect(claimBoardOwnership(db, options)).resolves.toMatchObject({ status: "claimed", claimedByUserId: fixture.userId });
  });

  it.each([false, true])("retains the bootstrap chat, sessions and attachments for the claimant, including hidden threads (%s)", async (hidden) => {
    const fixture = await seedOperationalOwnership();
    const chat = await seedConversation(fixture.localCompany.id, fixture.agent.id, "local-board", hidden ? new Date() : null);
    const otherChat = await seedConversation(fixture.localCompany.id, fixture.agent.id, "another-owner");
    const before = await claimState();
    await expect(claimBoardOwnership(db, await claimOptions(fixture.userId))).resolves.toMatchObject({ status: "claimed" });
    const svc = issueService(db);
    const claimedChat = await svc.getConversation(fixture.localCompany.id, fixture.agent.id, fixture.userId);
    const originalChat = before.tasks.find((row) => row.id === chat.id)!;
    expect(claimedChat).toEqual({
      ...originalChat, conversationUserId: fixture.userId,
      responsibleUserId: hidden ? "local-board" : fixture.userId,
      updatedAt: expect.any(Date),
    });
    expect(await svc.getConversation(fixture.localCompany.id, fixture.agent.id, "local-board")).toBeNull();
    expect(await svc.getConversation(fixture.localCompany.id, fixture.agent.id, "another-owner"))
      .toEqual(before.tasks.find((row) => row.id === otherChat.id));
    const after = await claimState();
    expect(after.tasks).toHaveLength(before.tasks.length);
    expect(after.comments).toEqual(before.comments);
    expect(after.attachments).toEqual(before.attachments);
    expect(after.assets).toEqual(before.assets);
  });

  it.each([false, true])("rejects a claimant chat collision atomically, even when the claimant thread is hidden (%s)", async (hidden) => {
    const fixture = await seedOperationalOwnership();
    await seedConversation(fixture.localCompany.id, fixture.agent.id, "local-board");
    await seedConversation(fixture.localCompany.id, fixture.agent.id, fixture.userId, hidden ? new Date() : null);
    const options = await claimOptions(fixture.userId);
    const before = await claimState();
    await expect(claimBoardOwnership(db, options)).rejects.toMatchObject({
      status: 409, message: expect.stringContaining("Both conversations have been preserved"),
    });
    expect(await claimState()).toEqual(before);
    expect(inspectBoardClaimChallenge(options.token, options.code)).toMatchObject({ status: "available", claimedByUserId: null });
  });
});
