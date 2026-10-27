// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FridayVoiceSession, pcmWave } from "./friday-voice-session";
class Recognition {
  static latest: Recognition; static starts = 0;
  onstart?: () => void; onend?: () => void; onerror?: (event: { error: string }) => void; onresult?: (event: unknown) => void;
  constructor() { Recognition.latest = this; }
  start() { Recognition.starts++; this.onstart?.(); } stop() { this.onend?.(); } abort = vi.fn();
  result(text: string, isFinal = true) { this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] }); }
}
class Utterance { onend?: () => void; constructor(public text: string) {} }
describe("Friday voice session", () => {
  let session: FridayVoiceSession;
  const send = vi.fn().mockResolvedValue(undefined), draft = vi.fn();
  const synthesis = { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() };
  const binding = () => ({ key: "company:friday", disabled: false, draft, send });
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); Recognition.starts = 0; vi.stubGlobal("SpeechRecognition", Recognition); vi.stubGlobal("speechSynthesis", synthesis); vi.stubGlobal("SpeechSynthesisUtterance", Utterance); session = new FridayVoiceSession(); session.bind(binding()); });
  afterEach(() => { session.disable(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("sends after silence once and keeps listening while Friday prepares and speaks a reply", async () => {
    expect(Recognition.starts).toBe(0); session.toggle(); Recognition.latest.result("Show my projects");
    await vi.advanceTimersByTimeAsync(999); expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(send).toHaveBeenCalledExactlyOnceWith("Show my projects"); expect(session.snapshot().enabled).toBe(true); expect(session.snapshot().listening).toBe(true);
    session.bind({ ...binding(), reply: { id: "reply", body: "Here are your projects." } });
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(session.snapshot().listening).toBe(true);
    synthesis.speak.mock.calls[0][0].onend(); await Promise.resolve();
    expect(session.snapshot().listening).toBe(true);
    session.bind({ ...binding(), reply: { id: "reply", body: "Here are your projects." } }); expect(synthesis.speak).toHaveBeenCalledOnce();
  });
  it("does not send while interim speech continues and preserves an explicitly paused turn", async () => {
    session.toggle(); Recognition.latest.result("Show"); await vi.advanceTimersByTimeAsync(800); Recognition.latest.result("my company", false); await vi.advanceTimersByTimeAsync(1500); expect(send).not.toHaveBeenCalled(); session.toggle(); expect(draft).toHaveBeenCalledWith("Show"); expect(session.snapshot().enabled).toBe(false);
  });
  it("keeps microphone and captured text across route remounts for the same conversation", async () => {
    session.toggle(); const active = Recognition.latest; active.result("Show my decisions"); session.unbind("company:friday"); session.bind(binding()); expect(Recognition.latest).toBe(active); await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledOnce();
  });
  it("stops a session when a different employee is opened and never sends the old draft there", async () => {
    session.toggle(); Recognition.latest.result("Private company request"); session.bind({ ...binding(), key: "other:employee" }); await vi.advanceTimersByTimeAsync(1500); expect(send).not.toHaveBeenCalled(); expect(session.snapshot().enabled).toBe(false); expect(draft).toHaveBeenCalledWith("Private company request");
  });
  it("releases the mic after leaving the application without a new conversation", async () => { session.toggle(); const active = Recognition.latest; session.unbind("company:friday"); await vi.advanceTimersByTimeAsync(1500); expect(active.abort).toHaveBeenCalled(); expect(session.snapshot().enabled).toBe(false); });
  it("waits for a complete reply and resumes after an execution ends without one", async () => {
    session.toggle(); Recognition.latest.result("Review the launch"); await vi.advanceTimersByTimeAsync(1000);
    session.bind({ ...binding(), busy: true, reply: { id: "stream", body: "Still working" } });
    expect(synthesis.speak).not.toHaveBeenCalled(); expect(session.snapshot().listening).toBe(true);
    session.bind({ ...binding(), busy: false }); expect(session.snapshot().listening).toBe(true);
    session.bind({ ...binding(), busy: false, reply: { id: "stream", body: "The review is complete." } }); expect(synthesis.speak).toHaveBeenCalledOnce();
  });
  it("encodes bounded mono PCM as a valid WAV", () => { const data = Uint8Array.from(atob(pcmWave([new Float32Array([0, 1, -1])], 16000)), char => char.charCodeAt(0)); const view = new DataView(data.buffer); expect(new TextDecoder().decode(data.slice(0, 4))).toBe("RIFF"); expect(view.getUint32(24, true)).toBe(16000); expect(view.getInt16(46, true)).toBe(32767); expect(view.getInt16(48, true)).toBe(-32768); });
  it("speaks a clarification and listens for its answer while the provider waits", async () => {
    const question = { id: "clarification", body: "Do you mean my voice or the topic?" };
    session.bind({ ...binding(), busy: true, question });
    expect(synthesis.speak).not.toHaveBeenCalled();
    session.toggle();
    expect(synthesis.speak.mock.calls[0][0].text).toBe(question.body);
    synthesis.speak.mock.calls[0][0].onend(); await Promise.resolve();
    expect(session.snapshot().listening).toBe(true);
    session.bind({ ...binding(), busy: true, question });
    expect(synthesis.speak).toHaveBeenCalledOnce();
    Recognition.latest.result("The voice you use"); await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledExactlyOnceWith("The voice you use");
  });
  it("speaks a new question during a voice exchange without replaying earlier ones", async () => {
    session.toggle(); Recognition.latest.result("Use the right one"); await vi.advanceTimersByTimeAsync(1000);
    session.bind({ ...binding(), busy: true, question: { id: "which-one", body: "Which voice do you mean?" } });
    expect(synthesis.speak).toHaveBeenCalledOnce();
    synthesis.speak.mock.calls[0][0].onend(); await Promise.resolve();
    expect(session.snapshot().listening).toBe(true);
    session.unbind("company:friday"); session.bind({ ...binding(), busy: true, question: { id: "which-one", body: "Which voice do you mean?" } });
    expect(synthesis.speak).toHaveBeenCalledOnce();
  });
  it("accepts another turn while execution is busy without disabling the mic", async () => {
    session.toggle(); Recognition.latest.result("Review the launch"); await vi.advanceTimersByTimeAsync(1000);
    session.bind({ ...binding(), busy: true });
    Recognition.latest.result("Include the marketing project"); await vi.advanceTimersByTimeAsync(1000);
    expect(send.mock.calls.map(call => call[0])).toEqual(["Review the launch", "Include the marketing project"]);
    expect(session.snapshot().enabled).toBe(true);
  });
  it.each(["yes", "no", "the voice", "stop", "Here are your projects, but only show the launch"])("interrupts playback with %s without sending speaker echo", async answer => {
    session.toggle(); const playback = session.speak("Here are your projects and their latest decisions.");
    const active = Recognition.latest;
    active.result("Here are your projects and their latest decisions.");
    await vi.advanceTimersByTimeAsync(1200);
    expect(send).not.toHaveBeenCalled(); expect(session.snapshot().speaking).toBe(true);
    active.result(answer, false);
    expect(session.snapshot().speaking).toBe(false); expect(session.snapshot().listening).toBe(true);
    active.result(answer); await vi.advanceTimersByTimeAsync(1000); await playback;
    expect(send).toHaveBeenCalledExactlyOnceWith(answer);
  });
  it("never starts a reply over a detected user turn or bypasses a native hold", async () => {
    session.toggle(); Recognition.latest.result("I have more to add", false);
    session.bind({ ...binding(), reply: { id: "late", body: "The launch is ready." } });
    expect(synthesis.speak).not.toHaveBeenCalled();
    session.bind({ ...binding(), disabled: true, busy: true });
    expect(session.snapshot().enabled).toBe(true); expect(session.snapshot().listening).toBe(false);
    session.bind({ ...binding(), disabled: false, busy: true });
    expect(session.snapshot().listening).toBe(true);
  });
  it("cancels stale playback on a conversation switch", async () => {
    session.toggle(); const playback = session.speak("A reply for the first company.");
    const utterance = synthesis.speak.mock.calls[0][0];
    session.bind({ ...binding(), key: "other:employee" });
    utterance.onend(); await playback;
    expect(session.snapshot().speaking).toBe(false); expect(session.snapshot().enabled).toBe(false); expect(session.snapshot().listening).toBe(false);
  });
});
