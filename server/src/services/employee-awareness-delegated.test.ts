import { randomUUID } from "node:crypto";
import { agents, agentosAssignments, agentosEmployees, agentosPortfolioMandates, type Db } from "@paperclipai/db";
import { employeeAwarenessQuerySchema } from "@paperclipai/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationActor } from "./authorization.js";
import { forbidden } from "../errors.js";
import { readDelegatedEmployeeAwareness } from "./employee-awareness-delegated.js";
import { assertPortfolioMandateActor } from "./agentos-portfolio-mandates.js";

const native = vi.hoisted(() => ({ authorize: vi.fn(), work: vi.fn(), audit: vi.fn(), publish: vi.fn() }));
vi.mock("./agentos-portfolio-mandates.js", async original => ({
  ...await original<typeof import("./agentos-portfolio-mandates.js")>(),
  agentosPortfolioMandateService: () => ({ authorizeReads: native.authorize }),
}));
vi.mock("./friday-awareness.js", () => ({ fridayAwarenessService: () => ({ work: native.work }) }));
vi.mock("./activity-log.js", () => ({ persistActivity: native.audit }));
vi.mock("./accounting-transaction.js", () => ({ publishAccountingActivities: native.publish }));

function fixture() {
  const companyId = randomUUID(), agentId = randomUUID(), targetCompanyId = randomUUID(), targetAgentId = randomUUID();
  const employee = { id: randomUUID(), portfolioId: randomUUID(), name: "Analyst", specialty: "Arithmetic" };
  const source = { id: randomUUID(), companyId, agentId, employeeId: employee.id, portfolioId: employee.portfolioId, status: "active", revision: 1 };
  const mandate: typeof agentosPortfolioMandates.$inferSelect = { id: randomUUID(), portfolioId: employee.portfolioId,
    sourceCompanyId: companyId, sourceAgentId: agentId, ownerUserId: "owner", grantId: randomUUID(), revision: 3,
    targetCompanyIds: [targetCompanyId], readScope: "company_shared_only", action: "portfolio_work:read",
    expiresAt: null, revokedAt: null, createdAt: new Date(), updatedAt: new Date() };
  const local = { assignmentId: source.id, assignmentRevision: 1, companyId, companyName: "First company",
    agentId, agentName: "Local analyst", agentStatus: "idle", department: null, employeeId: employee.id };
  const foreign = { ...local, assignmentId: randomUUID(), assignmentRevision: 2, companyId: targetCompanyId,
    companyName: "Second company", agentId: targetAgentId, agentName: "Separate analyst" };
  const state = { source: [source], employee: [employee], mandate: [mandate], candidates: [local, foreign], authority: true,
    authorizedTargets: [targetCompanyId], lockError: null as unknown };
  const statements: Array<{ sql: string; params: unknown[] }> = [], locks: Array<{ strength: string; options: unknown }> = [];
  const dialect = new PgDialect();
  const db = { select: vi.fn(() => {
    let table: unknown, joined = false, params: unknown[] = [];
    const query = { from(value: unknown) { table = value; return query; }, innerJoin() { joined = true; return query; },
      where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) { const statement = dialect.sqlToQuery(condition); statements.push(statement); params = statement.params; return query; },
      orderBy() { return query; }, for(strength: string, options: unknown) { locks.push({ strength, options }); return query; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        if (state.lockError) return Promise.reject(state.lockError).then(resolve, reject);
        const values = table === agentosAssignments ? joined
          ? state.candidates.filter(candidate => params.includes(candidate.companyId) && params.includes(candidate.employeeId)) : state.source
          : table === agentosEmployees ? state.employee : state.mandate;
        return Promise.resolve(values).then(resolve, reject);
      } };
    return query;
  }) } as unknown as Db;
  db.transaction = (async (work: (tx: Db) => Promise<unknown>) => work(db)) as unknown as Db["transaction"];
  const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId, agentId, runId: randomUUID(),
    onBehalfOfUserId: "owner", authorizingUserId: "external", keyScope: { kind: "standard" } };
  const input = { mandateId: mandate.id, revision: mandate.revision, offset: 0, limit: 3 };
  native.authorize.mockImplementation(async (_tx, originalActor, _sourceCompanyId, query) => {
    assertPortfolioMandateActor(mandate, originalActor, mandate.targetCompanyIds[0]!, query.revision);
    if (!state.authority || !state.authorizedTargets.length) throw forbidden("Current authority was revoked");
    return { row: mandate, actor: originalActor, targetCompanyIds: state.authorizedTargets };
  });
  return { companyId, agentId, targetCompanyId, targetAgentId, employee, source, mandate, local, foreign, state, db, actor,
    input, statements, locks, read: (patch = {}) => readDelegatedEmployeeAwareness(db, companyId, agentId, actor, employeeAwarenessQuerySchema.parse({ ...input, ...patch })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.work.mockImplementation(async (_company, _actor, query) => ({ observedAt: new Date().toISOString(),
    tasks: [{ id: query.agentId, title: "Visible task" }], projects: [], counts: { todo: 1 }, nextOffset: null, nextProjectOffset: null }));
  native.audit.mockResolvedValue({ publication: { marker: "committed" } });
});

describe("explicit same-employee delegated awareness", () => {
  it("keeps company labels and actual assignment agents separate under the original runtime identity", async () => {
    const f = fixture();
    const result = await f.read();
    expect(result).toMatchObject({ scope: "authorized_assignments", mandate: { id: f.mandate.id, revision: 3, readScope: "company_shared_only" } });
    expect(result.assignments.map(value => [value.company.id, value.agent.id, value.readScope]))
      .toEqual([[f.companyId, f.agentId, "current_company"], [f.targetCompanyId, f.targetAgentId, "company_shared_only"]]);
    expect(native.work.mock.calls.map(call => call[1])).toEqual([f.actor, f.actor]);
    expect(native.work.mock.calls[1]).toEqual([f.targetCompanyId, f.actor,
      { agentId: f.targetAgentId, offset: 0, projectOffset: 0, limit: 25, status: "all" }, { portfolioReadScope: "company_shared_only" }]);
    expect(f.locks.at(-1)).toEqual({ strength: "share", options: { noWait: true, of: [agentosAssignments, agents, expect.anything()] } });
    expect(native.audit.mock.calls[0][1]).toMatchObject({ companyId: f.companyId, actorType: "agent", actorId: f.agentId, runId: f.actor.runId });
    expect(native.publish).toHaveBeenCalledWith(f.companyId, [{ marker: "committed" }]);
  });

  it("filters other employees and companies before assignment pages or work reads", async () => {
    const f = fixture();
    f.state.candidates.push({ ...f.foreign, companyId: randomUUID(), companyName: "Hidden company" },
      { ...f.foreign, employeeId: randomUUID(), agentName: "Different employee" });
    const result = await f.read({ limit: 1, offset: 1 });
    expect(result.assignments).toHaveLength(1); expect(result.assignments[0].agent.id).toBe(f.targetAgentId);
    expect(result.nextOffset).toBeNull(); expect(JSON.stringify(result)).not.toMatch(/Hidden company|Different employee/);
    const sql = f.statements.at(-1)!;
    expect(sql.sql).toContain('"agentos_assignments"."employee_id" =');
    expect(sql.sql).toContain('"agentos_assignments"."portfolio_id" =');
    expect(sql.params).toEqual(expect.arrayContaining([f.employee.id, f.source.portfolioId, "active", f.companyId, f.targetCompanyId]));
    expect(native.work).toHaveBeenCalledTimes(1);
  });

  it("omits a mandate target that lost current authority before paging while retaining allowed assignments", async () => {
    const f = fixture(), deniedCompanyId = randomUUID();
    f.mandate.targetCompanyIds.unshift(deniedCompanyId);
    f.state.candidates.unshift({ ...f.foreign, companyId: deniedCompanyId, companyName: "Revoked company" });
    const result = await f.read({ limit: 1 });
    expect(result.assignments[0].company.id).toBe(f.companyId);
    expect(result.nextOffset).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Revoked company");
    expect(f.statements.at(-1)!.params).not.toContain(deniedCompanyId);
  });

  it.each(["retired", "missing_employee", "missing_mandate", "revoked", "expired", "changed_revision", "owner_ceiling"])("denies stale scope without work or publication (%s)", async condition => {
    const f = fixture();
    if (condition === "retired") f.state.source = [];
    if (condition === "missing_employee") f.state.employee = [];
    if (condition === "missing_mandate") f.state.mandate = [];
    if (condition === "revoked") f.mandate.revokedAt = new Date();
    if (condition === "expired") f.mandate.expiresAt = new Date(0);
    if (condition === "changed_revision") f.mandate.revision++;
    if (condition === "owner_ceiling") f.state.authority = false;
    await expect(f.read()).rejects.toMatchObject({ status: expect.any(Number) });
    expect(native.work).not.toHaveBeenCalled(); expect(native.publish).not.toHaveBeenCalled();
  });

  it("rejects forged or rebound continuations and binds valid work pages to the native agent", async () => {
    const f = fixture();
    await expect(f.read({ assignmentId: randomUUID(), assignmentRevision: 2 })).rejects.toMatchObject({ status: 404 });
    await expect(f.read({ assignmentId: f.foreign.assignmentId, assignmentRevision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(native.work).not.toHaveBeenCalled();
    const result = await f.read({ assignmentId: f.foreign.assignmentId, assignmentRevision: 2, workOffset: 25, projectOffset: 200 });
    expect(result.assignments).toHaveLength(1); expect(result.nextOffset).toBeNull();
    expect(native.work.mock.calls[0][2]).toEqual({ agentId: f.targetAgentId, offset: 25, projectOffset: 200, limit: 25, status: "all" });
  });

  it("rechecks expiry after projection and does not publish a failed audit", async () => {
    const f = fixture();
    native.work.mockImplementationOnce(async () => { f.mandate.expiresAt = new Date(0); return { tasks: [] }; });
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(native.publish).not.toHaveBeenCalled();
    f.mandate.expiresAt = null; native.audit.mockRejectedValueOnce(new Error("audit failed"));
    await expect(f.read()).rejects.toThrow("audit failed");
    expect(native.publish).not.toHaveBeenCalled();
  });

  it("preserves current actor/key admission and retries contended authority rather than bypassing it", async () => {
    const f = fixture();
    for (const actor of [{ ...f.actor, type: "board" }, { ...f.actor, agentId: randomUUID() }, { ...f.actor, companyId: randomUUID() },
      { ...f.actor, keyScope: { kind: "skill_test" } }]) {
      await expect(readDelegatedEmployeeAwareness(f.db, f.companyId, f.agentId, actor as AuthorizationActor, f.input)).rejects.toMatchObject({ status: 403 });
    }
    expect(f.db.select).not.toHaveBeenCalled();
    f.state.lockError = { code: "55P03" };
    await expect(f.read()).rejects.toMatchObject({ status: 409, details: { retryable: true } });
  });

  it("requires paired versioned scope and bounds continuation offsets", () => {
    const f = fixture();
    for (const patch of [{ revision: undefined }, { mandateId: undefined }, { assignmentId: f.foreign.assignmentId },
      { assignmentRevision: 2 }, { workOffset: 1 }, { projectOffset: 1 }, { limit: 6 },
      { assignmentId: f.foreign.assignmentId, assignmentRevision: 2, offset: 1 },
      { assignmentId: f.foreign.assignmentId, assignmentRevision: 2, workOffset: 100001 }]) {
      expect(employeeAwarenessQuerySchema.safeParse({ ...f.input, ...patch }).success).toBe(false);
    }
  });
});
