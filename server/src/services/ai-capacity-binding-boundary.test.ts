import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiExecutionCapacityService, assertAiCapacityBindingsSettled, currentAiCapacityScope } from "./ai-execution-capacity.js";

const native = vi.hoisted(() => ({ cleanup: vi.fn(), stopped: vi.fn(), remote: vi.fn(), event: vi.fn(), bootstrap: vi.fn() }));
vi.mock("./execution-blocker.js", async original => ({ ...await original<typeof import("./execution-blocker.js")>(), hasPendingRunCleanup: native.cleanup }));
vi.mock("./native-local-process-stop.js", async original => ({ ...await original<typeof import("./native-local-process-stop.js")>(), hasNativeLocalProcessStop: native.stopped }));
vi.mock("./remote-execution-termination.js", async original => ({ ...await original<typeof import("./remote-execution-termination.js")>(), remoteExecutionHasStopped: native.remote }));
vi.mock("./heartbeat-run-events.js", async original => ({ ...await original<typeof import("./heartbeat-run-events.js")>(), appendHeartbeatRunEvent: native.event }));
vi.mock("./cancelled-native-startup.js", async original => ({ ...await original<typeof import("./cancelled-native-startup.js")>(), isCancelledNativeStartup: native.bootstrap }));

const companyId = "a745a87a-177b-4407-a791-ad41f01bb6f4", runId = "925aa566-7e86-4bc5-8c50-caf3d96e3f8a";
const binding = { companyId, connectionId: "cd9a6a35-c3e5-436f-b2af-47d214b84cf5", grantId: "2a161510-d1cf-46e3-b189-48121d0f712a" };
const attribution = { ...binding, method: "subscription" as const, provider: "openai" as const, mode: "shared" as const, responsibleUserId: "owner" };
const scope = { userId: "owner", local: false, companyIds: [companyId] };
const policy = { name: "Explicit seat", provider: "openai" as const, maxConcurrent: 1, interactiveReserved: 0, interactivePriority: false, waitWarningMs: 60_000 };
type Query = { text: string; params: unknown[] };
function fixture(options: { status?: string; settled?: boolean; claimReleased?: boolean; admin?: boolean; membership?: boolean; role?: string; revokeAtFence?: boolean; many?: boolean } = {}) {
  const queries: Query[] = [];
  let admin = options.admin ?? true;
  const run = { id: runId, companyId, agentId: "agent", status: options.status ?? "running", runtimeMode: "native", contextSnapshot: { aiConnection: attribution, aiCapacityAdmission: { settled: true } } };
  const db = drizzle(async (text, params) => {
    queries.push({ text, params });
    if (text.includes("pg_advisory_xact_lock")) { if (options.revokeAtFence) admin = false; return { rows: [] }; }
    if (text.includes('from "auth_user"') || text.includes('from "user"')) return { rows: [["owner"]] };
    if (text.includes('from "instance_user_roles"')) return { rows: text.includes(" join ") && !admin ? [] : [["admin-role"]] };
    if (text.includes('from "company_memberships"')) return { rows: options.membership === false ? [] : [[companyId, options.role ?? "member"]] };
    if (text.includes('from "heartbeat_runs"')) {
      const row = text.startsWith('select "id", "company_id", "status", "runtime_mode"')
        ? [run.id, run.companyId, run.status, run.runtimeMode]
        : text.startsWith('select "agent_id", "status", "context_snapshot"') ? [run.agentId, run.status, run.contextSnapshot]
        : Object.keys(getTableColumns(heartbeatRuns)).map(key => run[key as keyof typeof run] ?? null);
      return { rows: options.many ? Array.from({ length: 101 }, () => row) : [row] };
    }
    if (text.includes('from "ai_execution_capacity_claims"')) return { rows: options.claimReleased ? [[new Date().toISOString()]] : [] };
    if (text.includes('from "ai_execution_capacity_bindings"')) return { rows: [] };
    if (text.includes('from "native_run_finalizations"')) return { rows: [] };
    if (text.includes('from "heartbeat_run_events"')) return { rows: options.settled ? [["ai.capacity.unbound_settled"]] : [] };
    throw new Error(`Unexpected query: ${text}`);
  }) as unknown as Db;
  // Controlled callback: verifies actual service SQL order/contracts, not
  // PostgreSQL locking or transaction isolation. Real DB cases stay separate.
  db.transaction = ((work: (tx: Db) => Promise<unknown>) => work(db)) as unknown as Db["transaction"];
  return { db, queries };
}
beforeEach(() => { vi.clearAllMocks(); native.cleanup.mockResolvedValue(false); native.stopped.mockResolvedValue(false); native.remote.mockResolvedValue(false); native.bootstrap.mockResolvedValue(false); });

describe("capacity configuration authority", () => {
  it("refreshes native administrator authority after waiting at the configuration fence", async () => {
    const { db, queries } = fixture({ revokeAtFence: true });
    await expect(aiExecutionCapacityService(db).save({ policy, bindings: [] }, scope)).rejects.toThrow("administrator");
    expect(queries[0].text).toContain("pg_advisory_xact_lock(");
    const authority = queries.findIndex(query => query.text.includes('from "instance_user_roles"') && query.text.includes(" join "));
    expect(authority).toBeGreaterThan(0);
    expect(queries[authority].text).toContain('"approval_status"');
    expect(queries[authority].params).toContain("approved");
    expect(queries.some(query => query.text.startsWith("insert ") || query.text.startsWith("update "))).toBe(false);
  });
  it.each([{ membership: false }, { role: "viewer" }])("rejects lost or read-only membership after locks: %j", async options => {
    const { db, queries } = fixture(options);
    await expect(currentAiCapacityScope(db, scope, [companyId])).rejects.toThrow("every bound company");
    expect(queries.find(query => query.text.includes('from "company_memberships"'))?.text).toContain("for share nowait");
  });
  it("retains the request company ceiling despite a current wider membership", async () => {
    const { db } = fixture();
    await expect(currentAiCapacityScope(db, { ...scope, companyIds: [] }, [companyId])).rejects.toThrow("every bound company");
  });
});

describe("binding edits and existing native work", () => {
  it("rejects active unbound work even if caller context claims settlement", async () => {
    const { db, queries } = fixture();
    await expect(assertAiCapacityBindingsSettled(db, [binding])).rejects.toThrow("Wait for existing work");
    expect(queries[0].params).toEqual(expect.arrayContaining([companyId, binding.grantId, binding.connectionId]));
    expect(queries[0].params.at(-1)).toBe(101);
  });
  it("does not infer release from terminal status, but accepts authoritative cleanup evidence", async () => {
    const { db } = fixture({ status: "failed" });
    await expect(assertAiCapacityBindingsSettled(db, [binding])).rejects.toThrow("native cleanup");
    native.stopped.mockResolvedValue(true);
    await expect(assertAiCapacityBindingsSettled(db, [binding])).resolves.toBeUndefined();
    native.cleanup.mockResolvedValue(true);
    await expect(assertAiCapacityBindingsSettled(db, [binding])).rejects.toThrow("native cleanup");
  });
  it.each([{ settled: true }, { claimReleased: true }])("accepts the native completed admission receipt: %j", async proof => {
    await expect(assertAiCapacityBindingsSettled(fixture({ status: "succeeded", ...proof }).db, [binding])).resolves.toBeUndefined();
    expect(native.cleanup).not.toHaveBeenCalled();
  });
  it("fences unbound admission and locks the exact attributed run before recording its receipt", async () => {
    const { db, queries } = fixture();
    await expect(aiExecutionCapacityService(db).tryAcquire({ companyId, runId, attribution, interactive: false })).resolves.toEqual({ admitted: true, governed: false });
    expect(queries[0].text).toContain("pg_advisory_xact_lock_shared(");
    expect(queries[1].text).toContain('from "heartbeat_runs"');
    expect(queries[1].text).toContain("for update");
    expect(native.event).toHaveBeenCalledWith(db, expect.objectContaining({ companyId, runId, eventType: "ai.capacity.unbound_admitted" }));
  });
  it("bounds unresolved historical proof checks instead of holding admission behind an unlimited scan", async () => {
    await expect(assertAiCapacityBindingsSettled(fixture({ many: true }).db, [binding])).rejects.toThrow("More than 100 executions");
    expect(native.cleanup).not.toHaveBeenCalled();
    expect(native.stopped).not.toHaveBeenCalled();
  });
  it("lets the verified cleanup owner settle early failures even before unbound admission", async () => {
    const { db } = fixture({ status: "failed" });
    await expect(aiExecutionCapacityService(db).releaseSettled(runId, companyId, false)).resolves.toBe(false);
    expect(native.event).not.toHaveBeenCalled();
    await expect(aiExecutionCapacityService(db).releaseSettled(runId, companyId, true)).resolves.toBe(true);
    expect(native.event).toHaveBeenCalledWith(db, expect.objectContaining({ companyId, runId, eventType: "ai.capacity.unbound_settled" }));
  });
  it("uses the native cancelled-startup owner for historical never-dispatched work under locks", async () => {
    const { db, queries } = fixture({ status: "cancelled" });
    await expect(assertAiCapacityBindingsSettled(db, [binding])).rejects.toThrow("native cleanup");
    native.bootstrap.mockResolvedValue(true);
    await expect(assertAiCapacityBindingsSettled(db, [binding])).resolves.toBeUndefined();
    expect(queries.find(query => query.text.includes('from "native_run_finalizations"'))?.text).toContain("for share nowait");
    expect(native.bootstrap).toHaveBeenCalledWith(db, expect.objectContaining({ id: runId, status: "cancelled" }), undefined);
  });
});
