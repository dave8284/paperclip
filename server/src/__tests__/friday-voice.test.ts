import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({ access: vi.fn().mockResolvedValue(undefined) }));

function childFixture() {
  const requests: Array<{ id: string; op: string; mode?: string }> = [];
  const stdin = Object.assign(new EventEmitter(), {
    write: vi.fn((line: string, callback: (error?: Error | null) => void) => {
      requests.push(JSON.parse(line)); callback(); return true;
    }),
  });
  const child = Object.assign(new EventEmitter(), {
    stdin, stdout: new PassThrough(), stderr: new PassThrough(), requests,
    kill: vi.fn((_signal?: string) => true),
    reply(index: number, result: unknown, error?: string) {
      child.stdout.write(JSON.stringify({ id: requests[index].id, result, ...(error ? { error } : {}) }) + "\n");
    },
  });
  child.kill.mockImplementation(() => { child.emit("exit", null, "SIGKILL"); return true; });
  return child;
}

describe("independent local recognition and speech workers", () => {
  let request: typeof import("../services/friday-voice.js").fridayVoiceRequest;
  let cleanup: (() => void) | undefined;
  let children: ReturnType<typeof childFixture>[];
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.stubEnv("AGENTOS_VOICE_HOME", "/local/voice");
    children = [];
    vi.mocked(spawn).mockReset().mockImplementation(() => {
      const child = childFixture(); children.push(child);
      return child as unknown as ChildProcessWithoutNullStreams;
    });
    const registration = vi.spyOn(process, "once");
    ({ fridayVoiceRequest: request } = await import("../services/friday-voice.js"));
    cleanup = registration.mock.calls.find(([event]) => event === "exit")?.[1] as (() => void) | undefined;
    registration.mockRestore();
  });
  afterEach(() => {
    cleanup?.();
    if (cleanup) process.removeListener("exit", cleanup);
    for (const child of children) { child.stdout.destroy(); child.stderr.destroy(); }
    vi.useRealTimers(); vi.unstubAllEnvs();
  });

  it("does no process work while unconfigured", async () => {
    vi.stubEnv("AGENTOS_VOICE_HOME", "");
    await expect(request({ op: "speak", text: "Hello" })).rejects.toMatchObject({ status: 503 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("finishes speech while an earlier transcription is still pending", async () => {
    let recognized = false;
    const transcription = request({ op: "transcribe", audio: "synthetic-audio" }).then(value => { recognized = true; return value; });
    const speech = request({ op: "speak", text: "Your result is ready." });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(children.map(child => child.requests[0].op)).toEqual(["transcribe", "speak"]);
    children[1].reply(0, { audio: "synthetic-wav", sampleRate: 24000 });
    await expect(speech).resolves.toMatchObject({ audio: "synthetic-wav" });
    expect(recognized).toBe(false);
    children[0].reply(0, { text: "A later microphone result." });
    await expect(transcription).resolves.toMatchObject({ text: "A later microphone result." });
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).toMatchObject({ HF_HUB_OFFLINE: "1", TOKENIZERS_PARALLELISM: "false" });
  });

  it("prepares both lanes concurrently and retains speech after recognition preparation fails", async () => {
    const prepared = request({ op: "prepare" });
    const rejected = expect(prepared).rejects.toMatchObject({ status: 503 });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(children.map(child => child.requests[0])).toEqual([
      expect.objectContaining({ op: "prepare", mode: "speech" }),
      expect.objectContaining({ op: "prepare", mode: "transcription" }),
    ]);
    children[0].reply(0, { ready: true }); children[1].reply(0, undefined, "ImportError");
    await rejected;
    const speech = request({ op: "speak", text: "Speech is still available." });
    await vi.waitFor(() => expect(children[0].requests).toHaveLength(2));
    expect(children).toHaveLength(2);
    children[0].reply(1, { audio: "ready", sampleRate: 24000 });
    await expect(speech).resolves.toMatchObject({ audio: "ready" });
  });

  it("limits each lane to two pending requests without blocking the other lane", async () => {
    const first = request({ op: "transcribe", audio: "first" });
    const second = request({ op: "transcribe", audio: "second" });
    await vi.waitFor(() => expect(children[0]?.requests).toHaveLength(2));
    await expect(request({ op: "transcribe", audio: "third" })).rejects.toMatchObject({ status: 429 });
    await expect(request({ op: "prepare" })).rejects.toMatchObject({ status: 429 });
    expect(children).toHaveLength(1); // Busy prepare did not partly start speech.
    const speech = request({ op: "speak", text: "An independent answer." });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1].reply(0, { audio: "answer" });
    await expect(speech).resolves.toMatchObject({ audio: "answer" });
    children[0].reply(0, { text: "first" }); children[0].reply(1, { text: "second" });
    await Promise.all([first, second]);
  });

  it.each(["stream", "callback"] as const)("contains %s pipe errors and ignores late events from the retired child", async mode => {
    const transcription = request({ op: "transcribe", audio: "first" });
    const rejected = expect(transcription).rejects.toMatchObject({ status: 503 });
    const speech = request({ op: "speak", text: "Keep this speech." });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    const failed = children[0];
    if (mode === "stream") failed.stdin.emit("error", new Error("EPIPE"));
    else {
      failed.stdin.write.mockImplementationOnce((_line, callback) => { callback(new Error("EPIPE")); return false; });
      await expect(request({ op: "transcribe", audio: "second" })).rejects.toMatchObject({ status: 503 });
    }
    await rejected;
    expect(failed.kill).toHaveBeenCalledWith("SIGKILL");
    expect(children[1].kill).not.toHaveBeenCalled();
    const replacement = request({ op: "transcribe", audio: "replacement" });
    await vi.waitFor(() => expect(children).toHaveLength(3));
    failed.emit("error", new Error("late exit")); failed.emit("exit", 1, null);
    expect(children[2].kill).not.toHaveBeenCalled();
    children[2].reply(0, { text: "replacement" }); children[1].reply(0, { audio: "preserved" });
    await expect(replacement).resolves.toMatchObject({ text: "replacement" });
    await expect(speech).resolves.toMatchObject({ audio: "preserved" });
  });

  it("bounds hung recognition and releases idle speech without recurring work", async () => {
    const transcription = request({ op: "transcribe", audio: "stalled" });
    const rejected = expect(transcription).rejects.toMatchObject({ status: 503 });
    const speech = request({ op: "speak", text: "A timely result." });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1].reply(0, { audio: "ready" }); await speech;
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    expect(children[1].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(children[1].kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes both lanes and rejects active work when the server exits", async () => {
    const recognition = request({ op: "transcribe", audio: "active" });
    const speech = request({ op: "speak", text: "Active speech." });
    const rejected = Promise.all([
      expect(recognition).rejects.toMatchObject({ status: 503 }),
      expect(speech).rejects.toMatchObject({ status: 503 }),
    ]);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    cleanup?.(); await rejected;
    expect(children.every(child => child.kill.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
