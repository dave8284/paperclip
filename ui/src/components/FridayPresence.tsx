import { Keyboard, Mic, MicOff } from "lucide-react";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { FridayOrb } from "./FridayOrb";
import { FridayVoiceControls } from "./FridayVoiceControls";

export function FridayPresence({ data, connected, docked = false, assistantName = "Friday", onConversation, onType }: {
  data: AgentConversationFocusData; connected: boolean; docked?: boolean; assistantName?: string; onConversation?: () => void; onType?: () => void;
}) {
  return <div className="agentos-friday-presence" data-docked={docked}>
    <FridayVoiceControls minimal compact speakReplies assistantName={assistantName} reply={data.reply} onTranscript={data.onTranscript} onVoiceMessage={data.onVoiceMessage} disabled={data.voiceDisabled || data.loading || data.unavailable}
      renderPresence={voice => {
        const state = voice.listening ? "listening" : voice.speaking ? "speaking" : data.awaitingInput ? "waiting" : data.unavailable || !connected ? "offline" : data.runStatus === "running" ? "thinking" : data.runStatus === "queued" ? "waiting" : "idle";
        const status = voice.listening ? "Listening — tap the mic to send" : voice.speaking ? "Speaking" : voice.starting ? "Opening microphone" : data.awaitingInput ? "Your decision is needed" : data.loading ? "Loading conversation" : data.unavailable ? "Connection interrupted" : !connected ? "Connect your subscription in settings" : data.runStatus === "running" ? "Thinking through your request" : data.runStatus === "queued" ? "Waiting to start" : "Here when you need me · mic off";
        return <div className="agentos-presence-controls"><FridayOrb state={state} compact={docked} label={`Open ${assistantName} conversation history`} onActivate={onConversation} /><div className="agentos-presence-status"><strong>{assistantName}</strong><span role="status" aria-live="polite">{status}</span></div>
          <button type="button" className="agentos-talk-button" disabled={!voice.canListen} onClick={voice.toggleListening} aria-pressed={voice.listening} aria-label={voice.listening ? "Send voice message" : voice.starting ? "Cancel microphone" : `Talk to ${assistantName}`}>
            {voice.listening ? <Mic data-testid="friday-mic-listening" /> : <MicOff data-testid="friday-mic-paused" />}<span>{voice.listening ? "Send voice message" : voice.starting ? "Cancel microphone" : `Talk to ${assistantName}`}</span>
          </button>{!docked && <button type="button" className="agentos-prefer-type" onClick={onType}><Keyboard />Prefer to type?</button>}
        </div>;
      }} />
  </div>;
}
