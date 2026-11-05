import { useSyncExternalStore } from "react";
import { FridayVoiceSession, fridayVoiceSession, type VoiceTimingContext, type VoiceTimingMeasurement } from "@/lib/friday-voice-session";

function measurement(value?: VoiceTimingMeasurement) {
  if (!value || value.status === "unmeasured") return "Not measured yet";
  if (value.status === "measured" && value.durationMs !== null) return value.durationMs < 1 ? "<1 ms" : `${Math.round(value.durationMs).toLocaleString()} ms`;
  if (value.status === "pending") return "In progress";
  if (value.status === "failed") return "Failed";
  if (value.status === "cancelled") return "Cancelled";
  return "Unavailable";
}

export function FridayVoiceTiming({ session = fridayVoiceSession, context }: { session?: FridayVoiceSession; context?: VoiceTimingContext }) {
  const voice = useSyncExternalStore(session.subscribe, session.snapshot);
  const timings = context && voice.timings.active && voice.timings.sessionKey === context.sessionKey && voice.timings.companyId === context.companyId ? voice.timings : undefined;
  return <details className="space-y-2">
    <summary className="cursor-pointer text-sm font-medium">Voice response timing</summary>
    <p className="text-xs text-muted-foreground">Latest individual operations on this device. These measurements may come from different turns.</p>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt>Final transcription</dt><dd className="text-right font-mono">{measurement(timings?.transcription)}</dd>
      <dt>Message acknowledgment</dt><dd className="text-right font-mono">{measurement(timings?.submission)}</dd>
      <dt>Speech playback start</dt><dd className="text-right font-mono">{measurement(timings?.playback)}</dd>
      <dt>Agent response / total</dt><dd className="text-right text-muted-foreground">Not measured</dd>
    </dl>
    <p className="text-xs text-muted-foreground">Transcription includes pending speech setup and preview work. Playback includes synthesis until the browser reports audio has started. Agent response and total time need a confirmed link between each sent turn and its reply; overlapping turns cannot be attributed reliably here.</p>
    <p className="text-xs text-muted-foreground">Timing stays in memory for this conversation. It records no words or audio and clears when the conversation changes.</p>
  </details>;
}
