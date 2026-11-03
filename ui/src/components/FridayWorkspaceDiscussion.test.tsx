// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { Company } from "@paperclipai/shared";
import { FridayWorkspace } from "./FridayWorkspace";
import { FridayConversationPanel } from "./FridayConversationPanel";
import { fridayVoiceSession } from "@/lib/friday-voice-session";
const message = "Explain decision approval-7. Company: company. Project: launch. Native source: /approvals/approval-7. Related task: task-9. Re-read the source; this is not approval.";
vi.mock("@/api/issues", () => ({ issuesApi: { listDocuments: async () => [] } }));
vi.mock("./FridayPresence", () => ({ FridayPresence: () => <div>Friday</div> }));
vi.mock("./AgentOSPortfolio", () => ({ AgentOSCompanies: () => null, AgentOSDecisionPeek: () => null, AgentOSPortfolioMap: () => null, AgentOSWorkforceTable: () => null, AgentOSScopedRecords: ({ onAsk }: { onAsk: (text: string) => void }) => <button onClick={() => onAsk(message)}>Discuss with Friday</button> }));
vi.mock("@/lib/router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
class Utterance { onend?: () => void; constructor(public text: string) {} }
class Recognition { onstart?: () => void; start() { this.onstart?.(); } abort() {} }
afterEach(() => { fridayVoiceSession.disable(); fridayVoiceSession.autoSpeak = true; vi.unstubAllGlobals(); });
it.each([false, true])("opens and retains the docked decision conversation, passes its context, and requests speech with the microphone enabled=%s", async microphoneEnabled => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const send = vi.fn().mockResolvedValue(undefined), draft = vi.fn(), speak = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), resume: vi.fn(), getVoices: () => [] }); vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("SpeechRecognition", Recognition);
  const key = `company:friday:discussion:${microphoneEnabled}`;
  fridayVoiceSession.bind({ key, disabled: false, send, draft }); fridayVoiceSession.autoSpeak = false;
  if (microphoneEnabled) fridayVoiceSession.toggle();
  function Workspace() {
    const [open, setOpen] = useState(false);
    return <><FridayWorkspace companyId="company" companies={[{ id: "company", name: "Launch Co" } as Company]} panel="attention" view={{ panel: "attention", companyId: "company" }} setPanel={vi.fn()} compact={open} connected onConversation={() => setOpen(value => !value)} onType={() => setOpen(true)} data={{ issueId: "conversation", voiceSessionKey: key, attachments: [], workProducts: [], reply: undefined, onTranscript: draft, onVoiceMessage: send, voiceDisabled: false, runStatus: "idle", awaitingInput: false, unavailable: false, loading: false }} />
      <FridayConversationPanel focus={{ canvas: true, docked: true, showTranscript: open, onClose: () => setOpen(false), render: () => null }} open={open} required={false}>Recorded discussion</FridayConversationPanel></>;
  }
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Workspace /></QueryClientProvider>));
    const panel = host.querySelector<HTMLElement>('[aria-label="Conversation with Friday"]')!;
    expect(panel.hidden).toBe(true);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Discuss with Friday")!.click());
    expect(send).toHaveBeenCalledExactlyOnceWith(message); expect(draft).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(false); expect(panel.dataset.docked).toBe("true");
    fridayVoiceSession.bind({ key, disabled: false, send, draft, reply: { id: "answer", body: "I recommend reviewing the launch evidence before approving." } });
    expect(speak).toHaveBeenCalledOnce(); expect(fridayVoiceSession.snapshot().enabled).toBe(microphoneEnabled); expect(fridayVoiceSession.autoSpeak).toBe(false);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Discuss with Friday")!.click());
    expect(panel.hidden).toBe(false); expect(send).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
