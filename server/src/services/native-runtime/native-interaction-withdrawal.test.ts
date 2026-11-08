import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issueThreadInteractions, issues, statusDecisions } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { materializeNativeInteractionResponses } from "./native-interaction-bridge.js";

describe("native confirmation withdrawal delivery", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("native-withdrawal-");
    db = createDb(temporary.connectionString);
  }, 90_000);
  afterAll(async () => { await temporary?.cleanup(); });

  async function fixture(kind: "request_confirmation" | "request_checkbox_confirmation" = "request_confirmation") {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Withdrawal", issuePrefix: `W${companyId.slice(0, 8)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Review work", status: "in_review", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId, contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const [card] = await db.insert(issueThreadInteractions).values({
      companyId, issueId, kind, status: "pending", createdByAgentId: agentId,
      continuationPolicy: "wake_assignee", sourceRunId: runId,
      payload: kind === "request_confirmation"
        ? { version: 1, prompt: "Review output", target: { type: "custom", key: "native_completion_review", revisionId: randomUUID() } }
        : { version: 1, prompt: "Review output", options: [{ id: "checked", label: "Checked" }] },
    }).returning();
    return { companyId, agentId, issueId, runId, card, interactionIds: [card.id] };
  }

  it.each(["request_confirmation", "request_checkbox_confirmation"] as const)("delivers authoritative withdrawal of %s without an approval or task transition", async kind => {
    const f = await fixture(kind);
    const [before] = await db.select().from(issues).where(eq(issues.id, f.issueId));
    const withdrawn = await issueThreadInteractionService(db).withdrawInteraction({ id: f.issueId, companyId: f.companyId }, f.card.id,
      { reason: "Repair the stale review binding; the CEO still must review." }, { userId: "board-user" });
    expect(withdrawn).toMatchObject({ status: "cancelled", result: { outcome: "withdrawn" } });
    await expect(materializeNativeInteractionResponses({ db, ...f })).resolves.toEqual([{
      interactionId: f.card.id, kind,
      response: { status: "cancelled", result: withdrawn.result },
    }]);
    expect(await db.select().from(issues).where(eq(issues.id, f.issueId))).toMatchObject([{
      status: before!.status, statusVersion: before!.statusVersion, lastStatusDecisionId: before!.lastStatusDecisionId,
      assigneeAgentId: before!.assigneeAgentId, executionRunId: before!.executionRunId,
    }]);
    expect(await db.select().from(statusDecisions).where(eq(statusDecisions.issueId, f.issueId))).toEqual([]);
  });

  it("allows the creator's own administrative withdrawal without treating it as self-approval", async () => {
    const f = await fixture();
    await issueThreadInteractionService(db).withdrawInteraction({ id: f.issueId, companyId: f.companyId }, f.card.id,
      { reason: "Request is obsolete" }, { agentId: f.agentId, runId: f.runId });
    await expect(materializeNativeInteractionResponses({ db, ...f })).resolves.toMatchObject([{
      response: { status: "cancelled", result: { outcome: "withdrawn", reason: "Request is obsolete" } },
    }]);
    await db.update(issueThreadInteractions).set({ status: "accepted", result: { version: 1, outcome: "accepted" } }).where(eq(issueThreadInteractions.id, f.card.id));
    await expect(materializeNativeInteractionResponses({ db, ...f })).rejects.toMatchObject({ code: "native_interaction_self_approval" });
  });

  it.each(["pending", "wrong_outcome", "no_resolver", "no_resolution_time"])("rejects an unproven withdrawal: %s", async invalid => {
    const f = await fixture();
    await db.update(issueThreadInteractions).set({
      status: invalid === "pending" ? "pending" : "cancelled",
      result: { version: 1, outcome: invalid === "wrong_outcome" ? "accepted" : "withdrawn" },
      resolvedByUserId: invalid === "no_resolver" ? null : "board-user",
      resolvedAt: invalid === "no_resolution_time" ? null : new Date(),
    }).where(eq(issueThreadInteractions.id, f.card.id));
    await expect(materializeNativeInteractionResponses({ db, ...f })).rejects.toMatchObject({ code: "native_interaction_unresolved" });
  });

  it("does not project a foreign company's withdrawn card", async () => {
    const f = await fixture(), other = await fixture();
    await issueThreadInteractionService(db).withdrawInteraction({ id: f.issueId, companyId: f.companyId }, f.card.id, {}, { userId: "board-user" });
    await expect(materializeNativeInteractionResponses({ db, ...other, interactionIds: [f.card.id] }))
      .rejects.toMatchObject({ code: "native_interaction_missing" });
  });

  it.each(["secret", "tool"])("keeps governed %s withdrawal outside the plain administrative projection", async governed => {
    const f = await fixture();
    await issueThreadInteractionService(db).withdrawInteraction({ id: f.issueId, companyId: f.companyId }, f.card.id, {}, { userId: "board-user" });
    const payload = { version: 1 as const, prompt: "Governed request", ...(governed === "secret"
      ? { secretProposal: { version: 1 as const, proposalId: randomUUID(), sourceSecretLabel: "Secret", configPath: "env.EXAMPLE",
        targetAgentId: f.agentId, targetAgentName: "Worker", justification: "Test", expiresAt: new Date().toISOString() } }
      : { toolAction: { version: 1 as const, actionRequestId: randomUUID(), invocationId: randomUUID(), toolName: "test",
        toolDisplayName: "Test", connectionId: null, applicationId: null, appDisplayName: null, risk: "write" as const,
        previewMarkdown: "Test", argumentsSummaryJson: "{}", argumentsHash: "test", expiresAt: new Date().toISOString() } }) };
    await db.update(issueThreadInteractions).set({ payload }).where(eq(issueThreadInteractions.id, f.card.id));
    await expect(materializeNativeInteractionResponses({ db, ...f })).rejects.toMatchObject({
      code: governed === "secret" ? "native_interaction_unresolved" : "native_interaction_governed_request_unresolved",
    });
  });
});
