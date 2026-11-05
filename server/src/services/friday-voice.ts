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
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };
type WorkerLane = { worker: ChildProcessWithoutNullStreams | null; pending: Map<string, PendingRequest>; expiry?: ReturnType<typeof setTimeout> };
const lanes: Record<LaneName, WorkerLane> = {
  speech: { worker: null, pending: new Map() },
  transcription: { worker: null, pending: new Map() },
};
const unavailable = () => new HttpError(503, "Local voice is unavailable. Check Settings → Voice; typing is still available.");
function stopWorker(lane: WorkerLane, expected?: ChildProcessWithoutNullStreams) {
  if (expected && lane.worker !== expected) return;
  clearTimeout(lane.expiry); lane.expiry = undefined;
  const active = lane.worker; lane.worker = null;
  active?.kill("SIGKILL");
  for (const request of lane.pending.values()) { clearTimeout(request.timeout); request.reject(unavailable()); }
  lane.pending.clear();
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
function requestLane(lane: WorkerLane, input: WorkerInput): Promise<unknown> {
  clearTimeout(lane.expiry); lane.expiry = undefined;
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
        if (!request) return;
        lane.pending.delete(reply.id); clearTimeout(request.timeout);
        if (reply.error) request.reject(unavailable()); else request.resolve(reply.result);
        if (!lane.pending.size) lane.expiry = setTimeout(() => stopWorker(lane, child), 300_000);
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
  return new Promise((resolve, reject) => {
    const child = lane.worker!;
    const id = randomUUID();
    const timeout = setTimeout(() => stopWorker(lane, child), 60_000);
    lane.pending.set(id, { resolve, reject, timeout });
    try { child.stdin.write(JSON.stringify({ ...input, id }) + "\n", error => { if (error) stopWorker(lane, child); }); }
    catch { stopWorker(lane, child); }
  });
}

export async function fridayVoiceRequest(input: VoiceInput): Promise<unknown> {
  if (!(await fridayVoiceStatus()).available) throw unavailable();
  const targets = input.op === "prepare" ? [lanes.speech, lanes.transcription] : [input.op === "speak" ? lanes.speech : lanes.transcription];
  if (targets.some(lane => lane.pending.size >= 2)) throw new HttpError(429, "Local speech is busy. Please try again shortly.");
  if (input.op === "prepare") {
    await Promise.all([requestLane(lanes.speech, { op: "prepare", mode: "speech" }), requestLane(lanes.transcription, { op: "prepare", mode: "transcription" })]);
    return { ready: true };
  }
  return requestLane(targets[0], input);
}
