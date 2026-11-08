import { randomUUID } from "node:crypto";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, companyOperatingProfiles, environmentLeases, heartbeatRuns, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { operatingProfileService } from "../services/operating-profile.js";

const deps = vi.hoisted(() => ({ decide: vi.fn(), persist: vi.fn(), publish: vi.fn() }));
vi.mock("../services/access.js", () => ({ accessService: () => ({ decide: deps.decide }) }));
vi.mock("../services/activity-log.js", () => ({ persistActivity: deps.persist, publishActivity: deps.publish }));
vi.mock("../services/hot-restart.js", () => ({ readProcessStartedAt: () => { throw new Error("Unexpected process inspection"); } }));

// Real Drizzle projection/SQL with a controlled store. Transaction ordering is
// observable here; actual concurrent locks remain PostgreSQL integration work.
function fixture() {
  const companyId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
  const profile = { companyId, fridayAgentId: null as string | null, revision: 3 };
  const agent = { id: agentId, companyId, status: "idle", lifecycleState: "ready" };
  const run = { id: runId, companyId, agentId, status: "succeeded", runtimeMode: "native" } as Record<string, unknown>;
  const state = { runs: [] as Record<string, unknown>[], leases: [] as Record<string, unknown>[], owners: [] as Record<string, unknown>[] };
  const queries: string[] = [];
  const row = (table: Table, record: Record<string, unknown>) => Object.keys(getTableColumns(table)).map(key => {
    const value = record[key] ?? null;
    return value instanceof Date ? value.toISOString() : value;
  });
  const db = drizzle(async (query) => {
    queries.push(query);
    if (query.startsWith("select pg_advisory_xact_lock")) return { rows: [] };
    if (query.startsWith("insert into \"company_operating_profiles\"")) return { rows: [] };
    const tables: Array<[string, Table, Record<string, unknown>[]]> = [
      ["company_operating_profiles", companyOperatingProfiles, [profile]], ["agents", agents, [agent]],
      ["heartbeat_runs", heartbeatRuns, state.runs], ["environment_leases", environmentLeases, state.leases],
      ["native_run_finalizations", nativeRunFinalizations, state.owners],
      ["heartbeat_run_events", heartbeatRuns, []],
    ];
    const selected = tables.find(([name]) => name === query.match(/ from "([^"]+)"/)?.[1]);
    if (!selected) throw new Error(`Unexpected query: ${query}`);
    return { rows: selected[2].map(record => row(selected[1], record)) };
  }) as unknown as Db;
  // pg-proxy has no transaction implementation; do not claim lock/commit proof.
  db.transaction = (async callback => callback(db as never)) as Db["transaction"];
  const save = () => operatingProfileService(db).update(companyId,
    { type: "board", userId: "owner" }, { actorType: "user", actorId: "owner" },
    { expectedRevision: 3, fridayAgentId: agentId });
  return { companyId, agentId, run, profile, state, queries, save };
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.decide.mockResolvedValue({ allowed: true });
  deps.persist.mockResolvedValue({ publication: { action: "operating_profile.updated" } });
});

describe("Friday designation waits for native execution settlement", () => {
  it("saves an idle employee under the same configuration lock as provider entry", async () => {
    const f = fixture();
    expect(await f.save()).toMatchObject({ fridayAgentId: f.agentId, revision: 4 });
    const lock = f.queries.findIndex(query => query.includes("pg_advisory_xact_lock"));
    const execution = f.queries.findIndex(query => query.includes('from "heartbeat_runs"'));
    const write = f.queries.findIndex(query => query.startsWith("insert"));
    expect(lock).toBeLessThan(execution); expect(execution).toBeLessThan(write);
    expect(deps.persist).toHaveBeenCalledOnce(); expect(deps.publish).toHaveBeenCalledOnce();
  });
  it.each(["queued", "running"])("rejects %s work without changing role or cancelling it", async status => {
    const f = fixture(); f.state.runs.push({ ...f.run, status });
    await expect(f.save()).rejects.toMatchObject({ status: 409, details: { code: "friday_execution_pending" } });
    expect(f.queries.every(query => query.startsWith("select"))).toBe(true);
    expect(deps.persist).not.toHaveBeenCalled(); expect(deps.publish).not.toHaveBeenCalled();
  });
  it("does not mistake terminal status for stopped native execution", async () => {
    const f = fixture(); f.state.runs.push({ ...f.run, status: "cancelled", startedAt: new Date(), finishedAt: new Date() });
    await expect(f.save()).rejects.toMatchObject({ details: { code: "friday_execution_pending" } });
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it.each(["environment", "controller", "finalizer"])("retains an unresolved %s after terminal status", async kind => {
    const f = fixture(); f.state.runs.push({ ...f.run });
    if (kind === "environment") f.state.leases.push({ id: randomUUID(), companyId: f.companyId, heartbeatRunId: f.run.id, provider: "docker", status: "pending_cleanup" });
    if (kind === "controller") f.state.runs[0].controllerLeaseExpiresAt = new Date(Date.now() + 60_000);
    if (kind === "finalizer") f.state.owners.push({ runId: f.run.id, leaseOwner: "active-owner", leaseExpiresAt: new Date(Date.now() + 60_000) });
    await expect(f.save()).rejects.toMatchObject({ details: { code: "friday_execution_pending" } });
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it("consumes stopped evidence without taking over abandoned lifecycle cleanup", async () => {
    const f = fixture(); f.state.runs.push({ ...f.run, status: "cancelled" });
    f.state.owners.push({ runId: f.run.id, leaseOwner: "expired-owner", leaseExpiresAt: new Date(0) });
    expect(await f.save()).toMatchObject({ fridayAgentId: f.agentId });
    expect(f.queries.some(query => query.startsWith("update"))).toBe(false);
  });
  it("leaves an unchanged Friday's conversation and execution untouched", async () => {
    const f = fixture(); f.profile.fridayAgentId = f.agentId; f.state.runs.push({ ...f.run, status: "running" });
    expect(await f.save()).toMatchObject({ revision: 3 });
    expect(f.queries.some(query => query.includes('from "heartbeat_runs"'))).toBe(false);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it("keeps existing authority and stale-revision checks ahead of execution reads", async () => {
    const f = fixture(); deps.decide.mockResolvedValue({ allowed: false, explanation: "Denied" });
    await expect(f.save()).rejects.toMatchObject({ status: 403 }); expect(f.queries).toHaveLength(0);
    deps.decide.mockResolvedValue({ allowed: true }); f.profile.revision = 4;
    await expect(f.save()).rejects.toMatchObject({ status: 409 });
    expect(f.queries.some(query => query.includes('from "heartbeat_runs"'))).toBe(false);
  });
});
