import { describe, expect, it } from "vitest";
import { attentionDecideOrder, compareAttentionActivity, compareAttentionDecisionPriority } from "./attention-order.js";

type Item = Parameters<typeof compareAttentionDecisionPriority>[0];
const now = Date.parse("2026-11-08T12:00:00Z");
const item = (dedupKey: string, overrides: Partial<Item> = {}): Item => ({
  dedupKey, sourceKind: "approval", severity: "low", decideBy: null, expiresAt: null,
  activityAt: "2026-11-08T10:00:00Z", ...overrides,
});

describe("native attention ordering shared with portfolio previews", () => {
  it("keeps explicit deadlines ahead of severity, and overdue deadlines ahead of future ones", () => {
    const rows = [item("critical", { severity: "critical" }), item("next-week", { decideBy: "2026-11-10" }),
      item("overdue", { decideBy: "2026-11-07" }), item("today", { decideBy: "today" })];
    expect(rows.sort((a, b) => compareAttentionDecisionPriority(a, b, now)).map(row => row.dedupKey))
      .toEqual(["overdue", "today", "next-week", "critical"]);
  });

  it("orders equal deadline groups by expiry, then severity, then recorded activity", () => {
    const rows = [item("recent-low"), item("older-critical", { severity: "critical", activityAt: "2026-11-06T00:00:00Z" }),
      item("late-expiry", { expiresAt: "2026-11-10T00:00:00Z" }),
      item("early-expiry", { expiresAt: "2026-11-09T00:00:00Z" })];
    expect(rows.sort((a, b) => compareAttentionDecisionPriority(a, b, now)).map(row => row.dedupKey))
      .toEqual(["early-expiry", "late-expiry", "older-critical", "recent-low"]);
    expect(compareAttentionDecisionPriority(item("new"), item("old", { activityAt: "2026-11-07T00:00:00Z" }), now)).toBeLessThan(0);
  });

  it("retains native source and deduplication tie breakers without assigning an action to a blocker", () => {
    const failed = item("run", { sourceKind: "failed_run" });
    expect(compareAttentionDecisionPriority(failed, item("approval"), now)).toBeLessThan(0);
    expect(compareAttentionDecisionPriority(item("a"), item("b"), now)).toBeLessThan(0);
    expect(compareAttentionDecisionPriority(failed, failed, now)).toBe(0);
    expect(failed).not.toHaveProperty("decisionVerbs");
  });

  it("preserves activity sorting independently of the decision-priority view", () => {
    const oldCritical = item("old", { severity: "critical", activityAt: "2026-11-07T00:00:00Z" });
    expect(compareAttentionActivity(item("new"), oldCritical)).toBeLessThan(0);
    expect(compareAttentionDecisionPriority(item("new"), oldCritical, now)).toBeGreaterThan(0);
  });

  it("uses native UTC day/week boundaries, including Sunday at the end of the ISO week", () => {
    expect(attentionDecideOrder({ decideBy: "today" }, now)).toEqual([0, Date.parse("2026-11-08T23:59:59.999Z")]);
    expect(attentionDecideOrder({ decideBy: "this_week" }, now)).toEqual([0, Date.parse("2026-11-08T23:59:59.999Z")]);
    expect(attentionDecideOrder({ decideBy: "this_week" }, Date.parse("2026-11-09T00:01:00Z")))
      .toEqual([0, Date.parse("2026-11-15T23:59:59.999Z")]);
  });

  it("preserves whenever and missing/invalid deadline buckets", () => {
    expect(attentionDecideOrder({ decideBy: "whenever" }, now)).toEqual([1, Number.MAX_SAFE_INTEGER]);
    for (const decideBy of [null, "unknown", "2026-99-99"]) {
      expect(attentionDecideOrder({ decideBy }, now)).toEqual([2, Number.MAX_SAFE_INTEGER]);
    }
    expect(compareAttentionActivity(item("invalid", { activityAt: "invalid" }), item("valid"))).toBeGreaterThan(0);
  });
});
