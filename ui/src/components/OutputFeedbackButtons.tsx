import type { ReactNode } from "react";
import type { FeedbackDataSharingPreference, FeedbackVoteValue } from "@paperclipai/shared";

/** Legacy call sites retain their local action slot; upstream output sharing is
 * not part of AgentOS. Keeping this interface never invokes the vote callback. */
export function OutputFeedbackButtons({ rightSlot }: {
  activeVote?: FeedbackVoteValue | null;
  disabled?: boolean;
  sharingPreference?: FeedbackDataSharingPreference;
  termsUrl?: string | null;
  onVote: (vote: FeedbackVoteValue, options?: { allowSharing?: boolean; reason?: string }) => Promise<void>;
  rightSlot?: ReactNode;
  inline?: boolean;
}) {
  return rightSlot ?? null;
}
