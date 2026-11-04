import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHotRestartIntent, resolveHotRestartIntentPath, resolveLegacyHotRestartIntentPath, resumePendingHotRestartIntent, writeHotRestartIntent, writeHotRestartShutdownSnapshot } from "../services/hot-restart.js";

describe("resuming an accepted dev restart", () => {
  let home: string;
  const boot = "2026-11-04T10:00:00.000Z";
  beforeEach(async () => { home = await mkdtemp(path.join(os.tmpdir(), "paperclip-restart-resume-")); vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default"); });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
  const prepare = (overrides = {}) => writeHotRestartIntent({ homeDir: home, previousServerPid: process.pid, previousServerIdentity: boot, previousServerStartedAt: boot, recoveryRequestId: "request-1", preflightActiveRunIds: ["earlier-run"], ...overrides });
  const resume = (overrides = {}) => resumePendingHotRestartIntent({ homeDir: home, previousServerPid: process.pid, previousServerIdentity: boot, preflightActiveRunIds: ["new-run", "earlier-run"], ...overrides });
  it("preserves operation identity and unions preflight runs in both native intent files", async () => {
    const initial = await prepare(); const resumed = await resume();
    expect(resumed).toEqual({ ...initial, drainRunIds: [], preflightActiveRunIds: ["earlier-run", "new-run"] });
    expect(await readHotRestartIntent(home)).toEqual(resumed);
    expect(JSON.parse(await readFile(resolveLegacyHotRestartIntentPath(home), "utf8"))).toEqual(resumed);
  });
  it("serializes concurrent retry preflights without losing either run set", async () => {
    await prepare();
    await Promise.all([resume({ preflightActiveRunIds: ["run-a"] }), resume({ preflightActiveRunIds: ["run-b"] })]);
    expect((await readHotRestartIntent(home))?.preflightActiveRunIds.sort()).toEqual(["earlier-run", "run-a", "run-b"]);
  });
  it.each([{ previousServerPid: 1 }, { previousServerIdentity: "another-boot" }])("does not resume a different process identity: %j", async mismatch => {
    const initial = await prepare(); expect(await resume(mismatch)).toBeNull(); expect(await readHotRestartIntent(home)).toEqual({ ...initial, drainRunIds: [] });
  });
  it("allows native operator recovery with freshly matching OS identity, but never just a PID", async () => {
    await prepare();
    expect(await resume({ previousServerIdentity: null })).toBeNull();
    expect(await resume({ previousServerIdentity: null, previousServerStartedAt: "2026-11-04T11:00:00.000Z" })).toBeNull();
    expect(await resume({ previousServerIdentity: "wrong-boot", previousServerStartedAt: boot })).toBeNull();
    expect(await resume({ previousServerIdentity: null, previousServerStartedAt: boot })).toMatchObject({ recoveryRequestId: "request-1", previousServerPid: process.pid });
  });
  it.each([{ drainRequired: true }, { recoveryRequestId: null }])("does not repurpose an incompatible operation: %j", async options => {
    const initial = await prepare(options); expect(await resume()).toBeNull(); expect(await readHotRestartIntent(home)).toEqual({ ...initial, drainRunIds: [] });
  });
  it("does not modify a request whose native shutdown snapshot has begun", async () => {
    const initial = await prepare();
    const captured = await writeHotRestartShutdownSnapshot({ homeDir: home, intent: initial, signal: "SIGTERM", activeRuns: [] });
    expect(await resume()).toBeNull(); expect(await readHotRestartIntent(home)).toEqual({ ...captured, drainRunIds: [] });
  });
  it("keeps a retry's preflight evidence when shutdown captured an earlier request copy", async () => {
    const initial = await prepare(); await resume();
    const snapshot = await writeHotRestartShutdownSnapshot({ homeDir: home, intent: initial, signal: "SIGTERM", activeRuns: [] });
    expect(snapshot.preflightActiveRunIds).toEqual(["earlier-run", "new-run"]);
    expect((await readHotRestartIntent(home))?.preflightActiveRunIds).toEqual(["earlier-run", "new-run"]);
  });
  it("requires matching legacy and instance records and never claims another instance's request", async () => {
    const initial = await prepare();
    await writeFile(resolveLegacyHotRestartIntentPath(home), JSON.stringify({ ...initial, previousServerIdentity: "other-boot" }));
    expect(await resume()).toBeNull();
    await writeFile(resolveLegacyHotRestartIntentPath(home), JSON.stringify({ ...initial, recoveryRequestId: "other-request" }));
    expect(await resume()).toBeNull();
    expect(JSON.parse(await readFile(resolveHotRestartIntentPath(home), "utf8"))).toEqual(initial);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "other-instance");
    expect(await resume()).toBeNull();
  });
});
