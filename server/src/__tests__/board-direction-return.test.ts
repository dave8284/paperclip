import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentosBoardDirections, heartbeatRuns, issues, type chatTaskHandoffs, type Db } from "@paperclipai/db";
import { authorizeBoardDirectionReturn, recordBoardDirectionHandoff } from "../services/board-direction-return.js";
import { chatCompletionInstruction } from "../services/chat-completion-delivery.js";

function fixture() {
  const direction = { id: randomUUID(), sourceCompanyId: randomUUID(), sourceAgentId: randomUUID(), sourceRunId: randomUUID(),
    ownerUserId: "original-owner", authorizingUserId: null, mandateId: randomUUID(), mandateRevision: 1, grantId: randomUUID(),
    targetCompanyId: randomUUID(), executiveAgentId: randomUUID(), issueId: randomUUID(), expectedIssueStatusVersion: 0,
    idempotencyKey: randomUUID(), inputFingerprint: "intent", wakeupRequestId: randomUUID(), dispatchState: "dispatched",
    attemptCount: 1, nextAttemptAt: new Date(), leaseExpiresAt: null, lastErrorCode: null, createdAt: new Date(), updatedAt: new Date(),
    dispatchedAt: new Date() } satisfies typeof agentosBoardDirections.$inferSelect;
  const source = { id: randomUUID(), companyId: direction.sourceCompanyId, conversationAgentId: direction.sourceAgentId,
    assigneeAgentId: direction.sourceAgentId, conversationUserId: direction.ownerUserId, conversationSessionGeneration: 2, status: "in_review" } as typeof issues.$inferSelect;
  const task = { id: direction.issueId, companyId: direction.targetCompanyId, status: "done", statusVersion: 4 } as typeof issues.$inferSelect;
  const handoff = { taskId: task.id, companyId: direction.sourceCompanyId, conversationId: source.id, agentId: direction.sourceAgentId,
    sessionGeneration: 2, createdAt: new Date() } satisfies typeof chatTaskHandoffs.$inferSelect;
  return { direction, source, task, handoff, statusVersion: 4 };
}
function proxy(table: typeof agentosBoardDirections | typeof heartbeatRuns | typeof issues, value: Record<string, unknown> | null) {
  const queries: string[] = [];
  const db = drizzle(async query => {
    queries.push(query);
    return { rows: value ? [Object.keys(getTableColumns(table)).map(key => {
      const cell = value[key]; return cell instanceof Date ? cell.toISOString() : cell ?? null;
    })] : [] };
  }) as unknown as Db;
  return { db, queries };
}

describe("board-direction return provenance", () => {
  it("never treats an unbound foreign task as an ordinary conversation completion", async () => {
    const f = fixture(), { db, queries } = proxy(agentosBoardDirections, null);
    await expect(authorizeBoardDirectionReturn(db, f)).rejects.toMatchObject({ status: 403 });
    expect(queries).toHaveLength(1);
  });
  it("preserves the existing ordinary same-company completion path", async () => {
    const f = fixture(), { db } = proxy(agentosBoardDirections, null);
    expect(await authorizeBoardDirectionReturn(db, { ...f, task: { ...f.task, companyId: f.handoff.companyId } })).toBeNull();
  });
  it.each(["source company", "source agent", "conversation", "owner", "assignee", "generation", "cancelled chat", "reopened task", "status version"])(
    "rejects changed %s before any mandate or native source read", async change => {
      const f = fixture();
      if (change === "source company") f.handoff.companyId = randomUUID();
      if (change === "source agent") f.handoff.agentId = randomUUID();
      if (change === "conversation") f.handoff.conversationId = randomUUID();
      if (change === "owner") f.source.conversationUserId = "replacement-owner";
      if (change === "assignee") f.source.assigneeAgentId = randomUUID();
      if (change === "generation") f.source.conversationSessionGeneration += 1;
      if (change === "cancelled chat") f.source.status = "cancelled";
      if (change === "reopened task") f.task.status = "todo";
      if (change === "status version") f.statusVersion += 1;
      const { db, queries } = proxy(agentosBoardDirections, f.direction);
      await expect(authorizeBoardDirectionReturn(db, f)).rejects.toMatchObject({ status: 403 });
      expect(queries).toHaveLength(1);
    });
  it("retains an unconfirmed native dispatch as retryable instead of fabricating delivery", async () => {
    const f = fixture(), { db, queries } = proxy(agentosBoardDirections, { ...f.direction, dispatchState: "pending" });
    await expect(authorizeBoardDirectionReturn(db, f)).rejects.toMatchObject({ status: 409, details: { retryable: true } });
    expect(queries).toHaveLength(1);
  });
  it.each(["legacy runtime", "other responsible user", "missing source task"])("does not create return relations from %s", async change => {
    const f = fixture();
    const run = { id: f.direction.sourceRunId, companyId: f.direction.sourceCompanyId, agentId: f.direction.sourceAgentId,
      runtimeMode: change === "legacy runtime" ? "adapter" : "native", responsibleUserId: change === "other responsible user" ? "other" : f.direction.ownerUserId,
      nativeIssueId: change === "missing source task" ? null : f.source.id, issueId: null };
    const { db, queries } = proxy(heartbeatRuns, run);
    expect(await recordBoardDirectionHandoff(db, f.direction)).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/^select /);
  });
  it("directs Friday to current company evidence without treating a Done status as acceptance", () => {
    const text = chatCompletionInstruction({ chatCompletionUpdates: [{ id: randomUUID(), status: "done", boardDirection: { outcomePath: "/native-evidence" } }] });
    expect(text).toContain("not proof of accepted business results");
    expect(text).toContain("CEO's current report");
    expect(text).toContain("never author the company's deliverable");
    expect(chatCompletionInstruction({})).toBe("");
    expect(chatCompletionInstruction({ chatCompletionUpdates: [{ id: randomUUID(), status: "done" }] })).not.toContain("boardDirection entries");
  });
});
