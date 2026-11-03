import { type ReactNode } from "react";
import type {
  FeedbackDataSharingPreference,
  FeedbackVoteValue,
} from "@paperclipai/shared";
import { cn, formatShortDate } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { useCopyAction, useCopyToast } from "../lib/use-copy-action";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Copy, MoreHorizontal, X } from "lucide-react";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Short relative timestamp for an agent bubble — "2h ago" within a week, then
 * an absolute short date. Mirrors the task thread's `commentDateLabel` so both
 * surfaces read identically.
 */
export function agentBubbleDateLabel(date: Date | string | undefined): string {
  if (!date) return "";
  const then = new Date(date).getTime();
  if (Date.now() - then < WEEK_MS) return timeAgo(date);
  return formatShortDate(date);
}

/**
 * Copy-to-clipboard icon button shared by every agent-bubble footer — the
 * conference-room {@link AgentBubbleActionRow} and the redesigned task thread's
 * {@link TaskChatBubbleActions} (PAP-413). Single-sourced so both footers keep
 * identical sizing, radius, and the "copied ✓" feedback affordance rather than
 * re-declaring the same button markup on each surface.
 */
export function BubbleCopyButton({ copyText }: { copyText: string }) {
  const { copied, failed, copy } = useCopyAction(2000);
  const label = failed ? "Couldn’t copy message" : "Copy message";

  return (
    <button
      type="button"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={label}
      aria-label={label}
      onClick={() => {
        void copy(copyText);
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : failed ? (
        <X className="h-3.5 w-3.5 text-destructive" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

/**
 * Shared agent-bubble action row — copy · timestamp · ⋯ menu.
 *
 * Rendered below every agent bubble so the task thread (`IssueChatThread`) and
 * the conference room (`BoardChat`) speak the same bubble language (PAP-95 /
 * PAP-105). Each surface supplies its own copy text, timestamp label, optional
 * feedback-vote wiring, and any extra overflow-menu items (e.g. stop-run /
 * view-run on the task side).
 */
export function AgentBubbleActionRow({
  copyText,
  dateLabel,
  dateTitle,
  anchorHref,
  feedback,
  menuItems,
  className,
}: {
  copyText: string;
  /** Short relative label shown inline (e.g. "2h ago"). */
  dateLabel?: string;
  /** Full datetime shown in the hover tooltip. */
  dateTitle?: string;
  /** Anchor href for the timestamp link (deep-link to the comment). */
  anchorHref?: string;
  /** Legacy feedback callback contract; upstream output voting is not displayed. */
  feedback?: {
    activeVote: FeedbackVoteValue | null;
    sharingPreference: FeedbackDataSharingPreference;
    termsUrl: string | null;
    onVote: (
      vote: FeedbackVoteValue,
      options?: { allowSharing?: boolean; reason?: string },
    ) => Promise<void>;
  } | null;
  /** Extra DropdownMenuItem nodes appended after the default "Copy message". */
  menuItems?: ReactNode;
  className?: string;
}) {
  // The menu closes on click, so its copy confirmation has to outlive it.
  const copyWithToast = useCopyToast();
  return (
    <div className={cn("mt-2 flex items-center gap-1", className)}>
      <BubbleCopyButton copyText={copyText} />
      {feedback ? (
        <IssueChatFeedbackButtons
          activeVote={feedback.activeVote}
          sharingPreference={feedback.sharingPreference}
          termsUrl={feedback.termsUrl}
          onVote={feedback.onVote}
        />
      ) : null}
      {dateLabel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={anchorHref}
              className="text-(length:--text-micro) text-muted-foreground hover:text-foreground hover:underline"
            >
              {dateLabel}
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {dateTitle}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            title="More actions"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              void copyWithToast(copyText, "Message copied");
            }}
          >
            <Copy className="mr-2 h-3.5 w-3.5" />
            Copy message
          </DropdownMenuItem>
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Retains the native footer contract without exposing upstream feedback export. */
export function IssueChatFeedbackButtons(_props: { activeVote: FeedbackVoteValue | null; sharingPreference: FeedbackDataSharingPreference; termsUrl: string | null; onVote: (vote: FeedbackVoteValue, options?: { allowSharing?: boolean; reason?: string }) => Promise<void>; }) {
  // Legacy callback compatibility: AgentOS does not expose upstream output sharing.
  return null;
}
