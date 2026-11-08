import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiWorkspaceAccountRoutes } from "./ai-workspace-accounts.js";

const service = vi.hoisted(() => ({ list: vi.fn(), enroll: vi.fn(), update: vi.fn(), install: vi.fn(), revoke: vi.fn() }));
const setup = vi.hoisted(() => ({ finishConnection: vi.fn(), reconcile: vi.fn(), inherit: vi.fn(), inspectCompany: vi.fn() }));
vi.mock("../services/ai-workspace-accounts.js", () => ({ aiWorkspaceAccountService: () => service }));
vi.mock("../services/ai-workspace-account-setup.js", () => ({ aiWorkspaceAccountSetupService: () => setup }));
const accountId = "11111111-1111-4111-8111-111111111111", companyId = "22222222-2222-4222-8222-222222222222";
const sourceCompanyId = "33333333-3333-4333-8333-333333333333";
const board = { type: "board", source: "session", userId: "owner", companyIds: [sourceCompanyId, companyId] };
const requests = [
  ["get", "/instance/ai-accounts"], ["post", "/instance/ai-accounts/enroll"],
  ["patch", "/instance/ai-accounts/:accountId"], ["post", "/instance/ai-accounts/:accountId/companies/:companyId"],
  ["delete", "/instance/ai-accounts/:accountId/companies/:companyId"],
  ["post", "/instance/ai-accounts/setup"], ["post", "/instance/ai-accounts/:accountId/setup"],
  ["post", "/instance/ai-accounts/companies/:companyId/setup"], ["get", "/instance/ai-accounts/companies/:companyId/setup"],
] as const;
function handler(method: string, path: string) {
  const route = aiWorkspaceAccountRoutes({} as never).stack.find(layer => layer.route?.path === path && layer.route.stack.some(item => item.method === method));
  return route!.route!.stack[0].handle as (req: Request, res: Response) => Promise<void>;
}
function request(method: string, actor = board, body: Record<string, unknown> = {}) {
  return { method: method.toUpperCase(), actor, body, params: { accountId, companyId } } as unknown as Request;
}
function response() { return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response; }
beforeEach(() => { vi.clearAllMocks(); service.list.mockResolvedValue([]); });

describe("owner account route authority without a listener", () => {
  it.each(requests)("rejects agent callers before %s %s reaches account management", async (method, path) => {
    const req = request(method); req.actor = { type: "agent", source: "agent_jwt", companyId, agentId: "agent", onBehalfOfUserId: "owner" };
    await expect(handler(method, path)(req, response())).rejects.toMatchObject({ status: 403 });
    for (const operation of Object.values(service)) expect(operation).not.toHaveBeenCalled();
    for (const operation of Object.values(setup)) expect(operation).not.toHaveBeenCalled();
  });
  it("requires an authenticated owner identity even in local implicit board mode", async () => {
    const req = request("get"); req.actor = { type: "board", source: "local_implicit" };
    await expect(handler(...requests[0])(req, response())).rejects.toMatchObject({ status: 403 });
    expect(service.list).not.toHaveBeenCalled();
  });
  it("uses session ownership and the exact company ceiling for account summaries", async () => {
    const res = response(); await handler(...requests[0])(request("get"), res);
    expect(service.list).toHaveBeenCalledWith({ userId: "owner", companyIds: board.companyIds });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it("rejects enrollment outside the session company ceiling even for an instance admin", async () => {
    const req = request("post", { ...board, companyIds: [companyId] }, {
      id: accountId, sourceCompanyId, sourceConnectionId: accountId, sourceGrantId: accountId, autoInstall: true,
    });
    req.actor.isInstanceAdmin = true;
    await expect(handler(...requests[1])(req, response())).rejects.toMatchObject({ status: 403 });
    expect(service.enroll).not.toHaveBeenCalled();
  });
  it.each([requests[3], requests[4]])("rejects %s to an inaccessible company without reading the account", async (method, path) => {
    await expect(handler(method, path)(request(method, { ...board, companyIds: [sourceCompanyId] }, {
      expectedRevision: 1, expectedLinkRevision: null,
    }), response())).rejects.toMatchObject({ status: 403 });
    expect(service.install).not.toHaveBeenCalled(); expect(service.revoke).not.toHaveBeenCalled();
  });
  it("does not accept caller-supplied ownership or missing revision preconditions", async () => {
    const update = handler(...requests[2]);
    await expect(update(request("patch", board, { expectedRevision: 1, enabled: false, userId: "other" }), response())).rejects.toThrow();
    await expect(update(request("patch", board, { enabled: false }), response())).rejects.toThrow();
    expect(service.update).not.toHaveBeenCalled();
  });
  it("passes explicit company install and revoke preconditions unchanged", async () => {
    const body = { expectedRevision: 4, expectedLinkRevision: 2 };
    await handler(...requests[3])(request("post", board, body), response());
    await handler(...requests[4])(request("delete", board, body), response());
    for (const operation of [service.install, service.revoke]) expect(operation).toHaveBeenCalledWith(
      { userId: "owner", companyIds: board.companyIds }, accountId, companyId, body,
    );
  });
  it("connection retries retain the authenticated identity and company ceiling", async () => {
    await handler(...requests[5])(request("post", board, { companyId, connectionId: accountId, grantId: accountId }), response());
    expect(setup.finishConnection).toHaveBeenCalledWith({ companyId, connectionId: accountId, grantId: accountId, userId: "owner" }, board.companyIds);
  });
  it("company status is read-only and company retries do not create companies", async () => {
    await handler(...requests[8])(request("get"), response());
    expect(setup.inspectCompany).toHaveBeenCalledWith(companyId, "owner", board.companyIds);
    expect(setup.inherit).not.toHaveBeenCalled(); expect(setup.finishConnection).not.toHaveBeenCalled();
    await handler(...requests[7])(request("post"), response());
    expect(setup.inherit).toHaveBeenCalledWith(companyId, "owner", { ceiling: board.companyIds });
  });
});
