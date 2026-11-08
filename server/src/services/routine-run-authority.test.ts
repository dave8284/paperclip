import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, agentApiKeys, authUsers, companies, companyMemberships, executionWorkspaces, heartbeatRuns, instanceUserRoles, issues, goals,
  issueAccessGrants, principalPermissionGrants, projectAccessMembers, projects, projectWorkspaces, routines, routineTriggers,
  pluginManagedResources, routineRuns, runIdentityContexts, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeRoutineDispatch, authorizeRoutineReplay } from "./routine-run-authority.js";
import type { AuthorizationActor } from "./authorization.js";
import { routineService } from "./routines.js";

const native = vi.hoisted(() => ({ decide: vi.fn(), reads: vi.fn(), assignable: vi.fn(), projectWorkspace: vi.fn(), executionWorkspace: vi.fn(), createIssue: vi.fn() }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decide: native.decide, decideReads: native.reads }) }));
vi.mock("./agent-assignability.js", () => ({ assertAssignableAgent: native.assignable }));
vi.mock("./task-workspace-access.js", () => ({ assertTaskWorkspaceSourceProjectAccess: native.projectWorkspace, assertExecutionWorkspaceRecordAccess: native.executionWorkspace }));
vi.mock("./issues.js", () => ({ issueService: () => ({ create: native.createIssue }) }));
vi.mock("./secrets.js", () => ({ secretService: () => ({}) }));
vi.mock("./heartbeat.js", () => ({ heartbeatService: () => ({}) }));
vi.mock("./instance-settings.js", () => ({ instanceSettingsService: () => ({ getExperimental: async () => ({ enableIsolatedWorkspaces: false }) }) }));
vi.mock("./issue-assignment-wakeup.js", () => ({ queueIssueAssignmentWakeup: vi.fn() }));
vi.mock("../telemetry.js", () => ({ getTelemetryClient: () => null }));

type Row = Record<string, unknown>;
function fixture() {
  const companyId = randomUUID(), routineId = randomUUID(), employee = randomUUID(), target = randomUUID(), owner = randomUUID(), project = randomUUID(), otherProject = randomUUID(), runId = randomUUID(), triggerId = randomUUID(), workspaceId = randomUUID();
  const tables = [agents, agentApiKeys, authUsers, companies, companyMemberships, executionWorkspaces, heartbeatRuns, instanceUserRoles, issues, goals,
    issueAccessGrants, principalPermissionGrants, projectAccessMembers, projects, projectWorkspaces, routines, routineTriggers, pluginManagedResources, routineRuns, runIdentityContexts];
  const rows: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableName(table), []]));
  const current: typeof routines.$inferSelect = { id: routineId, companyId, title: "Weekly check", description: "Prepare an operations check", projectId: project,
    parentIssueId: null, goalId: null, assigneeAgentId: employee, priority: "medium", status: "active", concurrencyPolicy: "coalesce_if_active",
    variables: [], env: null, latestRevisionId: null, latestRevisionNumber: 1, responsibleUserId: owner, originKind: "manual", originId: null,
    createdAt: new Date(), updatedAt: new Date(), catchUpPolicy: "skip_missed", activityGatePolicy: "always", activityGateScope: "company",
    folderId: null, createdByAgentId: employee, createdByUserId: null, updatedByAgentId: null, updatedByUserId: null, lastTriggeredAt: null, lastEnqueuedAt: null };
  rows.routines = [current]; rows.companies = [{ id: companyId }];
  rows.agents = [employee, target].map(id => ({ id, companyId, role: id === employee ? "ceo" : "engineer", status: "idle", lifecycleState: "ready" }));
  rows.user = [{ id: owner, approvalStatus: "approved" }];
  rows.heartbeat_runs = [{ id: runId, companyId, agentId: employee, status: "running", responsibleUserId: owner }];
  rows.projects = [project, otherProject].map(id => ({ id, companyId }));
  rows.routine_triggers = [{ id: triggerId, companyId, routineId, kind: "api", enabled: true, archived: false, setupPending: false }];
  rows.project_workspaces = [{ id: workspaceId, companyId, projectId: otherProject }];
  rows.execution_workspaces = [{ id: "workspace", companyId, projectId: otherProject, metadata: {} }];
  const statements: string[] = [];
  let afterWait: (() => void) | undefined;
  const db = drizzle(async (query, params) => {
    statements.push(query);
    if (query.startsWith("select pg_advisory_xact_lock")) return { rows: [] };
    if (query.startsWith("select id from")) { afterWait?.(); afterWait = undefined; return { rows: [] }; }
    const name = query.match(/(?:from|into|update) "([^"]+)"/)?.[1], table = tables.find(item => getTableName(item) === name);
    if (!name || !table) throw new Error(`Unexpected SQL: ${query}`);
    const keys = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]));
    const equality = [...(query.split(" where ")[1]?.split(" returning ")[0] ?? "").matchAll(/(?:"([^"]+)"\.)?"([^"]+)" = \$(\d+)/g)];
    let selected = rows[name].filter(row => equality.every(([, source, column, param]) => !source || source === name ? row[keys[column]] === params[Number(param) - 1] : true));
    if (query.startsWith("insert ") && name === "routine_runs") {
      const [, columns, values] = query.match(/\(([^)]+)\) values \(([^)]+)\)/)!;
      const names = [...columns.matchAll(/"([^"]+)"/g)].map(match => match[1]);
      const row: Row = { id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      values.split(",").forEach((value, index) => { const param = value.trim().match(/^\$(\d+)$/); if (param) row[keys[names[index]]] = params[Number(param[1]) - 1]; });
      rows[name].push(row); selected = [row];
    } else if (query.startsWith("update ") && ["routine_runs", "routines"].includes(name)) {
      for (const row of selected) for (const [, column, index] of query.split(" where ")[0].matchAll(/"([^"]+)" = \$(\d+)/g)) row[keys[column]] = params[Number(index) - 1];
    } else if (!query.startsWith("select ")) throw new Error(`Unexpected SQL: ${query}`);
    const projection = query.startsWith("select ") ? query.slice(7, query.indexOf(" from ")) : query.split(" returning ")[1] ?? "";
    const fields = [...projection.matchAll(/(?:"[^"]+"\.)?"([^"]+)"/g)].map(match => keys[match[1]]);
    return { rows: selected.map(row => fields.map(key => row[key] ?? null)) };
  }) as unknown as Db;
  db.transaction = (async (fn: (tx: Db) => Promise<unknown>) => fn(db)) as unknown as Db["transaction"];
  const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", agentId: employee, companyId, runId, onBehalfOfUserId: owner,
    onBehalfOfMemberships: [{ companyId, membershipRole: "owner", status: "active" }] };
  const input = { actor, expected: structuredClone(current), assigneeAgentId: target, projectId: otherProject };
  return { db, rows, input, current, actor, statements, companyId, routineId, employee, target, owner, project, otherProject, runId, triggerId, workspaceId,
    afterWait: (fn: () => void) => { afterWait = fn; } };
}
beforeEach(() => {
  vi.clearAllMocks(); native.decide.mockResolvedValue({ allowed: true });
  native.reads.mockImplementation(async (_actor, resources) => resources.map(() => ({ allowed: true })));
  native.assignable.mockResolvedValue(undefined); native.projectWorkspace.mockResolvedValue(undefined); native.executionWorkspace.mockResolvedValue(undefined);
});

describe("routine execution authority", () => {
  it("retains legitimate CEO delegation while checking the effective target and private project through native policy", async () => {
    const f = fixture();
    const actor = await authorizeRoutineDispatch(f.db, f.input);
    expect(actor).toMatchObject({ agentId: f.employee, onBehalfOfUserId: f.owner, runId: f.runId });
    expect(actor.onBehalfOfMemberships).toBeUndefined();
    expect(native.decide).toHaveBeenCalledWith(expect.objectContaining({ actor, action: "tasks:assign",
      resource: expect.objectContaining({ assigneeAgentId: f.target, projectId: f.otherProject }), scope: expect.objectContaining({ assigneeAgentId: f.target, projectId: f.otherProject }) }));
    expect(native.reads.mock.calls.flatMap(([, resources]) => resources).some(resource => resource.projectId === f.otherProject)).toBe(true);
    expect(f.statements.some(sql => sql.includes('"principal_permission_grants"') && sql.endsWith("for share nowait"))).toBe(true);
  });
  it("pins target reporting and private-parent ancestry before native assignment decisions", async () => {
    const f = fixture(), manager = randomUUID(), ancestor = randomUUID();
    f.rows.agents[1].reportsTo = manager;
    f.rows.agents.push({ id: manager, companyId: f.companyId, reportsTo: f.employee });
    f.current.parentIssueId = "parent"; f.input.expected.parentIssueId = "parent";
    f.rows.issues.push({ id: "parent", companyId: f.companyId, projectId: f.project, privacyParentIssueId: ancestor },
      { id: ancestor, companyId: f.companyId, projectId: f.otherProject });
    native.decide.mockImplementationOnce(async () => {
      expect(f.statements.filter(sql => sql.includes('from "agents"') && sql.endsWith("for share nowait"))).toHaveLength(4);
      expect(f.statements.filter(sql => sql.includes('from "issue_access_grants"') && sql.endsWith("for share nowait"))).toHaveLength(2);
      return { allowed: true };
    });
    await authorizeRoutineDispatch(f.db, f.input);
  });
  it("keeps an authorized employee's self-run and an authorized board override valid", async () => {
    const f = fixture();
    await expect(authorizeRoutineDispatch(f.db, { ...f.input, assigneeAgentId: f.employee })).resolves.toMatchObject({ agentId: f.employee });
    await expect(authorizeRoutineDispatch(f.db, { ...f.input, actor: { type: "board", source: "session", userId: f.owner, companyIds: [f.companyId] } })).resolves.toMatchObject({ userId: f.owner });
  });
  it.each(["native target grant", "effective private project", "stored private project", "parent privacy"])("rejects denied %s", async kind => {
    const f = fixture();
    if (kind === "native target grant") native.decide.mockResolvedValue({ allowed: false, explanation: "Target is outside the assignment grant" });
    else {
      if (kind === "parent privacy") {
        Object.assign(f.current, { parentIssueId: "parent" }); Object.assign(f.input.expected, { parentIssueId: "parent" });
        f.rows.issues.push({ id: "parent", companyId: f.companyId, projectId: f.project });
      }
      native.reads.mockImplementation(async (_actor, resources) => resources.map((resource: { issueId?: string; projectId?: string }) => ({ allowed: kind === "parent privacy"
        ? resource.issueId !== "parent" : resource.projectId !== (kind === "effective private project" ? f.otherProject : f.project) })));
    }
    await expect(authorizeRoutineDispatch(f.db, f.input)).rejects.toMatchObject({ status: kind === "native target grant" ? 403 : 404 });
    expect(native.assignable).not.toHaveBeenCalled();
  });
  it.each(["revision", "owner", "status", "project"])("rejects a changed routine %s after preparation", async kind => {
    const f = fixture();
    if (kind === "revision") f.current.latestRevisionNumber += 1;
    if (kind === "owner") f.current.assigneeAgentId = f.target;
    if (kind === "status") f.current.status = "archived";
    if (kind === "project") f.current.projectId = f.otherProject;
    await expect(authorizeRoutineDispatch(f.db, f.input)).rejects.toMatchObject({ status: 409 });
    expect(native.decide).not.toHaveBeenCalled();
  });
  it.each(["inactive run", "changed responsible user", "missing identity context", "unapproved user", "retired owner", "revoked key", "disabled trigger", "foreign project"])("fails closed for %s", async kind => {
    const f = fixture();
    if (kind === "inactive run") f.rows.heartbeat_runs[0].status = "succeeded";
    if (kind === "changed responsible user") f.rows.heartbeat_runs[0].responsibleUserId = randomUUID();
    if (kind === "missing identity context") f.rows.heartbeat_runs[0].activeIdentityContextId = randomUUID();
    if (kind === "unapproved user") f.rows.user[0].approvalStatus = "pending";
    if (kind === "retired owner") f.rows.agents[0].lifecycleState = "terminated";
    if (kind === "revoked key") f.input.actor.keyId = "deleted-key";
    if (kind === "disabled trigger") f.rows.routine_triggers[0].enabled = false;
    if (kind === "foreign project") f.rows.projects[1].companyId = randomUUID();
    await expect(authorizeRoutineDispatch(f.db, { ...f.input, ...(kind === "disabled trigger" ? { triggerId: f.triggerId } : {}) })).rejects.toMatchObject({ status: kind === "disabled trigger" ? 409 : kind === "foreign project" ? 404 : 403 });
  });
  it("keeps existing work eligibility and workspace authorization as owning checks", async () => {
    const f = fixture();
    native.assignable.mockRejectedValueOnce(Object.assign(new Error("Friday cannot execute routine work"), { status: 403 }));
    await expect(authorizeRoutineDispatch(f.db, f.input)).rejects.toMatchObject({ status: 403 });
    native.projectWorkspace.mockRejectedValueOnce(Object.assign(new Error("Private workspace"), { status: 403 }));
    await expect(authorizeRoutineDispatch(f.db, { ...f.input, projectWorkspaceId: f.workspaceId })).rejects.toMatchObject({ status: 403 });
    expect(native.projectWorkspace).toHaveBeenCalledWith(f.db, expect.objectContaining({ agentId: f.employee }), f.companyId, f.otherProject);
    native.executionWorkspace.mockImplementationOnce(async () => {
      expect(f.statements.some(sql => sql.includes('from "execution_workspaces"') && sql.endsWith("for update nowait"))).toBe(true);
      throw Object.assign(new Error("Retained private task"), { status: 403 });
    });
    await expect(authorizeRoutineDispatch(f.db, { ...f.input, executionWorkspaceId: "workspace" })).rejects.toMatchObject({ status: 403 });
  });
  it("does not let an idempotency key expose a different request or a newly private cycle task", async () => {
    const f = fixture(), existing = { dispatchFingerprint: "one", linkedIssueId: "cycle" };
    await expect(authorizeRoutineReplay(f.db, f.actor, f.companyId, existing, "two")).rejects.toMatchObject({ status: 409 });
    native.reads.mockResolvedValueOnce([{ allowed: false }]);
    await expect(authorizeRoutineReplay(f.db, f.actor, f.companyId, existing, "one")).rejects.toMatchObject({ status: 404 });
    await expect(authorizeRoutineReplay(f.db, f.actor, f.companyId, existing, "one")).resolves.toBeUndefined();
  });
  it.each(["grant", "routine", "run"])("the actual dispatch observes %s changes after its routine lock, before any receipt, replay or task write", async kind => {
    const f = fixture();
    f.afterWait(() => {
      if (kind === "grant") native.decide.mockResolvedValue({ allowed: false, explanation: "Permission revoked while waiting" });
      if (kind === "routine") f.current.latestRevisionNumber += 1;
      if (kind === "run") f.rows.heartbeat_runs[0].status = "succeeded";
    });
    await expect(routineService(f.db).runRoutine(f.routineId, { source: "manual", assigneeAgentId: f.target,
      projectId: f.otherProject, idempotencyKey: "retained-key" }, { agentId: f.employee }, f.actor)).rejects.toMatchObject({ status: kind === "routine" ? 409 : 403 });
    expect(f.statements.some(sql => /^(insert|update|delete) /.test(sql))).toBe(false);
    expect(f.statements.some(sql => sql.includes('from "routine_runs"'))).toBe(false);
    expect(native.createIssue).not.toHaveBeenCalled();
  });
  it("the actual authorized dispatch preserves API actor, responsible user, workspace authority and an exact idempotent replay", async () => {
    const f = fixture();
    native.createIssue.mockImplementationOnce(async (companyId, input, outerTransaction, authorization) => {
      expect(outerTransaction).toBeUndefined();
      // The task owner rechecks authority in its separate write transaction;
      // it commits before the dispatch queues a worker.
      await authorization.assertCanCreate(f.db, input);
      return { id: randomUUID(), companyId, ...input };
    });
    const service = routineService(f.db);
    const request = { source: "api" as const, assigneeAgentId: f.target, projectId: f.otherProject, idempotencyKey: "one-authorized-cycle" };
    const result = await service.runRoutine(f.routineId, request, { agentId: f.employee, runId: f.runId }, f.actor);
    expect(result.status).toBe("issue_created");
    expect(native.createIssue).toHaveBeenCalledWith(f.companyId, expect.objectContaining({ assigneeAgentId: f.target, projectId: f.otherProject,
      createdByAgentId: f.employee, responsibleUserId: f.owner, actorRunId: f.runId,
      workspaceSelectionActor: expect.objectContaining({ agentId: f.employee, onBehalfOfUserId: f.owner }) }), undefined, { assertCanCreate: expect.any(Function) });
    const replay = await service.runRoutine(f.routineId, request, { agentId: f.employee, runId: f.runId }, f.actor);
    expect(replay.id).toBe(result.id);
    expect(native.createIssue).toHaveBeenCalledTimes(1);
  });
  it("the native task writer rechecks current grants before persistence after routine admission", async () => {
    const f = fixture();
    f.current.projectId = null;
    const { issueService } = await vi.importActual<typeof import("./issues.js")>("./issues.js");
    native.createIssue.mockImplementationOnce(issueService(f.db).create);
    native.decide.mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, explanation: "Assignment was revoked during task preparation" });
    const result = await routineService(f.db).runRoutine(f.routineId, { source: "manual", assigneeAgentId: f.target }, { agentId: f.employee }, f.actor);
    expect(result).toMatchObject({ status: "failed", failureReason: "Assignment was revoked during task preparation" });
    expect(native.decide).toHaveBeenCalledTimes(2);
    expect(f.statements.some(sql => sql.includes('from "companies"') && sql.endsWith("for no key update nowait"))).toBe(true);
    expect(f.statements.some(sql => /^(insert into "issues"|update "companies")/.test(sql))).toBe(false);
  });
  it("the native task writer authorizes the inherited effective project before allocating a task", async () => {
    const f = fixture();
    f.rows.issues.push({ id: "parent", companyId: f.companyId, projectId: f.otherProject });
    f.rows.project_workspaces = [];
    const { issueService } = await vi.importActual<typeof import("./issues.js")>("./issues.js");
    const assertCanCreate = vi.fn(async (_tx, scope) => {
      expect(scope).toMatchObject({ projectId: f.otherProject, assigneeAgentId: f.target });
      throw Object.assign(new Error("Inherited private project cannot receive work"), { status: 403 });
    });
    await expect(issueService(f.db).create(f.companyId, { title: "A private cycle", parentId: "parent", assigneeAgentId: f.target }, undefined,
      { assertCanCreate })).rejects.toMatchObject({ status: 403 });
    expect(assertCanCreate).toHaveBeenCalledTimes(1);
    expect(f.statements.some(sql => /^(insert into "issues"|update "companies")/.test(sql))).toBe(false);
  });
  it("does not accept an agent audit identity without its authenticated native authority", async () => {
    const f = fixture();
    await expect(routineService(f.db).runRoutine(f.routineId, { source: "manual" }, { agentId: f.employee })).rejects.toMatchObject({ status: 403 });
    expect(f.statements).toEqual([]);
  });
});
