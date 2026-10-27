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
let session: FridayVoiceSession;
const send = vi.fn().mockResolvedValue(undefined), draft = vi.fn(), stop = vi.fn();
const binding = { key: "company:friday", companyId: "company", disabled: false, send, draft };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ available: true });
  api.post.mockResolvedValue({ ready: true });
  vi.stubGlobal("AudioContext", LocalAudio);
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
