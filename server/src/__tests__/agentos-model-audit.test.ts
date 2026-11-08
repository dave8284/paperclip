import { beforeEach, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import type { Analytics } from "@agentos/model-intelligence";
import { adminModelActivitySchema } from "@paperclipai/shared";
import { modelActivityAudit } from "../services/agentos-model-audit.js";
const executionProjections = vi.hoisted(() => vi.fn());
vi.mock("../services/execution-projection.js", () => ({ executionProjectionsForRuns: executionProjections }));
beforeEach(() => executionProjections.mockReset().mockResolvedValue(new Map()));

const since = new Date("2026-10-06T00:00:00Z"), through = new Date("2026-11-05T00:00:00Z");
const selected = { provider: "openai", model: "selected-model", reason: "baseline", policyVersion: "v1" };
const triage = { status: "abstained", reason: "contradictory_output", provider: "local_laya", model: "pinned-laya",
  elapsedMs: 611, contextStrategy: "context_rich_author_and_independent_review", proposedTaskType: null, proposedCandidateId: null };
function run(id: string, selection: unknown = selected, nativeProfile: unknown = null, runtimeSessionState = "unknown") {
  return [id, "company-a", "Northstar", "NST", "agent-a", "task-a", "2026-11-04T00:00:00Z", "succeeded", "engineering.building", 5000,
    125, 2500, selection, triage, [{ provider: "openai", model: "actual-model" }], nativeProfile, runtimeSessionState];
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
  expect(audit.text).toContain("{nativeExecutionInput,binding,runId}");
  expect(audit.text).toContain("{nativeExecutionInput,binding,companyId}");
  expect(audit.text).toContain("{nativeExecutionInput,binding,agentId}");
  expect(audit.text).toContain("{nativeExecutionInput,provider,model}");
  expect(audit.text).not.toContain("credentialBindings");
  expect(executionProjections).toHaveBeenCalledWith(db, "company-a", ["run-a", "run-b"], through);
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
  expect(executionProjections).toHaveBeenCalledTimes(1);
  expect(executionProjections.mock.calls[0][2]).toHaveLength(50);
});

it("retains unknown queue/comment timing for an unbound run instead of inventing zero latency", async () => {
  const unbound = run("run-unbound"); unbound[5] = null; unbound[10] = null; unbound[11] = null;
  const db = drizzle(async text => ({ rows: text.includes('"model_activity_per_run"') ? [] : [unbound] })) as unknown as Db;
  const result = adminModelActivitySchema.parse(await modelActivityAudit(db, since, through, undefined));
  expect(result.recentRuns[0]).toMatchObject({ taskId: null, queueDelayMs: null, firstAgentCommentMs: null });
});

it("retains frozen native requests separately from MI selection and observed provider usage", async () => {
  const profile = { harness: "codex", model: "requested-model", sessionRequest: "existing" };
  const rows = [run("native", null, profile, "fresh"), run("missing", null), run("malformed", null, { ...profile, model: " " }), run("conflicting", null, profile, "conflicting")];
  const db = drizzle(async text => ({ rows: text.includes('"model_activity_per_run"') ? [] : rows })) as unknown as Db;
  const result = adminModelActivitySchema.parse(await modelActivityAudit(db, since, through, undefined));
  expect(result.recentRuns[0]).toMatchObject({ selected: null, nativeProfile: profile, runtimeSessionState: "fresh", actualModels: [{ provider: "openai", model: "actual-model" }], review: null });
  expect(result.recentRuns.slice(1, 3).every(row => row.nativeProfile === null && row.runtimeSessionState === "unknown")).toBe(true);
  expect(result.recentRuns[3]).toMatchObject({ nativeProfile: profile, runtimeSessionState: "conflicting" });
  expect(result.recentRuns.every(row => row.execution === null && row.executionState === "not_recorded")).toBe(true);
});

it("uses native attempt evidence and resolves only same-company predecessor/successor links", async () => {
  executionProjections.mockResolvedValue(new Map([["run-a", { phase: "retry_scheduled", label: "Retry scheduled", cause: "transient_failure", attempt: 2, retryAt: through.toISOString(), predecessorRunId: "previous", successorRunId: "next" }]]));
  const db = drizzle(async text => ({ rows: text.includes('"model_activity_per_run"') ? [] : text.includes('jsonb_agg(observed_model)')
    ? [run("run-a")] : [["previous", "company-a", "previous-agent"], ["next", "company-b", "outside-agent"]] })) as unknown as Db;
  const result = adminModelActivitySchema.parse(await modelActivityAudit(db, since, through, undefined));
  expect(result.recentRuns[0]).toMatchObject({ executionState: "available", execution: { attempt: 2, predecessorRunId: "previous", predecessorAgentId: "previous-agent", successorRunId: "next", successorAgentId: null } });
  expect(JSON.stringify(result)).not.toContain("outside-agent");
});

it("retains available audit evidence when one company execution read fails", async () => {
  const other = run("run-b"); other[1] = "company-b";
  executionProjections.mockImplementation(async (_db, companyId) => {
    if (companyId === "company-a") throw new Error("Private database failure detail");
    return new Map([["run-b", { phase: "completed", label: "Completed", cause: null, attempt: 1, retryAt: null, predecessorRunId: null, successorRunId: null }]]);
  });
  const db = drizzle(async text => ({ rows: text.includes('"model_activity_per_run"') ? [] : [run("run-a"), other] })) as unknown as Db;
  const result = adminModelActivitySchema.parse(await modelActivityAudit(db, since, through, undefined));
  expect(result.recentRuns[0]).toMatchObject({ executionState: "unavailable", execution: null, selected, actualModels: [{ provider: "openai", model: "actual-model" }] });
  expect(result.recentRuns[1]).toMatchObject({ executionState: "available", execution: { attempt: 1 } });
  expect(JSON.stringify(result)).not.toContain("Private database failure detail");
});
