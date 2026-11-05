import { beforeEach, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { adminModelIntelligenceSchema } from "@paperclipai/shared";
const authorization = vi.hoisted(() => ({ assert: vi.fn() }));
vi.mock("../services/agentos-administration.js", () => ({ assertAdministration: authorization.assert }));
vi.mock("../services/model-intelligence.js", () => ({ modelIntelligenceProduct: () => null }));
import { modelIntelligenceAnalytics } from "../services/agentos-model-analytics.js";

const actor = { userId: "admin", local: false };
beforeEach(() => { vi.resetAllMocks(); authorization.assert.mockResolvedValue(undefined); });
function database() {
  const queries: string[] = [];
  const db = drizzle(async text => {
    queries.push(text);
    if (text.includes('"model_activity_per_run"') || text.includes('jsonb_agg(observed_model)')) return { rows: [] };
    if (text.includes('from "cost_events"')) return { rows: [["typesafe", "typesafe/jev-1.13", "metered_api", "decision", 1, 12, 0, 0, 1]] };
    if (text.includes('from "decision_invocations"')) return { rows: [["openrouter", "typesafe/jev-1.13", "model_intelligence.triage", 1, 0, 0, 1, 0, null]] };
    if (text.includes("nativeReviewContextReceipt")) return { rows: [[2, 3, 1]] };
    if (text.includes("modelTriage,taskType")) return { rows: [["engineering.building", "complex", "context_rich_author_and_independent_review", "not_run", "subscription_only_policy", null, null, null, null, null, null, 2]] };
    if (text.includes('from "heartbeat_runs"')) return { rows: [["succeeded", 5]] };
    throw new Error("Unexpected query");
  }) as unknown as Db;
  return { db, queries };
}
it("separates decision purpose and computation receipts while retaining missing outcome evidence", async () => {
  const { db, queries } = database();
  const result = adminModelIntelligenceSchema.parse(await modelIntelligenceAnalytics(db, actor));
  expect(authorization.assert).toHaveBeenCalledWith(db, actor);
  expect(result.usage[0]).toMatchObject({ usageKind: "decision", unpriced: 1 });
  expect(result.decisions[0]).toMatchObject({ feature: "model_intelligence.triage", unknown: 1, meanDurationMs: null });
  expect(result.triage).toMatchObject({ recordedRuns: 2, unrecordedRuns: 3, nativeReviewPreparedRuns: 1, quality: "not_evaluated" });
  expect(result.triage?.groups[0]).toMatchObject({ reason: "subscription_only_policy", decisionStatus: "not_run" });
  expect(result.activity).toMatchObject({ taskModels: [], recentRuns: [], moreRuns: false });
  expect(queries).toHaveLength(7);
  expect(queries.find(text => text.includes('from "cost_events"') && !text.includes('"model_activity_per_run"'))).toContain('group by "cost_events"."provider", "cost_events"."model", "cost_events"."billing_type", "cost_events"."usage_kind"');
  expect(queries.find(text => text.includes('from "decision_invocations"'))).toContain('"decision_invocations"."feature"');
  expect(queries.every(text => text.includes(" <= ") && text.includes(" >= "))).toBe(true);
});
it("rejects unauthorized analytics before any stored evidence is read", async () => {
  authorization.assert.mockRejectedValue(new Error("Administrator required"));
  const { db, queries } = database();
  await expect(modelIntelligenceAnalytics(db, actor)).rejects.toThrow("Administrator required");
  expect(queries).toHaveLength(0);
});
it("retains compatibility with servers that predate triage evidence", () => {
  expect(adminModelIntelligenceSchema.parse({ since: "a", through: "b", usage: [], decisions: [], runs: [],
    learning: { status: "not_connected", evaluations: null, policyReleases: null, selections: 0, explanation: "Not connected" } }).triage).toBeUndefined();
});
