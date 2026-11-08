import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { connectionGrants, aiWorkspaceAccounts, aiWorkspaceAccountLinks, type Db } from "@paperclipai/db";
import { describe, expect, it, vi } from "vitest";
import { createConnectionGrants } from "./tool-access/connections/grants.js";
import { createConnectionRemoval } from "./tool-access/connections/removal.js";
import { assertWorkspaceAccountCredentialMutationSettled } from "./ai-workspace-account-guards.js";

const companyId = "64b68e80-f001-431f-a752-8a760153cba8";
const connectionId = "7536c942-4b27-40c5-8f4e-1442a4fcaa87";
const grantId = "d2cce4fe-8451-4dca-9c18-632d64ecfd54";

function fixture() {
  let enrolled = false;
  const writes: string[] = [], queries: string[] = [];
  const grant = { id: grantId, companyId, connectionId, kind: "organization", status: "active", credentialSecretRefs: [] };
  const db = drizzle(async (query) => {
    queries.push(query);
    // Enrollment commits while a generic request waits for the native fence.
    // This is a controlled interleaving, not a PostgreSQL locking claim.
    if (query.includes("pg_advisory_xact_lock")) { enrolled = true; return { rows: [] }; }
    if (query.includes('from "ai_workspace_accounts"')) return { rows: enrolled ? [["registered-account"]] : [] };
    if (query.includes('from "ai_workspace_account_links"')) return { rows: [] };
    if (query.includes('from "chat_endpoints"')) return { rows: [] };
    if (query.includes('from "connection_grants"')) return { rows: [Object.keys(getTableColumns(connectionGrants)).map(key => grant[key as keyof typeof grant] ?? null)] };
    if (/^(insert|update|delete)/.test(query)) { writes.push(query); return { rows: [] }; }
    throw new Error(`Unexpected query: ${query}`);
  }) as unknown as Db;
  db.transaction = ((work: (tx: Db) => Promise<unknown>) => work(db)) as unknown as Db["transaction"];
  const getConnectionRow = vi.fn().mockResolvedValue({ id: connectionId, companyId, connectionPurpose: "ai", config: {} });
  return { db, writes, queries, getConnectionRow };
}

describe("registered AI account lifecycle", () => {
  it.each(["audience", "installation", "revocation"] as const)("rechecks %s after a concurrent enrollment", async operation => {
    const f = fixture();
    const service = createConnectionGrants(f.db, { getConnectionRow: f.getConnectionRow, assertSecretRefs: vi.fn(), vercelConnect: null });
    const result = operation === "audience" ? service.replaceConnectionGrantMembers(connectionId, grantId, [])
      : operation === "installation" ? service.addConnectionInstallation(connectionId, { isDefault: true })
      : service.revokeConnectionGrant(connectionId, grantId);
    await expect(result).rejects.toMatchObject({ details: { code: "workspace_ai_account_managed" } });
    expect(f.writes).toEqual([]);
    expect(f.queries.some(query => query.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("does not archive or partially remove an account enrolled while removal waited", async () => {
    const f = fixture();
    const secrets = { remove: vi.fn() }, runtimeSupervisor = { stopSlot: vi.fn() };
    const service = createConnectionRemoval(f.db, { options: {}, secrets: secrets as never, runtimeSupervisor, vercelConnect: null, getConnectionRow: f.getConnectionRow });
    await expect(service(connectionId, companyId)).rejects.toMatchObject({ details: { code: "workspace_ai_account_managed" } });
    expect(f.writes).toEqual([]);
    expect(secrets.remove).not.toHaveBeenCalled();
    expect(runtimeSupervisor.stopSlot).not.toHaveBeenCalled();
  });

  it("rechecks newly enrolled aliases before replacing a previously company-only credential", async () => {
    let enrolled = false;
    const queries: { text: string; params: unknown[] }[] = [];
    const account = { id: "account", sourceCompanyId: companyId, sourceConnectionId: connectionId, sourceGrantId: grantId };
    const link = { id: "link", accountId: account.id, companyId: "alias-company", connectionId: "alias-connection", grantId: "alias-grant" };
    const db = drizzle(async (text, params) => {
      queries.push({ text, params });
      if (text.includes("pg_advisory_xact_lock")) { enrolled = true; return { rows: [] }; }
      if (text.includes('from "ai_workspace_accounts"')) return { rows: enrolled
        ? [Object.keys(getTableColumns(aiWorkspaceAccounts)).map(key => account[key as keyof typeof account] ?? null)] : [] };
      if (text.includes('from "ai_workspace_account_links"')) return { rows: [Object.keys(getTableColumns(aiWorkspaceAccountLinks)).map(key => link[key as keyof typeof link] ?? null)] };
      if (text.includes('from "environment_leases"')) return { rows: params.includes(link.companyId) && params.includes(link.grantId) ? [["unsaved-alias-refresh"]] : [] };
      throw new Error(`Unexpected reconnect guard query: ${text}`);
    }) as unknown as Db;
    await expect(assertWorkspaceAccountCredentialMutationSettled(db, companyId, connectionId)).rejects.toThrow("credential cleanup");
    expect(queries[0].text).toContain("pg_advisory_xact_lock");
    expect(queries[1].text).toContain('from "ai_workspace_accounts"');
    expect(queries.at(-1)?.params).toEqual(expect.arrayContaining([companyId, grantId, link.companyId, link.grantId]));
  });
});
