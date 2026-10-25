import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Volume2, Square } from "lucide-react";
import { Button } from "./ui/button";

interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type VoiceWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export function spokenReply(text: string) {
  return text.replace(/```[\s\S]*?```/g, " Code is available in the conversation. ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " linked source ").replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
}

/** Microphone activation is explicit. Voice turns use the native sender, with
 * recoverable draft fallback; legacy dictation can remain draft-only. */
export function FridayVoiceControls({ onTranscript, reply, disabled = false, renderPresence, compact = false, speakReplies = false, onVoiceMessage }: {
  onTranscript: (text: string) => void;
  reply?: { id: string; body: string; createdAt?: Date | string };
  disabled?: boolean;
  compact?: boolean;
  speakReplies?: boolean;
  onVoiceMessage?: (text: string) => Promise<void>;
  renderPresence?: (voice: { listening: boolean; speaking: boolean; starting: boolean; canListen: boolean; toggleListening: () => void }) => ReactNode;
}) {
  const host = window as unknown as VoiceWindow;
  const RecognitionClass = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  const synthesis = typeof window.speechSynthesis === "undefined" ? null : window.speechSynthesis;
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(() => {
    if (!speakReplies) return false;
    try { return localStorage.getItem("paperclip.friday.speakReplies") !== "false"; } catch { return true; }
  });
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const captured = useRef("");
  const voiceFailed = useRef(false);
  const voiceCallback = useRef(onVoiceMessage);
  voiceCallback.current = onVoiceMessage;
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const transcriptCallback = useRef(onTranscript);
  transcriptCallback.current = onTranscript;
  const seenReply = useRef(reply?.id ?? "");
  const speakSince = useRef(Date.now());
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const stopSpeaking = () => { if (utterance.current) { utterance.current.onend = null; utterance.current.onerror = null; } synthesis?.cancel(); utterance.current = null; setSpeaking(false); };
  const stopListening = () => { const draft = captured.current.trim(); captured.current = ""; if (draft) transcriptCallback.current(draft); const active = recognition.current; recognition.current = null; if (active) { active.onstart = null; active.onend = null; active.onerror = null; active.onresult = null; active.abort(); } setListening(false); setStarting(false); setInterim(""); };

  useEffect(() => {
    const update = () => setVoices(synthesis?.getVoices() ?? []);
    update(); synthesis?.addEventListener("voiceschanged", update);
    const hidden = () => { if (document.hidden) { stopListening(); stopSpeaking(); } };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      const active = recognition.current;
      if (active) { active.onstart = null; active.onend = null; active.onresult = null; active.onerror = null; active.abort(); }
      if (utterance.current) { utterance.current.onend = null; utterance.current.onerror = null; synthesis?.cancel(); }
      synthesis?.removeEventListener("voiceschanged", update);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [synthesis]);

  function speak(body: string) {
    if (!synthesis || !body.trim()) return;
    stopListening(); stopSpeaking(); setError("");
    // Short utterances avoid the truncation seen with long browser speech calls.
    const chunks = spokenReply(body).match(/.{1,220}(?:\s|$)|\S{1,220}/g) ?? [];
    const voice = voices.find(item => item.voiceURI === voiceURI) ?? voices.find(item => item.localService && /^en\b/.test(item.lang));
    const play = (index: number) => {
      if (index >= chunks.length) { utterance.current = null; setSpeaking(false); return; }
      const next = new SpeechSynthesisUtterance(chunks[index]);
      if (voice) next.voice = voice;
      next.onend = () => play(index + 1);
      next.onerror = event => { utterance.current = null; setSpeaking(false); if (event.error !== "canceled" && event.error !== "interrupted") setError(event.error === "not-allowed" ? "Your browser blocked automatic audio. Click Read reply to start playback." : "Speech playback failed. Try Read reply or choose another voice."); };
      utterance.current = next; synthesis.speak(next);
    };
    setSpeaking(true); play(0);
  }
  useEffect(() => {
    if (!reply || reply.id === seenReply.current) return;
    seenReply.current = reply.id;
    // Never replay loaded history when opening Friday. Speak new replies only.
    const arrivedAfterOptIn = !reply.createdAt || new Date(reply.createdAt).getTime() >= speakSince.current;
    if (autoSpeak && arrivedAfterOptIn && !document.hidden && !recognition.current) speak(reply.body);
  }, [reply?.id, autoSpeak]);
  useEffect(() => { if (disabled) stopListening(); }, [disabled]);
  useEffect(() => { if (speakReplies) { try { localStorage.setItem("paperclip.friday.speakReplies", String(autoSpeak)); } catch { /* Storage is optional. */ } } }, [autoSpeak, speakReplies]);

  function listen() {
    if (!RecognitionClass || disabled || sendingRef.current) return;
    stopSpeaking(); setError(""); setInterim(""); captured.current = ""; voiceFailed.current = false;
    const active = new RecognitionClass();
    active.lang = navigator.language || "en-US"; active.continuous = true; active.interimResults = true;
    active.onstart = () => { if (recognition.current === active) { setStarting(false); setListening(true); } };
    active.onend = () => {
      if (recognition.current !== active) return;
      recognition.current = null; setStarting(false); setListening(false); setInterim("");
      const text = captured.current.trim(); captured.current = "";
      if (!text || !voiceCallback.current) return;
      if (voiceFailed.current || document.hidden) { transcriptCallback.current(text); return; }
      sendingRef.current = true; setSending(true);
      void voiceCallback.current(text).catch(error => {
        transcriptCallback.current(text);
        setError(error instanceof Error ? error.message : "Voice message could not be sent. Review your draft.");
      }).finally(() => { sendingRef.current = false; setSending(false); });
    };
    active.onerror = event => {
      voiceFailed.current = true;
      if (event.error !== "aborted") setError(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone or speech recognition permission was denied. Allow it in your browser settings, or type."
        : event.error === "audio-capture" ? "No microphone is available. Connect a microphone, or type."
          : `Dictation stopped (${event.error}). Your saved draft is still available.`);
      setStarting(false); setListening(false);
    };
    active.onresult = event => {
      if (recognition.current !== active) return;
      let partial = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) { const text = result[0].transcript.trim(); if (text) {
          if (voiceCallback.current) captured.current = [captured.current, text].filter(Boolean).join(" ");
          else transcriptCallback.current(text);
        } }
        else partial += result[0].transcript;
      }
      setInterim([captured.current, partial].filter(Boolean).join(" "));
    };
    recognition.current = active; setStarting(true);
    try { active.start(); } catch { recognition.current = null; setStarting(false); setError("The browser could not start dictation. Try again or type."); }
  }
  const toggleListening = () => starting ? stopListening() : listening ? recognition.current?.stop() : listen();
  const preferences = <>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={autoSpeak} disabled={!synthesis} onChange={event => { setAutoSpeak(event.target.checked); speakSince.current = Date.now(); seenReply.current = reply?.id ?? ""; if (!event.target.checked) stopSpeaking(); }} />Speak new replies</label>
      {!!voices.length && <select aria-label="Friday voice" className="rounded-md border bg-background px-2 py-1 text-xs" value={voiceURI} onChange={event => setVoiceURI(event.target.value)}><option value="">System voice</option>{voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select>}
      <p className="text-xs text-muted-foreground">{RecognitionClass ? "Browser dictation may send audio to your browser’s speech provider. Listening stops when you leave this page." : "This browser does not support dictation. Use browser/OS dictation or type; speech playback is available where supported."}</p>
  </>;
  return <div className={compact ? "friday-voice" : "space-y-2"} aria-label="Friday voice controls">
    {renderPresence?.({ listening, speaking, starting, canListen: !!RecognitionClass && !disabled && !sending, toggleListening })}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={listening ? "default" : "outline"} disabled={!RecognitionClass || disabled || sending} onClick={toggleListening}>{listening || starting ? <MicOff /> : <Mic />}{sending ? "Sending…" : listening ? onVoiceMessage ? "Send voice message" : "Stop listening" : starting ? "Cancel microphone" : "Talk to Friday"}</Button>
      <Button type="button" variant="outline" size="sm" disabled={!synthesis || !reply} onClick={() => reply && speak(reply.body)}><Volume2 />Read reply</Button>
      {compact && <Button type="button" variant="ghost" size="sm" disabled={!synthesis} aria-pressed={autoSpeak} onClick={() => { setAutoSpeak(value => !value); speakSince.current = Date.now(); if (autoSpeak) stopSpeaking(); }}>{autoSpeak ? "Mute replies" : "Unmute replies"}</Button>}
      {speaking && <Button type="button" variant="outline" size="sm" onClick={stopSpeaking}><Square />Stop speaking</Button>}
    </div>
    {compact ? <details className="friday-voice-settings"><summary className="cursor-pointer text-xs text-muted-foreground">Voice settings</summary><div className="space-y-2 pt-2">{preferences}</div></details> : preferences}
    {compact && !RecognitionClass && <p className="text-xs text-muted-foreground">Voice input is unavailable in this browser. You can still type and listen to replies.</p>}
    {onVoiceMessage && listening && <p className="text-xs text-muted-foreground">Tap the orb again to send when you finish speaking.</p>}
    {interim && <p role="status" className="text-sm text-muted-foreground">{interim}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
