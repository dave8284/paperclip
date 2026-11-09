// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FridayVoiceSession } from "./friday-voice-session";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ api }));
class Processor {
  onaudioprocess?: (event: unknown) => void;
  connect() {} disconnect() {}
  frame(level: number) { this.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(level) } }); }
}
class LocalAudio {
  static processor: Processor;
  sampleRate = 16000; destination = {};
  resume = () => Promise.resolve(); close = () => Promise.resolve();
  createMediaStreamSource() { return { connect() {} }; }
  createScriptProcessor() { LocalAudio.processor = new Processor(); return LocalAudio.processor; }
}
class Playback {
  static latest: Playback;
  static playResult?: () => Promise<void>;
  onended?: () => void; onerror?: () => void;
  play = vi.fn(() => Playback.playResult?.() ?? Promise.resolve()); pause = vi.fn();
  constructor(public src: string) { Playback.latest = this; }
}
let session: FridayVoiceSession;
const send = vi.fn().mockResolvedValue(undefined), draft = vi.fn(), stop = vi.fn();
const binding = { key: "company:friday", companyId: "company", disabled: false, send, draft };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.clearAllMocks();
  Playback.playResult = undefined;
  api.get.mockResolvedValue({ available: true });
  api.post.mockResolvedValue({ ready: true });
  vi.stubGlobal("AudioContext", LocalAudio);
  vi.stubGlobal("Audio", Playback);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop }] }) } });
  session = new FridayVoiceSession();
});
afterEach(() => { session.disable(); vi.unstubAllGlobals(); });
it("shows local partial words while capturing and sends only the completed turn", async () => {
  let transcriptions = 0;
  api.post.mockImplementation(async (_path, body) => body.op === "prepare" ? { ready: true } : { text: ["Show", "Show my projects", "Show my projects and decisions"][transcriptions++] });
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06); await flush();
  expect(session.snapshot().interim).toBe("Show"); expect(send).not.toHaveBeenCalled();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06); await flush();
  expect(session.snapshot().interim).toBe("Show my projects"); expect(send).not.toHaveBeenCalled();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(0); await flush();
  expect(send).toHaveBeenCalledExactlyOnceWith("Show my projects and decisions");
  expect(session.snapshot().enabled).toBe(true); expect(stop).toHaveBeenCalled();
});
it("drops a late preview after changing employee and never delivers it", async () => {
  let finish!: (result: { text: string }) => void;
  api.post.mockImplementation((_path, body) => body.op === "prepare" ? Promise.resolve({ ready: true }) : new Promise(resolve => { finish = resolve; }));
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06);
  session.bind({ ...binding, key: "other:employee", companyId: "other" });
  finish({ text: "Private words from the old company" }); await flush();
  expect(session.snapshot().interim).toBe(""); expect(send).not.toHaveBeenCalled(); expect(session.snapshot().enabled).toBe(false);
});
it("ends a spoken turn over steady room noise instead of waiting for absolute silence", async () => {
  api.post.mockImplementation(async (_path, body) => body.op === "prepare" ? { ready: true } : { text: "Show my decisions" });
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06); await flush();
  expect(session.snapshot().interim).toBe("Show my decisions");
  // Fan noise above the previous fixed .012 RMS threshold is not continued speech.
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.018); await flush(); await flush();
  expect(send).toHaveBeenCalledExactlyOnceWith("Show my decisions"); expect(session.snapshot().enabled).toBe(true);
});
it("waits for an outstanding preview before final transcription so the worker queue cannot reject the turn", async () => {
  let finish!: (result: { text: string }) => void;
  let transcriptions = 0;
  api.post.mockImplementation((_path, body) => body.op === "prepare" ? Promise.resolve({ ready: true }) : ++transcriptions === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ text: "Show my decisions" }));
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06);
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(0);
  await flush(); expect(transcriptions).toBe(1); expect(send).not.toHaveBeenCalled();
  finish({ text: "Show my" }); await flush(); await flush();
  expect(transcriptions).toBe(2); expect(send).toHaveBeenCalledExactlyOnceWith("Show my decisions");
});
it("does not mistake steady noise for a confirmed user turn and lose a completed reply", async () => {
  api.post.mockImplementation(async (_path, body) => body.op === "prepare" ? { ready: true } : body.op === "speak" ? { audio: "YQ==" } : { text: "" });
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.018); await flush();
  expect(session.snapshot().hearingSpeech).toBe(false);
  session.bind({ ...binding, reply: { id: "reply", body: "The launch review is ready." } }); await flush();
  expect(session.snapshot().speaking).toBe(true);
  expect(Playback.latest.play).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
});
it("does not start a new reply over a recognised local user turn", async () => {
  api.post.mockImplementation(async (_path, body) => body.op === "prepare" ? { ready: true } : { text: "Wait, I need to add more detail" });
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06); await flush();
  expect(session.snapshot().hearingSpeech).toBe(true);
  session.bind({ ...binding, reply: { id: "reply", body: "The launch review is ready." } }); await flush();
  expect(session.snapshot().speaking).toBe(false);
  expect(api.post.mock.calls.some(call => call[1].op === "speak")).toBe(false);
});
it("keeps local capture alive during speech, drops playback echo and accepts an interruption", async () => {
  let words = "Here are your projects and decisions";
  api.post.mockImplementation(async (_path, body) => body.op === "prepare" ? { ready: true } : body.op === "speak" ? { audio: "YQ==" } : { text: words });
  session.bind(binding); await flush(); session.toggle(); await flush();
  const playback = session.speak(words); await flush();
  expect(session.snapshot().listening).toBe(true);
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06); await flush();
  expect(session.snapshot().interim).toBe(""); expect(Playback.latest.pause).not.toHaveBeenCalled();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(0); await flush(); await flush();
  expect(send).not.toHaveBeenCalled(); expect(session.snapshot().speaking).toBe(true);
  words = "Stop, show the launch instead";
  const capture = LocalAudio.processor;
  for (let i = 0; i < 6; i++) capture.frame(.06); await flush();
  expect(Playback.latest.pause).toHaveBeenCalledOnce(); expect(session.snapshot().speaking).toBe(false);
  expect(session.snapshot().listening).toBe(true); expect(LocalAudio.processor).toBe(capture);
  expect(session.snapshot().interim).toBe(words);
  for (let i = 0; i < 6; i++) capture.frame(0); await flush(); await playback;
  expect(send).toHaveBeenCalledExactlyOnceWith(words); expect(session.snapshot().enabled).toBe(true);
});
it("prepares only the next audio chunk during playback and stops lookahead after an interruption", async () => {
  api.post.mockImplementation(async (_path, body) => body.op === "speak" ? { audio: "YQ==" } : { ready: true });
  session.bind(binding); await flush();
  const playback = session.speak("The review is ready. The launch needs one approval. The remaining work is scheduled.");
  await flush();
  const calls = () => api.post.mock.calls.filter(call => call[1].op === "speak");
  expect(calls().map(call => call[1].text)).toEqual(["The review is ready.", "The launch needs one approval."]);
  expect(Playback.latest.play).toHaveBeenCalledOnce();
  session.stopSpeaking(); await playback; await flush();
  expect(calls()).toHaveLength(2);
  expect(session.snapshot().speaking).toBe(false);
});

it("plays prepared chunks in order without waiting to start synthesis at the audio boundary", async () => {
  api.post.mockImplementation(async (_path, body) => body.op === "speak" ? { audio: btoa(body.text) } : { ready: true });
  session.bind(binding); await flush();
  const playback = session.speak("The review is ready. The launch needs one approval.");
  await flush();
  const first = Playback.latest;
  expect(first.src).toContain(btoa("The review is ready."));
  first.onended?.(); await flush();
  expect(Playback.latest).not.toBe(first);
  expect(Playback.latest.src).toContain(btoa("The launch needs one approval."));
  Playback.latest.onended?.(); await playback;
  expect(session.snapshot().speaking).toBe(false);
});

it("measures final transcription including outstanding preview work, then submission separately", async () => {
  let now = 0;
  session = new FridayVoiceSession(() => now);
  let finishPreview!: (value: { text: string }) => void, finishFinal!: (value: { text: string }) => void, acknowledge!: () => void;
  let requests = 0;
  api.post.mockImplementation((_path, body) => body.op === "prepare" ? Promise.resolve({ ready: true }) : ++requests === 1
    ? new Promise(resolve => { finishPreview = resolve; }) : new Promise(resolve => { finishFinal = resolve; }));
  send.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06);
  now = 100;
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(0);
  await flush();
  expect(session.snapshot().timings.transcription).toEqual({ status: "pending", durationMs: null });
  now = 450; finishPreview({ text: "Show my" }); await flush();
  now = 900; finishFinal({ text: "Show my projects" }); await flush();
  expect(session.snapshot().timings.transcription).toEqual({ status: "measured", durationMs: 800 });
  expect(session.snapshot().timings.submission.status).toBe("pending");
  now = 940; acknowledge(); await flush();
  expect(session.snapshot().timings.submission).toEqual({ status: "measured", durationMs: 40 });
  expect(JSON.stringify(session.snapshot().timings)).not.toContain("Show my projects");
});

it("includes speech preparation in final transcription timing", async () => {
  let now = 0;
  session = new FridayVoiceSession(() => now);
  let ready!: () => void, finish!: (value: { text: string }) => void;
  api.post.mockImplementation((_path, body) => body.op === "prepare"
    ? new Promise<void>(resolve => { ready = resolve; }) : new Promise(resolve => { finish = resolve; }));
  session.bind(binding); await flush(); session.toggle(); await flush();
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(.06);
  now = 100;
  for (let i = 0; i < 6; i++) LocalAudio.processor.frame(0);
  await flush(); expect(finish).toBeUndefined();
  now = 400; ready(); await flush();
  now = 1000; finish({ text: "Show my projects" }); await flush();
  expect(session.snapshot().timings.transcription).toEqual({ status: "measured", durationMs: 900 });
});

it("times audio only after play resolves and ignores a late start after the conversation changes", async () => {
  let now = 0;
  session = new FridayVoiceSession(() => now);
  let synthesized!: (value: { audio: string }) => void, started!: () => void;
  api.post.mockImplementation((_path, body) => body.op === "prepare" ? Promise.resolve({ ready: true }) : new Promise(resolve => { synthesized = resolve; }));
  Playback.playResult = () => new Promise<void>(resolve => { started = resolve; });
  session.bind(binding); await flush();
  now = 100;
  const playback = session.speak("Your review is ready.");
  now = 300; synthesized({ audio: "YQ==" }); await flush();
  expect(session.snapshot().timings.playback).toEqual({ status: "pending", durationMs: null });
  now = 550; started(); await flush();
  expect(session.snapshot().timings.playback).toEqual({ status: "measured", durationMs: 450 });
  Playback.latest.onended?.(); await playback;

  const later = session.speak("Another reply.");
  synthesized({ audio: "YQ==" }); await flush();
  session.bind({ ...binding, key: "other:employee", companyId: "other" });
  now = 2000; started(); await later; await flush();
  expect(session.snapshot().timings.companyId).toBe("other");
  expect(session.snapshot().timings.playback).toEqual({ status: "unmeasured", durationMs: null });
});

it("speaks the native final stream before persistence and appends without replaying the saved answer", async () => {
  api.post.mockImplementation(async (_path, body) => body.op === "speak" ? { audio: btoa(body.text) } : { ready: true });
  session.bind(binding); await flush();
  const reply = { id: "native-final", runId: "run", streaming: true, body: "Your microphone works. The next" };
  session.bind({ ...binding, busy: true, liveReply: reply }); await flush();
  const first = Playback.latest;
  expect(first.src).toContain(btoa("Your microphone works."));
  expect(session.snapshot().playing).toBe(true);
  session.bind({ ...binding, busy: true }); await flush();
  expect(first.pause).not.toHaveBeenCalled();
  expect(session.snapshot().playing).toBe(true);
  first.onended?.(); await flush();
  expect(session.snapshot().playing).toBe(false);
  session.bind({ ...binding, busy: true, liveReply: { ...reply, body: "Your microphone works. The next step is ready. More" } }); await flush();
  expect(Playback.latest.src).toContain(btoa("The next step is ready."));
  Playback.latest.onended?.(); await flush();
  session.bind({ ...binding, reply: { id: "saved", runId: "run", committed: true, body: "Your microphone works. The next step is ready. More later." } }); await flush();
  expect(Playback.latest.src).toContain(btoa("More later."));
  Playback.latest.onended?.(); await flush();
  session.bind({ ...binding, reply: { id: "saved", runId: "run", committed: true, body: "Your microphone works. The next step is ready. More later." } }); await flush();
  expect(api.post.mock.calls.filter(call => call[1].op === "speak").map(call => call[1].text))
    .toEqual(["Your microphone works.", "The next step is ready.", "More later."]);
  expect(session.snapshot().speaking).toBe(false);
});

it("aborts synthesis on interruption and never resumes the cancelled stream when it is saved", async () => {
  let signal: AbortSignal | undefined;
  api.post.mockImplementation((_path, body, options) => body.op === "speak" ? new Promise((_resolve, reject) => {
    signal = options.signal; signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }) : Promise.resolve({ ready: true }));
  session.bind(binding); await flush();
  const reply = { id: "native-final", runId: "run", streaming: true, body: "This reply is obsolete. More" };
  session.bind({ ...binding, busy: true, liveReply: reply }); await flush();
  expect(signal?.aborted).toBe(false);
  session.stopSpeaking(); expect(signal?.aborted).toBe(true); await flush();
  session.bind({ ...binding, liveReply: { ...reply, body: "This reply is obsolete. More old text." } });
  session.bind({ ...binding, reply: { id: "saved", runId: "run", committed: true, body: "Revised wording from the interrupted answer." } }); await flush();
  expect(api.post.mock.calls.filter(call => call[1].op === "speak")).toHaveLength(1);
  expect(session.snapshot()).toMatchObject({ speaking: false, playing: false, error: "" });
});
