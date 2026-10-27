import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Mic, MicOff, Volume2, Square } from "lucide-react";
import { FridayVoiceSession, fridayVoiceSession } from "@/lib/friday-voice-session";
import { Button } from "./ui/button";
export { spokenReply } from "@/lib/friday-voice-session";

export function FridayVoiceControls({ onTranscript, reply, disabled = false, renderPresence, compact = false, minimal = false, speakReplies = false, onVoiceMessage, assistantName = "Friday", sessionKey, companyId, busy, onTurn }: {
  assistantName?: string; onTranscript: (text: string) => void;
  reply?: { id: string; body: string; createdAt?: Date | string };
  disabled?: boolean; compact?: boolean; minimal?: boolean; speakReplies?: boolean;
  onVoiceMessage?: (text: string) => Promise<void>;
  sessionKey?: string; companyId?: string; busy?: boolean; onTurn?: () => void;
  renderPresence?: (voice: { enabled: boolean; listening: boolean; speaking: boolean; starting: boolean; preparing: boolean; sending: boolean; interim: string; canListen: boolean; toggleListening: () => void }) => ReactNode;
}) {
  const session = useMemo(() => sessionKey ? fridayVoiceSession : new FridayVoiceSession(), [!!sessionKey]);
  const voice = useSyncExternalStore(session.subscribe, session.snapshot);
  const [autoSpeak, setAutoSpeak] = useState(() => { try { return speakReplies && localStorage.getItem("paperclip.friday.speakReplies") !== "false"; } catch { return speakReplies; } });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const key = sessionKey ?? "dictation";
  useEffect(() => { session.autoSpeak = autoSpeak; session.voiceURI = voiceURI; session.bind({ key, companyId, disabled, busy, send: onVoiceMessage, draft: onTranscript, reply, onTurn }); });
  useEffect(() => {
    const update = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    update(); window.speechSynthesis?.addEventListener("voiceschanged", update);
    document.addEventListener("visibilitychange", session.visibility);
    window.addEventListener("pagehide", session.disable);
    return () => { window.speechSynthesis?.removeEventListener("voiceschanged", update); document.removeEventListener("visibilitychange", session.visibility); window.removeEventListener("pagehide", session.disable); session.unbind(key); if (!sessionKey) session.disable(); };
  }, [session, key]);
  const toggleAutoSpeak = (value: boolean) => { setAutoSpeak(value); try { localStorage.setItem("paperclip.friday.speakReplies", String(value)); } catch { /* Optional preference. */ } if (!value) session.stopSpeaking(); };
  const canListen = voice.enabled || (!disabled && !voice.checking && session.canListen());
  const preferences = <>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={autoSpeak} onChange={event => toggleAutoSpeak(event.target.checked)} />Speak new replies</label>
    {!voice.local && !!voices.length && <select aria-label={`${assistantName} voice`} className="rounded-md border bg-background px-2 py-1 text-xs" value={voiceURI} onChange={event => setVoiceURI(event.target.value)}><option value="">System voice</option>{voices.map(item => <option key={item.voiceURI} value={item.voiceURI}>{item.name} · {item.lang}</option>)}</select>}
    <p className="text-xs text-muted-foreground">{voice.checking ? "Checking local speech…" : voice.local ? "Whisper + Kokoro · speech runs on this computer. Pause briefly to send; Friday listens again after replying." : session.canListen() ? "Browser speech fallback: your browser may send audio to its speech provider. Pause to send. Your microphone stays enabled as you navigate." : "This browser does not support dictation and local speech is not ready. You can type and listen to replies."}</p>
  </>;
  return <div className={compact ? "friday-voice" : "space-y-2"} aria-label={`${assistantName} voice controls`}>
    {renderPresence?.({ ...voice, canListen, toggleListening: session.toggle })}
    {!minimal && <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant={voice.enabled ? "default" : "outline"} disabled={!canListen} onClick={session.toggle}>{voice.enabled ? <Mic /> : <MicOff />}{voice.enabled ? "Pause microphone" : `Talk to ${assistantName}`}</Button><Button type="button" size="sm" variant="outline" disabled={!reply} onClick={() => reply && void session.speak(reply.body)}><Volume2 />Read reply</Button>{compact && <Button variant="ghost" size="sm" onClick={() => toggleAutoSpeak(!autoSpeak)}>{autoSpeak ? "Mute replies" : "Unmute replies"}</Button>}{voice.speaking && <Button variant="outline" size="sm" onClick={() => session.stopSpeaking()}><Square />Stop speaking</Button>}</div>}
    {compact ? <details className="friday-voice-settings"><summary className="cursor-pointer text-xs text-muted-foreground">Voice settings</summary><div className="space-y-2 pt-2">{preferences}{minimal && <Button type="button" variant="outline" size="sm" disabled={!reply} onClick={() => voice.speaking ? session.stopSpeaking() : reply && void session.speak(reply.body)}><Volume2 />{voice.speaking ? "Stop speaking" : "Read reply"}</Button>}</div></details> : preferences}
    {voice.interim && !renderPresence && <p role="status" className="text-sm text-muted-foreground">{voice.interim}</p>}
    {voice.error && <p role="alert" className="text-sm text-destructive">{voice.error}</p>}
  </div>;
}
