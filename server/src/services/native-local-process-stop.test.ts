import os from "node:os";
import { drizzle } from "drizzle-orm/pg-proxy";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROCESS_IDENTITY_RECORDED,
  PROCESS_START_REQUESTED,
  recordedLocalExecutionStopped,
  retainedNativeLocalExecutionStopped,
} from "./native-local-process-stop.js";

type Run = typeof heartbeatRuns.$inferSelect;
type Event = {
  companyId: string; runId: string; eventType: string; sourceEventId: string | null;
  payload: Record<string, unknown>; seq: number;
};

function fixture(overrides: Partial<Run> = {}) {
  const run = {
    id: "retained-run", companyId: "local-company", runtimeMode: "native", status: "succeeded",
    processPid: 48321, processGroupId: 48321, processStartedAt: new Date("2026-11-05T09:54:11Z"),
    finishedAt: new Date("2026-11-05T09:55:00Z"), controllerBootId: null, controllerLeaseExpiresAt: null,
    runnerProfileJson: { sessionCheckpoint: { sessionId: "retained-session", providerSessionId: "retained-provider-session" } },
    ...overrides,
  } as Run;
  const identity: Event = {
    companyId: run.companyId, runId: run.id, eventType: PROCESS_IDENTITY_RECORDED,
    sourceEventId: null, seq: 1,
    payload: { targetKind: "local", hostname: "control-host", processPid: 48321, processGroupId: 48321,
      processStartedAt: "2026-11-05T09:54:11.000Z" },
  };
  const events = [identity];
  const leases = [{ companyId: run.companyId, heartbeatRunId: run.id, provider: "local" }];
  const queries: string[] = [];
  // Execute the generated SQL's filters/order against controlled observations.
  // No lifecycle writes are supported, so accidental mutation fails the test.
  function equal(text: string, params: unknown[], field: string, value: unknown) {
    const match = text.match(new RegExp(`"${field}" = \\$(\\d+)`));
    return !match || params[Number(match[1]) - 1] === value;
  }
  const db = drizzle(async (text, params) => {
    queries.push(text);
    if (text.includes('from "environment_leases"')) {
      return { rows: leases.filter(row => equal(text, params, "company_id", row.companyId) &&
        equal(text, params, "heartbeat_run_id", row.heartbeatRunId)).map(row => [row.provider]) };
    }
    if (text.includes('from "heartbeat_run_events"')) {
      const kinds = text.match(/"event_type" in \(([^)]+)\)/)?.[1].match(/\$(\d+)/g)
        ?.map(parameter => params[Number(parameter.slice(1)) - 1]);
      let rows = events.filter(row => equal(text, params, "company_id", row.companyId) &&
        equal(text, params, "run_id", row.runId) && equal(text, params, "event_type", row.eventType) &&
        (!text.includes('"source_event_id" is null') || row.sourceEventId === null) &&
        (!kinds || kinds.includes(row.eventType)));
      if (text.includes('"seq" desc')) rows = rows.toSorted((a, b) => b.seq - a.seq);
      if (text.includes(" limit ")) rows = rows.slice(0, 1);
      return { rows: rows.map(row => text.startsWith('select "event_type", "payload"')
        ? [row.eventType, row.payload] : [row.payload]) };
    }
    throw new Error(`Unexpected retained-process query: ${text}`);
  }) as unknown as Db;
  return { run, identity, events, leases, queries, db };
}

beforeEach(() => {
  vi.spyOn(os, "hostname").mockReturnValue("control-host");
  vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("No such process"), { code: "ESRCH" }); });
});
afterEach(() => vi.restoreAllMocks());

describe("retained successful native process observation", () => {
  it("accepts exact stopped local identity without changing reusable session state", async () => {
    const f = fixture();
    const before = structuredClone(f.run);
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(true);
    expect(process.kill).toHaveBeenNthCalledWith(1, 48321, 0);
    expect(process.kill).toHaveBeenNthCalledWith(2, -48321, 0);
    expect(f.run).toEqual(before);
    expect(f.queries.every(query => query.startsWith("select "))).toBe(true);
  });

  it.each([
    ["live process", 48321, null], ["live process group", -48321, null],
    ["process permission denied", 48321, "EPERM"], ["group permission denied", -48321, "EPERM"],
  ] as const)("rejects %s even after a successful result", async (_label, blockedPid, code) => {
    const f = fixture();
    vi.mocked(process.kill).mockImplementation(pid => {
      if (pid === blockedPid && code === null) return true;
      throw Object.assign(new Error("Liveness observation"), { code: pid === blockedPid ? code : "ESRCH" });
    });
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
  });

  it.each([
    ["other host", { hostname: "other-host" }],
    ["different birth", { processStartedAt: "2026-11-05T09:54:10.000Z" }],
    ["different process", { processPid: 48320 }],
    ["different group", { processGroupId: 48320 }],
    ["remote target", { targetKind: "remote" }],
  ] as const)("rejects identity from %s before probing the host", async (_label, payload) => {
    const f = fixture();
    Object.assign(f.identity.payload, payload);
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("a newer start request invalidates the earlier recorded identity", async () => {
    const f = fixture();
    f.events.push({ ...f.identity, eventType: PROCESS_START_REQUESTED, payload: {}, seq: 2 });
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("requires the newest launch identity rather than an older matching launch", async () => {
    const f = fixture();
    f.events.push({ ...f.identity, payload: { ...f.identity.payload, processPid: 48320 }, seq: 2 });
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it.each(["company", "run", "provider-authored"])("does not accept a %s event as authority", async scope => {
    const f = fixture();
    if (scope === "company") f.identity.companyId = "other-company";
    if (scope === "run") f.identity.runId = "other-run";
    if (scope === "provider-authored") f.identity.sourceEventId = "provider-event";
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("never inspects a remote lease's PID on the control host", async () => {
    const f = fixture();
    f.leases.push({ ...f.leases[0], provider: "sandbox" });
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("ignores unrelated remote leases and accepts an expired controller lease", async () => {
    const f = fixture({ controllerBootId: "previous-controller", controllerLeaseExpiresAt: new Date(0) });
    f.leases.push({ ...f.leases[0], provider: "sandbox", companyId: "other-company" });
    f.leases.push({ ...f.leases[0], provider: "sandbox", heartbeatRunId: "other-run" });
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(true);
  });

  it.each([
    ["unfinished", { finishedAt: null }], ["legacy", { runtimeMode: "legacy" }],
    ["running", { status: "running" }], ["failed", { status: "failed" }],
    ["active controller", { controllerLeaseExpiresAt: new Date(Date.now() + 60_000) }],
    ["workspace owner", { runnerProfileJson: { nativeWorkspaceFinalizationOwner: { token: "owner" } } }],
    ["missing PID", { processPid: null }], ["zero PID", { processPid: 0 }], ["init PID", { processPid: 1 }],
    ["negative PID", { processPid: -48321 }], ["fractional PID", { processPid: 2.5 }],
    ["missing group", { processGroupId: null }], ["zero group", { processGroupId: 0 }],
    ["negative group", { processGroupId: -48321 }], ["fractional group", { processGroupId: 2.5 }],
    ["missing birth", { processStartedAt: null }], ["invalid birth", { processStartedAt: new Date(NaN) }],
  ] satisfies Array<[string, Partial<Run>]>)("rejects %s before querying or probing", async (_label, overrides) => {
    const f = fixture(overrides);
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
    expect(f.queries).toEqual([]);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("keeps the general observer's existing support for identities without a process group", async () => {
    const f = fixture({ processGroupId: null });
    f.identity.payload.processGroupId = null;
    expect(await recordedLocalExecutionStopped(f.db, f.run)).toBe(true);
    expect(await retainedNativeLocalExecutionStopped(f.db, f.run)).toBe(false);
  });
});
