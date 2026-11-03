import type { HTMLAttributes } from "react";
import { AGENT_PALETTE_IDS, appearanceForPalette } from "@paperclipai/shared";
import { AgentAvatar } from "./AgentAvatar";
import { cn } from "@/lib/utils";

// Preserve saved design previews while using AgentOS's particle portrait.
// No inherited capsule/mascot animation is loaded.
export type AgentCapsuleState = "slot" | "configured" | "online";
export type AgentCapsuleSizePreset = "sm" | "md" | "lg";
export type AgentCapsuleGlow = "green" | "blue";
export const AGENT_GRADIENT_COUNT = 10;
const SIZES = { sm: { width: 24, height: 60 }, md: { width: 34, height: 84 }, lg: { width: 46, height: 116 } };
const LABELS = { slot: "empty agent slot", configured: "agent configured, offline", online: "agent online" };
export interface AgentCapsuleProps extends Omit<HTMLAttributes<HTMLDivElement>, "color"> {
  state: AgentCapsuleState;
  gradient?: number;
  size?: AgentCapsuleSizePreset | { width: number; height: number };
  glow?: AgentCapsuleGlow;
  strokeDraw?: boolean;
}
export function AgentCapsule({ state, gradient = 1, size = "md", glow = "green", strokeDraw: _strokeDraw, className, style, "aria-label": ariaLabel, ...rest }: AgentCapsuleProps) {
  const dimensions = typeof size === "string" ? SIZES[size] : size;
  const index = ((Math.trunc(gradient) - 1) % AGENT_GRADIENT_COUNT + AGENT_GRADIENT_COUNT) % AGENT_GRADIENT_COUNT;
  return <div role="img" aria-label={ariaLabel ?? LABELS[state]} data-state={state} data-gradient={index + 1} data-glow={glow}
    className={cn("mx-auto flex items-center justify-center", className)} style={{ ...dimensions, ...style }} {...rest}>
    <AgentAvatar appearance={appearanceForPalette(AGENT_PALETTE_IDS[index % AGENT_PALETTE_IDS.length])} size={24} className="size-full" muted={state === "slot"} />
  </div>;
}
export default AgentCapsule;
