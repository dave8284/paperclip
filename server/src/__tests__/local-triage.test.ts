import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecisionRequest } from "@paperclipai/shared";
import { createLocalTriageRuntime, localTriagePin } from "../services/local-triage.js";

const request: DecisionRequest = { state: "A fixed synthetic task", questions: { category: { type: "choice", instructions: "Classify", criteria: { yes: "Fits", unknown: "Unknown" } } } };
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function runtimeFixture(mode = "success", overrides: { requestMs?: number; startupMs?: number; idleMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "agentos-local-triage-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  for (const path of ["encoder/config.json", "tokenizer/tokenizer.json", "rl_agent_config.json", "model.safetensors"]) {
    const target = join(dir, "typed-decisions", path);
    await mkdir(join(target, ".."), { recursive: true }); await writeFile(target, "{}");
  }
  await writeFile(join(dir, "agentos-model.json"), JSON.stringify(localTriagePin));
  const runner = join(dir, "fixture.py");
  await writeFile(runner, `import json,sys,time,os\nif ${JSON.stringify(mode)} == "startup_hang": time.sleep(60)\nif ${JSON.stringify(mode)} == "closed_stdin": os.close(0)\nprint(json.dumps(${JSON.stringify({ type: "ready", ...localTriagePin })}),flush=True)\nif ${JSON.stringify(mode)} == "closed_stdin": time.sleep(60)\nfor line in sys.stdin:\n r=json.loads(line)\n if ${JSON.stringify(mode)} == "hang": time.sleep(60)\n if ${JSON.stringify(mode)} == "wrong_id": r["id"]="other-company-request"\n print(json.dumps({"id":r["id"],"status":"succeeded","answers":{"category":{"type":"choice","choice":"unknown","probabilities":{"yes":0.1,"unknown":0.9}}},"inputTokens":5,"outputTokens":0}),flush=True)\n`);
  const children: ChildProcessWithoutNullStreams[] = [];
  const spawnSpy = vi.fn<typeof spawn>((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args); children.push(child as ChildProcessWithoutNullStreams); return child;
  });
  const env = { PAPERCLIP_LOCAL_TRIAGE_ENABLED: "true", PAPERCLIP_LOCAL_TRIAGE_PYTHON: "/usr/bin/python3", PAPERCLIP_LOCAL_TRIAGE_MODEL_DIR: dir, OPENAI_API_KEY: "must-not-reach-child" };
  const runtime = createLocalTriageRuntime({ env, spawn: spawnSpy, runnerPath: runner, requestMs: 250, startupMs: 10_000, idleMs: 5_000, ...overrides });
  cleanups.push(() => runtime.stop());
  return { runtime, env, dir, children, spawnSpy };
}

describe("bounded local worker lifecycle over real stdio", () => {
  it("stays quiet while disabled and refuses missing setup without spawning", async () => {
    const spawnSpy = vi.fn(); const runtime = createLocalTriageRuntime({ env: {}, spawn: spawnSpy });
    expect(await runtime.status()).toBe("disabled"); expect(await runtime.decide(request)).toEqual({ status: "not_run", reason: "local_disabled" });
    expect(spawnSpy).not.toHaveBeenCalled();
    const missing = createLocalTriageRuntime({ env: { PAPERCLIP_LOCAL_TRIAGE_ENABLED: "true", PAPERCLIP_LOCAL_TRIAGE_PYTHON: "https://outside", PAPERCLIP_LOCAL_TRIAGE_MODEL_DIR: "relative" }, spawn: spawnSpy });
    expect(await missing.decide(request)).toEqual({ status: "not_run", reason: "local_setup_required" }); expect(spawnSpy).not.toHaveBeenCalled();
  });
  it("warms without queueing the first task, then returns bounded correlated local output with no credentials", async () => {
    const { runtime, spawnSpy } = await runtimeFixture();
    expect(await runtime.decide(request)).toEqual({ status: "not_run", reason: "local_warming_up" });
    await vi.waitFor(async () => expect(await runtime.status()).toBe("ready"), { timeout: 5_000 });
    const result = await runtime.decide(request);
    expect(result).toMatchObject({ status: "succeeded", inputTokens: 5, outputTokens: 0, answers: { category: { choice: "unknown" } } });
    expect(result.requestId).toMatch(/^[a-f0-9-]+$/); expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(spawnSpy).toHaveBeenCalledOnce();
    expect(spawnSpy.mock.calls[0][2]?.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(spawnSpy.mock.calls[0][2]?.env).toMatchObject({ HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" });
  });
  it("does not queue concurrent work and actually kills a hung process at the request deadline", async () => {
    const { runtime, children } = await runtimeFixture("hang");
    await runtime.decide(request); await vi.waitFor(async () => expect(await runtime.status()).toBe("ready"), { timeout: 5_000 });
    const exited = new Promise(resolve => children[0].once("exit", (_code, signal) => resolve(signal)));
    const active = runtime.decide(request); await vi.waitFor(async () => expect(await runtime.status()).toBe("busy"));
    expect(await runtime.decide(request)).toEqual({ status: "not_run", reason: "local_busy" });
    expect(await active).toMatchObject({ status: "abstained", reason: "cancelled_or_deadline" });
    expect(await exited).toBe("SIGKILL"); expect(await runtime.status()).toBe("cold");
  });
  it("contains a closed child stdin error instead of crashing the server", async () => {
    const { runtime } = await runtimeFixture("closed_stdin");
    await runtime.decide(request); await vi.waitFor(async () => expect(await runtime.status()).toBe("ready"), { timeout: 5_000 });
    expect(await runtime.decide(request)).toMatchObject({ status: "abstained", reason: "local_worker_unavailable" });
    expect(await runtime.status()).toBe("unavailable");
  });
  it("rejects output for a different request and unloads the worker", async () => {
    const { runtime } = await runtimeFixture("wrong_id");
    await runtime.decide(request); await vi.waitFor(async () => expect(await runtime.status()).toBe("ready"), { timeout: 5_000 });
    expect(await runtime.decide(request)).toMatchObject({ status: "abstained", reason: "local_invalid_response" });
    expect(await runtime.status()).toBe("unavailable");
  });
  it("releases an idle model and a cancelled active model without recurring work", async () => {
    const idle = await runtimeFixture("success", { idleMs: 100 });
    await idle.runtime.decide(request); await vi.waitFor(async () => expect(await idle.runtime.status()).toBe("ready"), { timeout: 5_000 });
    await vi.waitFor(async () => expect(await idle.runtime.status()).toBe("cold")); expect(idle.spawnSpy).toHaveBeenCalledOnce();
    const active = await runtimeFixture("hang", { requestMs: 2_000 });
    await active.runtime.decide(request); await vi.waitFor(async () => expect(await active.runtime.status()).toBe("ready"), { timeout: 5_000 });
    const controller = new AbortController(); const result = active.runtime.decide(request, controller.signal);
    await vi.waitFor(async () => expect(await active.runtime.status()).toBe("busy")); controller.abort();
    expect(await result).toMatchObject({ status: "abstained", reason: "cancelled_or_deadline" });
  });
  it("fails closed on a mismatched checkpoint manifest", async () => {
    const { runtime, dir, spawnSpy } = await runtimeFixture();
    await writeFile(join(dir, "agentos-model.json"), JSON.stringify({ ...localTriagePin, revision: "moving-main" }));
    expect(await runtime.decide(request)).toMatchObject({ status: "not_run", reason: "local_setup_required" }); expect(spawnSpy).not.toHaveBeenCalled();
  });
  it("read-only diagnostics never stops an active worker when configuration changes", async () => {
    const { runtime, env, children } = await runtimeFixture();
    await runtime.decide(request); await vi.waitFor(async () => expect(await runtime.status()).toBe("ready"), { timeout: 5_000 });
    env.PAPERCLIP_LOCAL_TRIAGE_ENABLED = "false";
    expect(await runtime.status({ readOnly: true })).toBe("disabled"); expect(children[0].killed).toBe(false);
    env.PAPERCLIP_LOCAL_TRIAGE_ENABLED = "true";
    expect(await runtime.status({ readOnly: true })).toBe("ready");
  });
  it("bounds model startup and kills it without an inference request", async () => {
    const { runtime, children } = await runtimeFixture("startup_hang", { startupMs: 100 });
    await runtime.decide(request);
    const exited = new Promise(resolve => children[0].once("exit", (_code, signal) => resolve(signal)));
    expect(await exited).toBe("SIGKILL"); expect(await runtime.status()).toBe("unavailable");
  });
});
