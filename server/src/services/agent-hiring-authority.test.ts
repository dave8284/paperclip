import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, agentosDepartments, authUsers, companyMemberships, companyOperatingProfiles, principalPermissionGrants, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDepartmentWorkforceTarget, resolveAgentHiringAuthority, resolveDepartmentConfigurationAuthority } from "./agent-hiring-authority.js";

const native = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("./access.js", () => ({ accessService: () => ({ decide: native.decide }) }));
type Row = Record<string, unknown>;
function fixture() {
  const companyId = randomUUID(), owner = randomUUID(), head = randomUUID(), ceo = randomUUID(), lead = randomUUID(), outsider = randomUUID(), foreign = randomUUID();
  const tables = [agents, agentosDepartments, authUsers, companyMemberships, companyOperatingProfiles, principalPermissionGrants];
  const rows: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableName(table), []]));
  rows.agents = [head, ceo, lead, outsider, foreign].map(id => ({ id, companyId: id === foreign ? randomUUID() : companyId,
    role: id === ceo ? "ceo" : "general", status: "idle", lifecycleState: "ready", reportsTo: id === lead ? head : id === ceo ? null : ceo }));
  rows.agentos_departments = [{ id: randomUUID(), companyId, leadAgentId: head }];
  rows.company_operating_profiles = [{ companyId, fridayAgentId: null }];
  rows.user = [{ id: owner, approvalStatus: "approved" }];
  let afterWait: (() => void) | undefined;
  const queries: string[] = [];
  const db = drizzle(async (query, params) => {
    queries.push(query);
    if (query.startsWith("select pg_advisory")) { afterWait?.(); afterWait = undefined; return { rows: [] }; }
    const name = query.match(/from "([^"]+)"/)?.[1], table = tables.find(table => getTableName(table) === name);
    if (!name || !table || !query.startsWith("select ")) throw new Error(`Unexpected SQL: ${query}`);
    const keys = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]));
    const selected = rows[name].filter(row => {
      if (name === "agents") return params.includes(row.id) && params.includes(row.companyId);
      if (name === "agentos_departments") return params.includes(row.companyId) && params.includes(row.leadAgentId);
      if (name === "company_operating_profiles") return params.includes(row.companyId);
      if (name === "user") return params.includes(row.id);
      return true;
    });
    const projection = query.slice(7, query.indexOf(" from "));
    const fields = [...projection.matchAll(/(?:"[^"]+"\.)?"([^"]+)"/g)].map(match => keys[match[1]]);
    return { rows: selected.map(row => fields.map(key => row[key] ?? null)) };
  }) as unknown as Db;
  const actor = (agentId = head) => ({ type: "agent" as const, source: "agent_jwt" as const, companyId, agentId, onBehalfOfUserId: owner });
  const hire = (input: { role?: string; reportsTo?: string | null } = {}, agentId = head, requireDepartmentHead = true) =>
    resolveAgentHiringAuthority(db, companyId, actor(agentId), input, { lock: true, requireDepartmentHead });
  return { companyId, owner, head, ceo, lead, outsider, foreign, rows, queries, db, actor, hire, afterWait: (fn: () => void) => { afterWait = fn; } };
}
beforeEach(() => { native.decide.mockReset(); native.decide.mockResolvedValue({ allowed: true }); });

describe("native department head hiring scope", () => {
  it("defaults a head's specialist hire to its own reporting line and allows current team leads", async () => {
    const f = fixture();
    await expect(f.hire({ role: "engineer" })).resolves.toEqual({ departmentHead: true, reportsTo: f.head });
    await expect(f.hire({ role: "engineer", reportsTo: f.lead })).resolves.toEqual({ departmentHead: true, reportsTo: f.lead });
    expect(f.queries.some(query => /from "agents".*for share nowait/.test(query))).toBe(true);
    Object.assign(f.rows.agents.find(row => row.id === f.lead)!, { status: "paused", lifecycleState: "paused" });
    await expect(f.hire({ role: "engineer", reportsTo: f.lead })).resolves.toMatchObject({ reportsTo: f.lead });
    expect(f.rows.agents.find(row => row.id === f.lead)!.status).toBe("paused");
  });
  it.each(["ceo", "top level", "other team", "foreign", "cycle", "inactive", "nested department"])("rejects a head's %s hire", async kind => {
    const f = fixture();
    let input: { role?: string; reportsTo?: string | null } = {};
    if (kind === "ceo") input.role = "ceo";
    if (kind === "top level") input.reportsTo = null;
    if (kind === "other team") input.reportsTo = f.outsider;
    if (kind === "foreign") input.reportsTo = f.foreign;
    if (["cycle", "inactive", "nested department"].includes(kind)) input.reportsTo = f.lead;
    if (kind === "cycle") f.rows.agents.find(row => row.id === f.lead)!.reportsTo = f.lead;
    if (kind === "inactive") f.rows.agents.find(row => row.id === f.lead)!.lifecycleState = "terminated";
    if (kind === "nested department") f.rows.agentos_departments.push({ id: randomUUID(), companyId: f.companyId, leadAgentId: f.lead });
    await expect(f.hire(input)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves direct CEO specialist hiring without requiring a department", async () => {
    const f = fixture(); f.rows.agentos_departments = [];
    await expect(f.hire({ role: "engineer", reportsTo: f.ceo }, f.ceo, false)).resolves.toEqual({ departmentHead: false, reportsTo: f.ceo });
  });
  it("preserves ordinary creators' existing native authority instead of inventing a department requirement", async () => {
    const f = fixture();
    await expect(f.hire({ role: "engineer", reportsTo: f.outsider }, f.outsider, false)).resolves.toEqual({ departmentHead: false, reportsTo: f.outsider });
  });
  it.each(["appointment", "permission", "friday", "owner"])("rechecks %s after the write transaction waits", async kind => {
    const f = fixture();
    const admitted = await resolveAgentHiringAuthority(f.db, f.companyId, f.actor(), { role: "engineer" });
    expect(admitted.departmentHead).toBe(true);
    f.afterWait(() => {
      if (kind === "appointment") f.rows.agentos_departments = [];
      if (kind === "permission") native.decide.mockResolvedValue({ allowed: false, explanation: "native hiring grant revoked" });
      if (kind === "friday") f.rows.company_operating_profiles[0].fridayAgentId = f.head;
      if (kind === "owner") f.rows.user[0].approvalStatus = "rejected";
    });
    await expect(f.hire({ role: "engineer", reportsTo: admitted.reportsTo })).rejects.toThrow();
  });
});

describe("department reporting edits and revision restoration", () => {
  it.each(["agent_config:update", "agent_instructions:update"] as const)("keeps nongraph %s edits within the current head's team", async targetAction => {
    const f = fixture();
    const target = (id: string) => f.rows.agents.find(row => row.id === id)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    await expect(resolveDepartmentConfigurationAuthority(f.db, target(f.lead), f.actor(), {}, { lock: true, targetAction })).resolves.toMatchObject({ departmentHead: true });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target(f.head), f.actor(), {}, { lock: true, targetAction })).resolves.toMatchObject({ departmentHead: true });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target(f.outsider), f.actor(), {}, { lock: true, targetAction })).rejects.toMatchObject({ status: 403 });
    f.rows.agentos_departments.push({ id: randomUUID(), companyId: f.companyId, leadAgentId: f.lead });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target(f.lead), f.actor(), {}, { lock: true, targetAction })).rejects.toMatchObject({ status: 403 });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target(f.lead), f.actor(f.ceo), {}, { lock: true, targetAction })).resolves.toMatchObject({ departmentHead: false });
    expect(native.decide.mock.calls.every(([request]) => request.action === targetAction)).toBe(true);
  });
  it("preserves Friday's native self-configuration while denying team configuration and hiring", async () => {
    const f = fixture(); f.rows.company_operating_profiles[0].fridayAgentId = f.head; f.rows.agentos_departments = [];
    const target = f.rows.agents.find(row => row.id === f.head)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, { lock: true })).resolves.toMatchObject({ departmentHead: false });
    await expect(resolveDepartmentConfigurationAuthority(f.db, { ...target, id: f.lead }, f.actor(), {}, { lock: true })).rejects.toMatchObject({ status: 403 });
    await expect(f.hire({}, f.head, false)).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks nongraph target ownership after waiting for the department lock", async () => {
    const f = fixture();
    const target = f.rows.agents.find(row => row.id === f.lead)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    expect((await resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {})).departmentHead).toBe(true);
    f.afterWait(() => { target.reportsTo = f.ceo; });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, { lock: true, requireDepartmentHead: true })).rejects.toMatchObject({ status: 403 });
  });
  it.each(["agent_config:update", "agent_instructions:update"] as const)("preserves protected %s consent without allowing it across teams", async targetAction => {
    const f = fixture();
    native.decide.mockImplementation(async input => ({ allowed: input.scope?.consentedChange === true,
      reason: "deny_missing_consent", explanation: "requires native change consent" }));
    const target = f.rows.agents.find(row => row.id === f.lead)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    const options = { lock: true, targetAction, configurationRequiresChangeGrant: true, configurationConsentedChange: true };
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, options)).resolves.toMatchObject({ departmentHead: true });
    expect(native.decide).toHaveBeenCalledWith(expect.objectContaining({ scope: { targetAgentId: target.id, requiresChangeGrant: true, consentedChange: true } }));
    target.reportsTo = f.ceo;
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, options)).rejects.toMatchObject({ status: 403 });
    target.reportsTo = f.head;
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, { ...options, configurationConsentedChange: false })).rejects.toThrow("requires native change consent");
    native.decide.mockResolvedValue({ allowed: false, reason: "deny_no_grant", explanation: "Native grant revoked" });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, options)).rejects.toThrow("Native grant revoked");
  });
  it("cannot pass route-only scope preflight into a locked mutation", async () => {
    const f = fixture();
    const target = f.rows.agents.find(row => row.id === f.lead)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, { configurationScopeOnly: true })).resolves.toMatchObject({ departmentHead: true });
    expect(native.decide).not.toHaveBeenCalled();
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, { lock: true, configurationScopeOnly: true })).rejects.toMatchObject({ status: 403 });
  });
  it.each(["ceo", "outside", "top level", "take report", "own promotion", "own manager"])("rejects %s through configuration", async kind => {
    const f = fixture();
    const targetId = kind === "take report" ? f.outsider : kind.startsWith("own ") ? f.head : f.lead;
    const target = f.rows.agents.find(row => row.id === targetId)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    const patch = kind === "ceo" || kind === "own promotion" ? { role: "ceo" }
      : kind === "top level" ? { reportsTo: null }
      : { reportsTo: kind === "take report" ? f.head : f.outsider };
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), patch, { lock: true, requireDepartmentHead: true })).rejects.toMatchObject({ status: 403 });
  });
  it("permits moving an existing report within the head's current team under native configure authority", async () => {
    const f = fixture();
    const target = { id: randomUUID(), companyId: f.companyId, role: "engineer", reportsTo: f.head, lifecycleState: "ready", status: "idle" };
    f.rows.agents.push(target);
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), { reportsTo: f.lead }, { lock: true })).resolves.toMatchObject({ departmentHead: true, reportsTo: f.lead });
    expect(native.decide).toHaveBeenCalledWith(expect.objectContaining({ action: "agent_config:update", resource: { type: "agent", companyId: f.companyId, agentId: target.id } }));
  });
  it("does not turn a native configuration denial into a hire permission", async () => {
    const f = fixture(); native.decide.mockImplementation(async input => ({ allowed: input.action === "agents:create", explanation: "configure denied" }));
    const target = f.rows.agents.find(row => row.id === f.lead)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), { role: "engineer" }, { lock: true })).rejects.toThrow("configure denied");
  });
  it("rejects a formerly admitted head's configuration after its appointment is removed", async () => {
    const f = fixture();
    const target = f.rows.agents.find(row => row.id === f.lead)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    expect((await resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), { role: "engineer" })).departmentHead).toBe(true);
    f.afterWait(() => { f.rows.agentos_departments = []; });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), { role: "engineer" }, { lock: true, requireDepartmentHead: true })).rejects.toThrow("appointment changed");
  });
  it("requires current explicit native resume permission and retains the department ceiling for paused employees", async () => {
    const f = fixture();
    const target = f.rows.agents.find(row => row.id === f.lead)! as unknown as { id: string; companyId: string; role: string; reportsTo: string | null };
    Object.assign(target, { status: "paused", lifecycleState: "paused" });
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, { lock: true, configurationRequiresChangeGrant: true })).resolves.toMatchObject({ departmentHead: true });
    expect(native.decide).toHaveBeenLastCalledWith(expect.objectContaining({ action: "agent_config:update", scope: { targetAgentId: f.lead, requiresChangeGrant: true } }));
    target.reportsTo = f.ceo;
    await expect(resolveDepartmentConfigurationAuthority(f.db, target, f.actor(), {}, { lock: true, configurationRequiresChangeGrant: true })).rejects.toMatchObject({ status: 403 });
  });
});

describe("department workforce target ownership", () => {
  it.each(["agent_config:update", "workforce:retire"] as const)("allows own staff and rejects unrelated, foreign, or another head's employees (%s)", async action => {
    const f = fixture();
    await expect(assertDepartmentWorkforceTarget(f.db, f.companyId, f.actor(), f.lead, action, true)).resolves.toBeUndefined();
    for (const target of [f.outsider, f.foreign, f.ceo]) await expect(assertDepartmentWorkforceTarget(f.db, f.companyId, f.actor(), target, action, true)).rejects.toMatchObject({ status: 403 });
    f.rows.agentos_departments.push({ id: randomUUID(), companyId: f.companyId, leadAgentId: f.lead });
    await expect(assertDepartmentWorkforceTarget(f.db, f.companyId, f.actor(), f.lead, action, true)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves CEO scope and native retirement grants without requiring a configure grant", async () => {
    const f = fixture(); native.decide.mockImplementation(async input => ({ allowed: input.action === "workforce:retire" }));
    await expect(assertDepartmentWorkforceTarget(f.db, f.companyId, f.actor(f.ceo), f.outsider, "workforce:retire", false)).resolves.toBeUndefined();
    await expect(assertDepartmentWorkforceTarget(f.db, f.companyId, f.actor(), f.lead, "workforce:retire", true)).resolves.toBeUndefined();
    expect(native.decide.mock.calls.every(([input]) => input.action === "workforce:retire")).toBe(true);
  });
  it("keeps authorized retirement retries possible after the target stopped, without allowing self-retirement of the head", async () => {
    const f = fixture(); Object.assign(f.rows.agents.find(row => row.id === f.lead)!, { status: "terminated", lifecycleState: "terminated" });
    await expect(assertDepartmentWorkforceTarget(f.db, f.companyId, f.actor(), f.lead, "workforce:retire", true)).resolves.toBeUndefined();
    await expect(assertDepartmentWorkforceTarget(f.db, f.companyId, f.actor(), f.head, "workforce:retire", true)).rejects.toMatchObject({ status: 403 });
  });
});
