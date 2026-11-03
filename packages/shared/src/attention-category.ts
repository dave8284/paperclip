import type { AttentionItem } from "./types/attention.js";

type AttentionCategoryInput = Pick<AttentionItem, "sourceKind" | "inlineResolvable"> & {
  subject: Pick<AttentionItem["subject"], "metadata">;
};

/** Presentation classification only; native resolvers remain authoritative. */
export function isAttentionProposal(item: AttentionCategoryInput): boolean {
  if (!item.inlineResolvable) return false;
  if (item.sourceKind === "approval" || item.sourceKind === "decision" || item.sourceKind === "join_request") return true;
  return item.sourceKind === "issue_thread_interaction" && ["request_confirmation", "request_checkbox_confirmation", "suggest_tasks", "request_item_verdicts"].includes(String(item.subject.metadata?.kind));
}

export function isAttentionWorkItem(item: AttentionCategoryInput): boolean {
  // Clarifications stay with the conversation, where Friday can ask them aloud.
  return !isAttentionProposal(item) && !(item.sourceKind === "issue_thread_interaction" && item.subject.metadata?.kind === "ask_user_questions");
}
