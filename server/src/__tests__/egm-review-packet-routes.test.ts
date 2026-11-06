import type { Request, Response, NextFunction } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { egmReviewPacketRoutes } from "../routes/egm-review-packets.js";
const owner = vi.hoisted(() => ({ prepare: vi.fn(), read: vi.fn(), clear: vi.fn() }));
vi.mock("../services/native-runtime/egm-review-packets.js", () => ({ egmReviewPacketService: () => owner }));
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { type: "agent", agentId: id(1), runId: id(2), companyId: id(3) };
const body = { reviewerAgentId: id(4), packet: { documentId: id(5), revisionId: id(6) }, target: { documentId: id(7), revisionId: id(8) }, persona: "zoom_out", question: "Does the plan solve the root problem?" };
async function call(method: string, requestBody: unknown = {}) {
  const route = egmReviewPacketRoutes({} as never).stack.find(layer => layer.route?.methods[method])!.route;
  const req = { method: method.toUpperCase(), actor, params: { id: id(9), sourceRunId: id(2) }, body: requestBody } as unknown as Request;
  const res = { json: vi.fn(), setHeader: vi.fn() };
  for (const layer of route.stack) {
    let next = false;
    await (layer.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>)(req, res as unknown as Response, () => { next = true; });
    if (!next) break;
  }
  return res;
}
beforeEach(() => { vi.clearAllMocks(); owner.prepare.mockResolvedValue({ execution: "independent_review_unavailable" }); owner.read.mockResolvedValue({ stage: "server_prepared" }); owner.clear.mockResolvedValue({ cleared: true }); });
it("passes the authenticated actor and exact native route scope to the owning service", async () => {
  const response = await call("put", body);
  expect(owner.prepare).toHaveBeenCalledExactlyOnceWith(actor, { issueId: id(9), sourceRunId: id(2) }, { ...body, sources: [] });
  expect(response.json).toHaveBeenCalledWith({ execution: "independent_review_unavailable" });
  const read = await call("get"); expect(owner.read).toHaveBeenCalledExactlyOnceWith(actor, { issueId: id(9), sourceRunId: id(2) });
  expect(read.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
});
it("rejects caller-authored receipt/provenance fields before native mutation", async () => {
  await expect(call("put", { ...body, requestSha256: "a".repeat(64), isolated: true })).rejects.toThrow();
  expect(owner.prepare).not.toHaveBeenCalled();
});
it("requires the exact receipt for clear and preserves current authorization errors", async () => {
  await expect(call("delete", {})).rejects.toThrow();
  expect(owner.clear).not.toHaveBeenCalled();
  await call("delete", { requestSha256: "a".repeat(64) });
  expect(owner.clear).toHaveBeenCalledExactlyOnceWith(actor, { issueId: id(9), sourceRunId: id(2) }, "a".repeat(64));
  owner.read.mockRejectedValue({ status: 404 });
  await expect(call("get")).rejects.toMatchObject({ status: 404 });
});
