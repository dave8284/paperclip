// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IssueComment } from "@paperclipai/shared";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { FridayPresence } from "./FridayPresence";

vi.mock("./FridayOrb", () => ({ FridayOrb: ({ state }: { state: string }) => <div data-orb-state={state} /> }));
class Utterance { constructor(public text: string) {} }
const synthesis = { getVoices: () => [], speak: vi.fn(), cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
const data: AgentConversationFocusData = { issueId: "chat", attachments: [], workProducts: [], reply: undefined, onTranscript: vi.fn(), voiceDisabled: false, runStatus: "idle", awaitingInput: false, unavailable: false, loading: false };
let host: HTMLDivElement, root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  vi.stubGlobal("speechSynthesis", synthesis); vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const render = (next = data) => act(async () => root.render(<FridayPresence data={next} connected />));
const reply = () => ({ ...data, reply: { id: "reply", body: "Your review is ready.", createdAt: new Date(Date.now() + 1000) } as IssueComment });

it("shows preparation until actual playback starts, then returns to the muted state when it ends", async () => {
  await render(); await render(reply());
  expect(host.textContent).toContain("Preparing reply audio");
  expect(host.querySelector("[data-orb-state]")?.getAttribute("data-orb-state")).toBe("thinking");
  expect(host.textContent).not.toContain("Speaking");
  const utterance = synthesis.speak.mock.calls[0][0];
  await act(async () => utterance.onstart());
  expect(host.textContent).toContain("Speaking");
  expect(host.querySelector("[data-orb-state]")?.getAttribute("data-orb-state")).toBe("speaking");
  expect(host.querySelector('[aria-label="Talk to Friday"]')?.getAttribute("aria-pressed")).toBe("false");
  await act(async () => utterance.onend());
  expect(host.textContent).toContain("mic off");
  expect(host.textContent).not.toContain("Speaking");
});

it("does not show a late playback start after a native hold cancels the prepared reply", async () => {
  await render(); const next = reply(); await render(next);
  const utterance = synthesis.speak.mock.calls[0][0];
  await render({ ...next, voiceDisabled: true, awaitingInput: true });
  await act(async () => utterance.onstart());
  expect(host.textContent).toContain("Your decision is needed");
  expect(host.textContent).not.toContain("Speaking");
  expect(host.textContent).not.toContain("Preparing reply audio");
});
