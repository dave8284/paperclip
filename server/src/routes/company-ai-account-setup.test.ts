import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "./companies.js";
const native = vi.hoisted(() => ({ create: vi.fn(), membership: vi.fn(), grants: vi.fn(), activity: vi.fn(), inherit: vi.fn() }));
vi.mock("../services/index.js", () => ({
  companyService: () => ({ create: native.create }), agentService: () => ({}), companyPortabilityService: () => ({}),
  accessService: () => ({ ensureMembership: native.membership, ensureRoleDefaultGrants: native.grants }), budgetService: () => ({}),
  companyArtifactsService: () => ({}), feedbackService: () => ({}), heartbeatService: () => ({}),
  buildExportFidelityReport: vi.fn(), collectExportFidelityCounts: vi.fn(), logActivity: native.activity, workTimelineService: () => ({}),
}));
vi.mock("../services/ai-workspace-account-setup.js", () => ({ inheritOwnerAiAccountsWithStatus: native.inherit }));
const company = { id: "11111111-1111-4111-8111-111111111111", name: "Fixture", budgetMonthlyCents: 0 };
const pending = { status: "pending", accountId: null, installedCompanyIds: [], pending: [{ companyId: company.id, reason: "busy", message: "Retry account setup" }], retry: { kind: "company", companyId: company.id } };
function handler() {
  const layer = companyRoutes({} as never).stack.find(layer => layer.route?.path === "/" && layer.route.stack.some(item => item.method === "post"));
  return layer!.route!.stack.at(-1)!.handle as (req: Request, res: Response) => Promise<void>;
}
const request = () => ({ body: { name: company.name, budgetMonthlyCents: 0 }, actor: { type: "board", source: "session", userId: "owner", isInstanceAdmin: true, companyIds: [] } }) as unknown as Request;
function response() { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res as unknown as Response; }
beforeEach(() => { vi.clearAllMocks(); native.create.mockResolvedValue(company); native.inherit.mockResolvedValue(pending); });
describe("company creation and resumable AI account setup", () => {
  it("returns the durable company with explicit pending setup instead of asking the client to create it again", async () => {
    const res = response(); await handler()(request(), res);
    expect(native.create).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ...company, aiAccountSetup: pending });
    expect(native.inherit).toHaveBeenCalledWith(expect.anything(), company.id, "owner");
    expect(native.inherit.mock.invocationCallOrder[0]).toBeGreaterThan(native.membership.mock.invocationCallOrder[0]);
    expect(native.inherit.mock.invocationCallOrder[0]).toBeGreaterThan(native.grants.mock.invocationCallOrder[0]);
  });
  it("does not substitute local-board as an approved private account owner", async () => {
    const req = request(); req.actor = { type: "board", source: "local_implicit" };
    await handler()(req, response());
    expect(native.inherit).toHaveBeenCalledWith(expect.anything(), company.id, null);
  });
});
