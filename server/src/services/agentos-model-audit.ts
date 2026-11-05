import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { companies, costEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import { adminModelActivitySchema, type AdminModelActivity } from "@paperclipai/shared";
import type { Analytics } from "@agentos/model-intelligence";

const RUN_LIMIT = 50;
const MODEL_LIMIT = 100;
const ACTUAL_MODEL_LIMIT = 20;
const auditRowSchema = adminModelActivitySchema.shape.recentRuns.element;

// Read only after the owning administrator endpoint authorizes the caller.
// These projections never select prompts, transcripts, configuration or errors.
export async function modelActivityAudit(db: Db, since: Date, through: Date, learning: Analytics | undefined): Promise<AdminModelActivity> {
  const selectionBound = sql`${heartbeatRuns.contextSnapshot} #>> '{modelIntelligence,id}' = ${heartbeatRuns.id}::text
    and ${heartbeatRuns.contextSnapshot} #>> '{modelIntelligence,namespace}' = ${heartbeatRuns.companyId}::text`;
  const triageBound = sql`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,schema}' = 'agentos.model-triage.v1'
    and ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,runId}' = ${heartbeatRuns.id}::text
    and ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,companyId}' = ${heartbeatRuns.companyId}::text`;
  const taskType = sql<string>`coalesce(
    case when ${selectionBound} then nullif(${heartbeatRuns.contextSnapshot} #>> '{modelIntelligence,taskType}', '') end,
    case when ${triageBound} then nullif(${heartbeatRuns.contextSnapshot} #>> '{modelTriage,taskType}', '') end,
    'unclassified')`;
  const duration = sql<number | null>`case when ${heartbeatRuns.finishedAt} >= ${heartbeatRuns.startedAt}
    then extract(epoch from (${heartbeatRuns.finishedAt} - ${heartbeatRuns.startedAt}))::float8 * 1000 end`;
  // Aggregate once per company/run/model before timing: multiple token receipts
  // for one run must not weight that run's duration or execution status twice.
  const perRun = db.select({
    companyId: heartbeatRuns.companyId, companyName: companies.name,
    runId: heartbeatRuns.id, taskType: taskType.as("task_family"), provider: costEvents.provider, model: costEvents.model,
    status: heartbeatRuns.status, durationMs: duration.as("duration_ms"),
    inputTokens: sql<number>`sum(${costEvents.inputTokens})::float8`.as("input_tokens"),
    outputTokens: sql<number>`sum(${costEvents.outputTokens})::float8`.as("output_tokens"),
    unpriced: sql<number>`count(*) filter (where ${costEvents.costStatus} = 'unpriced')::int`.as("unpriced"),
  }).from(costEvents).innerJoin(heartbeatRuns, and(eq(costEvents.heartbeatRunId, heartbeatRuns.id), eq(costEvents.companyId, heartbeatRuns.companyId)))
    .innerJoin(companies, eq(companies.id, heartbeatRuns.companyId))
    .where(and(eq(costEvents.usageKind, "agent"), gte(costEvents.occurredAt, since), lte(costEvents.occurredAt, through),
      gte(heartbeatRuns.createdAt, since), lte(heartbeatRuns.createdAt, through)))
    .groupBy(heartbeatRuns.companyId, companies.name, heartbeatRuns.id, taskType, costEvents.provider, costEvents.model,
      heartbeatRuns.status, heartbeatRuns.startedAt, heartbeatRuns.finishedAt).as("model_activity_per_run");

  const [taskModels, recent] = await Promise.all([
    db.select({ companyId: perRun.companyId, companyName: perRun.companyName, taskType: perRun.taskType,
      provider: perRun.provider, model: perRun.model, runs: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${perRun.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${perRun.status} in ('failed', 'timed_out', 'interrupted'))::int`,
      meanDurationMs: sql<number | null>`avg(${perRun.durationMs})::float8`,
      inputTokens: sql<number>`sum(${perRun.inputTokens})::float8`, outputTokens: sql<number>`sum(${perRun.outputTokens})::float8`,
      unpricedReceipts: sql<number>`sum(${perRun.unpriced})::int`,
    }).from(perRun).groupBy(perRun.companyId, perRun.companyName, perRun.taskType, perRun.provider, perRun.model)
      .orderBy(sql`count(*) desc`, perRun.companyId, perRun.taskType, perRun.provider, perRun.model).limit(MODEL_LIMIT + 1),
    db.select({
      id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, companyName: companies.name, companyPrefix: companies.issuePrefix,
      agentId: heartbeatRuns.agentId, taskId: heartbeatRuns.issueId, createdAt: heartbeatRuns.createdAt,
      status: heartbeatRuns.status, taskType, durationMs: duration,
      queueDelayMs: sql<number | null>`case when ${heartbeatRuns.startedAt} >= ${heartbeatRuns.createdAt} and ${heartbeatRuns.startedAt} <= ${through}
        then extract(epoch from (${heartbeatRuns.startedAt} - ${heartbeatRuns.createdAt}))::float8 * 1000 end`,
      // Use only native scope and persisted author/run attribution. Derived
      // attribution and fast-response comments cannot establish agent timing.
      // The existing company/issue/created_at index bounds each recent-run lookup.
      firstAgentCommentMs: sql<number | null>`case when ${heartbeatRuns.scopeKind} = 'issue' and ${heartbeatRuns.issueId} is not null and ${heartbeatRuns.startedAt} is not null then (
        select extract(epoch from (min(comment.created_at) - ${heartbeatRuns.startedAt}))::float8 * 1000
        from issue_comments comment
        where comment.company_id = ${heartbeatRuns.companyId} and comment.issue_id = ${heartbeatRuns.issueId}
          and comment.created_by_run_id = ${heartbeatRuns.id} and comment.author_agent_id = ${heartbeatRuns.agentId}
          and comment.origin = 'comment' and comment.deleted_at is null
          and comment.created_at >= ${heartbeatRuns.startedAt} and comment.created_at <= ${through}
      ) end`,
      selected: sql<AdminModelActivity["recentRuns"][number]["selected"]>`case when ${selectionBound} then jsonb_build_object(
        'provider', ${heartbeatRuns.contextSnapshot} #>> '{modelIntelligence,candidate,provider}',
        'model', ${heartbeatRuns.contextSnapshot} #>> '{modelIntelligence,candidate,model}',
        'reason', ${heartbeatRuns.contextSnapshot} #>> '{modelIntelligence,reason}',
        'policyVersion', ${heartbeatRuns.contextSnapshot} #>> '{modelIntelligence,policyVersion}') end`,
      triage: sql<AdminModelActivity["recentRuns"][number]["triage"]>`case when ${triageBound} then jsonb_build_object(
        'status', ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,status}',
        'reason', ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,reason}',
        'provider', ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,provider}',
        'model', coalesce(${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,resolvedModel}', ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,requestedModel}'),
        'elapsedMs', ${heartbeatRuns.contextSnapshot} #> '{modelTriage,decision,elapsedMs}',
        'contextStrategy', ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,contextStrategy}',
        'proposedTaskType', ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,proposedTaskType}',
        'proposedCandidateId', ${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,proposedCandidateId}') end`,
      actualModels: sql<Array<{ provider: string; model: string }>>`coalesce((select jsonb_agg(observed_model) from (
        select distinct ce.provider, ce.model from cost_events ce
        where ce.company_id = ${heartbeatRuns.companyId} and ce.heartbeat_run_id = ${heartbeatRuns.id}
          and ce.usage_kind = 'agent' and ce.occurred_at <= ${through}
        order by ce.provider, ce.model limit ${ACTUAL_MODEL_LIMIT + 1}
      ) observed_model), '[]'::jsonb)`,
    }).from(heartbeatRuns).innerJoin(companies, eq(companies.id, heartbeatRuns.companyId))
      .where(and(gte(heartbeatRuns.createdAt, since), lte(heartbeatRuns.createdAt, through)))
      .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id)).limit(RUN_LIMIT + 1),
  ]);
  return {
    taskModels: taskModels.slice(0, MODEL_LIMIT), moreTaskModels: taskModels.length > MODEL_LIMIT, taskModelLimit: MODEL_LIMIT,
    recentRuns: recent.slice(0, RUN_LIMIT).map(row => {
      const reviewed = learning?.evaluations.find(evaluation => evaluation.namespace === row.companyId && evaluation.receiptId === row.id);
      const selected = auditRowSchema.shape.selected.safeParse(row.selected);
      const triage = auditRowSchema.shape.triage.safeParse(row.triage);
      return { ...row, createdAt: row.createdAt.toISOString(),
        selected: selected.success ? selected.data : null, triage: triage.success ? triage.data : null,
        actualModels: row.actualModels.slice(0, ACTUAL_MODEL_LIMIT), actualModelsTruncated: row.actualModels.length > ACTUAL_MODEL_LIMIT,
        review: reviewed ? { passed: reviewed.passed, source: reviewed.source, evidenceRef: reviewed.evidenceRef, iterations: reviewed.iterations, latencyMs: reviewed.latencyMs } : null,
      };
    }), moreRuns: recent.length > RUN_LIMIT, runLimit: RUN_LIMIT, reviewLookupLimit: 100,
  };
}
