import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { AiWorkspaceAccountSummary } from "@paperclipai/shared";
import { conflict } from "../errors.js";
import { aiWorkspaceAccountSetupService } from "./ai-workspace-account-setup.js";

const management = vi.hoisted(() => ({ enroll: vi.fn(), list: vi.fn(), install: vi.fn() }));
vi.mock("./ai-workspace-accounts.js", () => ({ aiWorkspaceAccountService: () => management }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decidePrincipalGrant: async () => ({ allowed: true }) }) }));
const source = "11111111-1111-4111-8111-111111111111", target = "22222222-2222-4222-8222-222222222222";
const third = "33333333-3333-4333-8333-333333333333", accountId = "44444444-4444-4444-8444-444444444444";
const input = { userId: "owner", companyId: source, connectionId: "55555555-5555-4555-8555-555555555555", grantId: "66666666-6666-4666-8666-666666666666" };
const scope = { userId: input.userId, companyIds: [source, target, third] };
const account: AiWorkspaceAccountSummary = { id: accountId, ownerUserId: "owner", revision: 1, enabled: true, autoInstall: true,
  sourceCompanyId: source, sourceConnectionId: input.connectionId, sourceGrantId: input.grantId,
  name: "Owner subscription", provider: "openai", method: "subscription", available: true, links: [] };
const root = (kind = "organization", method = "subscription") => ({ connection: { connectionPurpose: "ai", config: { ai: { provider: "openai", method } } }, grant: { kind, subjectUserId: "owner" } });
const memberships = scope.companyIds.map(companyId => ({ companyId }));
const owned = scope.companyIds.map(id => ({ id }));
function database(...results: unknown[][]) {
  const remaining = [...results];
  const select = vi.fn(() => {
    if (!remaining.length) throw new Error("Unexpected setup query");
    const rows = remaining.shift()!;
    const query: Record<string, unknown> = { then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve) };
    for (const name of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) query[name] = () => query;
    return query;
  });
  return { db: { select } as unknown as Db, select, remaining };
}
beforeEach(() => {
  vi.clearAllMocks(); management.list.mockResolvedValue([account]); management.enroll.mockResolvedValue(account); management.install.mockResolvedValue({});
});
describe("owner account setup after durable connection/company creation", () => {
  it("enrolls once and installs only current owned companies inside the scope", async () => {
    const f = database([], [root()], memberships, [...owned, { id: "outside" }], [...owned, { id: "outside" }]);
    expect(await aiWorkspaceAccountSetupService(f.db).finishConnection(input)).toMatchObject({ status: "ready", accountId, installedCompanyIds: [target, third] });
    expect(management.enroll).toHaveBeenCalledOnce();
    expect(management.install.mock.calls.map(call => call[2])).toEqual([target, third]);
    expect(f.remaining).toHaveLength(0);
  });
  it.each([["user", "subscription"], ["organization", "api_key"]])("does not promote a %s %s login", async (kind, method) => {
    const f = database([], [root(kind, method)]);
    expect(await aiWorkspaceAccountSetupService(f.db).finishConnection(input)).toMatchObject({ status: "not_applicable" });
    expect(management.enroll).not.toHaveBeenCalled(); expect(management.install).not.toHaveBeenCalled();
  });
  it("does not auto-enroll an ordinary manager's company login", async () => {
    const f = database([], [root()], memberships, [{ id: target }]);
    expect(await aiWorkspaceAccountSetupService(f.db).finishConnection(input)).toMatchObject({ status: "not_applicable" });
    expect(management.enroll).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false }, { autoInstall: false }])("reconnect preserves an explicit account preference %j", async change => {
    management.list.mockResolvedValue([{ ...account, ...change }]);
    const f = database([account], [root()], memberships);
    expect(await aiWorkspaceAccountSetupService(f.db).finishConnection(input)).toMatchObject({ status: "not_applicable", accountId });
    expect(management.enroll).not.toHaveBeenCalled(); expect(management.install).not.toHaveBeenCalled();
  });
  it("retains successful companies, exposes a retry for failures, and never reverses a revoked alias", async () => {
    management.list.mockResolvedValue([{ ...account, links: [{ id: "revoked", companyId: target, connectionId: "alias", grantId: "grant", revision: 2, enabled: false }] }]);
    management.install.mockRejectedValueOnce(conflict("Work must finish"));
    const f = database(owned);
    const result = await aiWorkspaceAccountSetupService(f.db).reconcile(scope, accountId);
    expect(result).toMatchObject({ status: "pending", retry: { kind: "account", accountId }, pending: [{ companyId: third, reason: "busy" }] });
    expect(management.install).toHaveBeenCalledTimes(1); expect(management.install.mock.calls[0][2]).toBe(third);
  });
  it("a partial install failure does not hide another successful company", async () => {
    management.install.mockRejectedValueOnce(conflict("Busy")).mockResolvedValueOnce({});
    const f = database(owned);
    expect(await aiWorkspaceAccountSetupService(f.db).reconcile(scope, accountId)).toMatchObject({ status: "pending", installedCompanyIds: [third], pending: [{ companyId: target }] });
  });
  it("a committed login remains repairable when enrollment fails and never returns database secrets", async () => {
    management.enroll.mockRejectedValueOnce(new Error("database credential=must-not-appear"));
    const f = database([], [root()], memberships, owned);
    const result = await aiWorkspaceAccountSetupService(f.db).finishConnection(input);
    expect(result).toMatchObject({ status: "pending", retry: { kind: "connection", companyId: source, connectionId: input.connectionId, grantId: input.grantId } });
    expect(JSON.stringify(result)).not.toContain("must-not-appear");
    expect(management.install).not.toHaveBeenCalled();
  });
  it("inspection reconstructs a missing enrollment after restart without writing", async () => {
    management.list.mockResolvedValue([]);
    const f = database([], [root()], memberships, owned);
    expect(await aiWorkspaceAccountSetupService(f.db).inspectConnection(input)).toMatchObject({ status: "pending", retry: { kind: "connection" } });
    expect(management.enroll).not.toHaveBeenCalled(); expect(management.install).not.toHaveBeenCalled();
  });
  it("company inspection finds a saved shared login whose enrollment never committed", async () => {
    management.list.mockResolvedValue([]);
    const f = database(memberships, owned, owned, [{ companyId: source, connectionId: input.connectionId, grantId: input.grantId }]);
    expect(await aiWorkspaceAccountSetupService(f.db).inspectCompany(target, "owner")).toMatchObject({ status: "pending", retry: { kind: "connection", companyId: source } });
    expect(management.enroll).not.toHaveBeenCalled(); expect(management.install).not.toHaveBeenCalled();
  });
  it("company inspection reports missing aliases without creating one", async () => {
    const f = database(memberships, owned, owned, []);
    expect(await aiWorkspaceAccountSetupService(f.db).inspectCompany(target, "owner")).toMatchObject({ status: "pending",
      pending: [{ companyId: target, reason: "setup_failed" }], retry: { kind: "company", companyId: target } });
    expect(management.install).not.toHaveBeenCalled();
  });
  it("company retry uses its saved id and latest account revision without repeating creation", async () => {
    const f = database(memberships, owned, owned, []);
    expect(await aiWorkspaceAccountSetupService(f.db).inherit(target, "owner")).toMatchObject({ status: "ready", installedCompanyIds: [target] });
    expect(management.install).toHaveBeenCalledWith(scope, accountId, target, { expectedRevision: 1, expectedLinkRevision: null });
  });
  it("an explicit request ceiling prevents installing into another owned company", async () => {
    const f = database([account], [root()], memberships, owned);
    expect(await aiWorkspaceAccountSetupService(f.db).finishConnection(input, [source, target])).toMatchObject({ status: "ready", installedCompanyIds: [target] });
    expect(management.install.mock.calls.map(call => call[2])).toEqual([target]);
  });
  it("ordinary member inspection does not advertise setup they cannot perform", async () => {
    const f = database(memberships, [{ id: source }]);
    expect(await aiWorkspaceAccountSetupService(f.db).inspectCompany(target, "owner")).toMatchObject({ status: "not_applicable", retry: null });
    expect(management.list).not.toHaveBeenCalled(); expect(management.install).not.toHaveBeenCalled();
  });
});
