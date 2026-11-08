import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { agents, authUsers, companies, companyMemberships, companyOperatingProfiles, principalPermissionGrants, agentosPortfolios,
  agentosPortfolioCompanies, agentosBoardDirections, heartbeatRuns, issues, agentWakeupRequests, activityLog } from "@paperclipai/db";
import { agentosPortfolioMandateService } from "../services/agentos-portfolio-mandates.js";
import { boardDirectionService } from "../services/board-directions.js";
import { boardDirectionDeliveryService } from "../services/board-direction-delivery.js";
import { describeEmbeddedPostgres, useEmbeddedPostgres, seedCompanyWithBoardAccess } from "./helpers/route-test-harness.js";
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
      conversationAgentId: friday.id, conversationUserId: f.userId, responsibleUserId: f.userId }).returning();
    const [run] = await ctx.db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: friday.id, issueId: chat.id, nativeIssueId: chat.id,
      scopeKind: "issue", status: "running", runtimeMode: "native", responsibleUserId: f.userId }).returning();
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
    return { ...f, actor, owner, who, portfolio, mandates, intent, friday, ceo, worker, target, run, input };
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
    expect(wakeup).not.toHaveBeenCalled();
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
});
