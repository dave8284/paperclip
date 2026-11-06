import { expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { executePaperclipNativeSession } from "../services/native-runtime/native-session-executor.js";
const provider = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../vendor/paperclip-runner/index.js", async original => ({ ...await original<typeof import("../vendor/paperclip-runner/index.js")>(), executeNativeSession: provider.execute }));
it.each([false, true])("refuses prepared EGM at common admission before provider or backend work (runnerd=%s)", async useRunnerd => {
  const db = drizzle(async () => ({ rows: [[{}, { nativeEgmPacketReceipt: { stage: "server_prepared" } }]] }));
  const backend = { execute: vi.fn() }, prepareRunnerEnvironment = vi.fn(), onSpawn = vi.fn();
  const id = "50000000-0000-4000-8000-000000000001";
  const execution = { schema: "paperclip.native-execution-input.v1", binding: { companyId: id, issueId: id, agentId: id, runId: id, executionWorkspaceId: id },
    provider: { kind: "codex", model: "synthetic-only" }, session: { normalizedSessionId: id, driverKind: "codex_app_server", lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } }, workspace: { cwd: "/unused" } };
  await expect(executePaperclipNativeSession({ db: db as never, execution: execution as never, runnerInstanceId: id, useRunnerd, backend: backend as never, prepareRunnerEnvironment, onSpawn })).rejects.toThrow("independent_review_unavailable");
  expect(provider.execute).not.toHaveBeenCalled(); expect(backend.execute).not.toHaveBeenCalled();
  expect(prepareRunnerEnvironment).not.toHaveBeenCalled(); expect(onSpawn).not.toHaveBeenCalled();
});
