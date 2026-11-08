import { and, eq, sql } from "drizzle-orm";
import { heartbeatRuns, issueThreadInteractions, statusDecisionEffects, statusDecisions, type Db } from "@paperclipai/db";
import { nativeReviewCreationEffect } from "./native-runtime/native-review-identity.js";
import { isUuidLike } from "@paperclipai/shared";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Run = Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "agentId" | "issueId" | "finishedAt">;
type ReviewerRun = Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "agentId" | "nativeIssueId" | "status" | "contextSnapshot" | "runnerProfileJson">;
type Review = Pick<typeof issueThreadInteractions.$inferSelect, "id" | "companyId" | "issueId" | "sourceRunId" | "kind" | "status" | "idempotencyKey" | "resolvedAt" | "resolvedByAgentId" | "resolvedByUserId" | "resolvedByRunId" | "addresseeAgentId" | "addresseeUserId"> & { payload: unknown };
type Decision = Pick<typeof statusDecisions.$inferSelect, "id" | "companyId" | "issueId" | "runId" | "applicationState" | "toStatus" | "decisionJson">;
type MaterializedEffect = Pick<typeof statusDecisionEffects.$inferSelect, "companyId" | "issueId" | "decisionId" | "ordinal" | "effectKind" | "targetType" | "targetId" | "idempotencyKey" | "deliveryState" | "payload">;

/** Verdict authority is an exact native review, never a process exit, caller
 * label, or a task-wide review of an unspecified implementation attempt. */
export function nativeIndependentReviewVerdict(run: Run, review: Review, decision: Decision | null, reviewerRun: ReviewerRun | null, materializedEffect: MaterializedEffect | null) {
  const target = record(record(review.payload).target);
  const creation = decision ? nativeReviewCreationEffect(decision.id, decision.decisionJson, review.idempotencyKey) : null;
  if (!run.finishedAt || review.companyId !== run.companyId || review.issueId !== run.issueId || review.sourceRunId !== run.id
    || review.kind !== "request_confirmation" || !["accepted", "rejected"].includes(review.status)
    || target.type !== "custom" || target.key !== "native_completion_review"
    || !decision || target.revisionId !== decision.id || decision.companyId !== run.companyId || decision.issueId !== run.issueId
    || decision.runId !== run.id || decision.applicationState !== "applied" || decision.toStatus !== "in_review"
    || !creation || !materializedEffect || materializedEffect.companyId !== run.companyId || materializedEffect.issueId !== run.issueId
    || materializedEffect.decisionId !== decision.id || materializedEffect.ordinal !== creation.ordinal
    || materializedEffect.effectKind !== "bind_reviewer" || materializedEffect.targetType !== "issue_thread_interaction"
    || materializedEffect.targetId !== review.id || materializedEffect.deliveryState !== "delivered"
    || materializedEffect.idempotencyKey !== `native-status:${decision.id}:${creation.ordinal}`
    || materializedEffect.payload.interactionId !== review.id || materializedEffect.payload.interactionKind !== review.kind
    || (materializedEffect.payload.ownerAgentId ?? null) !== creation.ownerAgentId
    || (materializedEffect.payload.ownerUserId ?? null) !== creation.ownerUserId
    || (review.addresseeAgentId ?? null) !== creation.ownerAgentId || (review.addresseeUserId ?? null) !== creation.ownerUserId
    || !review.resolvedAt || review.resolvedAt < run.finishedAt || review.resolvedAt > new Date()
    || review.resolvedByAgentId === run.agentId || (!review.resolvedByUserId && !review.resolvedByAgentId)) return null;
  if (review.resolvedByAgentId) {
    const receipt = record(reviewerRun?.runnerProfileJson?.nativeReviewContextReceipt), references = record(receipt.references);
    if (review.addresseeAgentId !== review.resolvedByAgentId || !reviewerRun || reviewerRun.id !== review.resolvedByRunId || reviewerRun.companyId !== run.companyId
      || reviewerRun.agentId !== review.resolvedByAgentId || reviewerRun.nativeIssueId !== run.issueId || reviewerRun.status !== "succeeded"
      || reviewerRun.contextSnapshot?.nativeReviewInteractionId !== review.id || reviewerRun.contextSnapshot?.nativeReviewDecisionId !== decision.id
      || receipt.schema !== "agentos.native-review-context-receipt.v1" || receipt.companyId !== run.companyId
      || receipt.issueId !== run.issueId || receipt.reviewerRunId !== reviewerRun.id || references.sourceRunId !== run.id
      || references.sourceDecisionId !== decision.id || references.reviewInteractionId !== review.id) return null;
  }
  return { outcome: review.status === "accepted" ? "passed" as const : "failed" as const,
    evaluator: review.resolvedByAgentId ? `agent:${review.resolvedByAgentId}` : `user:${review.resolvedByUserId}`, reviewId: review.id, resolvedAt: review.resolvedAt };
}


/** Exact native independent review evidence serves model outcomes and board
 * reporting; it never certifies business acceptance or current artifact contents. Missing or ambiguous review authority remains unknown. */
export async function readNativeIndependentReview(db: Db, run: Run) {
  if (!run.issueId) return null;
  const reviews = await db.select({ id: issueThreadInteractions.id, companyId: issueThreadInteractions.companyId, issueId: issueThreadInteractions.issueId,
    sourceRunId: issueThreadInteractions.sourceRunId, kind: issueThreadInteractions.kind, status: issueThreadInteractions.status,
    payload: sql<Record<string, unknown>>`jsonb_build_object('target', ${issueThreadInteractions.payload}->'target')`,
    idempotencyKey: issueThreadInteractions.idempotencyKey, resolvedAt: issueThreadInteractions.resolvedAt,
    resolvedByAgentId: issueThreadInteractions.resolvedByAgentId, resolvedByUserId: issueThreadInteractions.resolvedByUserId,
    resolvedByRunId: issueThreadInteractions.resolvedByRunId,
    addresseeAgentId: issueThreadInteractions.addresseeAgentId, addresseeUserId: issueThreadInteractions.addresseeUserId,
  }).from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, run.companyId),
    eq(issueThreadInteractions.issueId, run.issueId), eq(issueThreadInteractions.sourceRunId, run.id),
    sql`${issueThreadInteractions.payload}->'target'->>'key' = 'native_completion_review'`)).limit(2);
  if (reviews.length !== 1) return null;
  const review = reviews[0], target = record(record(review.payload).target);
  const [decision] = typeof target.revisionId === "string" && isUuidLike(target.revisionId)
    ? await db.select({ id: statusDecisions.id, companyId: statusDecisions.companyId, issueId: statusDecisions.issueId,
      runId: statusDecisions.runId, applicationState: statusDecisions.applicationState, toStatus: statusDecisions.toStatus,
      decisionJson: sql<Record<string, unknown>>`jsonb_build_object('effects', ${statusDecisions.decisionJson}->'effects')`,
    }).from(statusDecisions).where(and(eq(statusDecisions.companyId, run.companyId), eq(statusDecisions.id, target.revisionId))) : [];
  const effects = decision ? await db.select({ companyId: statusDecisionEffects.companyId, issueId: statusDecisionEffects.issueId,
    decisionId: statusDecisionEffects.decisionId, ordinal: statusDecisionEffects.ordinal, effectKind: statusDecisionEffects.effectKind,
    targetType: statusDecisionEffects.targetType, targetId: statusDecisionEffects.targetId, idempotencyKey: statusDecisionEffects.idempotencyKey,
    deliveryState: statusDecisionEffects.deliveryState,
    payload: sql<Record<string, unknown>>`jsonb_build_object('interactionId', ${statusDecisionEffects.payload}->'interactionId', 'interactionKind', ${statusDecisionEffects.payload}->'interactionKind', 'ownerAgentId', ${statusDecisionEffects.payload}->'ownerAgentId', 'ownerUserId', ${statusDecisionEffects.payload}->'ownerUserId')`,
  }).from(statusDecisionEffects).where(and(eq(statusDecisionEffects.companyId, run.companyId), eq(statusDecisionEffects.issueId, run.issueId),
    eq(statusDecisionEffects.decisionId, decision.id), eq(statusDecisionEffects.targetId, review.id), eq(statusDecisionEffects.effectKind, "bind_reviewer"),
    eq(statusDecisionEffects.targetType, "issue_thread_interaction"))).limit(2) : [];
  if (effects.length !== 1) return null;
  const [reviewer] = review.resolvedByRunId ? await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId,
    nativeIssueId: heartbeatRuns.nativeIssueId, status: heartbeatRuns.status,
    contextSnapshot: sql<Record<string, unknown>>`jsonb_build_object('nativeReviewInteractionId', ${heartbeatRuns.contextSnapshot}->'nativeReviewInteractionId', 'nativeReviewDecisionId', ${heartbeatRuns.contextSnapshot}->'nativeReviewDecisionId')`,
    runnerProfileJson: sql<Record<string, unknown>>`jsonb_build_object('nativeReviewContextReceipt', ${heartbeatRuns.runnerProfileJson}->'nativeReviewContextReceipt')`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.id, review.resolvedByRunId))) : [];
  return nativeIndependentReviewVerdict(run, review, decision ?? null, reviewer ?? null, effects[0]);
}
