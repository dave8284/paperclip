import { Keyboard, Mic, MicOff } from "lucide-react";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { FridayOrb } from "./FridayOrb";
import { FridayVoiceControls } from "./FridayVoiceControls";

export function FridayPresence({ data, connected, docked = false, assistantName = "Friday", onConversation, onType }: {
  data: AgentConversationFocusData; connected: boolean; docked?: boolean; assistantName?: string; onConversation?: () => void; onType?: () => void;
}) {
  return <div className="agentos-friday-presence" data-docked={docked}>
    <FridayVoiceControls sessionKey={data.voiceSessionKey} companyId={data.companyId} busy={data.runStatus !== "idle"} question={data.clarification} minimal compact speakReplies assistantName={assistantName} reply={data.reply} onTranscript={data.onTranscript} onVoiceMessage={data.onVoiceMessage} disabled={data.voiceDisabled || data.loading || data.unavailable}
      renderPresence={voice => {
        const state = data.unavailable || !connected ? "offline" : voice.speaking ? "speaking" : voice.sending ? "thinking" : voice.hearingSpeech ? "listening" : data.awaitingInput ? "waiting" : data.runStatus === "running" ? "thinking" : data.runStatus === "queued" ? "waiting" : voice.listening ? "listening" : "idle";
        const status = voice.speaking ? voice.enabled ? "Speaking · you can interrupt me" : "Speaking" : voice.sending ? "Finishing your sentence" : voice.hearingSpeech ? "Listening" : voice.starting ? "Opening microphone" : data.clarification ? "I have a quick question" : data.awaitingInput ? "Your decision is needed" : data.loading ? "Loading conversation" : data.unavailable ? "Connection interrupted" : !connected ? "Connect your subscription in settings" : data.runStatus === "running" ? voice.enabled ? "Thinking · you can keep talking" : "Thinking through your request" : data.runStatus === "queued" ? "Waiting to start" : voice.listening && voice.preparing ? "Preparing local speech · listening" : voice.listening ? "Listening · pause briefly to send" : voice.enabled ? "Microphone on · waiting for Friday" : "Here when you need me · mic off";
        return <div className="agentos-presence-controls" data-voice-state={state}>
          <div className="agentos-presence-orb">
            <FridayOrb state={state} compact={docked} label={`Toggle ${assistantName} conversation history`} onActivate={onConversation} />
            <button type="button" className="agentos-orb-microphone" data-enabled={voice.enabled} data-listening={voice.listening} disabled={!voice.canListen} onClick={voice.toggleListening} aria-pressed={voice.enabled} aria-label={voice.enabled ? "Pause microphone" : `Talk to ${assistantName}`} title={voice.enabled ? "Microphone enabled · click to mute" : `Microphone muted · talk to ${assistantName}`}>
              {voice.enabled ? <Mic data-testid="friday-mic-listening" /> : <MicOff data-testid="friday-mic-paused" />}
            </button>
          </div>
          <div className="agentos-presence-status"><strong>{assistantName}</strong><span className={voice.interim ? "agentos-live-transcript" : undefined} data-listening={voice.listening} role="status" aria-live="polite" aria-label={voice.interim ? "Live transcription" : undefined}>{voice.interim || status}</span></div>
          {!docked && <button type="button" className="agentos-prefer-type" onClick={onType}><Keyboard />Prefer to type?</button>}
        </div>;
      }} />
  </div>;
}
