import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { ConversationFocusView } from "@/lib/conversation-focus";
import { Button } from "./ui/button";

/** Presentation only. The native thread owns history, drafts, approval and send. */
export function FridayConversationPanel({ focus, open, required, children }: { focus?: ConversationFocusView; open: boolean; required: boolean; children: ReactNode }) {
  if (!focus?.canvas) return <>{children}</>;
  return <section className="agentos-conversation-panel" data-docked={focus.docked} hidden={!open} aria-label={`Conversation with ${focus.assistantName ?? "Friday"}`}>
    <header><h2>{focus.assistantName ?? "Friday"}</h2>{required && <span className="text-xs text-muted-foreground">Needs your attention</span>}<Button variant="ghost" size="icon-sm" aria-label="Minimise conversation" onClick={focus.onClose}><X /></Button></header>
    {children}
  </section>;
}
