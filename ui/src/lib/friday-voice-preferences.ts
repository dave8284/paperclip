import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
let snapshot = { speakReplies: read("paperclip.friday.speakReplies", "true") !== "false", voiceURI: read("agentos.friday.voiceURI", "") };
export function setFridayVoicePreferences(update: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...update };
  try { localStorage.setItem("paperclip.friday.speakReplies", String(snapshot.speakReplies)); localStorage.setItem("agentos.friday.voiceURI", snapshot.voiceURI); } catch { /* Preferences also work in memory. */ }
  listeners.forEach(listener => listener());
}
export function useFridayVoicePreferences() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot);
}
