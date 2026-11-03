import type { AgentAppearance } from "@paperclipai/shared";
import { AgentAvatar } from "../AgentAvatar";

export interface OnboardingCharacterProps {
  appearance: AgentAppearance;
  awake: boolean;
  className?: string;
}

/** The selected employee's orb; onboarding does not load a mascot or WebGL player. */
export function OnboardingCharacter({ appearance, awake, className }: OnboardingCharacterProps) {
  return <AgentAvatar appearance={appearance} size={256} muted={!awake} className={className} />;
}
