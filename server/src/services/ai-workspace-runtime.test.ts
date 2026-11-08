import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  aiWorkspaceAccounts, aiWorkspaceAccountLinks, authUsers, companies, companyMemberships,
  companySecrets, connectionGrants, connectionGrantMembers, principalPermissionGrants,
  toolConnections, type Db,
} from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiCredentialOwnerSnapshot, resolveAiCredentialOwner, type AiCredentialSelection } from "./ai-account-credential-owner.js";
import { settlePluginTaskCredentialHandoff } from "./plugin-task-credential-writeback.js";

const effects = vi.hoisted(() => ({ lock: vi.fn(), rotate: vi.fn(), credential: vi.fn(), merge: vi.fn() }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decidePrincipalGrant: async () => ({ allowed: true }) }) }));
vi.mock("./ai-connections.js", () => ({ aiConnectionService: () => ({ credential: effects.credential }) }));
vi.mock("./secrets.js", () => ({ secretService: () => ({ rotate: effects.rotate }) }));
vi.mock("@paperclipai/adapter-codex-local/server", () => ({
  withAccountHomeSecretMutationLock: effects.lock, decideCodexAuthMerge: effects.merge,
}));

const ids = {
  sourceCompany: "11111111-1111-4111-8111-111111111111", targetCompany: "22222222-2222-4222-8222-222222222222",
  sourceConnection: "33333333-3333-4333-8333-333333333333", targetConnection: "44444444-4444-4444-8444-444444444444",
  sourceGrant: "55555555-5555-4555-8555-555555555555", targetGrant: "66666666-6666-4666-8666-666666666666",
  account: "77777777-7777-4777-8777-777777777777", link: "88888888-8888-4888-8888-888888888888",
  secret: "99999999-9999-4999-8999-999999999999", lease: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const date = "2026-11-08T00:00:00.000Z";
type Row = Record<string, unknown>;
function selection(companyId: string, connectionId: string, grantId: string, alias: boolean): AiCredentialSelection {
  return {
    connection: { id: connectionId, companyId, config: { ai: { provider: "openai", method: "subscription" }, aiIsolatedSubscription: true,
      ...(alias ? { aiWorkspaceAccount: true } : {}) }, connectionPurpose: "ai", transport: "runtime_auth", credentialSource: "paperclip_vault",
      enabled: true, status: "active", healthStatus: "ok", credentialSecretRefs: [], credentialRefs: [], externalCredential: null,
      createdByUserId: "local-board", createdAt: date, updatedAt: date } as unknown as AiCredentialSelection["connection"],
    grant: { id: grantId, connectionId, companyId, kind: "organization",
      credentialSecretRefs: alias ? [] : [{ configPath: "ai.credential", secretId: ids.secret, versionSelector: "latest" }],
      subjectUserId: null, subjectAgentId: null, status: "active", revokedAt: null, externalCredential: null,
      createdByUserId: "local-board", createdAt: date, updatedAt: date } as unknown as AiCredentialSelection["grant"],
  };
}
async function fixture(root = false) {
  const source = selection(ids.sourceCompany, ids.sourceConnection, ids.sourceGrant, false);
  const target = selection(ids.targetCompany, ids.targetConnection, ids.targetGrant, true);
  const tables = {
    ai_workspace_accounts: { table: aiWorkspaceAccounts, rows: [{ id: ids.account, ownerUserId: "owner", sourceCompanyId: ids.sourceCompany,
      sourceConnectionId: ids.sourceConnection, sourceGrantId: ids.sourceGrant, revision: 3, enabled: true, autoInstall: true, createdAt: date, updatedAt: date }] as Row[] },
    ai_workspace_account_links: { table: aiWorkspaceAccountLinks, rows: [{ id: ids.link, accountId: ids.account, companyId: ids.targetCompany,
      connectionId: ids.targetConnection, grantId: ids.targetGrant, revision: 2, enabled: true, createdAt: date, updatedAt: date }] as Row[] },
    user: { table: authUsers, rows: [{ id: "owner", approvalStatus: "approved", createdAt: date, updatedAt: date }] as Row[] },
    companies: { table: companies, rows: [ids.sourceCompany, ids.targetCompany].map(id => ({ id, status: "active", createdAt: date, updatedAt: date })) as Row[] },
    company_memberships: { table: companyMemberships, rows: [ids.sourceCompany, ids.targetCompany].map((companyId, index) => ({
      id: `member-${index}`, companyId, principalType: "user", principalId: "owner", status: "active", membershipRole: "owner", createdAt: date, updatedAt: date,
    })) as Row[] },
    principal_permission_grants: { table: principalPermissionGrants, rows: [] as Row[] },
    connection_grant_members: { table: connectionGrantMembers, rows: [] as Row[] },
    tool_connections: { table: toolConnections, rows: [source.connection, target.connection] as unknown as Row[] },
    connection_grants: { table: connectionGrants, rows: [source.grant, target.grant] as unknown as Row[] },
    company_secrets: { table: companySecrets, rows: [{ id: ids.secret, companyId: ids.sourceCompany, aiSessionEpoch: 7, status: "active", createdAt: date, updatedAt: date }] as Row[] },
  };
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let metadata: Record<string, unknown>;
  const db = drizzle(async (text, params) => {
    queries.push({ text, params });
    if (text.startsWith('update "environment_leases"')) {
      const encoded = params.find(value => typeof value === "string" && value.includes('"runnerTaskCredentialHandoff"'));
      if (!encoded) throw new Error("Missing durable handoff update");
      metadata = { ...metadata, ...JSON.parse(encoded as string) };
      return { rows: [[ids.lease]] };
    }
    const name = text.match(/from "([^"]+)"/)?.[1] as keyof typeof tables;
    const entry = tables[name];
    if (!entry) throw new Error(`Unexpected query: ${text}`);
    const rows = entry.rows.filter(row => {
      if (name === "ai_workspace_account_links") return params.includes(row.grantId) || params.includes(row.connectionId);
      if (name === "ai_workspace_accounts") return params.includes(row.id) || params.includes(row.sourceGrantId);
      if (name === "company_memberships") return params.includes(row.companyId) && params.includes(row.principalId);
      if (name === "connection_grant_members") return params.includes(row.companyId) && params.includes(row.grantId);
      if (name === "principal_permission_grants") return true;
      return params.includes(row.id);
    });
    return { rows: rows.map(row => Object.keys(getTableColumns(entry.table)).map(key => row[key] ?? null)) };
  }) as unknown as Db;
  // The SQL transport runs actual resolver and handoff code; it does not emulate
  // PostgreSQL concurrency, transaction rollback, or provider behavior.
  db.transaction = (async (operation: (database: Db) => Promise<unknown>) => operation(db)) as unknown as Db["transaction"];
  const selected = root ? source : target;
  const owner = await resolveAiCredentialOwner(db, selected);
  metadata = { runnerTaskDispatched: true, runnerTaskExecutionStopped: true, runnerTaskCredentialHandoff: {
    accountIdentity: `${selected.grant.id}:owner:fixture-generation`, state: "pending",
    binding: { grantId: selected.grant.id, secretId: ids.secret, sessionEpoch: 7, versionSelector: "latest", credentialOwner: aiCredentialOwnerSnapshot(owner) },
  } };
  const exported = vi.fn(async (_identity: string) => ({ type: "codex-auth-json" as const, authJson: "fixture-rotated-auth" }));
  const settle = () => settlePluginTaskCredentialHandoff(db, { companyId: selected.connection.companyId, leaseId: ids.lease }, metadata, exported);
  return { source, target, tables, queries, db, exported, settle, metadata: () => metadata };
}

beforeEach(() => {
  vi.resetAllMocks();
  effects.lock.mockImplementation(async (_home, _companyId, operation) => operation());
  effects.credential.mockResolvedValue("fixture-original-auth");
  effects.merge.mockResolvedValue(10);
  effects.rotate.mockResolvedValue(undefined);
});

describe("workspace account durable credential recovery", () => {
  it.each([false, true])("writes only the canonical credential while retaining the originating lease (root=%s)", async root => {
    const f = await fixture(root);
    await f.settle();
    expect(effects.lock.mock.calls.every(call => call[1] === ids.sourceCompany)).toBe(true);
    expect(effects.credential).toHaveBeenCalledWith(expect.objectContaining({
      connection: expect.objectContaining({ companyId: ids.sourceCompany, id: ids.sourceConnection }),
      grant: expect.objectContaining({ id: ids.sourceGrant }),
    }));
    expect(effects.rotate).toHaveBeenCalledExactlyOnceWith(ids.secret, { value: "fixture-rotated-auth", preserveAiSessionEpoch: true }, { userId: null });
    expect(f.target.grant.credentialSecretRefs).toEqual([]);
    const secretReads = f.queries.filter(query => query.text.includes('from "company_secrets"'));
    expect(secretReads).toHaveLength(2);
    expect(secretReads.every(query => query.params.includes(ids.sourceCompany) && !query.params.includes(ids.targetCompany))).toBe(true);
    const updates = f.queries.filter(query => query.text.startsWith('update "environment_leases"'));
    expect(updates).toHaveLength(1);
    expect(updates[0].params).toContain(root ? ids.sourceCompany : ids.targetCompany);
    expect(f.metadata().runnerTaskCredentialHandoff).toMatchObject({ state: "complete" });
    expect(JSON.stringify(f.metadata())).not.toContain("fixture-rotated-auth");
    expect(f.exported).toHaveBeenCalledWith(`${root ? ids.sourceGrant : ids.targetGrant}:owner:fixture-generation`);
  });
  it("keeps a failed save pending and retries from durable authority without controller-local credential files", async () => {
    const f = await fixture();
    effects.rotate.mockRejectedValueOnce(new Error("fixture database write unavailable"));
    await expect(f.settle()).rejects.toThrow("fixture database write unavailable");
    expect(f.metadata().runnerTaskCredentialHandoff).toMatchObject({ state: "pending" });
    expect(f.queries.some(query => query.text.startsWith('update "environment_leases"'))).toBe(false);
    await f.settle();
    expect(effects.rotate).toHaveBeenCalledTimes(2);
    expect(f.metadata().runnerTaskCredentialHandoff).toMatchObject({ state: "complete" });
  });
  it("rechecks alias authority after the canonical lock wait and retains pending recovery on revocation", async () => {
    const f = await fixture();
    effects.lock.mockImplementationOnce(async (_home, _companyId, operation) => {
      f.tables.ai_workspace_account_links.rows[0].enabled = false;
      return operation();
    });
    await expect(f.settle()).rejects.toThrow("unavailable");
    expect(f.exported).not.toHaveBeenCalled();
    expect(effects.rotate).not.toHaveBeenCalled();
    expect(f.metadata().runnerTaskCredentialHandoff).toMatchObject({ state: "pending" });
  });
  it("rechecks owner approval after provider export without losing the pending replacement", async () => {
    const f = await fixture();
    f.exported.mockImplementationOnce(async () => {
      f.tables.user.rows[0].approvalStatus = "blocked";
      return { type: "codex-auth-json", authJson: "fixture-rotated-auth" };
    });
    await expect(f.settle()).rejects.toThrow("unavailable");
    expect(effects.rotate).not.toHaveBeenCalled();
    expect(f.metadata().runnerTaskCredentialHandoff).toMatchObject({ state: "pending" });
  });
  it("does not overwrite an explicitly reconnected account epoch", async () => {
    const f = await fixture();
    f.tables.company_secrets.rows[0].aiSessionEpoch = 8;
    await f.settle();
    expect(f.exported).not.toHaveBeenCalled();
    expect(effects.rotate).not.toHaveBeenCalled();
    expect(f.metadata().runnerTaskCredentialHandoff).toMatchObject({ state: "complete" });
  });
  it("retains a provider replacement when the pinned alias revision no longer matches", async () => {
    const f = await fixture();
    f.exported.mockImplementationOnce(async () => {
      f.tables.ai_workspace_account_links.rows[0].revision = 3;
      return { type: "codex-auth-json", authJson: "fixture-rotated-auth" };
    });
    await expect(f.settle()).rejects.toThrow();
    expect(effects.rotate).not.toHaveBeenCalled();
    expect(f.metadata().runnerTaskCredentialHandoff).toMatchObject({ state: "pending" });
  });
});
