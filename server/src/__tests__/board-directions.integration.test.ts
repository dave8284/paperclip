import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { agents, authUsers, companies, companyMemberships, companyOperatingProfiles, principalPermissionGrants, agentosPortfolios,
  agentosPortfolioCompanies, agentosBoardDirections, heartbeatRuns, issues, agentWakeupRequests, activityLog,
  chatTaskHandoffs, chatCompletionDeliveries, issueComments, projects, projectAccessMembers, issueAccessGrants, type Db } from "@paperclipai/db";
import { agentosPortfolioMandateService } from "../services/agentos-portfolio-mandates.js";
import { boardDirectionService } from "../services/board-directions.js";
import { boardDirectionDeliveryService } from "../services/board-direction-delivery.js";
import { describeEmbeddedPostgres, useEmbeddedPostgres, seedCompanyWithBoardAccess } from "./helpers/route-test-harness.js";
import { chatCompletionDeliveryService, prepareChatCompletionTurn, recordChatCompletion, chatCompletionInstruction, existingChatCompletionReply } from "../services/chat-completion-delivery.js";
import { issueService } from "../services/issues.js";
import { subscribeDeliveryWork, DELIVERY_QUEUES } from "../services/delivery-work-notifications.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import type { AuthorizationActor } from "../services/authorization.js";

describeEmbeddedPostgres("persisted company-isolated board directions", () => {
  const ctx = useEmbeddedPostgres("paperclip-board-directions-");
  async function fixture() {
    const f = await seedCompanyWithBoardAccess(ctx.db, "Friday source");
    await ctx.db.insert(authUsers).values({ id: f.userId, name: "Owner", email: `${randomUUID()}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    const [target] = await ctx.db.insert(companies).values({ name: "Target", issuePrefix: `B${randomUUID().slice(0, 6)}` }).returning();
    await ctx.db.insert(companyMemberships).values({ companyId: target.id, principalType: "user", principalId: f.userId, membershipRole: "owner", status: "active" });
    await ctx.db.insert(principalPermissionGrants).values(["users:manage_permissions", "tasks:assign"].map(permissionKey => ({ companyId: target.id, principalType: "user", principalId: f.userId, permissionKey })));
    const [friday, ceo, worker] = await ctx.db.insert(agents).values([
      { companyId: f.companyId, name: "Friday", adapterType: "process", role: "general", status: "running" },
      { companyId: target.id, name: "Executive", adapterType: "process", role: "ceo", status: "idle" },
      { companyId: target.id, name: "CEO", title: "CEO", adapterType: "process", role: "engineer", status: "idle" },
    ]).returning();
    await ctx.db.insert(companyMemberships).values([friday, ceo, worker].map(agent => ({ companyId: agent.companyId, principalType: "agent", principalId: agent.id, membershipRole: "member", status: "active" })));
    await ctx.db.insert(companyOperatingProfiles).values({ companyId: f.companyId, fridayAgentId: friday.id });
    const [portfolio] = await ctx.db.insert(agentosPortfolios).values({ homeCompanyId: f.companyId, ownerUserId: f.userId, name: "Board" }).returning();
    await ctx.db.insert(agentosPortfolioCompanies).values([f.companyId, target.id].map(companyId => ({ portfolioId: portfolio.id, companyId })));
    const [chat] = await ctx.db.insert(issues).values({ companyId: f.companyId, title: "Board conversation", assigneeAgentId: friday.id,
      conversationAgentId: friday.id, conversationUserId: f.userId, conversationState: "waiting", responsibleUserId: f.userId }).returning();
    const [run] = await ctx.db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: friday.id, issueId: chat.id, nativeIssueId: chat.id,
      scopeKind: "issue", status: "running", runtimeMode: "native", responsibleUserId: f.userId,
      contextSnapshot: { issueId: chat.id, conversationSessionGeneration: chat.conversationSessionGeneration } }).returning();
    const owner = { ...f.actor, companyIds: [f.companyId, target.id] } as AuthorizationActor;
    const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: f.companyId, agentId: friday.id, runId: run.id, onBehalfOfUserId: f.userId };
    const who = { actorType: "user" as const, actorId: f.userId };
    const mandates = agentosPortfolioMandateService(ctx.db);
    const intent = { id: randomUUID(), expectedRevision: 0, sourceCompanyId: f.companyId, sourceAgentId: friday.id,
      targetCompanyIds: [target.id], action: "portfolio_work:read" as const, readScope: "owner_accessible_private" as const, expiresAt: null };
    const mandate = await mandates.save(owner, who, portfolio.id, intent);
    const authorized = await mandates.setBoardDirectionAuthority(owner, who, portfolio.id, mandate.id, { enabled: true, expectedRevision: 1, expectedGrantId: null });
    const input = { mandateId: mandate.id, revision: 1, grantId: authorized.boardDirectionAuthority!.grantId, targetCompanyId: target.id,
      executiveAgentId: ceo.id, projectId: null, idempotencyKey: randomUUID(), title: "A company-owned direction", description: "CEO: plan this company's work and report evidence.", priority: "medium" as const };
    return { ...f, actor, owner, who, portfolio, mandates, intent, friday, ceo, worker, target, run, chat, input };
  }
  it("persists one native target task, source-only provenance and an idempotent outbox", async () => {
    const f = await fixture(), service = boardDirectionService(ctx.db);
    const [first, repeated] = await Promise.all([service.create(f.actor, f.companyId, f.input), service.create(f.actor, f.companyId, f.input)]);
    expect([first.created, repeated.created].sort()).toEqual([false, true]); expect(first.direction.id).toBe(repeated.direction.id);
    const [task] = await ctx.db.select().from(issues).where(eq(issues.id, first.direction.taskId));
    expect(task).toMatchObject({ companyId: f.target.id, assigneeAgentId: f.ceo.id, parentId: null, originRunId: null,
      createdByAgentId: null, createdByUserId: null, responsibleUserId: f.userId, originKind: "board_direction" });
    const source = await ctx.db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.entityId, first.direction.id)));
    expect(source).toHaveLength(1); expect(source[0]).toMatchObject({ actorType: "agent", actorId: f.friday.id, runId: f.run.id });
    const target = await ctx.db.select().from(activityLog).where(and(eq(activityLog.companyId, f.target.id), eq(activityLog.entityId, task.id)));
    expect(JSON.stringify(target)).not.toContain(f.run.id); expect(JSON.stringify(target)).not.toContain(f.companyId);
    await expect(service.create(f.actor, f.companyId, { ...f.input, description: "Changed" })).rejects.toMatchObject({ status: 409 });
    expect((await ctx.db.select().from(agentosBoardDirections).where(eq(agentosBoardDirections.sourceCompanyId, f.companyId)))).toHaveLength(1);
  });
  it("rejects a title-only executive and invalidates write authority when the read revision changes", async () => {
    const f = await fixture(), service = boardDirectionService(ctx.db);
    await expect(service.create(f.actor, f.companyId, { ...f.input, executiveAgentId: f.worker.id })).rejects.toMatchObject({ status: 403 });
    await f.mandates.save(f.owner, f.who, f.portfolio.id, { ...f.intent, expectedRevision: 1 });
    await expect(service.create(f.actor, f.companyId, { ...f.input, revision: 2 })).rejects.toMatchObject({ status: 403 });
    expect((await ctx.db.select().from(agentosBoardDirections).where(eq(agentosBoardDirections.sourceCompanyId, f.companyId)))).toHaveLength(0);
  });
  it("recovers an admitted receipt after sender revocation without another wake or false completion", async () => {
    const f = await fixture(), service = boardDirectionService(ctx.db);
    const saved = await service.create(f.actor, f.companyId, f.input);
    const [row] = await ctx.db.select().from(agentosBoardDirections).where(eq(agentosBoardDirections.id, saved.direction.id));
    const runId = randomUUID();
    await ctx.db.insert(agentWakeupRequests).values({ id: row.wakeupRequestId, companyId: f.target.id, agentId: f.ceo.id, source: "assignment", reason: "board_direction",
      status: "queued", requestedByActorType: "system", requestedByActorId: "board-direction", idempotencyKey: `board-direction:${row.id}`, payload: { issueId: row.issueId } });
    await ctx.db.insert(heartbeatRuns).values({ id: runId, companyId: f.target.id, agentId: f.ceo.id, issueId: row.issueId, nativeIssueId: row.issueId,
      wakeupRequestId: row.wakeupRequestId, status: "failed", runtimeMode: "native" });
    await ctx.db.update(agentWakeupRequests).set({ runId }).where(eq(agentWakeupRequests.id, row.wakeupRequestId));
    await f.mandates.setBoardDirectionAuthority(f.owner, f.who, f.portfolio.id, f.input.mandateId, { expectedRevision: 1, expectedGrantId: f.input.grantId, enabled: false });
    const wakeup = vi.fn(); await boardDirectionDeliveryService(ctx.db, { heartbeat: { wakeup } }).sweepPending();
    expect(wakeup.mock.calls.filter(([agentId]) => agentId === f.ceo.id)).toHaveLength(0);
    expect(await service.read(f.actor, f.companyId, row.id, 1)).toMatchObject({ dispatchState: "dispatched", taskStatus: "todo" });
  });
  it("cancels an unadmitted revoked handoff while preserving the company's saved task", async () => {
    const f = await fixture();
    const saved = await boardDirectionService(ctx.db).create(f.actor, f.companyId, f.input);
    await f.mandates.setBoardDirectionAuthority(f.owner, f.who, f.portfolio.id, f.input.mandateId, { expectedRevision: 1, expectedGrantId: f.input.grantId, enabled: false });
    const wakeup = vi.fn(); await boardDirectionDeliveryService(ctx.db, { heartbeat: { wakeup } }).sweepPending();
    expect(wakeup).not.toHaveBeenCalled();
    expect(await boardDirectionService(ctx.db).read(f.actor, f.companyId, saved.direction.id, 1)).toMatchObject({ dispatchState: "cancelled", taskStatus: "todo" });
  });
  async function returnFixture() {
    const f = await fixture();
    await instanceSettingsService(ctx.db).updateExperimental({ enableAgentChat: true });
    const saved = await boardDirectionService(ctx.db).create(f.actor, f.companyId, f.input);
    await ctx.db.update(agentosBoardDirections).set({ dispatchState: "dispatched", dispatchedAt: new Date() })
      .where(eq(agentosBoardDirections.id, saved.direction.id));
    await ctx.db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, f.run.id));
    type WakeOptions = Parameters<Parameters<typeof chatCompletionDeliveryService>[1]["wakeup"]>[1];
    const wakeup = vi.fn(async (_agentId: string, options: WakeOptions) => {
      const [run] = await ctx.db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.friday.id,
        issueId: f.chat.id, nativeIssueId: f.chat.id, scopeKind: "issue", status: "queued", runtimeMode: "native",
        responsibleUserId: f.userId, contextSnapshot: options.contextSnapshot }).returning();
      await ctx.db.insert(agentWakeupRequests).values({ companyId: f.companyId, agentId: f.friday.id,
        source: options.source, reason: options.reason, status: "queued", idempotencyKey: options.idempotencyKey,
        requestedByActorType: options.requestedByActorType, requestedByActorId: options.requestedByActorId, runId: run.id, payload: options.payload });
      return run;
    });
    const service = chatCompletionDeliveryService(ctx.db, { wakeup });
    const rows = () => ctx.db.select().from(chatCompletionDeliveries).where(eq(chatCompletionDeliveries.taskId, saved.direction.taskId));
    const finish = () => issueService(ctx.db).update(saved.direction.taskId, { status: "done" });
    const prepare = async () => {
      const [delivery] = await rows(); await service.deliver(delivery.id);
      const [queued] = await rows();
      const [run] = await ctx.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, queued.targetRunId!));
      return prepareChatCompletionTurn(ctx.db, run);
    };
    return { ...f, saved, wakeup, service, rows, finish, prepare };
  }
  it("returns target-company completion to the source owner conversation once, without private output copies", async () => {
    const f = await returnFixture();
    const [before] = await ctx.db.select().from(issues).where(eq(issues.id, f.saved.direction.taskId));
    const done = await f.finish();
    await ctx.db.transaction(tx => recordChatCompletion(tx, before, done!));
    expect(await f.rows()).toMatchObject([{ companyId: f.companyId, taskId: before.id, status: "pending" }]);
    const run = await f.prepare();
    expect(f.wakeup).toHaveBeenCalledTimes(1);
    expect(f.wakeup.mock.calls[0]).toMatchObject([f.friday.id, { requestedByActorType: "system",
      requestedByActorId: "chat_completion_delivery", payload: { issueId: f.chat.id }, allowRunCoalescing: false }]);
    expect(run.contextSnapshot?.chatCompletionUpdates).toMatchObject([{ id: before.id, status: "done", boardDirection: {
      id: f.saved.direction.id, sourceCompanyId: f.companyId, targetCompanyId: f.target.id, mandateId: f.input.mandateId, revision: 1 } }]);
    expect(JSON.stringify(run.contextSnapshot?.chatCompletionUpdates)).not.toContain(f.input.description);
    expect(JSON.stringify(run.contextSnapshot?.chatCompletionUpdates)).not.toContain(f.input.title);
    expect(chatCompletionInstruction(run.contextSnapshot!)).toContain("CEO's current report");
    const actor = { agentId: f.friday.id, runId: run.id };
    const reply = await issueService(ctx.db).addComment(f.chat.id, "The CEO has returned the company report.", actor, { completionReply: true });
    const duplicate = await issueService(ctx.db).addComment(f.chat.id, "A retry must not add another reply.", actor, { completionReply: true });
    expect(duplicate.id).toBe(reply.id);
    expect(await f.rows()).toMatchObject([{ status: "delivered", responseCommentId: reply.id }]);
    expect(await f.service.hasPending()).toBe(false);
    await f.service.sweepPending();
    await chatCompletionDeliveryService(ctx.db, { wakeup: f.wakeup }).sweepPending();
    expect(f.wakeup).toHaveBeenCalledTimes(1);
    expect((await ctx.db.select().from(issues).where(eq(issues.id, before.id)))[0]).toMatchObject({ companyId: f.target.id, status: "done", parentId: null });
  });
  it.each(["revoked mandate", "replaced Friday", "changed owner", "reset conversation"])("does not wake an obsolete return audience: %s", async change => {
    const f = await returnFixture(); await f.finish();
    if (change === "revoked mandate") await f.mandates.revoke(f.owner, f.who, f.portfolio.id, f.input.mandateId, 1);
    if (change === "replaced Friday") await ctx.db.update(companyOperatingProfiles).set({ fridayAgentId: null }).where(eq(companyOperatingProfiles.companyId, f.companyId));
    if (change === "changed owner") await ctx.db.update(issues).set({ conversationUserId: "different-owner" }).where(eq(issues.id, f.chat.id));
    if (change === "reset conversation") await ctx.db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, f.chat.id));
    const [delivery] = await f.rows(); await f.service.deliver(delivery.id);
    expect(f.wakeup).not.toHaveBeenCalled(); expect(await f.rows()).toMatchObject([{ status: "superseded" }]);
  });
  it("reads the current mandate revision for reporting without reviving its old write grant", async () => {
    const f = await returnFixture(); await f.finish();
    await f.mandates.save(f.owner, f.who, f.portfolio.id, { ...f.intent, expectedRevision: 1 });
    const run = await f.prepare();
    expect(run.contextSnapshot?.chatCompletionUpdates).toMatchObject([{ boardDirection: { revision: 2,
      outcomePath: `/api/companies/${f.companyId}/friday/board-directions/${f.saved.direction.id}?revision=2` } }]);
    await issueService(ctx.db).addComment(f.chat.id, "Current authorized company report.", { agentId: f.friday.id, runId: run.id }, { completionReply: true });
  });
  it("rechecks mandate revocation before both ordinary comments and the final return reply", async () => {
    const f = await returnFixture(); await f.finish(); const run = await f.prepare();
    await f.mandates.revoke(f.owner, f.who, f.portfolio.id, f.input.mandateId, 1);
    const actor = { agentId: f.friday.id, runId: run.id };
    await expect(issueService(ctx.db).addComment(f.chat.id, "Must not disclose old private results.", actor)).rejects.toMatchObject({ status: 403 });
    await expect(issueService(ctx.db).addComment(f.chat.id, "Must not publish after revocation.", actor, { completionReply: true })).rejects.toMatchObject({ status: 403 });
    expect(await ctx.db.select().from(issueComments).where(eq(issueComments.issueId, f.chat.id))).toHaveLength(0);
    await ctx.db.update(chatCompletionDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(chatCompletionDeliveries.taskId, f.saved.direction.taskId));
    const [delivery] = await f.rows(); await f.service.deliver(delivery.id);
    expect(await f.rows()).toMatchObject([{ status: "superseded", responseCommentId: null }]);
  });
  it("rejects a reset between wake and turn preparation", async () => {
    const f = await returnFixture(); await f.finish();
    const [delivery] = await f.rows(); await f.service.deliver(delivery.id);
    const [queued] = await f.rows();
    const [run] = await ctx.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, queued.targetRunId!));
    await ctx.db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, f.chat.id));
    await expect(prepareChatCompletionTurn(ctx.db, run)).rejects.toThrow("chat_completion_superseded");
    await expect(issueService(ctx.db).addComment(f.chat.id, "Old session reply.", { agentId: f.friday.id, runId: run.id }, { completionReply: true })).rejects.toMatchObject({ status: 409 });
  });
  it("reconstructs a pre-feature completed direction once on startup", async () => {
    const f = await returnFixture();
    await ctx.db.delete(chatTaskHandoffs).where(eq(chatTaskHandoffs.taskId, f.saved.direction.taskId));
    await ctx.db.update(issues).set({ status: "done", statusVersion: 1, completedAt: new Date() }).where(eq(issues.id, f.saved.direction.taskId));
    expect(await f.rows()).toHaveLength(0);
    await f.service.sweepPending();
    expect(f.wakeup).toHaveBeenCalledTimes(1);
    expect(await f.rows()).toMatchObject([{ companyId: f.companyId, status: "queued" }]);
    await chatCompletionDeliveryService(ctx.db, { wakeup: f.wakeup }).sweepPending();
    expect(f.wakeup).toHaveBeenCalledTimes(1);
  });

  it("does not let one acknowledged item hide a revoked audience later in a batched reply", async () => {
    const f = await returnFixture();
    const [project] = await ctx.db.insert(projects).values({ companyId: f.target.id, name: "Private after delivery" }).returning();
    await ctx.db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, f.run.id));
    const second = await boardDirectionService(ctx.db).create(f.actor, f.companyId, { ...f.input,
      idempotencyKey: randomUUID(), projectId: project.id });
    await ctx.db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, f.run.id));
    await ctx.db.update(agentosBoardDirections).set({ dispatchState: "dispatched", dispatchedAt: new Date() }).where(eq(agentosBoardDirections.id, second.direction.id));
    await f.finish(); await issueService(ctx.db).update(second.direction.taskId, { status: "done" });
    const run = await f.prepare();
    expect(run.contextSnapshot?.chatCompletionDeliveryIds).toHaveLength(2);
    const actor = { agentId: f.friday.id, runId: run.id };
    const reply = await issueService(ctx.db).addComment(f.chat.id, "Both CEO reports were available.", actor, { completionReply: true });
    await ctx.db.update(projects).set({ visibility: "private" }).where(eq(projects.id, project.id));
    await expect(issueService(ctx.db).addComment(f.chat.id, "Must not disclose the now-private second report.", actor)).rejects.toMatchObject({ status: 403 });
    await expect(issueService(ctx.db).addComment(f.chat.id, "Must validate the entire old reply receipt.", actor, { completionReply: true })).rejects.toMatchObject({ status: 403 });
    expect(await ctx.db.select().from(issueComments).where(eq(issueComments.issueId, f.chat.id))).toMatchObject([{ id: reply.id }]);
  });
  it("notifies after outer settlement and retains no delivery from a rolled-back completion", async () => {
    const f = await returnFixture(), notified = vi.fn();
    const unsubscribe = subscribeDeliveryWork(ctx.db, DELIVERY_QUEUES.chatCompletion, notified);
    try {
      await expect(ctx.db.transaction(async tx => {
        await issueService(ctx.db).update(f.saved.direction.taskId, { status: "done" }, tx);
        expect(notified).not.toHaveBeenCalled();
        throw new Error("rollback completion");
      })).rejects.toThrow("rollback completion");
      // Settlement also wakes recovery after rollback/uncertain commit. Only
      // durable rows authorize delivery; a notification is never completion.
      expect(notified).toHaveBeenCalledTimes(1); expect(await f.rows()).toHaveLength(0);
      notified.mockClear();
      await f.finish(); expect(notified).toHaveBeenCalledTimes(1);
      expect(await f.rows()).toMatchObject([{ companyId: f.companyId, taskId: f.saved.direction.taskId }]);
      const run = await f.prepare();
      await issueService(ctx.db).addComment(f.chat.id, "Committed report returned.", { agentId: f.friday.id, runId: run.id }, { completionReply: true });
    } finally { unsubscribe(); }
  });

  it("retains the return obligation while Friday is paused and admits it after resume", async () => {
    const f = await returnFixture(); await f.finish();
    await ctx.db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.friday.id));
    const [delivery] = await f.rows(); await f.service.deliver(delivery.id);
    expect(f.wakeup).not.toHaveBeenCalled(); expect(await f.rows()).toMatchObject([{ status: "pending", attempts: 0 }]);
    await ctx.db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.friday.id));
    await ctx.db.update(chatCompletionDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(chatCompletionDeliveries.id, delivery.id));
    const run = await f.prepare();
    expect(f.wakeup).toHaveBeenCalledTimes(1);
    await issueService(ctx.db).addComment(f.chat.id, "Company report after resume.", { agentId: f.friday.id, runId: run.id }, { completionReply: true });
  });

  it("retains the locked pause reason when Friday resumes before delivery handles the rejected authorization", async () => {
    const f = await returnFixture(); await f.finish();
    let rolledBackPausedAuthority = false;
    const interleaved = new Proxy(ctx.db, { get(target, key, receiver) {
      if (key !== "transaction") return Reflect.get(target, key, receiver);
      return async (callback: (tx: Db) => Promise<unknown>) => {
        // The unlocked preflight already saw an available recipient. Pause is
        // committed before the real authorization transaction reads its locks.
        await ctx.db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.friday.id));
        try { return await ctx.db.transaction(tx => callback(tx as unknown as Db)); }
        catch (error) { rolledBackPausedAuthority = true; throw error; }
        finally {
          // Resume is committed before deliver's catch observes the failure.
          await ctx.db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.friday.id));
        }
      };
    } });
    const [delivery] = await f.rows();
    await chatCompletionDeliveryService(interleaved, { wakeup: f.wakeup }).deliver(delivery.id);
    expect(rolledBackPausedAuthority).toBe(true);
    expect(await ctx.db.select({ status: agents.status }).from(agents).where(eq(agents.id, f.friday.id))).toEqual([{ status: "idle" }]);
    expect(await f.rows()).toMatchObject([{ status: "pending", attempts: 0, targetRunId: null }]);
    expect(f.wakeup).not.toHaveBeenCalled();
    await ctx.db.update(chatCompletionDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(chatCompletionDeliveries.id, delivery.id));
    const run = await f.prepare();
    expect(f.wakeup).toHaveBeenCalledTimes(1);
    await issueService(ctx.db).addComment(f.chat.id, "Company report after rapid resume.", { agentId: f.friday.id, runId: run.id }, { completionReply: true });
    expect(await f.rows()).toMatchObject([{ status: "delivered" }]);
  });

  it.each(["project member", "task grant"])("retains the %s authorization row through reply commit", async kind => {
    const f = await returnFixture(); await f.finish();
    let projectId: string | null = null;
    let accessId: string;
    if (kind === "project member") {
      const [project] = await ctx.db.insert(projects).values({ companyId: f.target.id, name: "Member-authorized project", visibility: "private" }).returning();
      projectId = project.id;
      const [member] = await ctx.db.insert(projectAccessMembers).values({ companyId: f.target.id, projectId,
        subjectType: "user", subjectId: f.userId }).returning();
      accessId = member.id;
      await ctx.db.update(issues).set({ projectId }).where(eq(issues.id, f.saved.direction.taskId));
    } else {
      await ctx.db.update(issues).set({ visibility: "private", responsibleUserId: null, createdByUserId: null })
        .where(eq(issues.id, f.saved.direction.taskId));
      const [grant] = await ctx.db.insert(issueAccessGrants).values({ issueId: f.saved.direction.taskId,
        subjectType: "user", subjectId: f.userId, source: "explicit" }).returning();
      accessId = grant.id;
    }
    const run = await f.prepare();
    const revoke = (tx: typeof ctx.db) => kind === "project member"
      ? tx.delete(projectAccessMembers).where(eq(projectAccessMembers.id, accessId))
      : tx.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, accessId));
    await ctx.db.transaction(async publication => {
      await existingChatCompletionReply(publication, run.id, f.chat.id);
      const blocked = await ctx.db.transaction(async concurrent => {
        await concurrent.execute(sql`set local lock_timeout = '100ms'`);
        await revoke(concurrent as unknown as typeof ctx.db);
      }).then(() => null, error => error);
      expect(blocked?.cause?.code ?? blocked?.code).toBe("55P03");
      if (projectId) {
        const phantom = await ctx.db.transaction(async concurrent => {
          await concurrent.execute(sql`set local lock_timeout = '100ms'`);
          await concurrent.insert(projectAccessMembers).values({ companyId: f.target.id, projectId: projectId!,
            subjectType: "user", subjectId: "new-concurrent-member" });
        }).then(() => null, error => error);
        expect(phantom?.cause?.code ?? phantom?.code).toBe("55P03");
      }
      await issueService(ctx.db).addComment(f.chat.id, "Report published under retained current access.",
        { agentId: f.friday.id, runId: run.id }, { completionReply: true }, publication);
    });
    await revoke(ctx.db);
    await expect(issueService(ctx.db).addComment(f.chat.id, "Access has now been revoked.",
      { agentId: f.friday.id, runId: run.id })).rejects.toMatchObject({ status: 403 });
  });

  it("does not publish a board return through a replacement non-native execution", async () => {
    const f = await returnFixture(); await f.finish(); const run = await f.prepare();
    await ctx.db.update(heartbeatRuns).set({ runtimeMode: "legacy", nativeIssueId: null }).where(eq(heartbeatRuns.id, run.id));
    const actor = { agentId: f.friday.id, runId: run.id };
    await expect(issueService(ctx.db).addComment(f.chat.id, "Unbound replacement report.", actor)).rejects.toMatchObject({ status: 403 });
    await expect(issueService(ctx.db).addComment(f.chat.id, "Unbound final report.", actor, { completionReply: true })).rejects.toMatchObject({ status: 403 });
    expect(await ctx.db.select().from(issueComments).where(eq(issueComments.issueId, f.chat.id))).toHaveLength(0);
  });

});
