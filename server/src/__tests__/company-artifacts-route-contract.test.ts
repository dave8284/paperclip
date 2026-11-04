import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";
const native = vi.hoisted(() => ({ decide: vi.fn(), list: vi.fn(), issues: vi.fn(), projects: vi.fn() }));
vi.mock("../services/index.js", () => ({
  companyService: () => ({}), agentService: () => ({}), companyPortabilityService: () => ({}),
  accessService: () => ({ decide: native.decide }), budgetService: () => ({}),
  companyArtifactsService: () => ({ list: native.list }), feedbackService: () => ({}),
  heartbeatService: () => ({}), buildExportFidelityReport: vi.fn(), collectExportFidelityCounts: vi.fn(),
  logActivity: vi.fn(), workTimelineService: () => ({}),
}));
vi.mock("../services/authorization.js", () => ({ issueReadSqlCondition: native.issues, projectReadSqlCondition: native.projects, responsibleUserAuthzShadowMode: () => false }));
const companyId = "11111111-1111-4111-8111-111111111111";
const actor: Express.Request["actor"] = { type: "agent", source: "agent_jwt", companyId, agentId: "agent", onBehalfOfUserId: "owner", onBehalfOfMemberships: [{ companyId, membershipRole: "member", status: "active" }], authorizingUserId: "authorizer", runId: "run" };
const issueCondition = sql<boolean>`false`, projectCondition = sql<boolean>`false`;
function handler() {
  const router = companyRoutes({} as never);
  const layer = router.stack.find(layer => layer.route?.path === "/:companyId/artifacts");
  return layer!.route.stack[0].handle as (req: Request, res: Response) => Promise<void>;
}
function response() { return { json: vi.fn() } as unknown as Response; }
beforeEach(() => {
  vi.clearAllMocks(); native.decide.mockResolvedValue({ allowed: true });
  native.issues.mockResolvedValue(issueCondition); native.projects.mockResolvedValue(projectCondition);
  native.list.mockResolvedValue({ artifacts: [], nextCursor: null });
});
describe("native artifact listing route contract without a listener", () => {
  it("passes the unchanged actor through native discovery and both privacy projections", async () => {
    await handler()({ actor, params: { companyId }, query: {} } as unknown as Request, response());
    expect(native.decide).toHaveBeenCalledWith({ actor, action: "company_scope:read", resource: { type: "company", companyId } });
    expect(native.issues.mock.calls[0][1]).toBe(actor); expect(native.projects.mock.calls[0][1]).toBe(actor);
    expect(native.list).toHaveBeenCalledWith(companyId, expect.any(Object), { userId: undefined, issueConditions: [issueCondition], projectReadCondition: projectCondition });
  });
  it("denies company discovery before fetching privacy predicates or artifacts", async () => {
    native.decide.mockResolvedValue({ allowed: false });
    await expect(handler()({ actor, params: { companyId }, query: {} } as unknown as Request, response())).rejects.toMatchObject({ status: 403 });
    expect(native.issues).not.toHaveBeenCalled(); expect(native.projects).not.toHaveBeenCalled(); expect(native.list).not.toHaveBeenCalled();
  });
  it("keeps the native foreign-company guard ahead of discovery", async () => {
    await expect(handler()({ actor, params: { companyId: "foreign" }, query: {} } as unknown as Request, response())).rejects.toMatchObject({ status: 403 });
    expect(native.decide).not.toHaveBeenCalled(); expect(native.list).not.toHaveBeenCalled();
  });
  it("keeps starred selection tied to the board identity while applying privacy", async () => {
    const board: Express.Request["actor"] = { type: "board", source: "session", userId: "viewer", companyIds: [companyId] };
    await handler()({ actor: board, params: { companyId }, query: { starred: "true" } } as unknown as Request, response());
    expect(native.list).toHaveBeenCalledWith(companyId, expect.objectContaining({ starred: true }), expect.objectContaining({ userId: "viewer", issueConditions: [issueCondition] }));
  });
});
