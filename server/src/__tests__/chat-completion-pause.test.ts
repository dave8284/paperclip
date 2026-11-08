import { describe, expect, it, vi } from "vitest";
import { agents, agentWakeupRequests, chatCompletionDeliveries, issues, type Db } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { PortfolioDelegatePausedError } from "../services/agentos-portfolio-mandates.js";

const authority = vi.hoisted(() => vi.fn());
vi.mock("../services/board-direction-return.js", () => ({
  authorizeBoardDirectionReturn: authority,
  recordBoardDirectionHandoffForTask: vi.fn(),
  recoverBoardDirectionReturns: vi.fn(),
}));
vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({ getExperimental: async () => ({ enableAgentChat: true }) }),
}));
import { chatCompletionDeliveryService } from "../services/chat-completion-delivery.js";

function fixture() {
  const delivery = { id: "return", taskId: "company-task", companyId: "source", status: "pending", statusVersion: 2,
    attempts: 0, targetRunId: null, nextAttemptAt: new Date(0) };
  const handoff = { taskId: delivery.taskId, companyId: "source", conversationId: "owner-chat", agentId: "friday", sessionGeneration: 1 };
  const task = { id: delivery.taskId, companyId: "target", status: "done", statusVersion: 2 };
  const source = { id: handoff.conversationId, companyId: "source", conversationAgentId: "friday", assigneeAgentId: "friday",
    conversationSessionGeneration: 1, status: "in_review" };
  const state = { recipientStatus: "idle", enterAuthorization: () => {}, leaveAuthorization: () => {} };
  const writes: Record<string, unknown>[] = [];
  const reader = (rows: unknown[]) => {
    const query = { innerJoin: () => query, leftJoin: () => query, where: () => query, orderBy: () => query,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  const db = {
    select: (fields?: Record<string, unknown>) => ({ from: (table: unknown) => {
      if (table === chatCompletionDeliveries) return reader(fields && "run" in fields
        ? [{ delivery: { ...delivery }, run: null }] : [{ delivery: { ...delivery }, handoff, task }]);
      if (table === issues) return reader([source]);
      if (table === agents) return reader([{ id: "friday", companyId: "source", status: state.recipientStatus }]);
      if (table === agentWakeupRequests) return reader([]);
      throw new Error("Unexpected audience read, including catch-side status lookup");
    } }),
    update: (table: unknown) => {
      expect(table).toBe(chatCompletionDeliveries);
      return { set: (patch: Record<string, unknown>) => {
        const write = () => { writes.push(patch); Object.assign(delivery, patch); };
        return { where: () => ({
          returning: async () => { write(); return [{ ...delivery }]; },
          then: (resolve: (value: unknown[]) => unknown) => { write(); return Promise.resolve([]).then(resolve); },
        }) };
      } };
    },
    transaction: async (callback: (tx: Db) => Promise<unknown>) => {
      state.enterAuthorization();
      try { return await callback(db as unknown as Db); }
      finally { state.leaveAuthorization(); }
    },
  };
  const wakeup = vi.fn(async () => ({ id: "new-return-run" }));
  authority.mockReset();
  return { delivery, state, writes, wakeup, service: chatCompletionDeliveryService(db as unknown as Db, { wakeup }) };
}

describe("completion return pause interleaving", () => {
  it("retains an observed pause when resume commits before the authorization catch, then delivers once", async () => {
    const f = fixture();
    f.state.enterAuthorization = () => { f.state.recipientStatus = "paused"; };
    f.state.leaveAuthorization = () => { f.state.recipientStatus = "idle"; };
    authority.mockImplementationOnce(async () => {
      expect(f.state.recipientStatus).toBe("paused");
      throw new PortfolioDelegatePausedError();
    });
    await f.service.deliver(f.delivery.id);
    expect(f.state.recipientStatus).toBe("idle");
    expect(f.delivery).toMatchObject({ status: "pending", attempts: 0, targetRunId: null });
    expect(f.wakeup).not.toHaveBeenCalled();
    f.state.enterAuthorization = () => {};
    authority.mockResolvedValueOnce({ id: "direction" });
    f.delivery.nextAttemptAt = new Date(0);
    await f.service.deliver(f.delivery.id);
    expect(authority).toHaveBeenCalledTimes(2);
    expect(f.wakeup).toHaveBeenCalledTimes(1);
    expect(f.delivery).toMatchObject({ status: "queued", attempts: 0, targetRunId: "new-return-run" });
  });

  it("does not reinterpret revoked authority as retryable because the recipient pauses before catch", async () => {
    const f = fixture();
    f.state.leaveAuthorization = () => { f.state.recipientStatus = "paused"; };
    authority.mockRejectedValueOnce(forbidden("The native portfolio read grant was removed or changed"));
    await f.service.deliver(f.delivery.id);
    expect(f.delivery).toMatchObject({ status: "superseded", attempts: 0 });
    expect(f.wakeup).not.toHaveBeenCalled();
  });

  it("rechecks revocation on the resumed attempt instead of treating the prior pause as permission", async () => {
    const f = fixture();
    authority.mockRejectedValueOnce(new PortfolioDelegatePausedError());
    await f.service.deliver(f.delivery.id);
    expect(f.delivery.status).toBe("pending");
    authority.mockRejectedValueOnce(forbidden("Mandate revoked"));
    f.delivery.nextAttemptAt = new Date(0);
    await f.service.deliver(f.delivery.id);
    expect(authority).toHaveBeenCalledTimes(2);
    expect(f.delivery).toMatchObject({ status: "superseded", attempts: 0, targetRunId: null });
    expect(f.wakeup).not.toHaveBeenCalled();
  });
});
