// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OutputFeedbackButtons } from "./OutputFeedbackButtons";
import { AgentBubbleActionRow, IssueChatFeedbackButtons } from "./AgentBubbleActionRow";
import { TooltipProvider } from "./ui/tooltip";

it.each(["prompt", "allowed", "not_allowed"] as const)("keeps upstream sharing controls absent with saved preference %s", async sharingPreference => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), onVote = vi.fn(), openTask = vi.fn();
  try {
    await act(async () => root.render(<TooltipProvider>
      <OutputFeedbackButtons activeVote="up" sharingPreference={sharingPreference} onVote={onVote} rightSlot={<button onClick={openTask}>Open task</button>} />
      <IssueChatFeedbackButtons activeVote="down" sharingPreference={sharingPreference} termsUrl={null} onVote={onVote} />
      <AgentBubbleActionRow copyText="Answer" dateLabel="Just now" feedback={{ activeVote: null, sharingPreference, termsUrl: null, onVote }} />
    </TooltipProvider>));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toMatch(/Paperclip|Always allow|sharing preference/);
    expect([...host.querySelectorAll("button")].some(button => /thumb|feedback|vote/i.test(button.getAttribute("aria-label") ?? button.textContent ?? ""))).toBe(false);
    expect(host.querySelector('[aria-label="Copy message"]')).not.toBeNull();
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Open task")!.click());
    expect(openTask).toHaveBeenCalledOnce(); expect(onVote).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
