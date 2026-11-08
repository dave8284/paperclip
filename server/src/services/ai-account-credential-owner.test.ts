import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  aiWorkspaceAccounts, aiWorkspaceAccountLinks, authUsers, companies, companyMemberships,
  connectionGrants, connectionGrantMembers, principalPermissionGrants, toolConnections, type Db,
} from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrollAiWorkspaceAccountSchema, installAiWorkspaceAccountSchema, updateAiWorkspaceAccountSchema } from "@paperclipai/shared";
import {
  aiCredentialOwnerSnapshot, sameAiCredentialOwner, resolveAiCredentialOwner,
  type AiCredentialSelection,
} from "./ai-account-credential-owner.js";

const authority = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decidePrincipalGrant: authority.decide }) }));
const ids = {
  sourceCompany: "11111111-1111-4111-8111-111111111111", targetCompany: "22222222-2222-4222-8222-222222222222",
  sourceConnection: "33333333-3333-4333-8333-333333333333", targetConnection: "44444444-4444-4444-8444-444444444444",
  sourceGrant: "55555555-5555-4555-8555-555555555555", targetGrant: "66666666-6666-4666-8666-666666666666",
  account: "77777777-7777-4777-8777-777777777777", link: "88888888-8888-4888-8888-888888888888",
  secret: "99999999-9999-4999-8999-999999999999",
};
const date = "2026-11-08T00:00:00.000Z";
type Row = Record<string, unknown>;
function selection(companyId: string, connectionId: string, grantId: string, alias: boolean): AiCredentialSelection {
  const refs = alias ? [] : [{ configPath: "ai.credential", secretId: ids.secret, versionSelector: "latest" }];
  return {
    connection: { id: connectionId, companyId, config: { ai: { provider: "openai", method: "subscription" }, aiIsolatedSubscription: true,
      ...(alias ? { aiWorkspaceAccount: true } : {}) }, connectionPurpose: "ai", transport: "runtime_auth", credentialSource: "paperclip_vault",
      enabled: true, status: "active", healthStatus: "ok", credentialSecretRefs: [], credentialRefs: [], externalCredential: null,
      createdByUserId: "local-board", createdAt: date, updatedAt: date } as unknown as AiCredentialSelection["connection"],
    grant: { id: grantId, connectionId, companyId, kind: "organization", credentialSecretRefs: refs, subjectUserId: null,
      subjectAgentId: null, status: "active", revokedAt: null, externalCredential: null, createdByUserId: "local-board",
      createdAt: date, updatedAt: date } as unknown as AiCredentialSelection["grant"],
  };
}
function fixture() {
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
  };
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let beforeQuery: ((text: string) => void) | undefined;
  const db = drizzle(async (text, params) => {
    queries.push({ text, params }); beforeQuery?.(text);
    const name = text.match(/from "([^"]+)"/)?.[1] as keyof typeof tables;
    const entry = tables[name];
    if (!entry) throw new Error(`Unexpected query: ${text}`);
    const rows = entry.rows.filter(row => {
      if (name === "ai_workspace_account_links") return params.includes(row.grantId) || params.includes(row.connectionId);
      if (name === "ai_workspace_accounts") return params.includes(row.id) || params.includes(row.sourceGrantId);
      if (name === "companies" || name === "tool_connections" || name === "connection_grants" || name === "user") return params.includes(row.id);
      if (name === "company_memberships") return params.includes(row.companyId) && params.includes(row.principalId);
      if (name === "connection_grant_members") return params.includes(row.companyId) && params.includes(row.grantId);
      return true;
    });
    return { rows: rows.map(row => Object.keys(getTableColumns(entry.table)).map(key => row[key] ?? null)) };
  }) as unknown as Db;
  // Controlled SQL transport exercises the actual resolver's reads/decisions.
  // It does not claim PostgreSQL transaction/locking execution.
  return { source, target, db, tables, queries, before: (fn: (text: string) => void) => { beforeQuery = fn; } };
}
beforeEach(() => { authority.decide.mockReset(); authority.decide.mockResolvedValue({ allowed: true }); });

describe("canonical AI credential ownership", () => {
  it("resolves two native grants to one credential without changing target execution identity", async () => {
    const f = fixture(); const before = structuredClone(f.target);
    const alias = await resolveAiCredentialOwner(f.db, f.target);
    const root = await resolveAiCredentialOwner(f.db, f.source);
    expect(alias.connection.id).toBe(ids.sourceConnection);
    expect(alias.grant.id).toBe(ids.sourceGrant);
    expect(aiCredentialOwnerSnapshot(alias).credential).toEqual(aiCredentialOwnerSnapshot(root).credential);
    expect(alias.binding).toEqual({ accountId: ids.account, accountRevision: 3, linkId: ids.link, linkRevision: 2 });
    expect(root.binding).toEqual({ accountId: ids.account, accountRevision: 3, linkId: null, linkRevision: null });
    expect(f.target).toEqual(before);
    expect(f.queries.every(query => query.text.startsWith("select "))).toBe(true);
    expect(f.queries.some(query => /secret_versions|from "company_secrets"/.test(query.text))).toBe(false);
    expect(authority.decide).toHaveBeenCalledWith(expect.objectContaining({ companyId: ids.sourceCompany, principalId: "owner" }));
    expect(authority.decide).toHaveBeenCalledWith(expect.objectContaining({ companyId: ids.targetCompany, principalId: "owner" }));
  });
  it("retains an unenrolled native connection without treating a config pointer as authority", async () => {
    const f = fixture(); f.tables.ai_workspace_accounts.rows = [];
    f.source.connection.config.accountId = ids.account;
    expect(await resolveAiCredentialOwner(f.db, f.source)).toBe(f.source);
  });
  it.each(["marker", "empty"])("a deleted alias cannot fall back through %s", async mode => {
    const f = fixture(); f.tables.ai_workspace_account_links.rows = [];
    if (mode === "marker") f.target.grant.credentialSecretRefs = structuredClone(f.source.grant.credentialSecretRefs);
    else delete f.target.connection.config.aiWorkspaceAccount;
    await expect(resolveAiCredentialOwner(f.db, f.target)).rejects.toThrow("unavailable");
  });
  it("rejects an alias edited to contain a copied or substituted credential", async () => {
    const f = fixture(); f.target.grant.credentialSecretRefs = structuredClone(f.source.grant.credentialSecretRefs);
    await expect(resolveAiCredentialOwner(f.db, f.target)).rejects.toThrow("unavailable");
  });
  it.each(["link disabled", "account disabled", "root revoked", "target revoked", "root archived", "owner blocked", "source owner lost", "target owner lost", "provider changed", "root missing"])("fails closed after %s", async scenario => {
    const f = fixture();
    if (scenario === "link disabled") f.tables.ai_workspace_account_links.rows[0].enabled = false;
    if (scenario === "account disabled") f.tables.ai_workspace_accounts.rows[0].enabled = false;
    if (scenario === "root revoked") f.source.grant.status = "revoked";
    if (scenario === "target revoked") f.target.grant.status = "revoked";
    if (scenario === "root archived") f.tables.companies.rows[0].status = "archived";
    if (scenario === "owner blocked") f.tables.user.rows[0].approvalStatus = "blocked";
    if (scenario === "source owner lost") f.tables.company_memberships.rows[0].membershipRole = "admin";
    if (scenario === "target owner lost") f.tables.company_memberships.rows[1].membershipRole = "admin";
    if (scenario === "provider changed") f.target.connection.config.ai = { provider: "anthropic", method: "subscription" };
    if (scenario === "root missing") f.tables.connection_grants.rows = [f.target.grant as unknown as Row];
    await expect(resolveAiCredentialOwner(f.db, f.target)).rejects.toThrow("unavailable");
  });
  it("disabling the workspace account also blocks its original native source", async () => {
    const f = fixture(); f.tables.ai_workspace_accounts.rows[0].enabled = false;
    await expect(resolveAiCredentialOwner(f.db, f.source)).rejects.toThrow("unavailable");
  });
  it.each([ids.sourceCompany, ids.targetCompany])("honors current native owner permission denial in %s", async companyId => {
    const f = fixture(); authority.decide.mockImplementation(async input => ({ allowed: input.companyId !== companyId }));
    await expect(resolveAiCredentialOwner(f.db, f.target)).rejects.toThrow("unavailable");
  });
  it("does not use admin ownership to override a personal source owner or credential audience", async () => {
    const personal = fixture(); personal.source.grant.kind = "user"; personal.source.grant.subjectUserId = "another-person";
    await expect(resolveAiCredentialOwner(personal.db, personal.target)).rejects.toThrow("unavailable");
    const restricted = fixture(); restricted.tables.connection_grant_members.rows = [{ id: ids.secret, companyId: ids.sourceCompany,
      grantId: ids.sourceGrant, subjectType: "user", subjectId: "another-person", createdAt: date }];
    await expect(resolveAiCredentialOwner(restricted.db, restricted.target)).rejects.toThrow("unavailable");
  });
  it("permits the actual personal source owner under current native management authority", async () => {
    const f = fixture(); f.source.grant.kind = "user"; f.source.grant.subjectUserId = "owner";
    f.tables.company_memberships.rows[0].membershipRole = "member";
    expect((await resolveAiCredentialOwner(f.db, f.target)).grant.subjectUserId).toBe("owner");
  });
  it("rejects nested aliases and mismatched company/grant identities", async () => {
    const nested = fixture(); nested.tables.ai_workspace_account_links.rows.push({ ...nested.tables.ai_workspace_account_links.rows[0],
      id: ids.secret, companyId: ids.sourceCompany, connectionId: ids.sourceConnection, grantId: ids.sourceGrant });
    await expect(resolveAiCredentialOwner(nested.db, nested.target)).rejects.toThrow("unavailable");
    const mismatch = fixture(); mismatch.target.grant.connectionId = ids.sourceConnection;
    await expect(resolveAiCredentialOwner(mismatch.db, mismatch.target)).rejects.toThrow("unavailable");
  });
  it("rechecks authority in the transaction and takes nonwaiting share locks on all authority records", async () => {
    const f = fixture();
    await resolveAiCredentialOwner(f.db, f.target, { lock: true });
    expect(f.queries.every(query => query.text.includes("for share nowait"))).toBe(true);
    const changed = fixture(); changed.before(text => {
      if (text.includes('from "user"')) changed.tables.user.rows[0].approvalStatus = "blocked";
    });
    await expect(resolveAiCredentialOwner(changed.db, changed.target, { lock: true })).rejects.toThrow("unavailable");
  });
  it("returns a temporary credential-busy error on lock contention instead of reconnecting", async () => {
    const f = fixture(); f.before(() => { throw Object.assign(new Error("wrapped"), { cause: { code: "55P03" } }); });
    await expect(resolveAiCredentialOwner(f.db, f.target, { lock: true })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_busy" } });
  });
  it("pins account/link revisions and canonical secret references without credential bytes", async () => {
    const f = fixture(); const first = aiCredentialOwnerSnapshot(await resolveAiCredentialOwner(f.db, f.target));
    expect(sameAiCredentialOwner(first, structuredClone(first))).toBe(true);
    f.tables.ai_workspace_account_links.rows[0].revision = 3;
    expect(sameAiCredentialOwner(first, aiCredentialOwnerSnapshot(await resolveAiCredentialOwner(f.db, f.target)))).toBe(false);
    f.tables.ai_workspace_account_links.rows[0].revision = 2;
    f.source.grant.credentialSecretRefs[0].secretId = ids.link;
    expect(sameAiCredentialOwner(first, aiCredentialOwnerSnapshot(await resolveAiCredentialOwner(f.db, f.target)))).toBe(false);
    expect(Object.keys(first)).toEqual(["companyId", "connectionId", "grantId", "credential", "binding"]);
  });
});

it("account management inputs reject injected authority and require current revisions", () => {
  const enroll = { id: ids.account, sourceCompanyId: ids.sourceCompany, sourceConnectionId: ids.sourceConnection, sourceGrantId: ids.sourceGrant, autoInstall: true };
  expect(enrollAiWorkspaceAccountSchema.safeParse(enroll).success).toBe(true);
  expect(enrollAiWorkspaceAccountSchema.safeParse({ ...enroll, ownerUserId: "another-person" }).success).toBe(false);
  expect(installAiWorkspaceAccountSchema.safeParse({ expectedRevision: 1, expectedLinkRevision: null }).success).toBe(true);
  expect(installAiWorkspaceAccountSchema.safeParse({ expectedRevision: 0, expectedLinkRevision: null }).success).toBe(false);
  expect(updateAiWorkspaceAccountSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
  expect(updateAiWorkspaceAccountSchema.safeParse({ expectedRevision: 1, sourceGrantId: ids.targetGrant }).success).toBe(false);
});
