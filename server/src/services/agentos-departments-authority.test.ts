import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agents, agentosDepartments, agentosDepartmentProjects, authUsers, companyMemberships,
  companyOperatingProfiles, instanceUserRoles, principalPermissionGrants, projects, type Db } from "@paperclipai/db";
import { departmentService } from "./agentos-departments.js";
import type { AuthorizationActor } from "./authorization.js";

const native = vi.hoisted(() => ({ decide: vi.fn(), read: vi.fn(), audit: vi.fn(), publish: vi.fn() }));
vi.mock("./access.js", () => ({ accessService: () => ({ decide: native.decide }) }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decideReads: native.read }) }));
vi.mock("./activity-log.js", () => ({ persistActivity: native.audit, publishActivity: native.publish }));

type Row = Record<string, unknown>;
function fixture() {
  const companyId = randomUUID(), owner = randomUUID(), head = randomUUID(), ceo = randomUUID(), other = randomUUID(), department = randomUUID(), another = randomUUID(), project = randomUUID();
  const date = "2026-11-08T00:00:00.000Z";
  const tables = [agents, agentosDepartments, agentosDepartmentProjects, authUsers, companyMemberships,
    companyOperatingProfiles, instanceUserRoles, principalPermissionGrants, projects];
  const rows: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableName(table), []]));
  rows.agents = [head, ceo, other].map(id => ({ id, companyId, name: id, role: id === ceo ? "ceo" : "general", status: "idle", lifecycleState: "ready" }));
  rows.user = [{ id: owner, approvalStatus: "approved", createdAt: date, updatedAt: date }];
  rows.agentos_departments = [{ id: department, companyId, name: "Engineering", description: "", leadAgentId: head, revision: 1, createdAt: date },
    { id: another, companyId, name: "Marketing", description: "", leadAgentId: other, revision: 1, createdAt: date }];
  rows.projects = [{ id: project, companyId, name: "Launch" }];
  rows.company_operating_profiles = [{ companyId, fridayAgentId: null, revision: 1, updatedAt: date }];
  const writes: string[] = [];
  let afterWait: (() => void) | undefined;
  const db = drizzle(async (query, params) => {
    if (query.startsWith("select pg_advisory")) { afterWait?.(); afterWait = undefined; return { rows: [] }; }
    const tableName = query.match(/(?:from|update|into) "([^"]+)"/)?.[1];
    const table = tables.find(table => getTableName(table) === tableName);
    if (!table || !tableName) throw new Error(`Unexpected SQL: ${query}`);
    const columns = getTableColumns(table), columnKey = Object.fromEntries(Object.entries(columns).map(([key, column]) => [column.name, key]));
    const where = query.split(" where ")[1]?.split(" returning ")[0] ?? "";
    const equalities = [...where.matchAll(/(?:"([^"]+)"\.)?"([^"]+)" = \$(\d+)/g)];
    let selected = rows[tableName].filter(row => equalities.every(([, source, column, index]) => !source || source === tableName ? row[columnKey[column]] === params[Number(index) - 1] : true));
    if (query.startsWith("insert ")) {
      writes.push(query);
      if (tableName === "agentos_department_projects") {
        const [company, departmentId, projectId] = params;
        rows[tableName] = rows[tableName].filter(row => row.projectId !== projectId);
        rows[tableName].push({ companyId: company, departmentId, projectId });
        return { rows: [] };
      }
      selected = [{ id: randomUUID(), companyId: params[0], name: params[1], description: params[2], leadAgentId: params[3] ?? null, revision: 1, createdAt: date }];
      rows[tableName].push(...selected);
    } else if (query.startsWith("update ")) {
      writes.push(query);
      for (const row of selected) for (const [, column, index] of query.split(" where ")[0].matchAll(/"([^"]+)" = \$(\d+)/g)) row[columnKey[column]] = params[Number(index) - 1];
    } else if (query.startsWith("delete ")) {
      writes.push(query); rows[tableName] = rows[tableName].filter(row => !selected.includes(row));
    }
    let projectedColumns = columns;
    if (query.includes('inner join "agentos_departments"')) {
      selected = selected.flatMap(link => rows.agentos_departments.filter(row => row.companyId === link.companyId && row.id === link.departmentId));
      projectedColumns = getTableColumns(agentosDepartments);
    }
    const projection = query.startsWith("select ") ? query.slice(7, query.indexOf(" from ")) : query.split(" returning ")[1] ?? "";
    const names = [...projection.matchAll(/(?:"[^"]+"\.)?"([^"]+)"/g)].map(match => match[1]);
    const keys = Object.fromEntries(Object.entries(projectedColumns).map(([key, column]) => [column.name, key]));
    return { rows: selected.map(row => names.map(name => row[keys[name]] ?? null)) };
  }) as unknown as Db;
  // Controlled SQL transport runs the real service's ownership decisions and
  // mutations. Persisted companion tests cover real authorization and locks.
  db.transaction = (async (operation: (tx: Db) => Promise<unknown>) => operation(db)) as unknown as Db["transaction"];
  const actor = (id = head): AuthorizationActor => ({ type: "agent", source: "agent_jwt", companyId, agentId: id, onBehalfOfUserId: owner });
  const who = { actorType: "agent" as const, actorId: head, agentId: head, runId: null };
  const service = departmentService(db);
  const edit = (target = department, id = head, leadAgentId?: string | null) => service.save(companyId, actor(id), who,
    { name: "Edited", description: "Team plan", expectedRevision: 1, ...(leadAgentId !== undefined ? { leadAgentId } : {}) }, target);
  return { companyId, owner, head, ceo, other, department, another, project, rows, writes, actor, who, service, edit,
    afterWait: (fn: () => void) => { afterWait = fn; } };
}
beforeEach(() => {
  vi.resetAllMocks(); native.decide.mockResolvedValue({ allowed: true }); native.read.mockResolvedValue([{ allowed: true }]);
  native.audit.mockResolvedValue({ publication: { event: "test" } });
});

describe("department ownership through the service", () => {
  it("allows the appointed head to update its department and preserves the native actor and audit", async () => {
    const f = fixture();
    await expect(f.edit()).resolves.toMatchObject({ name: "Edited", leadAgentId: f.head, revision: 2 });
    expect(native.decide).toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ type: "agent", agentId: f.head }), action: "applications:manage" }));
    expect(native.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorId: f.head, companyId: f.companyId, action: "department.updated" }));
  });
  it("allows the CEO to create a department or replace its head", async () => {
    const f = fixture();
    await expect(f.edit(f.department, f.ceo, f.other)).resolves.toMatchObject({ leadAgentId: f.other });
    await expect(f.service.save(f.companyId, f.actor(f.ceo), f.who, { name: "New", description: "", leadAgentId: f.head })).resolves.toMatchObject({ leadAgentId: f.head });
  });
  it("prevents a head from deleting its last appointment to escape the staffing ceiling", async () => {
    const f = fixture();
    await expect(f.service.remove(f.companyId, f.department, 1, f.actor(), f.who)).rejects.toThrow("CEO or board");
    expect(f.rows.agentos_departments.find(row => row.id === f.department)?.leadAgentId).toBe(f.head);
    expect(f.writes).toEqual([]);
    expect(native.audit).not.toHaveBeenCalled();
  });
  it("keeps department removal with the current authorized CEO", async () => {
    const f = fixture();
    await f.service.remove(f.companyId, f.department, 1, f.actor(f.ceo), f.who);
    expect(f.rows.agentos_departments.some(row => row.id === f.department)).toBe(false);
    expect(native.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "department.deleted" }));
  });
  it.each(["edit other", "delete other", "replace head", "create"])("rejects a head trying to %s without writing or auditing", async kind => {
    const f = fixture();
    const operation = kind === "edit other" ? f.edit(f.another)
      : kind === "delete other" ? f.service.remove(f.companyId, f.another, 1, f.actor(), f.who)
      : kind === "replace head" ? f.edit(f.department, f.head, f.other)
      : f.service.save(f.companyId, f.actor(), f.who, { name: "New", description: "", leadAgentId: f.head });
    await expect(operation).rejects.toMatchObject({ status: 403 });
    expect(f.writes).toEqual([]); expect(native.audit).not.toHaveBeenCalled();
  });
  it.each(["transfer", "take", "remove"])("prevents another department's project %s", async kind => {
    const f = fixture(); f.rows.agentos_department_projects.push({ companyId: f.companyId, departmentId: f.department, projectId: f.project });
    await expect(f.service.assign(f.companyId, f.project, kind === "remove" ? null : f.another,
      f.actor(kind === "transfer" ? f.head : f.other), f.who)).rejects.toMatchObject({ status: 403 });
    expect(f.writes).toEqual([]);
  });
  it("allows a head to add an unassigned project and remove its own project", async () => {
    const f = fixture();
    await f.service.assign(f.companyId, f.project, f.department, f.actor(), f.who);
    expect(f.rows.agentos_department_projects).toEqual([{ companyId: f.companyId, projectId: f.project, departmentId: f.department }]);
    await f.service.assign(f.companyId, f.project, null, f.actor(), f.who);
    expect(f.rows.agentos_department_projects).toEqual([]);
  });
  it.each(["appointment", "friday", "lifecycle", "company"])("rechecks %s authority after the configuration wait", async kind => {
    const f = fixture();
    f.afterWait(() => {
      if (kind === "appointment") f.rows.agentos_departments[0].leadAgentId = f.other;
      if (kind === "friday") f.rows.company_operating_profiles[0].fridayAgentId = f.head;
      if (kind === "lifecycle") f.rows.agents[0].lifecycleState = "terminated";
      if (kind === "company") f.rows.agents[0].companyId = randomUUID();
    });
    await expect(f.edit()).rejects.toMatchObject({ status: 403 }); expect(f.writes).toEqual([]);
  });
  it("does not override a native permission or project privacy denial", async () => {
    const f = fixture(); native.decide.mockResolvedValueOnce({ allowed: false, explanation: "native permission removed" });
    await expect(f.edit()).rejects.toThrow("native permission removed");
    native.read.mockResolvedValueOnce([{ allowed: false }]);
    await expect(f.service.assign(f.companyId, f.project, f.department, f.actor(), f.who)).rejects.toMatchObject({ status: 404 });
    expect(f.writes).toEqual([]);
  });
  it("does not appoint Friday to a delivery department even when its role says CEO", async () => {
    const f = fixture(); f.rows.company_operating_profiles[0].fridayAgentId = f.other;
    await expect(f.edit(f.department, f.ceo, f.other)).rejects.toThrow("Friday"); expect(f.writes).toEqual([]);
  });
});
