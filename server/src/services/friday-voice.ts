import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors.js";

// A single bounded local worker, created on demand. No startup inference,
// network fetches, idle scans or login daemon. Closing stdin ends the worker.
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
let worker: ChildProcessWithoutNullStreams | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const unavailable = () => new HttpError(503, "Local voice is unavailable. Check Settings → Voice; typing is still available.");
function stopWorker() {
  clearTimeout(expiry);
  const active = worker; worker = null;
  active?.kill("SIGKILL");
  for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(unavailable()); }
  pending.clear();
}
process.once("exit", stopWorker);
export async function fridayVoiceStatus() {
  const home = process.env.AGENTOS_VOICE_HOME;
  if (!home) return { available: false, engine: "Whisper + Kokoro", reason: "Local speech models have not been configured." };
  try {
    await Promise.all(["venv/bin/python", "kokoro-v1.0.onnx", "voices-v1.0.bin", "whisper/config.json", "whisper/weights.npz"].map(path => access(join(home, path))));
    return { available: true, engine: "Whisper + Kokoro", reason: null };
  } catch { return { available: false, engine: "Whisper + Kokoro", reason: "Local speech installation is incomplete." }; }
}
export async function fridayVoiceRequest(input: { op: "prepare" } | { op: "speak"; text: string } | { op: "transcribe"; audio: string }): Promise<unknown> {
  if (!(await fridayVoiceStatus()).available) throw unavailable();
  if (pending.size >= 2) throw new HttpError(429, "Local speech is busy. Please try again shortly.");
  clearTimeout(expiry);
  if (!worker) {
    const home = process.env.AGENTOS_VOICE_HOME!;
    const child = spawn(join(home, "venv/bin/python"), ["-u", fileURLToPath(new URL("./scripts/friday-voice.py", import.meta.url))], { env: { ...process.env, HF_HUB_OFFLINE: "1", TOKENIZERS_PARALLELISM: "false" }, stdio: "pipe" });
    worker = child;
    child.stderr.resume(); // Dependency progress contains no user-facing diagnostics.
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      try {
        const reply = JSON.parse(line);
        const request = pending.get(reply.id);
        if (!request) return;
        pending.delete(reply.id); clearTimeout(request.timeout);
        if (reply.error) request.reject(unavailable()); else request.resolve(reply.result);
        if (!pending.size) expiry = setTimeout(stopWorker, 300_000); // Actual resource-expiry deadline.
      } catch { stopWorker(); }
    });
    child.on("error", () => { if (worker === child) stopWorker(); });
    child.on("exit", () => { lines.close(); if (worker === child) stopWorker(); });
  }
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(stopWorker, 60_000);
    pending.set(id, { resolve, reject, timeout });
    worker!.stdin.write(JSON.stringify({ ...input, id }) + "\n", error => { if (error) stopWorker(); });
  });
}
