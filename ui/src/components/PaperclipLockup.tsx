import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

interface PaperclipLockupProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  decorative?: boolean;
  title?: string;
}

/** Compatibility export for native surfaces; the visible lockup is AgentOS. */
export function PaperclipLockup({ decorative = false, title = "AgentOS", className, ...rest }: PaperclipLockupProps) {
  return <svg {...rest} className={cn("agentos-wordmark", className)} viewBox="0 0 170 36"
    role={decorative ? undefined : "img"} aria-hidden={decorative ? true : undefined}
    aria-label={decorative ? undefined : title} focusable="false">
    <image href="/agentos-mark.svg" x="0" y="0" width="36" height="36" />
    <text x="43" y="25" fill="currentColor">AgentOS</text>
  </svg>;
}
