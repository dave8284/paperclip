import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecisionAnswer, DecisionRequest } from "@paperclipai/shared";

export const localTriagePin = {
  sdkVersion: "0.4.22", model: "convaiinnovations/laya",
  revision: "7b928d828b7b0e022f929d9bd2e44165aa270148", checkpoint: "typed-decisions",
} as const;
export const localTriageModelId = `${localTriagePin.model}@${localTriagePin.revision}/${localTriagePin.checkpoint}`;
export type LocalTriageStatus = "disabled" | "setup_required" | "cold" | "warming" | "ready" | "busy" | "unavailable";
export type LocalTriageResult = {
  status: "not_run" | "succeeded" | "abstained"; reason: string;
  requestId?: string; answers?: Record<string, DecisionAnswer>;
  elapsedMs?: number; inputTokens?: number; outputTokens?: number;
};

/** Instance-owned local compute. No URL, company-supplied command, credentials, or network fallback. */
export function createLocalTriageRuntime(options: {
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawn;
  runnerPath?: string;
  requestMs?: number;
  startupMs?: number;
  idleMs?: number;
} = {}) {
  const env = options.env ?? process.env;
  let worker: ChildProcessWithoutNullStreams | null = null;
  let state: LocalTriageStatus = "cold";
  let configuration: string | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let startup: ReturnType<typeof setTimeout> | undefined;
  let pending: { id: string; finish: (result: LocalTriageResult) => void } | null = null;
  const clearDeadlines = () => { clearTimeout(expiry); clearTimeout(startup); };
  function stop(reason = "local_worker_stopped", nextState: LocalTriageStatus = "cold") {
    clearDeadlines();
    const child = worker; worker = null; state = nextState;
    child?.kill("SIGKILL");
    pending?.finish({ status: "abstained", reason });
  }
  function armIdle() {
    clearTimeout(expiry);
    expiry = setTimeout(() => stop("local_idle_unload"), options.idleMs ?? 300_000);
    expiry.unref(); // Expiry of this live resource; no scan or recurring background work.
  }
  async function status(inspect: { readOnly?: boolean } = {}): Promise<LocalTriageStatus> {
    if (env.PAPERCLIP_LOCAL_TRIAGE_ENABLED !== "true") {
      if (worker && !inspect.readOnly) stop("local_disabled", "disabled");
      return "disabled";
    }
    const python = env.PAPERCLIP_LOCAL_TRIAGE_PYTHON;
    const modelDir = env.PAPERCLIP_LOCAL_TRIAGE_MODEL_DIR;
    if (!python || !modelDir || !isAbsolute(python) || !isAbsolute(modelDir)) return "setup_required";
    const nextConfiguration = `${python}\0${modelDir}`;
    if (!inspect.readOnly) {
      if (configuration !== null && configuration !== nextConfiguration) stop("local_configuration_changed");
      configuration = nextConfiguration;
    }
    try {
      const manifestPath = join(modelDir, "agentos-model.json");
      if ((await stat(manifestPath)).size > 4_096) return "setup_required";
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (Object.entries(localTriagePin).some(([key, value]) => manifest[key] !== value)) return "setup_required";
      await Promise.all([access(python, constants.X_OK), ...["rl_agent_config.json", "model.safetensors", "tokenizer/tokenizer.json", "encoder/config.json"].map(path => access(join(modelDir, localTriagePin.checkpoint, path)))]);
    } catch { return "setup_required"; }
    if (inspect.readOnly && configuration !== nextConfiguration) return "cold";
    return worker ? (pending ? "busy" : state) : state === "unavailable" ? "unavailable" : "cold";
  }
  function start() {
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1",
      TOKENIZERS_PARALLELISM: "false", USE_TF: "0", PYTHONUNBUFFERED: "1", OMP_NUM_THREADS: "2", MKL_NUM_THREADS: "2",
    };
    // Python's system libraries can need the operator's temp/home locations, but never provider credentials.
    for (const key of ["HOME", "TMPDIR", "SYSTEMROOT"]) if (env[key]) safeEnv[key] = env[key];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = (options.spawn ?? spawn)(env.PAPERCLIP_LOCAL_TRIAGE_PYTHON!, ["-I", "-u", options.runnerPath ?? fileURLToPath(new URL("./scripts/local-triage.py", import.meta.url)), env.PAPERCLIP_LOCAL_TRIAGE_MODEL_DIR!], { env: safeEnv, stdio: "pipe" });
    } catch { state = "unavailable"; return; }
    worker = child; state = "warming";
    let buffer = "";
    startup = setTimeout(() => { if (worker === child) stop("local_startup_deadline", "unavailable"); }, options.startupMs ?? 60_000);
    startup.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", () => { if (worker === child) stop("local_worker_unavailable", "unavailable"); });
    child.stderr.resume(); // Never persist model logs or task text.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (worker !== child) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 65_536) { stop("local_invalid_response", "unavailable"); return; }
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (state === "warming" && value.type === "ready" && Object.entries(localTriagePin).every(([key, expected]) => value[key] === expected)) {
            clearTimeout(startup); state = "ready"; armIdle();
          } else if (pending && value.id === pending.id && ["succeeded", "abstained"].includes(value.status)) {
            const validTokens = (count: unknown) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 100_000;
            if (value.status === "succeeded" && (typeof value.answers !== "object" || !value.answers || !validTokens(value.inputTokens) || !validTokens(value.outputTokens))) throw new Error("Invalid local answer");
            pending.finish({ status: value.status, reason: value.status === "succeeded" ? "local_observation" : ["local_context_truncated", "local_options_collapsed", "local_input_invalid", "local_inference_failed"].includes(value.reason) ? value.reason : "local_inference_failed", answers: value.answers, inputTokens: value.inputTokens, outputTokens: value.outputTokens });
          } else throw new Error("Invalid local response binding");
        } catch { stop("local_invalid_response", "unavailable"); return; }
      }
    });
    child.on("error", () => { if (worker === child) stop("local_worker_unavailable", "unavailable"); });
    child.on("exit", () => { if (worker === child) stop("local_worker_exited", "unavailable"); });
  }
  async function decide(request: DecisionRequest, signal?: AbortSignal): Promise<LocalTriageResult> {
    if (signal?.aborted) return { status: "not_run", reason: "cancelled_or_deadline" };
    if (Buffer.byteLength(JSON.stringify(request)) > 32_000) return { status: "not_run", reason: "local_input_invalid" };
    const readiness = await status();
    if (signal?.aborted) return { status: "not_run", reason: "cancelled_or_deadline" };
    if (readiness === "disabled" || readiness === "setup_required") return { status: "not_run", reason: `local_${readiness}` };
    // Recheck after filesystem awaits; concurrent callers may have started or occupied the worker.
    if (!worker) { start(); return { status: "not_run", reason: state === "warming" ? "local_warming_up" : "local_worker_unavailable" }; }
    if (state !== "ready") return { status: "not_run", reason: "local_warming_up" };
    if (pending) return { status: "not_run", reason: "local_busy" };
    clearTimeout(expiry);
    const id = randomUUID(); const started = performance.now();
    return new Promise(resolve => {
      const abort = () => stop("cancelled_or_deadline");
      const timeout = setTimeout(abort, options.requestMs ?? 2_000);
      timeout.unref();
      pending = { id, finish: result => {
        clearTimeout(timeout); signal?.removeEventListener("abort", abort);
        pending = null;
        if (worker) armIdle();
        resolve({ ...result, requestId: id, elapsedMs: Math.max(0, performance.now() - started) });
      } };
      signal?.addEventListener("abort", abort, { once: true });
      worker!.stdin.write(JSON.stringify({ id, request }) + "\n", error => { if (error && pending?.id === id) stop("local_worker_unavailable", "unavailable"); });
    });
  }
  return { decide, status, stop };
}

export const localTriageRuntime = createLocalTriageRuntime();
process.once("exit", () => localTriageRuntime.stop());
