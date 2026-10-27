import { modelIntelligenceProduct } from "./model-intelligence.js";
import { and, gte, lte, sql } from "drizzle-orm";
import { costEvents, decisionInvocations, heartbeatRuns, type Db } from "@paperclipai/db";
import { assertAdministration, type AdminPrincipal } from "./agentos-administration.js";

// Agent OS's read projection over recorded native evidence. Learning policy
// state belongs to the independent model product, not these billing tables.
export async function modelIntelligenceAnalytics(db: Db, actor: AdminPrincipal, now = new Date()) {
  await assertAdministration(db, actor);
  const since = new Date(now.getTime() - 30 * 86400000);
  const [usage, decisions, runs] = await Promise.all([
    db.select({
      provider: costEvents.provider, model: costEvents.model, billingType: costEvents.billingType,
      receipts: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::float8`,
      recordedCostCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::float8`,
      unpriced: sql<number>`count(*) filter (where ${costEvents.costStatus} = 'unpriced')::int`,
    }).from(costEvents).where(and(gte(costEvents.occurredAt, since), lte(costEvents.occurredAt, now)))
      .groupBy(costEvents.provider, costEvents.model, costEvents.billingType)
      .orderBy(sql`count(*) desc`).limit(100),
    db.select({
      provider: decisionInvocations.provider, model: decisionInvocations.model,
      attempts: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'failed')::int`,
      unknown: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'unknown')::int`,
      running: sql<number>`count(*) filter (where ${decisionInvocations.status} = 'running')::int`,
      meanDurationMs: sql<number | null>`avg(${decisionInvocations.durationMs})::float8`,
    }).from(decisionInvocations).where(and(gte(decisionInvocations.startedAt, since), lte(decisionInvocations.startedAt, now)))
      .groupBy(decisionInvocations.provider, decisionInvocations.model).orderBy(sql`count(*) desc`).limit(100),
    db.select({ status: heartbeatRuns.status, count: sql<number>`count(*)::int` }).from(heartbeatRuns)
      .where(and(gte(heartbeatRuns.createdAt, since), lte(heartbeatRuns.createdAt, now))).groupBy(heartbeatRuns.status),
  ]);
  const learning = modelIntelligenceProduct()?.analytics();
  return { since: since.toISOString(), through: now.toISOString(), usage, decisions, runs,
    learning: { status: learning ? "connected" as const : "not_connected" as const, evaluations: learning?.counts.evaluations ?? null, policyReleases: learning?.counts.policyEvents ?? null, selections: learning?.counts.selections ?? 0,
      explanation: learning ? "Local Model Intelligence records selection receipts and learns from reviewed outcomes. Unqualified and complex work retain the configured model. A replacement requires sufficient quality evidence and measured latency improvement. Active sessions preserve their model; no paid API fallback is used." : "Model Intelligence is not configured. Execution and usage records remain available; no learned model changes are being applied.",
    },
  };
}
