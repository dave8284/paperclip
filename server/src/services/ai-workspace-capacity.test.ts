import { randomUUID } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { aiExecutionCapacityBindings as bindings, aiExecutionCapacityGroups as groups,
  aiWorkspaceAccounts, aiWorkspaceAccountLinks, toolConnections, connectionGrants, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiExecutionCapacityService, ensureAiWorkspaceAccountCapacity } from "./ai-execution-capacity.js";

vi.mock("./delivery-work-notifications.js", async original => ({
  ...await original<typeof import("./delivery-work-notifications.js")>(), notifyDeliveryWork: vi.fn(async () => undefined),
}));
beforeEach(() => vi.clearAllMocks());

function fixture() {
  const now = new Date().toISOString(), groupId = randomUUID();
  const source = { companyId: randomUUID(), connectionId: randomUUID(), grantId: randomUUID() };
  const target = { companyId: randomUUID(), connectionId: randomUUID(), grantId: randomUUID() };
  const policy = { name: "Owner seat", provider: "openai" as const, maxConcurrent: 2, interactiveReserved: 0, interactivePriority: true, waitWarningMs: 60_000 };
  let group = { id: groupId, ...policy, revision: 1, createdByUserId: "owner", createdAt: now, updatedAt: now };
  let current: { id: string; companyId: string; connectionId: string; grantId: string; groupId: string }[] = [source, target].map(binding => ({ id: randomUUID(), ...binding, groupId }));
  const account = { id: randomUUID(), ownerUserId: "owner", sourceCompanyId: source.companyId, sourceConnectionId: source.connectionId,
    sourceGrantId: source.grantId, revision: 2, enabled: false, autoInstall: true, createdAt: now, updatedAt: now };
  const link = { id: randomUUID(), accountId: account.id, ...target, enabled: true, revision: 1, createdAt: now, updatedAt: now };
  const queries: { text: string; params: unknown[] }[] = [];
  const values = (table: Parameters<typeof getTableColumns>[0], row: object) => Object.keys(getTableColumns(table)).map(key => (row as Record<string, unknown>)[key] ?? null);
  const db = drizzle(async (text, params) => {
    queries.push({ text, params });
    if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (text.includes('from "environment_leases"') || text.includes('from "heartbeat_runs"') || text.includes('from "ai_execution_capacity_claims"')) return { rows: [] };
    if (text.includes('from "ai_workspace_accounts"')) return { rows: text.includes('"enabled" =') ? [] : [values(aiWorkspaceAccounts, account)] };
    if (text.includes('from "ai_workspace_account_links"')) return { rows: [values(aiWorkspaceAccountLinks, link)] };
    if (text.includes('from "ai_execution_capacity_groups"')) return { rows: [values(groups, group)] };
    if (text.includes('from "ai_execution_capacity_bindings"')) return { rows: current.filter(row => params.includes(row.grantId) || params.includes(row.groupId)).map(row => values(bindings, row)) };
    if (text.includes('from "connection_grants"')) {
      const selected = params.includes(target.grantId) ? target : source;
      const grant = values(connectionGrants, { id: selected.grantId, companyId: selected.companyId, connectionId: selected.connectionId,
        status: "active", kind: "organization", credentialSecretRefs: [], createdAt: now, updatedAt: now });
      const connection = values(toolConnections, { id: selected.connectionId, companyId: selected.companyId, name: "Owner seat",
        enabled: true, status: "active", connectionPurpose: "ai", config: { ai: { provider: "openai", method: "subscription" } }, createdAt: now, updatedAt: now });
      return { rows: [text.startsWith('select "tool_connections"') ? [...connection, ...grant] : [...grant, ...connection]] };
    }
    if (text.startsWith('update "ai_execution_capacity_groups"')) {
      group = { ...group, revision: group.revision + 1 }; return { rows: text.includes("returning") ? [values(groups, group)] : [] };
    }
    if (text.startsWith('delete from "ai_execution_capacity_bindings"')) { current = current.filter(row => !params.includes(row.groupId)); return { rows: [] }; }
    if (text.startsWith('insert into "ai_execution_capacity_bindings"')) {
      // Four native binding values per tuple; generated IDs are defaults.
      for (let index = 0; index < params.length; index += 4) {
        const [savedGroup, companyId, connectionId, grantId] = params.slice(index, index + 4) as string[];
        current.push({ id: randomUUID(), groupId: savedGroup, companyId, connectionId, grantId });
      }
      return { rows: [] };
    }
    if (text.startsWith('insert into "agentos_admin_events"')) return { rows: [] };
    throw new Error(`Unexpected capacity query: ${text}`);
  }) as unknown as Db;
  // Controlled persistence verifies service decisions and SQL contracts. It
  // does not claim PostgreSQL concurrency or lock behavior.
  db.transaction = (async (work: (tx: Db) => Promise<unknown>) => {
    const previous = structuredClone({ group, current });
    try { return await work(db); } catch (error) { group = previous.group; current = previous.current; throw error; }
  }) as unknown as Db["transaction"];
  return { db, queries, source, target, groupId, policy, account,
    scope: { userId: "owner", local: true, companyIds: [source.companyId, target.companyId] },
    bindings: () => current, setBindings: (next: typeof current) => { current = next; } };
}

describe("one capacity group per connected account", () => {
  it.each(["source", "target"] as const)("a disabled account cannot drop its %s company from the shared limit", async keep => {
    const f = fixture(), before = structuredClone(f.bindings());
    await expect(aiExecutionCapacityService(f.db).save({ id: f.groupId, expectedRevision: 1,
      policy: f.policy, bindings: [f[keep]] }, f.scope)).rejects.toThrow("same capacity group");
    expect(f.bindings()).toEqual(before);
    expect(f.queries.some(query => query.text.includes('from "ai_workspace_accounts"'))).toBe(true);
  });

  it("allows policy changes that retain every company even while the account is disabled", async () => {
    const f = fixture();
    await expect(aiExecutionCapacityService(f.db).save({ id: f.groupId, expectedRevision: 1,
      policy: { ...f.policy, maxConcurrent: 3 }, bindings: [f.source, f.target] }, f.scope)).resolves.toEqual({ id: f.groupId, revision: 2 });
    expect(f.bindings().map(row => row.groupId)).toEqual([f.groupId, f.groupId]);
  });

  it("adds another company to the existing seat limit without multiplying capacity", async () => {
    const f = fixture(); f.setBindings(f.bindings().filter(row => row.grantId === f.source.grantId));
    await expect(f.db.transaction(tx => ensureAiWorkspaceAccountCapacity(tx as unknown as Db,
      { ownerUserId: "owner", source: f.source, target: f.target }))).resolves.toBe(f.groupId);
    expect(f.bindings()).toEqual(expect.arrayContaining([
      expect.objectContaining({ ...f.source, groupId: f.groupId }), expect.objectContaining({ ...f.target, groupId: f.groupId }),
    ]));
    expect(f.queries.some(query => query.text.startsWith('insert into "ai_execution_capacity_groups"'))).toBe(false);
    expect(f.queries.filter(query => query.text.startsWith('update "ai_execution_capacity_groups"')).every(query => !query.text.includes('"max_concurrent" ='))).toBe(true);
  });

  it("refuses to silently combine already divergent company capacity groups", async () => {
    const f = fixture(); f.setBindings(f.bindings().map(row => row.grantId === f.target.grantId ? { ...row, groupId: randomUUID() } : row));
    await expect(ensureAiWorkspaceAccountCapacity(f.db, { ownerUserId: "owner", source: f.source, target: f.target })).rejects.toThrow("different capacity bindings");
    expect(f.queries.some(query => /^(insert|update|delete) /i.test(query.text))).toBe(false);
  });
});
