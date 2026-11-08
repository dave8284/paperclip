import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import { aiWorkspaceAccounts, aiWorkspaceAccountLinks, authUsers, companies, companyMemberships,
  connectionGrants, connectionGrantMembers, principalPermissionGrants, toolConnections, type Db } from "@paperclipai/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareManagedAiRuntime, withManagedAiProbe } from "./ai-connection-runtime.js";
import type { AiCredentialSelection } from "./ai-account-credential-owner.js";

const mocks = vi.hoisted(() => ({ select: vi.fn(), credential: vi.fn(), lock: vi.fn() }));
vi.mock("./ai-connections.js", () => ({ aiConnectionService: () => ({ select: mocks.select, runtimeCredential: mocks.credential }) }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decidePrincipalGrant: async () => ({ allowed: true }) }) }));
vi.mock("./subscriptions.js", () => ({ subscriptionService: () => ({ register: async () => "subscription" }) }));
vi.mock("./subscription-refresh.js", () => ({ refreshSubscriptionConnection: async () => undefined }));
vi.mock("@paperclipai/adapter-codex-local/server", async original => ({
  ...await original<object>(), withAccountHomeSecretMutationLock: mocks.lock,
}));

const ids = {
  sourceCompany: "11111111-1111-4111-8111-111111111111", targetCompany: "22222222-2222-4222-8222-222222222222",
  sourceConnection: "33333333-3333-4333-8333-333333333333", targetConnection: "44444444-4444-4444-8444-444444444444",
  sourceGrant: "55555555-5555-4555-8555-555555555555", targetGrant: "66666666-6666-4666-8666-666666666666",
  account: "77777777-7777-4777-8777-777777777777", link: "88888888-8888-4888-8888-888888888888",
  secret: "99999999-9999-4999-8999-999999999999", otherConnection: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherGrant: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", otherSecret: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
type Row = Record<string, unknown>;
const date = "2026-11-08T00:00:00.000Z";
function selected(companyId: string, connectionId: string, grantId: string, alias: boolean) {
  return {
    connection: { id: connectionId, companyId, name: "Owner account", config: { ai: { provider: "openai", method: "subscription" },
      aiIsolatedSubscription: true, ...(alias ? { aiWorkspaceAccount: true } : {}) }, connectionPurpose: "ai", transport: "runtime_auth",
      credentialSource: "paperclip_vault", enabled: true, status: "active", healthStatus: "ok", credentialSecretRefs: [], credentialRefs: [], externalCredential: null,
      createdAt: date, updatedAt: date } as unknown as AiCredentialSelection["connection"],
    grant: { id: grantId, connectionId, companyId, kind: "organization", subjectUserId: null, status: "active", revokedAt: null, externalCredential: null,
      credentialSecretRefs: alias ? [] : [{ configPath: "ai.credential", secretId: ids.secret, versionSelector: "latest" }], createdAt: date, updatedAt: date } as unknown as AiCredentialSelection["grant"],
    attribution: { connectionId, grantId, provider: "openai", method: "subscription", mode: "responsible_user", responsibleUserId: "owner" },
  };
}

describe("managed account authority after capacity waits", () => {
  let cwd: string, epoch: number, version: number, db: Db;
  let runtime: Awaited<ReturnType<typeof prepareManagedAiRuntime>> | undefined;
  let source: ReturnType<typeof selected>, target: ReturnType<typeof selected>, other: ReturnType<typeof selected>;
  let account: Row, link: Row, owner: Row;
  let queries: Array<{ query: string; params: unknown[] }>;
  const binding = { provider: "openai" as const, method: "subscription" as const, mode: "responsible_user" as const };
  const input = (companyId = ids.targetCompany) => ({ companyId, agentId: "agent", responsibleUserId: "owner", adapterType: "codex_local", binding, config: { cwd, model: "gpt-5.4" } });
  beforeEach(async () => {
    vi.clearAllMocks(); epoch = 1; version = 1; queries = [];
    cwd = await mkdtemp(path.join(os.tmpdir(), "agentos-capacity-authority-"));
    source = selected(ids.sourceCompany, ids.sourceConnection, ids.sourceGrant, false);
    target = selected(ids.targetCompany, ids.targetConnection, ids.targetGrant, true);
    other = selected(ids.targetCompany, ids.otherConnection, ids.otherGrant, false);
    other.grant.credentialSecretRefs[0].secretId = ids.otherSecret;
    account = { id: ids.account, ownerUserId: "owner", sourceCompanyId: ids.sourceCompany, sourceConnectionId: ids.sourceConnection,
      sourceGrantId: ids.sourceGrant, revision: 1, enabled: true, autoInstall: true, createdAt: date, updatedAt: date };
    link = { id: ids.link, accountId: ids.account, companyId: ids.targetCompany, connectionId: ids.targetConnection,
      grantId: ids.targetGrant, revision: 1, enabled: true, createdAt: date, updatedAt: date };
    owner = { id: "owner", approvalStatus: "approved", createdAt: date, updatedAt: date };
    const tables = {
      ai_workspace_accounts: { table: aiWorkspaceAccounts, rows: [account] },
      ai_workspace_account_links: { table: aiWorkspaceAccountLinks, rows: [link] },
      user: { table: authUsers, rows: [owner] },
      companies: { table: companies, rows: [ids.sourceCompany, ids.targetCompany].map(id => ({ id, status: "active", createdAt: date, updatedAt: date })) },
      company_memberships: { table: companyMemberships, rows: [ids.sourceCompany, ids.targetCompany].map(companyId => ({ id: companyId, companyId,
        principalId: "owner", principalType: "user", status: "active", membershipRole: "owner", createdAt: date, updatedAt: date })) },
      principal_permission_grants: { table: principalPermissionGrants, rows: [] },
      connection_grant_members: { table: connectionGrantMembers, rows: [] },
      tool_connections: { table: toolConnections, rows: [source.connection, target.connection, other.connection] },
      connection_grants: { table: connectionGrants, rows: [source.grant, target.grant, other.grant] },
    };
    mocks.select.mockImplementation(async () => structuredClone(target));
    mocks.credential.mockResolvedValue('{"tokens":{"access_token":"synthetic-only"}}');
    mocks.lock.mockImplementation(async (_home, _company, operation) => operation());
    // Exercise the real canonical resolver. Controlled SQL transport makes no
    // claim about PostgreSQL locks or provider behavior.
    db = drizzle(async (query, params) => {
      queries.push({ query, params });
      if (query.includes('from "company_secrets"')) return { rows: [[epoch, version]] };
      if (query.startsWith('select "credential_secret_refs", "status"')) {
        const grant = [source.grant, target.grant, other.grant].find(row => params.includes(row.id));
        return { rows: grant ? [[grant.credentialSecretRefs, grant.status]] : [] };
      }
      const name = query.match(/from "([^"]+)"/)?.[1] as keyof typeof tables;
      const entry = tables[name];
      if (!entry) throw new Error(`Unexpected query: ${query}`);
      const rows = (entry.rows as unknown as Row[]).filter(row => {
        if (name === "ai_workspace_account_links") return params.includes(row.grantId) || params.includes(row.connectionId);
        if (name === "ai_workspace_accounts") return params.includes(row.id) || params.includes(row.sourceGrantId);
        if (name === "company_memberships") return params.includes(row.companyId) && params.includes(row.principalId);
        if (name === "principal_permission_grants" || name === "connection_grant_members") return true;
        return params.includes(row.id);
      });
      return { rows: rows.map(row => Object.keys(getTableColumns(entry.table)).map(key => row[key] ?? null)) };
    }) as unknown as Db;
    runtime = await prepareManagedAiRuntime(db, input());
  });
  afterEach(async () => { await runtime?.cleanup(); await rm(cwd, { recursive: true, force: true }); runtime = undefined; });
  it("re-enters the native selector with original company, principal and agent while checking canonical freshness", async () => {
    await runtime!.assertCurrent();
    expect(mocks.select).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: ids.targetCompany, agentId: "agent", userId: "owner", adapterType: "codex_local", binding, model: "gpt-5.4" }));
    expect(mocks.credential).toHaveBeenCalledOnce();
    expect(runtime!.attribution).toMatchObject({ connectionId: ids.targetConnection, grantId: ids.targetGrant,
      credentialOwner: { companyId: ids.sourceCompany, grantId: ids.sourceGrant, binding: { accountId: ids.account, linkId: ids.link } } });
    expect(queries.filter(row => row.query.includes('from "company_secrets"')).every(row => row.params.includes(ids.sourceCompany))).toBe(true);
  });
  it.each(["The responsible user is not an active company member", "This credential is not shared with the responsible user", "This connection is not permitted for this agent"])("preserves native denial after a wait: %s", async message => {
    mocks.select.mockRejectedValueOnce(new Error(message));
    await expect(runtime!.assertCurrent()).rejects.toThrow(message);
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
  it("rejects a changed default without preparing or copying another credential", async () => {
    mocks.select.mockResolvedValueOnce(structuredClone(other));
    await expect(runtime!.assertCurrent()).rejects.toThrow("account changed");
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
  it.each(["epoch", "version"])("rejects changed credential %s without paid fallback", async field => {
    if (field === "epoch") epoch++; else version++;
    await expect(runtime!.assertCurrent()).rejects.toThrow("credential changed");
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
  it.each(["alias revoked", "account disabled", "owner approval lost", "link revision changed"])("rejects %s after a capacity wait", async change => {
    if (change === "alias revoked") link.enabled = false;
    if (change === "account disabled") account.enabled = false;
    if (change === "owner approval lost") owner.approvalStatus = "blocked";
    if (change === "link revision changed") link.revision = 2;
    await expect(runtime!.assertCurrent()).rejects.toThrow();
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
  it("also fences the original registered account after its owner authority changes", async () => {
    await runtime!.cleanup(); runtime = undefined;
    mocks.select.mockImplementation(async () => structuredClone(source));
    runtime = await prepareManagedAiRuntime(db, input(ids.sourceCompany));
    expect(runtime.attribution.credentialOwner?.binding?.linkId).toBeNull();
    account.enabled = false;
    await expect(runtime.assertCurrent()).rejects.toThrow("unavailable");
    expect(mocks.credential).toHaveBeenCalledTimes(2);
  });
  it("does not probe a newly selected default under a different account's mutation lock", async () => {
    const probe = vi.fn();
    mocks.lock.mockImplementationOnce(async (_home, companyId, operation) => {
      expect(companyId).toBe(ids.sourceCompany);
      mocks.select.mockImplementation(async () => structuredClone(other));
      return operation();
    });
    await expect(withManagedAiProbe(db, input(), probe)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
});
