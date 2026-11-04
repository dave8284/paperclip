import { localTriageRuntime, localTriageModelId, localTriagePin } from "./local-triage.js";
import { modelIntelligenceProduct } from "./model-intelligence.js";
import { and, gte, lte, sql } from "drizzle-orm";
import { costEvents, decisionInvocations, heartbeatRuns, type Db } from "@paperclipai/db";
import { assertAdministration, type AdminPrincipal } from "./agentos-administration.js";

// Agent OS's read projection over recorded native evidence. Learning policy
// state belongs to the independent model product, not these billing tables.
export async function modelIntelligenceAnalytics(db: Db, actor: AdminPrincipal, now = new Date()) {
  await assertAdministration(db, actor);
  const since = new Date(now.getTime() - 30 * 86400000);
  const triageTask = sql<string>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,taskType}'`;
  const triageComplexity = sql<string>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,complexity}'`;
  const triageContext = sql<string>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,contextStrategy}'`;
  const triageStatus = sql<string>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,status}'`;
  const triageReason = sql<string>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,reason}'`;
  const triageProvider = sql<string | null>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,provider}'`;
  const triageRequested = sql<string | null>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,requestedModel}'`;
  const triageResolved = sql<string | null>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,resolvedModel}'`;
  const triageComputation = sql<string | null>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,computationKind}'`;
  const triageProposedTask = sql<string | null>`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,proposedTaskType}'`;
  const recordedTriage = sql`${heartbeatRuns.contextSnapshot} #>> '{modelTriage,schema}' = 'agentos.model-triage.v1'`;
  const [usage, decisions, runs, triageGroups, triageCounts] = await Promise.all([
    db.select({
      provider: costEvents.provider, model: costEvents.model, billingType: costEvents.billingType, usageKind: costEvents.usageKind,
      receipts: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::float8`,
      recordedCostCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::float8`,
      unpriced: sql<number>`count(*) filter (where ${costEvents.costStatus} = 'unpriced')::int`,
    }).from(costEvents).where(and(gte(costEvents.occurredAt, since), lte(costEvents.occurredAt, now)))
      .groupBy(costEvents.provider, costEvents.model, costEvents.billingType, costEvents.usageKind)
      .orderBy(sql`count(*) desc`).limit(100),
    db.select({
      provider: decisionInvocations.provider, model: decisionInvocations.model, feature: decisionInvocations.feature,
      attempts: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'failed')::int`,
      unknown: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'unknown')::int`,
      running: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'running')::int`,
      meanDurationMs: sql<number | null>`avg(${decisionInvocations.durationMs})::float8`,
    }).from(decisionInvocations).where(and(gte(decisionInvocations.startedAt, since), lte(decisionInvocations.startedAt, now)))
      .groupBy(decisionInvocations.provider, decisionInvocations.model, decisionInvocations.feature).orderBy(sql`count(*) desc`).limit(100),
    db.select({ status: heartbeatRuns.status, count: sql<number>`count(*)::int` }).from(heartbeatRuns)
      .where(and(gte(heartbeatRuns.createdAt, since), lte(heartbeatRuns.createdAt, now))).groupBy(heartbeatRuns.status),
    db.select({ taskType: triageTask, complexity: triageComplexity, contextStrategy: triageContext,
      decisionStatus: triageStatus, reason: triageReason, provider: triageProvider, requestedModel: triageRequested, resolvedModel: triageResolved, computationKind: triageComputation, proposedTaskType: triageProposedTask,
      meanElapsedMs: sql<number | null>`avg(case when jsonb_typeof(${heartbeatRuns.contextSnapshot} #> '{modelTriage,decision,elapsedMs}') = 'number' then (${heartbeatRuns.contextSnapshot} #>> '{modelTriage,decision,elapsedMs}')::float8 end)`, runs: sql<number>`count(*)::int` })
      .from(heartbeatRuns).where(and(gte(heartbeatRuns.createdAt, since), lte(heartbeatRuns.createdAt, now), recordedTriage))
      .groupBy(triageTask, triageComplexity, triageContext, triageStatus, triageReason, triageProvider, triageRequested, triageResolved, triageComputation, triageProposedTask).orderBy(sql`count(*) desc`).limit(100),
    db.select({ recordedRuns: sql<number>`count(*) filter (where ${recordedTriage})::int`,
      unrecordedRuns: sql<number>`count(*) filter (where not coalesce((${recordedTriage}), false))::int`,
      nativeReviewPreparedRuns: sql<number>`count(*) filter (where ${heartbeatRuns.runnerProfileJson} #>> '{nativeReviewContextReceipt,stage}' = 'server_prepared')::int`,
    }).from(heartbeatRuns).where(and(gte(heartbeatRuns.createdAt, since), lte(heartbeatRuns.createdAt, now))),
  ]);
  const learning = modelIntelligenceProduct()?.analytics();
  return { since: since.toISOString(), through: now.toISOString(), usage, decisions, runs,
    triage: { localRuntime: { provider: "local_laya" as const, state: await localTriageRuntime.status({ readOnly: true }), model: localTriageModelId, sdkVersion: localTriagePin.sdkVersion, checkpoint: localTriagePin.checkpoint, externalFallback: false as const }, groups: triageGroups, recordedRuns: triageCounts[0]?.recordedRuns ?? 0,
      unrecordedRuns: triageCounts[0]?.unrecordedRuns ?? 0, nativeReviewPreparedRuns: triageCounts[0]?.nativeReviewPreparedRuns ?? 0,
      quality: "not_evaluated" as const },
    learning: { status: learning ? "connected" as const : "not_connected" as const, evaluations: learning?.counts.evaluations ?? null, policyReleases: learning?.counts.policyEvents ?? null, selections: learning?.counts.selections ?? 0,
      explanation: learning ? "Local Model Intelligence records selection receipts and learns from reviewed outcomes. Unqualified and complex work retain the configured model. A replacement requires sufficient quality evidence and measured latency improvement. Active sessions preserve their model; no paid API fallback is used." : "Model Intelligence is not configured. Execution and usage records remain available; no learned model changes are being applied.",
    },
  };
}
