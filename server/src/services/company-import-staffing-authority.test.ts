import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, companies, agentosDepartments, companyOperatingProfiles, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAgentImportStaffing } from "./company-import-staffing-authority.js";
import { resolveAgentHiringAuthority, resolveDepartmentConfigurationAuthority } from "./agent-hiring-authority.js";

const native = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("./access.js", () => ({ accessService: () => ({ decide: native.decide }) }));
type Row = Record<string, unknown>;
function fixture() {
  const tables = [agents, companies, agentosDepartments, companyOperatingProfiles];
  const rows: Record<string, Row[]> = {
    agents: [
      { id: "head", companyId: "company", name: "Head", role: "manager", reportsTo: "ceo", lifecycleState: "ready", status: "idle" },
      { id: "ceo", companyId: "company", name: "CEO", role: "ceo", reportsTo: null, lifecycleState: "ready", status: "idle" },
      { id: "own", companyId: "company", name: "Own", role: "engineer", reportsTo: "head", lifecycleState: "ready", status: "idle" },
      { id: "other", companyId: "company", name: "Other", role: "manager", reportsTo: "ceo", lifecycleState: "ready", status: "idle" },
      { id: "foreign", companyId: "foreign", name: "Foreign", role: "engineer", reportsTo: "head", lifecycleState: "ready", status: "idle" },
    ],
    companies: [{ id: "company", requireBoardApprovalForNewAgents: false }],
    agentos_departments: [{ id: "department", companyId: "company", leadAgentId: "head" }],
    company_operating_profiles: [{ companyId: "company", fridayAgentId: null }],
  };
  const db = drizzle(async (query, params) => {
    const name = query.match(/from "([^"]+)"/)?.[1], table = tables.find(item => getTableName(item) === name);
    if (!name || !table || !query.startsWith("select ")) throw new Error(`Unexpected SQL: ${query}`);
    const keys = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]));
    const selected = rows[name].filter(row => {
      if (name === "agents") return params.includes(row.id) && params.includes(row.companyId);
      if (name === "agentos_departments") return params.includes(row.companyId) && params.includes(row.leadAgentId);
      if (name === "companies") return params.includes(row.id);
      return params.includes(row.companyId);
    });
    const fields = [...query.slice(7, query.indexOf(" from ")).matchAll(/(?:"[^"]+"\.)?"([^"]+)"/g)].map(match => keys[match[1]]);
    return { rows: selected.map(row => fields.map(key => row[key] ?? null)) };
  }) as unknown as Db;
  const actor = (id = "head") => ({ type: "agent" as const, source: "agent_jwt" as const, companyId: "company", agentId: id });
  const item = (slug: string, manager: string | null = "head") => ({ slug, role: "engineer" as const,
    reportsToSlug: null as string | null, reportsToExistingAgentId: manager, reportsToExistingAgentSlug: null as string | null, permissionGrants: [] });
  const plan = (slug: string) => ({ slug, plannedName: slug, action: "create" as const, existingAgentId: null, reason: "new" });
  const prepare = (items: ReturnType<typeof item>[], id = "head", plans = items.map(item => plan(item.slug))) =>
    prepareAgentImportStaffing(db, { actor: actor(id), companyId: "company", agents: items, plans, existing: rows.agents as never });
  return { db, rows, actor, item, plan, prepare };
}
beforeEach(() => { native.decide.mockReset(); native.decide.mockResolvedValue({ allowed: true }); });

describe("agent catalog import staffing authority", () => {
  it("orders nested staff before creation and retains explicit own-team manager IDs", async () => {
    const f = fixture(), root = f.item("lead"), child = { ...f.item("specialist", null), reportsToSlug: "lead" };
    const result = await f.prepare([child, root]);
    expect(result.plans.map(plan => plan.slug)).toEqual(["lead", "specialist"]);
    expect(result.managerId("lead", new Map())).toBe("head");
    expect(() => result.managerId("specialist", new Map())).toThrow("not ready");
    expect(result.managerId("specialist", new Map([["lead", "created-lead"]]))).toBe("created-lead");
    expect(result.departmentHead).toBe(true);
  });
  it.each(["ceo", "unanchored", "other team", "foreign", "cycle", "unknown parent", "nested department"])("rejects a head package with %s before creating employees", async kind => {
    const f = fixture();
    const item = f.item("worker");
    if (kind === "ceo") Object.assign(item, { role: "ceo" });
    if (kind === "unanchored") item.reportsToExistingAgentId = null;
    if (kind === "other team") item.reportsToExistingAgentId = "other";
    if (kind === "foreign") item.reportsToExistingAgentId = "foreign";
    if (kind === "cycle" || kind === "unknown parent") Object.assign(item, { reportsToExistingAgentId: null, reportsToSlug: kind === "cycle" ? "worker" : "missing" });
    if (kind === "nested department") { item.reportsToExistingAgentId = "own"; f.rows.agentos_departments.push({ id: "nested", companyId: "company", leadAgentId: "own" }); }
    await expect(f.prepare([item])).rejects.toMatchObject({ status: kind === "cycle" || kind === "unknown parent" ? 422 : 403 });
  });
  it("keeps a CEO's direct specialist package valid without department scaffolding", async () => {
    const f = fixture();
    const result = await f.prepare([f.item("worker", "ceo")], "ceo");
    expect(result.departmentHead).toBe(false);
    expect(result.managerId("worker", new Map())).toBe("ceo");
  });
  it.each(["native denial", "friday", "approval", "explicit grants"])("does not let %s disappear behind the catalog importer", async kind => {
    const f = fixture(), item = f.item("worker");
    if (kind === "native denial") native.decide.mockResolvedValue({ allowed: false, explanation: "Responsible user lost access" });
    if (kind === "friday") f.rows.company_operating_profiles[0].fridayAgentId = "head";
    if (kind === "approval") f.rows.companies[0].requireBoardApprovalForNewAgents = true;
    if (kind === "explicit grants") Object.assign(item, { permissionGrants: [{ permissionKey: "users:manage_permissions", scope: null }] });
    await expect(f.prepare([item])).rejects.toMatchObject({ status: kind === "approval" ? 409 : 403 });
  });
  it("does not treat a collision skip as authority over another head's existing employee", async () => {
    const f = fixture(), item = f.item("existing");
    const plans = [{ ...f.plan(item.slug), action: "skip", existingAgentId: "other" }];
    await expect(f.prepare([item], "head", plans as never)).rejects.toMatchObject({ status: 403 });
  });
  it("allows a preparing parent only when this import actually created it, preserving scope", async () => {
    const f = fixture();
    Object.assign(f.rows.agents.find(row => row.id === "own")!, { lifecycleState: "preparing" });
    const run = (ids: string[]) => resolveAgentHiringAuthority(f.db, "company", f.actor(), { reportsTo: "own" }, { requireDepartmentHead: true, importedManagerIds: ids });
    await expect(run([])).rejects.toMatchObject({ status: 403 });
    await expect(run(["own"])).resolves.toMatchObject({ reportsTo: "own" });
    f.rows.agents.find(row => row.id === "own")!.reportsTo = "other";
    await expect(run(["own"])).rejects.toMatchObject({ status: 403 });
  });

  it("keeps an ordinary employee hired beneath a department head inside its own reporting subtree", async () => {
    const f = fixture();
    const hire = (input: { role?: string; reportsTo?: string | null }) => resolveAgentHiringAuthority(f.db, "company", f.actor("own"), input);
    await expect(hire({ role: "engineer" })).resolves.toMatchObject({ departmentHead: true, reportsTo: "own" });
    for (const input of [{ role: "ceo" }, { reportsTo: null }, { reportsTo: "other" }, { reportsTo: "head" }])
      await expect(hire(input)).rejects.toMatchObject({ status: 403 });
    await expect(f.prepare([f.item("worker", "own")], "own")).resolves.toMatchObject({ departmentHead: true });
    await expect(f.prepare([f.item("worker", "other")], "own")).rejects.toMatchObject({ status: 403 });
  });
  it("prevents a department employee using its default configuration grant to move itself out, promote itself, or control another team", async () => {
    const f = fixture(), actor = f.actor("own");
    const own = { id: "own", companyId: "company", role: "engineer", reportsTo: "head" };
    await expect(resolveDepartmentConfigurationAuthority(f.db, own, actor, {})).resolves.toMatchObject({ departmentHead: true });
    await expect(resolveDepartmentConfigurationAuthority(f.db, own, actor, { reportsTo: "ceo" })).rejects.toMatchObject({ status: 403 });
    await expect(resolveDepartmentConfigurationAuthority(f.db, own, actor, { role: "ceo" })).rejects.toMatchObject({ status: 403 });
    await expect(resolveDepartmentConfigurationAuthority(f.db, { id: "other", companyId: "company", role: "manager", reportsTo: "ceo" }, actor, {})).rejects.toMatchObject({ status: 403 });
  });
  it("pins inherited department authority across a reporting reassignment", async () => {
    const f = fixture(), actor = f.actor("own");
    const admitted = await resolveAgentHiringAuthority(f.db, "company", actor, { role: "engineer" });
    expect(admitted.departmentHead).toBe(true);
    f.rows.agents.find(row => row.id === "own")!.reportsTo = "ceo";
    await expect(resolveAgentHiringAuthority(f.db, "company", actor, { role: "engineer" }, { requireDepartmentHead: admitted.departmentHead })).rejects.toMatchObject({ status: 409 });
    // A later independent request sees the CEO's new direct reporting assignment
    // and retains ordinary native permission policy, without historical roles.
    await expect(resolveAgentHiringAuthority(f.db, "company", actor, { role: "engineer", reportsTo: "ceo" })).resolves.toMatchObject({ departmentHead: false });
  });
});
