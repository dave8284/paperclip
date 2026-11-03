import type { RefObject } from "react";
import type { CharacterState } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { AgentAvatar, avatarSizeClasses, type AgentAvatarProps } from "./AgentAvatar";

// Retain the native appearance contract without loading the inherited mascot runtime.
export interface AgentCharacterProps extends Omit<AgentAvatarProps, "pose"> {
  state?: CharacterState;
  motion?: "auto" | "still";
  trackingRegion?: RefObject<HTMLElement | null>;
  trackingScope?: "region" | "page";
  followCursor?: boolean;
  followRotation?: boolean;
}
export function AgentCharacter({ agent, appearance, size = 256, state = "idle", muted = false, className, label, name }: AgentCharacterProps) {
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    className={cn("agentos-employee-portrait relative inline-block shrink-0", avatarSizeClasses[size], className)} data-state={state}>
    <AgentAvatar agent={agent} appearance={appearance} size={size} name={name} pose={state} muted={muted} className="size-full" />
  </span>;
}
