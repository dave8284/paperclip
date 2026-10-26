import { FridayOrb } from "./FridayOrb";
import { cn } from "@/lib/utils";

export function AgentOSLoading({ className }: { className?: string }) {
  return <div className={cn("agentos-public agentos-loading", className)} role="status" aria-label="Opening Agent OS">
    <FridayOrb decorative compact state="thinking" label="" />
    <span>Opening Agent OS…</span>
  </div>;
}
