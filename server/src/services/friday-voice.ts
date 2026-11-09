import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors.js";

// Recognition and playback have independent, bounded workers so a microphone
// preview cannot hold speech behind it. Both are created only on an explicit
// request and released at their idle deadline; there is no background polling.
type VoiceInput = { op: "prepare" } | { op: "speak"; text: string } | { op: "transcribe"; audio: string };
type LaneName = "speech" | "transcription";
type WorkerInput = Exclude<VoiceInput, { op: "prepare" }> | { op: "prepare"; mode: LaneName };
type PendingRequest = { input: WorkerInput; resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout>; removeAbortListener: () => void };
type WorkerLane = { worker: ChildProcessWithoutNullStreams | null; activeId: string | null; pending: Map<string, PendingRequest>; expiry?: ReturnType<typeof setTimeout> };
const lanes: Record<LaneName, WorkerLane> = {
  speech: { worker: null, activeId: null, pending: new Map() },
  transcription: { worker: null, activeId: null, pending: new Map() },
};
const unavailable = () => new HttpError(503, "Local voice is unavailable. Check Settings → Voice; typing is still available.");
const cancelled = () => new DOMException("Local speech request was cancelled.", "AbortError");
function retireWorker(lane: WorkerLane) {
  clearTimeout(lane.expiry); lane.expiry = undefined;
  const active = lane.worker; lane.worker = null; lane.activeId = null;
  active?.kill("SIGKILL");
}
function stopWorker(lane: WorkerLane, expected?: ChildProcessWithoutNullStreams) {
  if (expected && lane.worker !== expected) return;
  retireWorker(lane);
  for (const request of lane.pending.values()) {
    clearTimeout(request.timeout); request.removeAbortListener(); request.reject(unavailable());
  }
  lane.pending.clear();
}
function releaseWhenIdle(lane: WorkerLane) {
  if (lane.pending.size || !lane.worker) return;
  const child = lane.worker;
  clearTimeout(lane.expiry);
  lane.expiry = setTimeout(() => stopWorker(lane, child), 300_000);
}
process.once("exit", () => { for (const lane of Object.values(lanes)) stopWorker(lane); });
export async function fridayVoiceStatus() {
  const home = process.env.AGENTOS_VOICE_HOME;
  if (!home) return { available: false, engine: "Whisper + Kokoro", reason: "Local speech models have not been configured." };
  try {
    await Promise.all(["venv/bin/python", "kokoro-v1.0.onnx", "voices-v1.0.bin", "whisper/config.json", "whisper/weights.npz"].map(path => access(join(home, path))));
    return { available: true, engine: "Whisper + Kokoro", reason: null };
  } catch { return { available: false, engine: "Whisper + Kokoro", reason: "Local speech installation is incomplete." }; }
}
function startWorker(lane: WorkerLane) {
  if (!lane.worker) {
    const home = process.env.AGENTOS_VOICE_HOME!;
    const child = spawn(join(home, "venv/bin/python"), ["-u", fileURLToPath(new URL("./scripts/friday-voice.py", import.meta.url))], { env: { ...process.env, HF_HUB_OFFLINE: "1", TOKENIZERS_PARALLELISM: "false" }, stdio: "pipe" });
    lane.worker = child;
    child.stderr.resume(); // Dependency progress contains no user-facing diagnostics.
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      if (lane.worker !== child) return;
      try {
        const reply = JSON.parse(line);
        if (!reply || typeof reply.id !== "string" || !("result" in reply || "error" in reply)) throw unavailable();
        const request = lane.pending.get(reply.id);
        if (!request || lane.activeId !== reply.id) return;
        lane.pending.delete(reply.id); clearTimeout(request.timeout);
        request.removeAbortListener(); lane.activeId = null;
        if (reply.error) request.reject(unavailable()); else request.resolve(reply.result);
        pumpLane(lane); releaseWhenIdle(lane);
      } catch { stopWorker(lane, child); }
    });
    const fail = () => stopWorker(lane, child);
    child.stdin.on("error", fail); // A closed pipe can emit outside write's callback.
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    lines.on("error", fail);
    child.on("error", fail);
    child.on("exit", () => { lines.close(); stopWorker(lane, child); });
    child.on("close", () => { lines.close(); stopWorker(lane, child); });
  }
  return lane.worker!;
}
function pumpLane(lane: WorkerLane) {
  if (lane.activeId || !lane.pending.size) return;
  clearTimeout(lane.expiry); lane.expiry = undefined;
  const [id, request] = lane.pending.entries().next().value!;
  try {
    const child = startWorker(lane);
    lane.activeId = id;
    child.stdin.write(JSON.stringify({ ...request.input, id }) + "\n", error => { if (error) stopWorker(lane, child); });
  } catch { stopWorker(lane); }
}
function requestLane(lane: WorkerLane, input: WorkerInput, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return; }
    const id = randomUUID();
    const abort = () => {
      const request = lane.pending.get(id);
      if (!request) return;
      lane.pending.delete(id); clearTimeout(request.timeout); request.removeAbortListener();
      request.reject(cancelled());
      // Only the active request has reached the serial Python worker. Killing
      // that inference cannot discard another caller's queued work: it is still
      // held here and starts on a replacement worker with its original deadline.
      if (lane.activeId === id) retireWorker(lane);
      pumpLane(lane); releaseWhenIdle(lane);
    };
    const timeout = setTimeout(() => stopWorker(lane), 60_000);
    lane.pending.set(id, { input, resolve, reject, timeout, removeAbortListener: () => signal?.removeEventListener("abort", abort) });
    signal?.addEventListener("abort", abort, { once: true });
    pumpLane(lane);
  });
}

export async function fridayVoiceRequest(input: VoiceInput, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw cancelled();
  if (!(await fridayVoiceStatus()).available) throw unavailable();
  if (signal?.aborted) throw cancelled();
  const targets = input.op === "prepare" ? [lanes.speech, lanes.transcription] : [input.op === "speak" ? lanes.speech : lanes.transcription];
  if (targets.some(lane => lane.pending.size >= 2)) throw new HttpError(429, "Local speech is busy. Please try again shortly.");
  if (input.op === "prepare") {
    await Promise.all([requestLane(lanes.speech, { op: "prepare", mode: "speech" }, signal), requestLane(lanes.transcription, { op: "prepare", mode: "transcription" }, signal)]);
    return { ready: true };
  }
  return requestLane(targets[0], input, signal);
}
