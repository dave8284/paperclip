import type { SVGProps } from "react";
import { cn } from "../lib/utils";
import { FridayOrb } from "./FridayOrb";

/** Compatibility export: inherited clip geometry is replaced with the AgentOS orb. */
export function AnimatedPaperclipIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 128 128" className={cn("agentos-status-mark", className)} aria-hidden="true" {...props}>
    <image href="/agentos-mark.svg" width="128" height="128" />
  </svg>;
}

/** Native route loaders share Friday's existing reduced-motion-aware orb. */
export function PaperclipLoading({ className }: { className?: string }) {
  return <div role="status" className={cn("agentos-route-loading flex min-h-dvh w-full items-center justify-center", className)}>
    <FridayOrb decorative compact state="thinking" label="" />
    <span className="sr-only">Loading AgentOS…</span>
  </div>;
}
