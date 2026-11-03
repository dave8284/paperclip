import { FridayOrb } from "./FridayOrb";
import { cn } from "@/lib/utils";

export function AgentOSLoading({ className }: { className?: string }) {
  return <div className={cn("agentos-public agentos-loading", className)} role="status" aria-label="Opening AgentOS">
    <FridayOrb decorative compact state="thinking" label="" />
    <span>Opening AgentOS…</span>
  </div>;
}
