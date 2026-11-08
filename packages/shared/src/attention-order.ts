import type { AttentionItem, AttentionSeverity, AttentionSourceKind } from "./types/attention.js";

type AttentionOrderInput = Pick<AttentionItem,
  "activityAt" | "severity" | "sourceKind" | "dedupKey" | "expiresAt" | "decideBy">;

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SOURCE_RANK: Record<AttentionSourceKind, number> = {
  failed_run: 0, recovery_action: 1, blocker_attention: 2, budget_alert: 3,
  agent_error_alert: 4, approval: 5, decision: 6, issue_thread_interaction: 7,
  review: 8, productivity_review: 9, join_request: 10,
};

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function compareAttentionActivity(left: AttentionOrderInput, right: AttentionOrderInput) {
  const timeDiff = timestamp(right.activityAt) - timestamp(left.activityAt);
  if (timeDiff !== 0) return timeDiff;
  const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityDiff !== 0) return severityDiff;
  const sourceDiff = SOURCE_RANK[left.sourceKind] - SOURCE_RANK[right.sourceKind];
  if (sourceDiff !== 0) return sourceDiff;
  return left.dedupKey.localeCompare(right.dedupKey);
}

/** Native explicit decide-by order, using the same UTC boundaries in every view. */
export function attentionDecideOrder(item: Pick<AttentionItem, "decideBy">, now: number): [number, number] {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = 24 * 60 * 60 * 1_000;
  if (item.decideBy === "today") return [0, start + day - 1];
  if (item.decideBy === "this_week") {
    const weekday = new Date(start).getUTCDay();
    const daysUntilSunday = weekday === 0 ? 0 : 7 - weekday;
    return [0, start + (daysUntilSunday + 1) * day - 1];
  }
  if (item.decideBy && /^\d{4}-\d{2}-\d{2}$/.test(item.decideBy)) {
    const deadline = Date.parse(`${item.decideBy}T23:59:59.999Z`);
    if (Number.isFinite(deadline)) return [0, deadline];
  }
  if (item.decideBy === "whenever") return [1, Number.MAX_SAFE_INTEGER];
  return [2, Number.MAX_SAFE_INTEGER];
}

/** Rank recorded attention facts; this neither creates decisions nor authorizes their actions. */
export function compareAttentionDecisionPriority(left: AttentionOrderInput, right: AttentionOrderInput, now: number) {
  const [leftBucket, leftDeadline] = attentionDecideOrder(left, now);
  const [rightBucket, rightDeadline] = attentionDecideOrder(right, now);
  if (leftBucket !== rightBucket) return leftBucket - rightBucket;
  if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
  const leftExpiry = left.expiresAt ? timestamp(left.expiresAt) : Number.MAX_SAFE_INTEGER;
  const rightExpiry = right.expiresAt ? timestamp(right.expiresAt) : Number.MAX_SAFE_INTEGER;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityDiff !== 0) return severityDiff;
  return compareAttentionActivity(left, right);
}
