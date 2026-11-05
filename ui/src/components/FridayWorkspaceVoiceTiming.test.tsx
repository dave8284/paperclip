// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { Company } from "@paperclipai/shared";
import { FridayWorkspace } from "./FridayWorkspace";
import { fridayVoiceSession } from "@/lib/friday-voice-session";

const fixture = vi.hoisted(() => ({ get: vi.fn(async () => ({ available: false })), company: { id: "business", name: "Selected business", purpose: "business", requireBoardApprovalForNewAgents: true } }));
vi.mock("@/api/client", () => ({ api: { get: fixture.get } }));
vi.mock("@/api/companies", () => ({ companiesApi: { get: async () => fixture.company } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("./FridayPresence", () => ({ FridayPresence: () => null }));
vi.mock("./AgentOSCompanyScope", () => ({ AgentOSCompanyScope: ({ children }: any) => children }));
vi.mock("./AgentOSDelete", () => ({ AgentOSDelete: () => null }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: any) => <a href={to}>{children}</a> }));

it("shows the active platform conversation timing in business settings without changing API scope or exposing other sessions", async () => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const synthesis = { getVoices: () => [], speak: vi.fn(), cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("speechSynthesis", synthesis);
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const binding = { key: "platform:friday", companyId: "platform", disabled: false, draft: vi.fn() };
  const data = { issueId: null, companyId: "platform", voiceSessionKey: binding.key, attachments: [], workProducts: [], reply: undefined, onTranscript: vi.fn(), voiceDisabled: false, runStatus: "idle" as const, awaitingInput: false, unavailable: false, loading: false };
  const render = (sessionKey = binding.key) => root.render(<QueryClientProvider client={client}><FridayWorkspace companyId="platform" data={{ ...data, voiceSessionKey: sessionKey }} panel="settings" setPanel={vi.fn()} compact={false} connected view={{ panel: "settings", companyId: "business" }} companies={[fixture.company as Company]} /></QueryClientProvider>);
  try {
    fridayVoiceSession.bind(binding);
    await act(async () => render());
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Voice")!.click());
    let playback!: Promise<void>;
    await act(async () => { playback = fridayVoiceSession.speak("A measured reply."); });
    now = 350;
    await act(async () => { synthesis.speak.mock.calls[0][0].onstart(); });
    expect(host.textContent).toContain("250 ms");
    expect(fixture.get).toHaveBeenCalledWith("/companies/business/friday/voice");
    await act(async () => render("platform:another-conversation"));
    expect(host.textContent).not.toContain("250 ms");
    await act(async () => render());
    expect(host.textContent).toContain("250 ms");
    await act(async () => { synthesis.speak.mock.calls[0][0].onend(); await playback; });
    vi.useFakeTimers();
    await act(async () => { fridayVoiceSession.unbind(binding.key); await vi.advanceTimersByTimeAsync(1500); });
    expect(host.textContent).not.toContain("250 ms");
    expect(host.textContent).toContain("Not measured yet");
  } finally {
    vi.useRealTimers();
    await act(async () => root.unmount()); client.clear(); host.remove(); fridayVoiceSession.disable(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
