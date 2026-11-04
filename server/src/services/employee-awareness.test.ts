import { randomUUID } from "node:crypto";
import { agents, type Db } from "@paperclipai/db";
import { employeeAwarenessQuerySchema } from "@paperclipai/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationActor } from "./authorization.js";
import { employeeAwarenessService } from "./employee-awareness.js";

const native = vi.hoisted(() => ({ company: vi.fn(), agent: vi.fn(), work: vi.fn() }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decideReads: native.company, decide: native.agent }) }));
vi.mock("./friday-awareness.js", () => ({ fridayAwarenessService: () => ({ work: native.work }) }));

function row(companyName = "Company") {
  return { assignmentId: randomUUID(), companyId: randomUUID(), companyName, agentId: randomUUID(), agentName: "Employee",
    agentStatus: "idle", department: "Engineering" };
}
function fixture() {
  const first = row("First"), second = row("Second"), hidden = row("Hidden company");
  const source = { ...first, portfolioId: randomUUID(), employeeId: randomUUID(), employeeName: "Shared employee", specialty: "Engineering" };
  const state = { source: [source], assignments: [first, hidden, second] };
  const predicates: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const select = vi.fn(() => {
    let sourceQuery = false;
    const query = { from(table: unknown) { sourceQuery = table === agents; return query; },
      innerJoin() { return query; }, leftJoin() { return query; },
      where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) { predicates.push(dialect.sqlToQuery(condition)); return query; },
      limit() { return query; }, orderBy() { return query; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(sourceQuery ? state.source : state.assignments).then(resolve); },
    };
    return query;
  });
  const db = { select } as unknown as Db;
  const actor: AuthorizationActor = { type: "board", source: "session", userId: "reader", companyIds: [first.companyId, second.companyId, hidden.companyId] };
  const query = employeeAwarenessQuerySchema.parse({});
  return { first, second, hidden, source, state, db, select, predicates, actor, query, read: () => employeeAwarenessService(db).read(first.companyId, first.agentId, actor, query) };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.company.mockResolvedValue([{ allowed: true }]);
  native.agent.mockResolvedValue({ allowed: true });
  native.work.mockImplementation(async (_companyId, _actor, query) => ({ observedAt: new Date().toISOString(), tasks: [{ id: query.agentId, title: "Current task" }], nextOffset: 25, nextProjectOffset: null }));
});

describe("employee awareness under the existing native authority", () => {
  it("filters denied companies and agents before pagination, counts or work reads", async () => {
    const f = fixture();
    native.company.mockImplementation(async (_actor, [resource]) => [{ allowed: resource.companyId !== f.hidden.companyId }]);
    const service = employeeAwarenessService(f.db);
    const first = await service.read(f.first.companyId, f.first.agentId, f.actor, { offset: 0, limit: 1 });
    expect(first).toMatchObject({ scope: "authorized_companies", employee: { id: f.source.employeeId }, nextOffset: 1 });
    expect(first.assignments.map(entry => entry.company.id)).toEqual([f.first.companyId]);
    const second = await service.read(f.first.companyId, f.first.agentId, f.actor, { offset: 1, limit: 1 });
    expect(second.assignments.map(entry => entry.company.id)).toEqual([f.second.companyId]);
    expect(second.nextOffset).toBeNull();
    expect(JSON.stringify([first, second])).not.toContain(f.hidden.companyId);
    expect(JSON.stringify([first, second])).not.toContain("Hidden company");
    expect(native.work.mock.calls.map(call => call[0])).toEqual([f.first.companyId, f.second.companyId]);
    native.agent.mockImplementation(async ({ resource }) => ({ allowed: resource.agentId !== f.second.agentId }));
    expect((await f.read()).assignments.map(entry => entry.company.id)).toEqual([f.first.companyId]);
  });

  it("uses only the actual agent's current assignment, even with an owner responsible for other companies", async () => {
    const f = fixture();
    const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", agentId: f.first.agentId, companyId: f.first.companyId,
      runId: randomUUID(), keyScope: { kind: "standard" }, onBehalfOfUserId: "owner", authorizingUserId: "external-authorizer", companyIds: f.actor.companyIds };
    const result = await employeeAwarenessService(f.db).read(f.first.companyId, f.first.agentId, actor, f.query);
    expect(result.scope).toBe("current_company");
    expect(result.assignments.map(entry => entry.company.id)).toEqual([f.first.companyId]);
    expect(result.nextOffset).toBeNull();
    expect(native.work).toHaveBeenCalledOnce();
    expect(native.work.mock.calls[0][1]).toMatchObject(actor);
    for (const [checkedActor, [resource]] of native.company.mock.calls) {
      expect(checkedActor).toMatchObject(actor);
      expect(resource.companyId).toBe(f.first.companyId);
    }
    const predicate = f.predicates[1];
    expect(predicate.sql).toContain('"agentos_assignments"."company_id" in');
    expect(predicate.params).toContain(f.first.companyId);
    expect(predicate.params).not.toContain(f.second.companyId);
    expect(predicate.params).toContain("active");
  });

  it("honors a board token's admitted companies even when native membership exists elsewhere", async () => {
    const f = fixture();
    f.actor.companyIds = [f.first.companyId];
    const result = await f.read();
    expect(result.assignments.map(entry => entry.company.id)).toEqual([f.first.companyId]);
    expect(native.company.mock.calls.every(([, [resource]]) => resource.companyId === f.first.companyId)).toBe(true);
    const consentedAdmin = { ...f.actor, source: "mcp_oauth" as const, isInstanceAdmin: true };
    const restricted = await employeeAwarenessService(f.db).read(f.first.companyId, f.first.agentId, consentedAdmin, f.query);
    expect(restricted.assignments).toHaveLength(1);
  });

  it("refreshes authority and evidence on every read while retaining responsible-user and run identity", async () => {
    const f = fixture();
    const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.first.companyId, agentId: f.first.agentId,
      runId: randomUUID(), onBehalfOfUserId: "owner", authorizingUserId: "authorizer",
      onBehalfOfMemberships: [{ companyId: f.first.companyId, status: "active" }], __responsibleUserSnapshotMemo: new Map() };
    let currentTitle = "Before update";
    native.work.mockImplementation(async () => ({ tasks: [{ title: currentTitle }] }));
    const service = employeeAwarenessService(f.db);
    expect((await service.read(f.first.companyId, f.first.agentId, actor, f.query)).assignments[0].work.tasks[0].title).toBe("Before update");
    currentTitle = "Updated evidence";
    expect((await service.read(f.first.companyId, f.first.agentId, actor, f.query)).assignments[0].work.tasks[0].title).toBe("Updated evidence");
    expect(native.work.mock.calls[0][1]).toMatchObject({ onBehalfOfUserId: "owner", authorizingUserId: "authorizer", runId: actor.runId });
    expect(native.work.mock.calls[0][1].onBehalfOfMemberships).toBeUndefined();
    expect(native.work.mock.calls[0][1].__responsibleUserSnapshotMemo).toBeUndefined();
    expect(actor.onBehalfOfMemberships).toHaveLength(1);
    native.company.mockResolvedValue([{ allowed: false }]);
    await expect(service.read(f.first.companyId, f.first.agentId, actor, f.query)).rejects.toMatchObject({ status: 404 });
    expect(native.work).toHaveBeenCalledTimes(2);
  });

  it("rejects foreign, peer, anonymous and restricted agent requests before database reads", async () => {
    const f = fixture(), service = employeeAwarenessService(f.db);
    const agent: AuthorizationActor = { type: "agent", agentId: f.first.agentId, companyId: f.first.companyId };
    for (const [companyId, agentId, actor] of [
      [f.second.companyId, f.second.agentId, agent], [f.first.companyId, f.second.agentId, agent],
      [f.first.companyId, f.first.agentId, { ...agent, keyScope: { kind: "skill_test" } }],
      [f.first.companyId, f.first.agentId, { type: "none" }],
    ] as Array<[string, string, AuthorizationActor]>) {
      await expect(service.read(companyId, agentId, actor, f.query)).rejects.toMatchObject({ status: 403 });
    }
    expect(f.select).not.toHaveBeenCalled();
    expect(native.work).not.toHaveBeenCalled();
  });

  it("keeps an unbound native agent useful without suggesting nonexistent shared assignments", async () => {
    const f = fixture();
    Object.assign(f.source, { employeeId: null, employeeName: null, specialty: null, portfolioId: null, assignmentId: null, department: null });
    const result = await f.read();
    expect(result.employee).toBeNull();
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({ assignmentId: null, company: { id: f.first.companyId } });
    expect(result.nextOffset).toBeNull();
    expect(f.select).toHaveBeenCalledOnce();
  });

  it("bounds native authorization concurrency and full evidence pages", async () => {
    const f = fixture();
    f.state.assignments = Array.from({ length: 30 }, (_, index) => row(`Company ${index}`));
    f.actor.companyIds!.push(...f.state.assignments.map(entry => entry.companyId));
    let active = 0, peak = 0;
    native.company.mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 0));
      active--; return [{ allowed: true }];
    });
    const result = await employeeAwarenessService(f.db).read(f.first.companyId, f.first.agentId, f.actor, { offset: 0, limit: 5 });
    expect(result.assignments).toHaveLength(5); expect(result.nextOffset).toBe(5);
    expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(8);
    expect(native.work).toHaveBeenCalledTimes(5);
    for (const [, actor, query] of native.work.mock.calls) {
      expect(actor.userId).toBe(f.actor.userId);
      expect(query).toMatchObject({ limit: 25, status: "all", offset: 0, projectOffset: 0 });
    }
  });

  it("rejects arbitrary scope fields and oversized pages", async () => {
    const f = fixture();
    for (const input of [{ limit: 6 }, { offset: -1 }, { companyId: f.second.companyId }, { agentId: f.second.agentId }, { offset: "all" }]) {
      expect(employeeAwarenessQuerySchema.safeParse(input).success).toBe(false);
    }
    await expect(employeeAwarenessService(f.db).read(f.first.companyId, f.first.agentId, f.actor, { offset: 0, limit: 6 })).rejects.toThrow();
    expect(f.select).not.toHaveBeenCalled();
  });
});
