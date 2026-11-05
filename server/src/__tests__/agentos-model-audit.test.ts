import { expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import type { Analytics } from "@agentos/model-intelligence";
import { adminModelActivitySchema } from "@paperclipai/shared";
import { modelActivityAudit } from "../services/agentos-model-audit.js";

const since = new Date("2026-10-06T00:00:00Z"), through = new Date("2026-11-05T00:00:00Z");
const selected = { provider: "openai", model: "selected-model", reason: "baseline", policyVersion: "v1" };
const triage = { status: "abstained", reason: "contradictory_output", provider: "local_laya", model: "pinned-laya",
  elapsedMs: 611, contextStrategy: "context_rich_author_and_independent_review", proposedTaskType: null, proposedCandidateId: null };
function run(id: string, selection: unknown = selected) {
  return [id, "company-a", "Northstar", "NST", "agent-a", "task-a", "2026-11-04T00:00:00Z", "succeeded", "engineering.building", 5000,
    125, 2500, selection, triage, [{ provider: "openai", model: "actual-model" }]];
}
it("keeps selected and actual models separate, binds reviews to company/run, and emits bounded safe SQL projections", async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const db = drizzle(async (text, params) => {
    queries.push({ text, params });
    if (text.includes('"model_activity_per_run"')) return { rows: [["company-a", "Northstar", "engineering.building", "openai", "actual-model", 2, 1, 1, 5000, 120, 15, 1]] };
    return { rows: [run("run-a"), run("run-b", { model: "incomplete" })] };
  }) as unknown as Db;
  const learning = { evaluations: [
    { namespace: "company-b", receiptId: "run-a", passed: false, source: "human", evidenceRef: "Other company private evidence", iterations: 1, latencyMs: 5 },
    { namespace: "company-a", receiptId: "run-a", passed: true, source: "human", evidenceRef: "Reviewed acceptance tests", iterations: 2, latencyMs: 5000 },
  ] } as Analytics;
  const result = adminModelActivitySchema.parse(await modelActivityAudit(db, since, through, learning));
  expect(result.taskModels[0]).toMatchObject({ model: "actual-model", runs: 2, meanDurationMs: 5000 });
  expect(result.recentRuns[0]).toMatchObject({ companyPrefix: "NST", queueDelayMs: 125, firstAgentCommentMs: 2500, selected, triage, actualModels: [{ provider: "openai", model: "actual-model" }], review: { passed: true, evidenceRef: "Reviewed acceptance tests" } });
  expect(result.recentRuns[1]).toMatchObject({ selected: null, review: null });
  expect(JSON.stringify(result)).not.toContain("Other company private evidence");
  const cohort = queries.find(query => query.text.includes('"model_activity_per_run"'))!;
  expect(cohort.text).toContain('"cost_events"."company_id" = "heartbeat_runs"."company_id"');
  expect(cohort.text).toContain('group by "heartbeat_runs"."company_id", "companies"."name", "heartbeat_runs"."id"');
  expect(cohort.params).toContain("agent");
  expect(cohort.params).toContain(101);
  const audit = queries.find(query => query.text.includes('jsonb_agg(observed_model)'))!;
  expect(audit.text).toContain('ce.company_id = "heartbeat_runs"."company_id"');
  expect(audit.params).toContain(21); expect(audit.params).toContain(51);
  expect(audit.text).not.toMatch(/stdout_excerpt|stderr_excerpt|result_json|adapter_config/);
  expect(audit.text).toContain("{modelTriage,runId}");
  expect(audit.text).toContain("{modelIntelligence,namespace}");
  expect(audit.text).toContain('"heartbeat_runs"."started_at" >= "heartbeat_runs"."created_at"');
  expect(audit.text).toContain('"heartbeat_runs"."scope_kind" = \'issue\'');
  expect(audit.text).toContain('"heartbeat_runs"."issue_id" is not null');
  expect(audit.text).toContain('min(comment.created_at)');
  expect(audit.text).toContain('comment.company_id = "heartbeat_runs"."company_id"');
  expect(audit.text).toContain('comment.issue_id = "heartbeat_runs"."issue_id"');
  expect(audit.text).toContain('comment.created_by_run_id = "heartbeat_runs"."id"');
  expect(audit.text).toContain('comment.author_agent_id = "heartbeat_runs"."agent_id"');
  expect(audit.text).toContain("comment.origin = 'comment' and comment.deleted_at is null");
  expect(audit.text).toContain('comment.created_at >= "heartbeat_runs"."started_at" and comment.created_at <= ');
  expect(audit.text).not.toMatch(/comment\.body|derived_created_by_run_id|derived_author_agent_id/);
});

it("reports every truncation rather than claiming a complete audit or complete model set", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => run(`run-${i}`));
  rows[0][14] = Array.from({ length: 21 }, (_, i) => ({ provider: "openai", model: `model-${i}` }));
  const groups = Array.from({ length: 101 }, () => ["company-a", "Northstar", "unclassified", "openai", "actual-model", 1, 1, 0, null, 1, 0, 0]);
  const db = drizzle(async text => ({ rows: text.includes('"model_activity_per_run"') ? groups : rows })) as unknown as Db;
  const result = adminModelActivitySchema.parse(await modelActivityAudit(db, since, through, undefined));
  expect(result).toMatchObject({ moreTaskModels: true, moreRuns: true, runLimit: 50, taskModelLimit: 100 });
  expect(result.taskModels).toHaveLength(100); expect(result.recentRuns).toHaveLength(50);
  expect(result.recentRuns[0].actualModels).toHaveLength(20);
  expect(result.recentRuns[0].actualModelsTruncated).toBe(true);
  expect(result.recentRuns.every(row => row.review === null)).toBe(true);
});

it("retains unknown queue/comment timing for an unbound run instead of inventing zero latency", async () => {
  const unbound = run("run-unbound"); unbound[5] = null; unbound[10] = null; unbound[11] = null;
  const db = drizzle(async text => ({ rows: text.includes('"model_activity_per_run"') ? [] : [unbound] })) as unknown as Db;
  const result = adminModelActivitySchema.parse(await modelActivityAudit(db, since, through, undefined));
  expect(result.recentRuns[0]).toMatchObject({ taskId: null, queueDelayMs: null, firstAgentCommentMs: null });
});
