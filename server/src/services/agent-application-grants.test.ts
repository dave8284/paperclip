import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, authUsers, companyMemberships, instanceUserRoles, principalPermissionGrants, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationActor } from "./authorization.js";
import { setAgentApplicationManagementGrant } from "./agent-application-grants.js";

const activity = vi.hoisted(() => ({ persist: vi.fn(), publish: vi.fn() }));
vi.mock("./activity-log.js", () => ({ persistActivity: activity.persist, publishActivity: activity.publish }));

type Row = Record<string, unknown>;
function fixture() {
  const companyId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
  const tables = [agents, authUsers, companyMemberships, instanceUserRoles, principalPermissionGrants];
  const rows: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableName(table), []]));
  rows.agents.push({ id: agentId, companyId, role: "ceo", status: "idle", permissions: { canCreateAgents: true } });
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
  let depth = 0, afterTargetLock: (() => void) | undefined;
  const queries: { text: string; depth: number; params: unknown[] }[] = [];
  const db = drizzle(async (text, params) => {
    queries.push({ text, depth, params });
    const tableName = text.match(/(?:from|update|into) "([^"]+)"/)?.[1];
    const table = tables.find(table => getTableName(table) === tableName);
    if (!tableName || !table) throw new Error(`Unexpected grant query: ${text}`);
    if (tableName === "agents" && text.includes("for update")) { afterTargetLock?.(); afterTargetLock = undefined; }
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
    try { return await work(db); } catch (error) { Object.assign(rows, before); throw error; } finally { depth--; }
  }) as unknown as Db["transaction"];
  const actor: AuthorizationActor = { type: "board", source: "session", userId, companyIds: [companyId] };
  const change = (enabled = true, override: Partial<AuthorizationActor> = {}) => setAgentApplicationManagementGrant(db, { companyId, agentId, actor: { ...actor, ...override }, enabled });
  return { db, rows, queries, companyId, agentId, userId, actor, change, addGrant, depth: () => depth,
    afterTargetLock: (callback: () => void) => { afterTargetLock = callback; } };
}

beforeEach(() => { vi.resetAllMocks(); activity.persist.mockResolvedValue({ publication: { event: "updated" } }); });

describe("explicit employee application management grants", () => {
  it("grants exactly one native key with atomic audit and preserves employee configuration, scopes and membership", async () => {
    const f = fixture(), existing = structuredClone(f.rows);
    activity.persist.mockImplementation(async () => { expect(f.depth()).toBe(1); return { publication: { event: "updated" } }; });
    activity.publish.mockImplementation(() => expect(f.depth()).toBe(0));
    await f.change();
    expect(f.rows.agents).toEqual(existing.agents);
    expect(f.rows.company_memberships).toEqual(existing.company_memberships);
    expect(f.rows.principal_permission_grants.slice(0, -1)).toEqual(existing.principal_permission_grants);
    expect(f.rows.principal_permission_grants.at(-1)).toMatchObject({ companyId: f.companyId, principalType: "agent", principalId: f.agentId, permissionKey: "applications:manage", scope: null, grantedByUserId: f.userId });
    expect(f.queries.filter(query => /^(insert|update|delete) /.test(query.text))).toHaveLength(1);
    expect(f.queries.every(query => query.depth > 0)).toBe(true);
    expect(activity.persist).toHaveBeenCalledWith(f.db, expect.objectContaining({ actorId: f.userId, action: "agent.permissions_updated", details: { permissionKey: "applications:manage", enabled: true, scope: null } }));
    expect(activity.publish).toHaveBeenCalledTimes(1);
  });
  it("revokes only that key without requiring the granting capability", async () => {
    const f = fixture(); f.addGrant(f.agentId, "applications:manage");
    f.rows.principal_permission_grants = f.rows.principal_permission_grants.filter(row => !(row.principalId === f.userId && row.permissionKey === "applications:manage"));
    const remaining = structuredClone(f.rows.principal_permission_grants.filter(row => row.principalId !== f.agentId || row.permissionKey !== "applications:manage"));
    await f.change(false);
    expect(f.rows.principal_permission_grants).toEqual(remaining);
  });
  it.each(["users:manage_permissions", "applications:manage"])("requires current board %s authority", async permission => {
    const f = fixture(); f.rows.principal_permission_grants = f.rows.principal_permission_grants.filter(row => row.principalId !== f.userId || row.permissionKey !== permission);
    await expect(f.change()).rejects.toMatchObject({ status: 403 });
    expect(activity.persist).not.toHaveBeenCalled(); expect(activity.publish).not.toHaveBeenCalled();
  });
  it("cannot expand a scoped board application grant to company-wide authority", async () => {
    const f = fixture(); f.rows.principal_permission_grants.find(row => row.principalId === f.userId && row.permissionKey === "applications:manage")!.scope = { agentIds: [f.agentId] };
    await expect(f.change()).rejects.toMatchObject({ status: 403 });
  });
  it.each(["ceo", "general"])("rejects %s agent self-grant before touching storage", async role => {
    const f = fixture(); f.rows.agents[0].role = role;
    await expect(f.change(true, { type: "agent", agentId: f.agentId, companyId: f.companyId })).rejects.toMatchObject({ status: 403 });
    expect(f.queries).toEqual([]);
  });
  it.each(["suspended", "archived"])("does not reactivate a %s target membership", async status => {
    const f = fixture(); f.rows.company_memberships[1].status = status; f.rows.company_memberships[1].membershipRole = "admin";
    const member = structuredClone(f.rows.company_memberships[1]); await f.change();
    expect(f.rows.company_memberships[1]).toEqual(member);
  });
  it.each(["membership", "grant", "approval", "admin"])("rechecks current board %s after the target lock", async revoked => {
    const f = fixture();
    f.afterTargetLock(() => {
      if (revoked === "membership") f.rows.company_memberships[0].status = "suspended";
      if (revoked === "approval") f.rows.user[0].approvalStatus = "pending";
      if (revoked === "grant" || revoked === "admin") f.rows.principal_permission_grants = f.rows.principal_permission_grants.filter(row => row.principalId !== f.userId);
    });
    await expect(f.change(true, { isInstanceAdmin: revoked === "admin", memberships: [{ companyId: f.companyId, membershipRole: "owner", status: "active" }] })).rejects.toMatchObject({ status: 403 });
    expect(activity.persist).not.toHaveBeenCalled();
  });
  it("rolls back the grant when its audit cannot be persisted", async () => {
    const f = fixture(), before = structuredClone(f.rows); activity.persist.mockRejectedValue(new Error("audit failed"));
    await expect(f.change()).rejects.toThrow("audit failed");
    expect(f.rows).toEqual(before); expect(activity.publish).not.toHaveBeenCalled();
  });
  it("returns a retryable conflict for busy authority without a grant or audit", async () => {
    const f = fixture(); f.afterTargetLock(() => { throw Object.assign(new Error("busy"), { code: "55P03" }); });
    await expect(f.change()).rejects.toMatchObject({ status: 409, details: { retryable: true } });
    expect(activity.persist).not.toHaveBeenCalled(); expect(activity.publish).not.toHaveBeenCalled();
  });
  it.each(["pending_approval", "terminated"])("does not activate permission for a %s employee", async status => {
    const f = fixture(); f.rows.agents[0].status = status;
    await expect(f.change()).rejects.toMatchObject({ status: 409 });
  });
  it("keeps another company's target unavailable", async () => {
    const f = fixture(); f.rows.agents[0].companyId = randomUUID();
    await expect(f.change()).rejects.toMatchObject({ status: 404 });
    expect(activity.persist).not.toHaveBeenCalled();
  });
});
