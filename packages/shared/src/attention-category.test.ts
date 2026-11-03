import { describe, expect, it } from "vitest";
import type { AttentionItem } from "./types/attention.js";
import { isAttentionProposal, isAttentionWorkItem } from "./attention-category.js";
const item = (sourceKind: AttentionItem["sourceKind"], inlineResolvable = true, kind?: string): Parameters<typeof isAttentionProposal>[0] => ({ sourceKind, inlineResolvable, subject: { metadata: { kind } } });
describe("AgentOS attention categories", () => {
  it("keeps executable proposals separate from raw operational work", () => {
    for (const source of ["approval", "decision", "join_request"] as const) {
      expect(isAttentionProposal(item(source))).toBe(true);
      expect(isAttentionWorkItem(item(source))).toBe(false);
      expect(isAttentionProposal(item(source, false))).toBe(false);
    }
    for (const source of ["failed_run", "agent_error_alert", "review", "blocker_attention", "budget_alert", "recovery_action"] as const) {
      expect(isAttentionProposal(item(source))).toBe(false);
      expect(isAttentionWorkItem(item(source))).toBe(true);
    }
  });
  it("keeps questions conversational and requires native actions for confirmations", () => {
    const question = item("issue_thread_interaction", true, "ask_user_questions");
    expect(isAttentionProposal(question)).toBe(false); expect(isAttentionWorkItem(question)).toBe(false);
    for (const kind of ["request_confirmation", "request_checkbox_confirmation", "suggest_tasks", "request_item_verdicts"]) {
      expect(isAttentionProposal(item("issue_thread_interaction", true, kind))).toBe(true);
      expect(isAttentionProposal(item("issue_thread_interaction", false, kind))).toBe(false);
    }
    expect(isAttentionProposal(item("issue_thread_interaction", true, "unknown"))).toBe(false);
  });
});
