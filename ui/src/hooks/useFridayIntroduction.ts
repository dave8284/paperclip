import { useCallback, useEffect, useState } from "react";

function readIntroduction(key: string) {
  try { return localStorage.getItem(key) === "true"; }
  catch { return false; }
}

/** A presentation preference only; it never opens chat or changes microphone state. */
export function useFridayIntroduction(key: string, conversationStarted: boolean) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const dismiss = useCallback(() => {
    setDismissed(previous => previous.has(key) ? previous : new Set([...previous, key]));
    try { localStorage.setItem(key, "true"); } catch { /* Keep the in-tab preference. */ }
  }, [key]);
  useEffect(() => { if (conversationStarted) dismiss(); }, [conversationStarted, dismiss]);
  // Read the current key during render, so changing conversations never flashes
  // the previous conversation's preference or a dismissed introduction.
  return { introduced: conversationStarted || dismissed.has(key) || readIntroduction(key), dismissIntroduction: dismiss };
}
