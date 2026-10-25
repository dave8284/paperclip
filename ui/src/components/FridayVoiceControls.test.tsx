// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FridayVoiceControls } from "./FridayVoiceControls";

class Recognition {
  static latest: Recognition;
  onstart?: () => void; onend?: () => void;
  onerror?: (event: { error: string }) => void;
  onresult?: (event: unknown) => void;
  start = vi.fn(() => this.onstart?.()); stop = vi.fn(() => this.onend?.()); abort = vi.fn();
  constructor() { Recognition.latest = this; }
}
class Utterance { constructor(public text: string) {} }
describe("Friday browser voice", () => {
  let host: HTMLDivElement, root: Root;
  const transcript = vi.fn();
  const synthesis = { getVoices: () => [], speak: vi.fn(), cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks(); vi.stubGlobal("SpeechRecognition", Recognition); vi.stubGlobal("speechSynthesis", synthesis); vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  async function render(reply?: { id: string; body: string }) { await act(async () => root.render(<FridayVoiceControls onTranscript={transcript} reply={reply} />)); }
  async function click(label: string) { await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes(label))!.click()); }
  it("does not activate the microphone on mount and adds final transcript once without sending", async () => {
    await render(); expect(transcript).not.toHaveBeenCalled();
    await click("Talk to Friday");
    expect(host.textContent).toContain("Stop listening");
    await act(async () => Recognition.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Create" } }] }));
    expect(transcript).not.toHaveBeenCalled();
    await act(async () => Recognition.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Create a project" } }] }));
    expect(transcript).toHaveBeenCalledExactlyOnceWith("Create a project");
    await click("Stop listening"); expect(Recognition.latest.stop).toHaveBeenCalledOnce();
  });
  it("shows denied permission without losing the text path and cleans up on leaving", async () => {
    await render(); await click("Talk to Friday");
    await act(async () => Recognition.latest.onerror?.({ error: "not-allowed" }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("permission was denied");
    await act(async () => root.unmount());
    expect(Recognition.latest.abort).toHaveBeenCalled();
    root = createRoot(host);
  });
  it("never reads history automatically, speaks new replies only after opt-in, and can stop", async () => {
    await render({ id: "old", body: "Earlier reply" }); expect(synthesis.speak).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(synthesis.speak).not.toHaveBeenCalled();
    await render({ id: "new", body: "Your project is ready." });
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(synthesis.speak.mock.calls[0][0].text).toBe("Your project is ready.");
    await render({ id: "new", body: "Your project is ready." }); expect(synthesis.speak).toHaveBeenCalledOnce();
    await click("Stop speaking"); expect(synthesis.cancel).toHaveBeenCalled();
  });
  it("makes unsupported dictation explicit while retaining reply playback", async () => {
    vi.stubGlobal("SpeechRecognition", undefined); vi.stubGlobal("webkitSpeechRecognition", undefined);
    await render({ id: "reply", body: "The plan is ready." });
    expect(host.textContent).toContain("does not support dictation");
    expect(Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Talk to Friday"))?.disabled).toBe(true);
    await click("Read reply"); expect(synthesis.speak).toHaveBeenCalledOnce();
  });
  it("sends a completed voice turn once and preserves text when recognition fails", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<FridayVoiceControls onTranscript={transcript} onVoiceMessage={send} />));
    await click("Talk to Friday");
    const result = (text: string) => Recognition.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
    await act(async () => { result("Create a project"); result("for the website"); });
    expect(send).not.toHaveBeenCalled();
    await click("Send voice message");
    await act(async () => Recognition.latest.onend?.());
    expect(send).toHaveBeenCalledExactlyOnceWith("Create a project for the website");
    await click("Talk to Friday");
    await act(async () => { result("Keep this draft"); Recognition.latest.onerror?.({ error: "network" }); Recognition.latest.onend?.(); });
    expect(send).toHaveBeenCalledOnce();
    expect(transcript).toHaveBeenCalledExactlyOnceWith("Keep this draft");
  });
  it("defaults Friday to spoken new replies, skips history and remembers mute", async () => {
    const show = async (id: string, createdAt: string) => act(async () => root.render(<FridayVoiceControls compact speakReplies onTranscript={transcript} reply={{ id, body: "Your project is ready.", createdAt }} />));
    await show("loaded", "2000-01-01");
    await show("more-history", "2000-01-02");
    expect(synthesis.speak).not.toHaveBeenCalled();
    await show("new", new Date(Date.now() + 1000).toISOString());
    expect(synthesis.speak).toHaveBeenCalledOnce();
    await click("Mute replies");
    expect(localStorage.getItem("paperclip.friday.speakReplies")).toBe("false");
    await show("muted", new Date(Date.now() + 2000).toISOString());
    expect(synthesis.speak).toHaveBeenCalledOnce();
    await click("Read reply");
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
  });
});
