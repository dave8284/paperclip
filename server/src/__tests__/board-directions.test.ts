import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it, vi } from "vitest";
import type { agentosPortfolioMandates, principalPermissionGrants, Db } from "@paperclipai/db";
import { createBoardDirectionSchema, setBoardDirectionAuthoritySchema } from "@paperclipai/shared";
import { boardDirectionGrantScope, matchesBoardDirectionGrant, BOARD_DIRECTION_PERMISSION } from "../services/board-direction-grants.js";
import { boardDirectionFingerprint, boardDirectionMatchesTask } from "../services/board-direction-intent.js";
import { deliverBoardDirection, boardDirectionDeliveryService } from "../services/board-direction-delivery.js";
import { boardDirectionActor, type BoardDirection } from "../services/board-directions.js";
import { runnerApiSensitiveResponse } from "../services/native-runtime/runner-api-sensitive-response.js";

function fixture() {
  const mandate = { id: randomUUID(), portfolioId: randomUUID(), ownerUserId: "owner", revision: 4, sourceCompanyId: randomUUID(), sourceAgentId: randomUUID(),
    grantId: randomUUID(), targetCompanyIds: [randomUUID()], action: "portfolio_work:read", readScope: "owner_accessible_private", expiresAt: null,
    revokedAt: null, createdAt: new Date(), updatedAt: new Date() } satisfies typeof agentosPortfolioMandates.$inferSelect;
  const grant = { id: randomUUID(), companyId: mandate.sourceCompanyId, principalType: "agent", principalId: mandate.sourceAgentId,
    permissionKey: BOARD_DIRECTION_PERMISSION, scope: boardDirectionGrantScope(mandate), grantedByUserId: mandate.ownerUserId,
    createdAt: new Date(), updatedAt: new Date() } as typeof principalPermissionGrants.$inferSelect;
  const input = createBoardDirectionSchema.parse({ mandateId: mandate.id, revision: mandate.revision, grantId: grant.id,
    targetCompanyId: mandate.targetCompanyIds[0], executiveAgentId: randomUUID(), projectId: null, idempotencyKey: randomUUID(),
    title: "Company direction", description: "CEO: propose a company-local delivery plan with evidence." });
  const row = { id: randomUUID(), sourceCompanyId: mandate.sourceCompanyId, sourceAgentId: mandate.sourceAgentId, sourceRunId: randomUUID(),
    mandateId: mandate.id, mandateRevision: mandate.revision, grantId: grant.id, targetCompanyId: input.targetCompanyId, executiveAgentId: input.executiveAgentId,
    issueId: randomUUID(), ownerUserId: mandate.ownerUserId, authorizingUserId: null, idempotencyKey: input.idempotencyKey,
    inputFingerprint: boardDirectionFingerprint(input) } as BoardDirection;
  const task = { id: row.issueId, companyId: row.targetCompanyId, projectId: input.projectId, title: input.title, description: input.description,
    priority: input.priority, assigneeAgentId: row.executiveAgentId, assigneeUserId: null, responsibleUserId: row.ownerUserId };
  return { mandate, grant, input, row, task };
}
describe("board direction scope and company isolation", () => {
  it("requires a separate exact write grant bound to the current private-read revision", () => {
    const { mandate, grant } = fixture();
    expect(matchesBoardDirectionGrant(mandate, undefined)).toBe(false);
    expect(matchesBoardDirectionGrant(mandate, grant)).toBe(true);
    for (const patch of [{ permissionKey: "workforce:portfolio_read" }, { grantedByUserId: "other" }, { principalId: randomUUID() },
      { companyId: randomUUID() }, { scope: null }, { scope: { ...grant.scope, allCompanies: true } }]) {
      expect(matchesBoardDirectionGrant(mandate, { ...grant, ...patch })).toBe(false);
    }
    for (const patch of [{ revision: 5 }, { grantId: randomUUID() }, { targetCompanyIds: [randomUUID()] }, { sourceAgentId: randomUUID() },
      { readScope: "company_shared_only" }, { revokedAt: new Date() }, { expiresAt: new Date(0) }]) {
      expect(matchesBoardDirectionGrant({ ...mandate, ...patch }, grant)).toBe(false);
    }
  });
  it.each(["parentId", "workspaceSelection", "executionWorkspaceId", "originRunId", "createdByUserId", "sourceCompanyId", "contextSnapshot", "credentials"])("rejects caller-supplied %s", key => {
    expect(createBoardDirectionSchema.safeParse({ ...fixture().input, [key]: randomUUID() }).success).toBe(false);
  });
  it("normalizes identical retries but binds company, executive, contents and project", () => {
    const { input } = fixture();
    expect(boardDirectionFingerprint({ ...input, title: ` ${input.title} ` })).toBe(boardDirectionFingerprint(input));
    expect(boardDirectionFingerprint({ ...input, executiveAgentId: input.executiveAgentId.toUpperCase(), targetCompanyId: input.targetCompanyId.toUpperCase() })).toBe(boardDirectionFingerprint(input));
    for (const patch of [{ targetCompanyId: randomUUID() }, { executiveAgentId: randomUUID() }, { projectId: randomUUID() },
      { description: "Changed direction" }, { grantId: randomUUID() }]) {
      expect(boardDirectionFingerprint({ ...input, ...patch })).not.toBe(boardDirectionFingerprint(input));
    }
  });
  it("rejects changed native work before admission without creating a replacement task", () => {
    const { row, task } = fixture();
    expect(boardDirectionMatchesTask(row, task)).toBe(true);
    for (const patch of [{ companyId: randomUUID() }, { id: randomUUID() }, { projectId: randomUUID() }, { title: "Rewritten" },
      { description: null }, { priority: "high" }, { assigneeAgentId: randomUUID() }, { assigneeUserId: "someone" }, { responsibleUserId: "other" }]) {
      expect(boardDirectionMatchesTask(row, { ...task, ...patch })).toBe(false);
    }
  });
  it("restores the actual source agent and owner, never a synthetic target board actor", () => {
    const { row } = fixture();
    expect(boardDirectionActor(row)).toMatchObject({ type: "agent", companyId: row.sourceCompanyId, agentId: row.sourceAgentId, runId: row.sourceRunId, onBehalfOfUserId: row.ownerUserId });
    expect(boardDirectionActor(row)).not.toHaveProperty("userId");
  });
  it("requires an explicit grant/revoke choice and concurrency identity", () => {
    expect(setBoardDirectionAuthoritySchema.safeParse({ expectedRevision: 4, expectedGrantId: null }).success).toBe(false);
    expect(setBoardDirectionAuthoritySchema.safeParse({ expectedRevision: 4, enabled: true }).success).toBe(false);
    expect(setBoardDirectionAuthoritySchema.parse({ expectedRevision: 4, expectedGrantId: null, enabled: false }).enabled).toBe(false);
  });
  it("keeps both direction response forms out of persisted tool content", () => {
    for (const method of ["POST", "GET"]) for (const suffix of ["", "/{directionId}"])
      expect(runnerApiSensitiveResponse(method, `/api/companies/{companyId}/friday/board-directions${suffix}`)).toBe(true);
  });
});

describe("durable board direction delivery", () => {
  function ports(receipts: boolean[]) {
    let offset = 0;
    return { accepted: vi.fn(async () => receipts[Math.min(offset++, receipts.length - 1)]!), enqueue: vi.fn(async () => undefined),
      settle: vi.fn(async (_state: "dispatched" | "cancelled", _code?: string) => {}), retry: vi.fn(async (_code: string) => {}) };
  }
  it("recovers a committed receipt before rechecking later-revoked sender authority", async () => {
    const port = ports([true]); await deliverBoardDirection(port);
    expect(port.enqueue).not.toHaveBeenCalled(); expect(port.settle).toHaveBeenCalledWith("dispatched"); expect(port.retry).not.toHaveBeenCalled();
  });
  it("requires a native receipt even when wakeup returns successfully", async () => {
    const port = ports([false, false]); await deliverBoardDirection(port);
    expect(port.settle).not.toHaveBeenCalled(); expect(port.retry).toHaveBeenCalledWith("native_admission_wait");
  });
  it("acknowledges a real native admission without claiming task completion", async () => {
    const port = ports([false, true]); await deliverBoardDirection(port);
    expect(port.enqueue).toHaveBeenCalledTimes(1); expect(port.settle).toHaveBeenCalledWith("dispatched");
  });
  it("recovers the enqueue commit/response gap", async () => {
    const port = ports([false, true]); port.enqueue.mockRejectedValue(new Error("connection lost after commit"));
    await deliverBoardDirection(port); expect(port.settle).toHaveBeenCalledWith("dispatched"); expect(port.retry).not.toHaveBeenCalled();
  });
  it.each([403, 404, 409])("stops unaccepted handoffs when authority or task identity changes (%s)", async status => {
    const port = ports([false]); port.enqueue.mockRejectedValue({ status }); await deliverBoardDirection(port);
    expect(port.settle).toHaveBeenCalledWith("cancelled", "authority_or_assignment_changed"); expect(port.retry).not.toHaveBeenCalled();
  });
  it("retains normal native admission waits as durable retry obligations", async () => {
    const port = ports([false]); port.enqueue.mockRejectedValue({ status: 409, details: { code: "board_direction_admission_wait" } });
    await deliverBoardDirection(port); expect(port.retry).toHaveBeenCalledWith("native_admission_wait"); expect(port.settle).not.toHaveBeenCalled();
  });
  it.each([{ code: "55P03" }, { cause: { code: "40P01" } }, { status: 409, details: { retryable: true } }])("retries transient authority contention without cancelling work (%j)", async error => {
    const port = ports([false]); port.enqueue.mockRejectedValue(error); await deliverBoardDirection(port);
    expect(port.retry).toHaveBeenCalledWith("authority_busy"); expect(port.settle).not.toHaveBeenCalled();
  });
  it("schedules the persisted retry/lease deadline and goes quiet without pending work", async () => {
    const now = new Date("2026-01-01T00:00:00Z"), later = new Date(now.getTime() + 60_000);
    const results = [[[later]], [[now]], [[null]]];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = drizzle(async (sql, params) => { queries.push({ sql, params }); return { rows: results.shift()! }; }) as unknown as Db;
    const service = boardDirectionDeliveryService(db, { heartbeat: { wakeup: vi.fn() }, now: () => now });
    expect(await service.hasPending()).toBe(false); expect(service.nextRunAt()).toBe(later.getTime());
    expect(await service.hasPending()).toBe(true); expect(service.nextRunAt()).toBe(now.getTime());
    expect(await service.hasPending()).toBe(false); expect(service.nextRunAt()).toBeNull();
    expect(queries.every(query => query.params.includes("pending") && query.sql.includes("greatest") && query.sql.includes("lease_expires_at"))).toBe(true);
  });
  it("does not discard an uncertain transport failure or expose its payload", async () => {
    const port = ports([false]); port.enqueue.mockRejectedValue(new Error("private provider material")); await deliverBoardDirection(port);
    expect(port.retry).toHaveBeenCalledWith("delivery_unconfirmed"); expect(port.settle).not.toHaveBeenCalled();
  });
  it("cannot turn an unreadable receipt into confirmed cancellation", async () => {
    const port = ports([false]); port.accepted.mockRejectedValue(new Error("database unavailable"));
    await expect(deliverBoardDirection(port)).rejects.toThrow("database unavailable"); expect(port.settle).not.toHaveBeenCalled(); expect(port.enqueue).not.toHaveBeenCalled();
  });
});
