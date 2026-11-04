import type { Request, Response, NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fridayRoutes } from "../routes/friday.js";
import { buildOpenApiSpec } from "../routes/openapi.js";
import { buildPaperclipTaskMarkdown } from "../services/heartbeat/task-markdown.js";
import { runnerApiOperation, searchRunnerApi } from "../services/native-runtime/runner-api-catalog.js";
import { runnerApiUrl } from "../services/native-runtime/runner-api-client.js";

const native = vi.hoisted(() => ({ read: vi.fn(), company: vi.fn() }));
vi.mock("../services/friday-diagnostics.js", () => ({ fridayDiagnosticsService: () => ({ read: native.read }) }));
vi.mock("../services/authorization.js", async original => ({ ...await original<typeof import("../services/authorization.js")>(), authorizationService: () => ({ decideReads: native.company }) }));
const companyId = "11111111-1111-4111-8111-111111111111";
const actor: Express.Request["actor"] = { type: "agent", source: "agent_jwt", agentId: "agent", companyId, runId: "run", onBehalfOfUserId: "owner", onBehalfOfMemberships: [{ companyId, status: "active", membershipRole: "member" }] };
const request = (overrides: Partial<Request> = {}) => ({ method: "GET", actor, params: { companyId }, query: {}, ...overrides }) as Request;
const response = () => { const result = { json: vi.fn(), set: vi.fn() }; result.set.mockReturnValue(result); return result as unknown as Response; };
function handlers() {
  const router = fridayRoutes({} as never);
  return {
    guard: router.stack[0].handle as (req: Request, res: Response, next: NextFunction) => Promise<void>,
    read: router.stack.find(layer => layer.route?.path === "/companies/:companyId/friday/diagnostics")!.route.stack[0].handle as (req: Request, res: Response) => Promise<void>,
  };
}
beforeEach(() => { vi.clearAllMocks(); native.company.mockResolvedValue([{ allowed: true }]); native.read.mockResolvedValue({ version: 1, checks: [] }); });

describe("Friday diagnostics discoverability and route contract without a listener", () => {
  it("keeps company admission ahead of a no-store read with the unchanged native actor", async () => {
    const route = handlers(), req = request(), res = response(), next = vi.fn();
    await route.guard(req, res, next); expect(next).toHaveBeenCalledOnce();
    await route.read(req, res);
    expect(native.read).toHaveBeenCalledWith(companyId, actor, { limit: 25, offset: 0 });
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it("rejects cross-company callers and denied discovery before diagnostics", async () => {
    const route = handlers(), res = response(), next = vi.fn();
    await expect(route.guard(request({ params: { companyId: "22222222-2222-4222-8222-222222222222" } }), res, next)).rejects.toMatchObject({ status: 403 });
    expect(native.company).not.toHaveBeenCalled();
    native.company.mockResolvedValue([{ allowed: false }]);
    await expect(route.guard(request(), res, next)).rejects.toMatchObject({ status: 403 });
    expect(next).not.toHaveBeenCalled(); expect(native.read).not.toHaveBeenCalled();
  });
  it("rejects an unbounded or unknown query before invoking the projection", async () => {
    await expect(handlers().read(request({ query: { limit: "5000", companyId: "foreign" } }), response())).rejects.toThrow();
    expect(native.read).not.toHaveBeenCalled();
  });
  it("registers the GET operation for native API discovery with bounded query parameters", () => {
    const operation = buildOpenApiSpec().paths?.["/api/companies/{companyId}/friday/diagnostics"]?.get;
    expect(operation?.summary).toContain("read-only");
    expect(operation?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "limit", in: "query" }), expect.objectContaining({ name: "projectId", in: "query" })]));
    const operationId = "GET /api/companies/{companyId}/friday/diagnostics";
    expect(searchRunnerApi({ query: operationId }).results[0].operationId).toBe(operationId);
    const nativeOperation = runnerApiOperation(operationId);
    expect(nativeOperation.allowedModes).toEqual(expect.arrayContaining(["standard", "ask", "planning"]));
    expect(nativeOperation.callPolicy).toBe("rest");
    const context = { companyId, issueId: "conversation", runId: "run", workMode: "ask" };
    expect(runnerApiUrl(nativeOperation, { operationId }, context, "https://paperclip.test").pathname).toBe(`/api/companies/${companyId}/friday/diagnostics`);
    // The generic client can address another company; the real route guard
    // above retains the denial instead of trusting URL construction as access.
    expect(runnerApiUrl(nativeOperation, { operationId, pathParams: { companyId: "foreign" } }, context, "https://paperclip.test").pathname).toBe("/api/companies/foreign/friday/diagnostics");
  });
  it("injects diagnosis, complete-answer and research guidance into existing conversations and resume deltas", () => {
    for (const includeDescription of [true, false]) {
      const prompt = buildPaperclipTaskMarkdown({ issue: { id: "conversation", identifier: null, title: "Friday", conversationAgentId: "installed-friday" }, includeDescription, nativeRunner: true });
      expect(prompt).toContain("/friday/diagnostics");
      expect(prompt).toContain("Answer the whole question");
      expect(prompt).toContain("Save useful web research");
      expect(prompt).toContain("baseRevisionId");
      expect(prompt).toContain("never add a monitoring loop");
    }
    expect(buildPaperclipTaskMarkdown({ issue: { id: "task", identifier: null, title: "Execution" } })).not.toContain("/friday/diagnostics");
  });
});
