import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, authUsers, companies, companyMemberships, costEvents, instanceUserRoles, principalPermissionGrants, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationActor } from "./authorization.js";
import { preflightImportedAgentPermissionGrants, mutateImportedAgentWithGrants } from "./company-import-permission-grants.js";
import * as lifecycleOwner from "../modules/agent-lifecycle/index.js";
import type { LifecycleEffects } from "../modules/agent-lifecycle/index.js";
import { withAccountingTransaction } from "./accounting-transaction.js";

const activity = vi.hoisted(() => ({ persist: vi.fn(), publish: vi.fn(), schedule: vi.fn(), effects: {} as LifecycleEffects }));
vi.mock("./activity-log.js", () => ({ persistActivity: activity.persist, publishActivity: activity.publish }));
vi.mock("./agent-lifecycle.js", () => ({
  createAgentLifecycle: (db: Db) => lifecycleOwner.createAgentLifecycle(db, activity.effects),
  createAgentImportLifecycle: (db: Db, input: Parameters<typeof lifecycleOwner.createAgentImportLifecycle>[2]) =>
    lifecycleOwner.createAgentImportLifecycle(db, activity.effects, input),
}));

type Row = Record<string, unknown>;
function fixture() {
  const companyId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
  const tables = [agents, authUsers, companies, companyMemberships, costEvents, instanceUserRoles, principalPermissionGrants];
  const rows: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableName(table), []]));
  rows.companies.push({ id: companyId });
  rows.agents.push({ id: agentId, companyId, name: "Existing CEO", role: "ceo", status: "idle", lifecycleState: "ready", lifecycleVersion: 1,
    lifecycleHolds: [], permissions: { canCreateAgents: true } });
  rows.user.push({ id: userId, approvalStatus: "approved" });
  rows.company_memberships.push(
    { id: randomUUID(), companyId, principalType: "user", principalId: userId, membershipRole: "operator", status: "active" },
    { id: randomUUID(), companyId, principalType: "agent", principalId: agentId, membershipRole: "member", status: "active" },
  );
  const addGrant = (principalId: string, permissionKey: string, scope: Row | null = null) => rows.principal_permission_grants.push({
    id: randomUUID(), companyId, principalType: principalId === userId ? "user" : "agent", principalId, permissionKey, scope,
  });
  addGrant(userId, "users:manage_permissions"); addGrant(userId, "applications:manage");
  addGrant(agentId, "agents:configure", { agentIds: [agentId] }); addGrant(agentId, "tasks:assign", { projectIds: [randomUUID()] });
  let depth = 0, afterCompanyLock: (() => void) | undefined;
  const queries: { text: string; depth: number; params: unknown[] }[] = [];
  const db = drizzle(async (text, params) => {
    queries.push({ text, depth, params });
    const tableName = text.match(/(?:from|update|into) "([^"]+)"/)?.[1];
    const table = tables.find(table => getTableName(table) === tableName);
    if (!tableName || !table) throw new Error(`Unexpected grant query: ${text}`);
    if (tableName === "companies" && text.includes("for no key update")) { afterCompanyLock?.(); afterCompanyLock = undefined; }
    const columns = getTableColumns(table), keys = Object.fromEntries(Object.entries(columns).map(([key, column]) => [column.name, key]));
    const where = text.split(" where ")[1]?.split(" returning ")[0] ?? "";
    const eqs = [...where.matchAll(/(?:"[^"]+"\.)?"([^"]+)" = \$(\d+)/g)];
    const ins = [...where.matchAll(/(?:"[^"]+"\.)?"([^"]+)" in \(([^)]+)\)/g)];
    let selected = rows[tableName].filter(row => eqs.every(([, column, index]) => row[keys[column]] === params[Number(index) - 1])
      && ins.every(([, column, list]) => [...list.matchAll(/\$(\d+)/g)].some(([, index]) => row[keys[column]] === params[Number(index) - 1])));
    if (text.startsWith("insert ")) {
      const match = text.match(/\(([^)]+)\) values \(([^)]+)\)/)!;
      const names = [...match[1].matchAll(/"([^"]+)"/g)].map(([, name]) => name);
      const values = match[2].split(", ");
      const row: Row = { id: randomUUID() };
      names.forEach((name, index) => { const value = values[index].match(/^\$(\d+)/); if (value) row[keys[name]] = params[Number(value[1]) - 1]; });
      rows[tableName].push(row); selected = [row];
    } else if (text.startsWith("delete ")) rows[tableName] = rows[tableName].filter(row => !selected.includes(row));
    else if (text.startsWith("update ")) for (const row of selected) for (const [, name, index] of text.split(" where ")[0].matchAll(/"([^"]+)" = \$(\d+)/g)) row[keys[name]] = params[Number(index) - 1];
    const projection = text.startsWith("select ") ? text.slice(7, text.indexOf(" from ")) : text.split(" returning ")[1] ?? "";
    const names = [...projection.matchAll(/(?:"[^"]+"\.)?"([^"]+)"/g)].map(([, name]) => name);
    return { rows: selected.map(row => names.map(name => row[keys[name]] ?? null)) };
  }) as unknown as Db;
  // Real native authorization and single-key SQL writer; controlled transport
  // verifies boundaries/rollback, not PostgreSQL contention semantics.
  db.transaction = (async (work: (tx: Db) => Promise<unknown>) => {
    const before = structuredClone(rows); depth++;
    const tx = Object.assign(Object.create(db), { nestedIndex: depth }) as Db;
    try { return await work(tx); } catch (error) { Object.assign(rows, before); throw error; } finally { depth--; }
  }) as unknown as Db["transaction"];
  const effects: Partial<LifecycleEffects> = {
    transaction: withAccountingTransaction,
    prepareHire: async (_tx, _companyId, data) => data,
    initializeHire: async () => {}, recordCreation: async () => {}, notifyWork: async () => {},
    prepareConfiguration: async (_tx, _existing, patch) => patch,
    completeConfiguration: async () => {}, recordStatus: async () => {}, reportFailure: () => {},
  };
  activity.effects = effects as LifecycleEffects;
  lifecycleOwner.startAgentLifecycle(db, activity.effects, {} as never, () => true).setWake(activity.schedule);
  const actor: AuthorizationActor = { type: "board", source: "session", userId, companyIds: [companyId] };
  const input = { companyId, actor, grants: [{ permissionKey: "applications:manage" as const, scope: null }] };
  const create = vi.fn(async (lifecycle: ReturnType<typeof lifecycleOwner.createAgentImportLifecycle>) =>
    lifecycle.requestHire(companyId, { name: "Imported CEO", role: "ceo", adapterType: "process", status: "idle" }));
  const preflight = () => preflightImportedAgentPermissionGrants(db, input);
  const mutate = () => mutateImportedAgentWithGrants(db, input, create);
  return { db, rows, queries, companyId, agentId, userId, actor, input, create, preflight, mutate, addGrant, depth: () => depth,
    afterCompanyLock: (callback: () => void) => { afterCompanyLock = callback; } };

}

beforeEach(() => { vi.resetAllMocks(); activity.persist.mockResolvedValue({ publication: { event: "updated" } }); });

describe("explicit grant import authority", () => {
  it("preflights native authority before writes and atomically creates the employee and scoped explicit grants", async () => {
    const f = fixture();
    await f.preflight();
    expect(f.queries.every(query => query.text.startsWith("select "))).toBe(true);
    activity.schedule.mockImplementation(() => expect(f.depth()).toBe(0));
    const result = await f.mutate();
    expect(result?.id).toBeTruthy();
    expect(f.rows.principal_permission_grants.at(-1)).toMatchObject({ principalId: result!.id, permissionKey: "applications:manage", scope: null });
    expect(f.queries.filter(query => /^(insert|update|delete) /.test(query.text)).every(query => query.depth > 0)).toBe(true);
    expect(activity.persist).toHaveBeenCalledWith(expect.objectContaining({ nestedIndex: 1 }), expect.objectContaining({ details: { source: "company_import", permissionKeys: ["applications:manage"] } }));
    expect(activity.schedule).toHaveBeenCalledTimes(1);
  });
  it.each(["users:manage_permissions", "applications:manage"])("rejects a board member lacking %s before importing an employee", async key => {
    const f = fixture(); f.rows.principal_permission_grants = f.rows.principal_permission_grants.filter(row => row.principalId !== f.userId || row.permissionKey !== key);
    await expect(f.preflight()).rejects.toMatchObject({ status: 403 });
    await expect(f.mutate()).rejects.toMatchObject({ status: 403 });
    expect(f.queries.some(query => /^(insert|update|delete) /.test(query.text))).toBe(false);
  });
  it("does not expand a scoped board grant to company-wide application management", async () => {
    const f = fixture();
    f.rows.principal_permission_grants.find(row => row.principalId === f.userId && row.permissionKey === "applications:manage")!.scope = { agentIds: [f.agentId] };
    await expect(f.preflight()).rejects.toMatchObject({ status: 403 });
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each(["membership", "grant", "approval", "stale admin"])("rechecks %s lost after preparation before creating the employee", async kind => {
    const f = fixture(); await f.preflight();
    f.afterCompanyLock(() => {
      if (kind === "membership") f.rows.company_memberships[0].status = "suspended";
      if (kind === "approval") f.rows.user[0].approvalStatus = "pending";
      if (kind === "grant" || kind === "stale admin") f.rows.principal_permission_grants = f.rows.principal_permission_grants.filter(row => row.principalId !== f.userId);
    });
    f.actor.isInstanceAdmin = kind === "stale admin";
    await expect(f.mutate()).rejects.toMatchObject({ status: 403 });
    expect(f.queries.some(query => /^(insert|update|delete) /.test(query.text))).toBe(false);
    expect(activity.schedule).not.toHaveBeenCalled();
  });
  it("rolls back a new employee and grants together when audit fails", async () => {
    const f = fixture(), before = structuredClone(f.rows);
    activity.persist.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(f.mutate()).rejects.toThrow("audit unavailable");
    expect(f.rows).toEqual(before); expect(activity.schedule).not.toHaveBeenCalled();
  });
  it("preserves an existing suspended membership role while adding the explicitly authorized key", async () => {
    const f = fixture(); Object.assign(f.rows.company_memberships[1], { status: "suspended", membershipRole: "admin" });
    const expected = structuredClone(f.rows.company_memberships[1]);
    await mutateImportedAgentWithGrants(f.db, f.input, lifecycle => lifecycle.updateConfiguration(f.agentId, { name: "Updated CEO" }));
    expect(f.rows.company_memberships[1]).toEqual(expected);
  });
  it("keeps an import pause and configuration with grants in one native transaction and publication queue", async () => {
    const f = fixture();
    activity.effects.completeConfiguration = async (_tx, _before, _after, _patch, _options, publications) => {
      publications.push({ event: "configured" } as never);
    };
    activity.publish.mockImplementation(() => expect(f.depth()).toBe(0));
    activity.schedule.mockImplementation(() => expect(f.depth()).toBe(0));
    const result = await mutateImportedAgentWithGrants(f.db, f.input, lifecycle =>
      lifecycle.updateAndTransition(f.agentId, "pause", { name: "Imported paused CEO" }));
    expect(result).toMatchObject({ id: f.agentId, name: "Imported paused CEO", pauseReason: "import", lifecycleHolds: ["import"] });
    expect(activity.persist).toHaveBeenCalledTimes(1);
    expect(activity.publish).toHaveBeenCalledTimes(2);
    expect(activity.schedule).toHaveBeenCalledTimes(1);
    expect(f.queries.filter(query => /^(insert|update|delete) /.test(query.text)).every(query => query.depth === 1 || query.text.includes("principal_permission_grants"))).toBe(true);
  });
  it("rolls back the nested native pause/configuration and publishes no premature work when a grant audit fails", async () => {
    const f = fixture(), before = structuredClone(f.rows);
    activity.effects.completeConfiguration = async (_tx, _before, _after, _patch, _options, publications) => {
      publications.push({ event: "configured" } as never);
    };
    activity.persist.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(mutateImportedAgentWithGrants(f.db, f.input, lifecycle =>
      lifecycle.updateAndTransition(f.agentId, "pause", { name: "Should roll back" }))).rejects.toThrow("audit unavailable");
    expect(f.rows).toEqual(before);
    expect(activity.publish).not.toHaveBeenCalled();
    expect(activity.schedule).not.toHaveBeenCalled();
  });
  it("retains the native root transaction guard and rejects a different company's employee", async () => {
    const f = fixture();
    await expect(f.db.transaction(async tx => mutateImportedAgentWithGrants(tx as unknown as Db, f.input, f.create)))
      .rejects.toThrow("root database");
    await expect(mutateImportedAgentWithGrants(f.db, f.input, lifecycle =>
      lifecycle.requestHire(randomUUID(), { name: "Foreign employee" }))).rejects.toThrow("authorized company");
    expect(f.queries.some(query => /^(insert|update|delete) /.test(query.text))).toBe(false);
  });
  it("requires current instance administration to preflight explicit grants for a new company", async () => {
    const f = fixture(), input = { ...f.input, companyId: randomUUID() };
    await expect(preflightImportedAgentPermissionGrants(f.db, input)).rejects.toMatchObject({ status: 403 });
    f.rows.instance_user_roles.push({ id: randomUUID(), userId: f.userId, role: "instance_admin" });
    await preflightImportedAgentPermissionGrants(f.db, input);
    expect(f.queries.every(query => query.text.startsWith("select "))).toBe(true);
  });
  it("keeps existing grant keys under native permission-management authority without requiring application authority", async () => {
    const f = fixture(); f.rows.principal_permission_grants = f.rows.principal_permission_grants.filter(row => row.principalId !== f.userId || row.permissionKey !== "applications:manage");
    await preflightImportedAgentPermissionGrants(f.db, { ...f.input, grants: [{ permissionKey: "skills:create", scope: null }] });
    expect(f.queries.every(query => query.text.startsWith("select "))).toBe(true);
  });
  it.each([undefined, { type: "agent" as const, agentId: "ceo", companyId: "company" }])("never reconstructs board authority from an audit user or CEO title", async actor => {
    const f = fixture();
    await expect(preflightImportedAgentPermissionGrants(f.db, { ...f.input, actor })).rejects.toMatchObject({ status: 403 });
    expect(f.queries).toEqual([]);
  });
  it("leaves imports without explicit grants on their existing native path", async () => {
    const f = fixture();
    await preflightImportedAgentPermissionGrants(f.db, { companyId: f.companyId, grants: [] });
    const mutate = vi.fn(async () => ({ id: "new" }));
    expect(await mutateImportedAgentWithGrants(f.db, { companyId: f.companyId, grants: [] }, mutate)).toEqual({ id: "new" });
    expect(mutate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestHire: expect.any(Function) })); expect(f.queries).toEqual([]);
  });
});
