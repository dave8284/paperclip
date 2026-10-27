import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useFridayVoicePreferences, setFridayVoicePreferences } from "@/lib/friday-voice-preferences";
import { Button } from "./ui/button";
export function AgentOSVoiceSettings({ companyId }: { companyId: string }) {
  const preferences = useFridayVoicePreferences();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const voice = useQuery({ queryKey: ["friday-voice", companyId], queryFn: () => api.get<{ available: boolean; reason: string | null }>(`/companies/${companyId}/friday/voice`) });
  useEffect(() => {
    const update = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    update(); window.speechSynthesis?.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", update);
  }, []);
  return <section className="max-w-2xl space-y-5"><h2 className="text-lg font-semibold">Friday’s voice</h2>
    <p>{voice.data?.available ? "Local speech is ready · Whisper + Kokoro" : voice.data?.reason ?? "Checking local speech…"}</p>
    <label className="flex items-center gap-3"><input type="checkbox" checked={preferences.speakReplies} onChange={event => setFridayVoicePreferences({ speakReplies: event.target.checked })} />Speak replies when the microphone is enabled</label>
    {!voice.data?.available && !!voices.length && <label className="block text-sm">Browser fallback voice<select className="mt-2 w-full rounded-lg border bg-background p-3" value={preferences.voiceURI} onChange={event => setFridayVoicePreferences({ voiceURI: event.target.value })}><option value="">System voice</option>{voices.map(item => <option key={item.voiceURI} value={item.voiceURI}>{item.name} · {item.lang}</option>)}</select></label>}
    <p className="text-sm text-muted-foreground">Tap the microphone on Friday to begin. Red means muted; blue means enabled. Your words appear as you speak. A brief pause sends your turn, and you can interrupt Friday and keep talking while she thinks. Moving to another view keeps the mic enabled and minimises the conversation.</p>
    <p className="text-sm text-muted-foreground">Local speech runs on this computer; audio is not retained. The transcript goes to your connected agent. Browser speech fallback may use your browser’s speech provider.</p>
    <Button variant="outline" onClick={() => void voice.refetch()}>Check local speech</Button>{voice.error && <p role="alert" className="text-destructive">{voice.error.message}</p>}
  </section>;
}
