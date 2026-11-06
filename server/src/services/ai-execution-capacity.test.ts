import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, companies, agents, heartbeatRuns, toolApplications, toolConnections, connectionGrants,
  aiExecutionCapacityClaims as claims, aiExecutionCapacityGroups as groups, agentosAdminEvents,
  type Db, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { aiExecutionCapacityPolicySchema, type AiConnectionAttribution } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { aiExecutionCapacityService, nextCapacityClaim, waitForAiCapacity } from "./ai-execution-capacity.js";

const now = new Date("2026-11-06T10:00:00Z");
const policy = { name: "Explicit test seat", provider: "openai" as const, maxConcurrent: 2, interactiveReserved: 1, interactivePriority: true, waitWarningMs: 60_000 };
const row = (runId: string, interactive = false, age = 0, active = false) => ({ runId, interactive,
  queuedAt: new Date(now.getTime() - age), warningAt: new Date(now.getTime() - age + 60_000),
  admittedAt: active ? now : null, releasedAt: null });

describe("capacity wait lifecycle", () => {
  it("subscribes before reading and handles a release arriving during the read", async () => {
    let wake = () => {};
    const unsubscribe = vi.fn();
    const attempt = vi.fn(async () => {
      if (attempt.mock.calls.length === 1) { wake(); return { admitted: false as const, warningAt: new Date(Date.now() + 60_000) }; }
      return { admitted: true as const, governed: true };
    });
    await expect(waitForAiCapacity({ signal: new AbortController().signal, attempt,
      subscribe: callback => { wake = callback; return unsubscribe; } })).resolves.toEqual({ governed: true });
    expect(attempt).toHaveBeenCalledTimes(2); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("does not finish cancellation while its admission transaction is unsettled", async () => {
    const controller = new AbortController(), unsubscribe = vi.fn();
    let commit!: (value: { admitted: true; governed: boolean }) => void;
    const transaction = new Promise<{ admitted: true; governed: boolean }>(resolve => { commit = resolve; });
    let finished = false;
    const waiting = waitForAiCapacity({ signal: controller.signal, attempt: () => transaction, subscribe: () => unsubscribe })
      .catch(error => { finished = true; throw error; });
    const rejection = expect(waiting).rejects.toThrow("Stopped");
    controller.abort(new Error("Stopped"));
    await Promise.resolve(); expect(finished).toBe(false);
    commit({ admitted: true, governed: true }); await rejection;
    expect(finished).toBe(true); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("uses one actual deadline and then remains quiet until a settlement event", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const warningAt = new Date(Date.now() + 1000);
      const attempt = vi.fn(async () => ({ admitted: false as const, warningAt }));
      const unsubscribe = vi.fn();
      const waiting = waitForAiCapacity({ signal: controller.signal, attempt, subscribe: () => unsubscribe });
      const rejection = expect(waiting).rejects.toThrow("Stopped");
      await vi.advanceTimersByTimeAsync(1000); expect(attempt).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3600_000); expect(attempt).toHaveBeenCalledTimes(2);
      controller.abort(new Error("Stopped")); await rejection;
      expect(vi.getTimerCount()).toBe(0); expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("fails admission without leaving a timer or listener on database errors", async () => {
    const unsubscribe = vi.fn();
    await expect(waitForAiCapacity({ signal: new AbortController().signal, attempt: async () => { throw new Error("DB unavailable"); }, subscribe: () => unsubscribe })).rejects.toThrow("DB unavailable");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("shared capacity ordering", () => {
  it("requires an explicit policy and keeps background work possible", () => {
    expect(aiExecutionCapacityPolicySchema.safeParse({ name: "Pro", provider: "openai" }).success).toBe(false);
    expect(aiExecutionCapacityPolicySchema.safeParse({ ...policy, interactiveReserved: 2 }).success).toBe(false);
    expect(aiExecutionCapacityPolicySchema.safeParse(policy).success).toBe(true);
  });
  it("counts active work across agents, companies and models without multiplying slots", () => {
    expect(nextCapacityClaim(policy, [row("active-background", false, 0, true), row("active-chat", true, 0, true), row("waiting-chat", true)], now)).toBeNull();
  });
  it("retains a conversation slot while background work is running", () => {
    expect(nextCapacityClaim(policy, [row("active-background", false, 0, true), row("older-background", false, 120_000), row("chat", true)], now)).toBe("chat");
  });
  it("lets older waiting work precede newer conversations once the threshold passes", () => {
    expect(nextCapacityClaim({ ...policy, interactiveReserved: 0 }, [row("old-background", false, 120_000), row("chat", true)], now)).toBe("old-background");
  });
  it("can prioritize conversation without preempting a running job", () => {
    const serial = { ...policy, maxConcurrent: 1, interactiveReserved: 0 };
    expect(nextCapacityClaim(serial, [row("background", false, 1000), row("chat", true)], now)).toBe("chat");
    expect(nextCapacityClaim(serial, [row("background", false, 1000, true), row("chat", true)], now)).toBeNull();
  });
  it("uses FIFO and stable ties when conversation priority is disabled", () => {
    expect(nextCapacityClaim({ ...policy, interactivePriority: false }, [row("b", true), row("a")], now)).toBe("a");
  });
  it("ignores released history", () => {
    expect(nextCapacityClaim(policy, [{ ...row("ended", false, 0, true), releasedAt: now }, row("background")], now)).toBe("background");
  });
  it("does not read the database or create timers when configured but idle", () => {
    const db = new Proxy({}, { get() { throw new Error("Idle database access"); } }) as Db;
    expect(aiExecutionCapacityService(db)).toBeDefined();
  });
});

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("native capacity database contract", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: Db;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("agentos-capacity"); db = createDb(database.connectionString); }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });
  beforeEach(async () => { await db.execute(sql`truncate ${groups}, ${companies} restart identity cascade`); });
  async function fixture() {
    const inputs = [];
    for (const name of ["First", "Second"]) {
      const [company] = await db.insert(companies).values({ name, issuePrefix: name }).returning();
      const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Worker" }).returning();
      const [application] = await db.insert(toolApplications).values({ companyId: company.id, name: "Model", type: "mcp_http" }).returning();
      const [connection] = await db.insert(toolConnections).values({ companyId: company.id, applicationId: application.id, name: "Shared seat", uid: randomUUID(), connectionPurpose: "ai", transport: "runtime_auth", status: "active", enabled: true, config: { ai: { provider: "openai", method: "subscription" } } }).returning();
      const [grant] = await db.insert(connectionGrants).values({ companyId: company.id, connectionId: connection.id, kind: "organization" }).returning();
      const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, status: "running", startedAt: new Date() }).returning();
      const attribution: AiConnectionAttribution = { connectionId: connection.id, grantId: grant.id, provider: "openai", method: "subscription", mode: "shared", responsibleUserId: "owner" };
      inputs.push({ runId: run.id, companyId: company.id, attribution, interactive: false });
    }
    const scope = { userId: "owner", local: true, companyIds: inputs.map(input => input.companyId) };
    const bindingInputs = inputs.map(input => ({ companyId: input.companyId, connectionId: input.attribution.connectionId, grantId: input.attribution.grantId }));
    const service = aiExecutionCapacityService(db);
    const group = await service.save({ policy: { ...policy, maxConcurrent: 1, interactiveReserved: 0 }, bindings: bindingInputs }, scope);
    for (const input of inputs) await db.update(heartbeatRuns).set({ contextSnapshot: { aiConnection: input.attribution } }).where(eq(heartbeatRuns.id, input.runId));
    return { service, group, inputs, scope, bindingInputs };
  }
  it("atomically admits only one cross-company contender and retains uncertain holds", async () => {
    const f = await fixture();
    const results = await Promise.all(f.inputs.map(input => f.service.tryAcquire(input)));
    expect(results.filter(result => result.admitted)).toHaveLength(1);
    const admitted = f.inputs[results.findIndex(result => result.admitted)], waiting = f.inputs[results.findIndex(result => !result.admitted)];
    expect(await f.service.releaseSettled(admitted.runId, admitted.companyId, false)).toBe(false);
    expect((await f.service.tryAcquire(waiting)).admitted).toBe(false);
    await f.service.releaseSettled(admitted.runId, admitted.companyId, true);
    expect((await f.service.tryAcquire(waiting)).admitted).toBe(true);
    await expect(f.service.tryAcquire(admitted)).rejects.toThrow("cannot be reused");
  });
  it("rejects foreign-company group edits and leaves audit/configuration unchanged", async () => {
    const f = await fixture();
    const before = await db.select().from(agentosAdminEvents);
    await expect(f.service.save({ id: f.group.id, expectedRevision: f.group.revision, policy, bindings: [f.bindingInputs[0]] }, { ...f.scope, companyIds: [f.inputs[0].companyId] })).rejects.toThrow("every bound company");
    expect(await db.select().from(agentosAdminEvents)).toEqual(before);
    expect((await f.service.overview({ ...f.scope, companyIds: [f.inputs[0].companyId] })).groups).toEqual([]);
  });
  it("rejects revoked connections at admission and never spills into paid execution", async () => {
    const f = await fixture(), input = f.inputs[0];
    await db.update(connectionGrants).set({ status: "revoked" }).where(eq(connectionGrants.id, input.attribution.grantId));
    await expect(f.service.tryAcquire(input)).rejects.toThrow("no longer active");
    expect(await db.select().from(claims)).toEqual([]);
  });
  it("keeps a delayed request durable without cancelling or replaying it", async () => {
    const f = await fixture();
    await f.service.tryAcquire(f.inputs[0]); await f.service.tryAcquire(f.inputs[1]);
    await db.update(claims).set({ warningAt: new Date(Date.now() - 1000) }).where(eq(claims.runId, f.inputs[1].runId));
    expect((await f.service.tryAcquire(f.inputs[1])).admitted).toBe(false);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.inputs[1].runId));
    expect(run.status).toBe("running"); expect(run.retryOfRunId).toBeNull();
    const [claim] = await db.select().from(claims).where(eq(claims.runId, run.id));
    expect(claim.warnedAt).not.toBeNull(); expect(claim.releasedAt).toBeNull();
  });
  it("reconstructs cancelled waiters after restart without freeing an uncertain admitted provider", async () => {
    const f = await fixture();
    await f.service.tryAcquire(f.inputs[0]); await f.service.tryAcquire(f.inputs[1]);
    await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(inArrayRunIds(f.inputs.map(input => input.runId)));
    await aiExecutionCapacityService(db).reconcile();
    const saved = await db.select().from(claims);
    expect(saved.find(row => row.runId === f.inputs[0].runId)?.releasedAt).toBeNull();
    expect(saved.find(row => row.runId === f.inputs[1].runId)?.releasedAt).not.toBeNull();
  });
  it("cannot regroup live reservations or save with a stale revision", async () => {
    const f = await fixture();
    await f.service.tryAcquire(f.inputs[0]);
    await expect(f.service.save({ id: f.group.id, expectedRevision: f.group.revision, policy, bindings: [f.bindingInputs[0]] }, f.scope)).rejects.toThrow("settle");
    await expect(f.service.save({ id: f.group.id, expectedRevision: 99, policy, bindings: f.bindingInputs }, f.scope)).rejects.toThrow("reload");
  });
  it("rejects binding an already running unbound execution and allows it only after native settlement", async () => {
    const f = await fixture();
    // Remove fixture bindings before these prepared executions enter admission.
    await db.execute(sql`delete from ai_execution_capacity_bindings`);
    const input = f.inputs[0];
    expect(await f.service.tryAcquire(input)).toEqual({ admitted: true, governed: false });
    const save = () => f.service.save({ policy, bindings: [f.bindingInputs[0]] }, f.scope);
    await expect(save()).rejects.toThrow("Wait for existing work");
    await db.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(heartbeatRuns.id, input.runId));
    await expect(save()).rejects.toThrow("native cleanup");
    expect(await f.service.releaseSettled(input.runId, input.companyId, false)).toBe(false);
    await expect(save()).rejects.toThrow("native cleanup");
    await f.service.releaseSettled(input.runId, input.companyId, true);
    await expect(save()).resolves.toMatchObject({ revision: 1 });
  });
});

function inArrayRunIds(ids: string[]) { return sql`${heartbeatRuns.id} in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`; }
