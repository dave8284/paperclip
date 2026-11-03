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
  onended?: () => void; onerror?: () => void;
  play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
  constructor(public src: string) { Playback.latest = this; }
}
let session: FridayVoiceSession;
const send = vi.fn().mockResolvedValue(undefined), draft = vi.fn(), stop = vi.fn();
const binding = { key: "company:friday", companyId: "company", disabled: false, send, draft };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.clearAllMocks();
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
