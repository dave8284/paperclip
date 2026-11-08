import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { completionContracts, heartbeatRuns, type Db } from "@paperclipai/db";
import type { ComparisonOutcomeInput } from "@agentos/model-intelligence";
import { conflict } from "../errors.js";
import { modelIntelligenceProduct } from "./model-intelligence.js";
import { modelProfileDigest } from "./model-profile-binding.js";
import { modelComparisonCheckDigest, modelComparisonTaskScope } from "./model-comparison-scope.js";
import { readNativeModelComparison, NATIVE_MODEL_COMPARISON_DELIVERY_KEY, type NativeModelComparisonBinding } from "./model-comparison-admission.js";
import { readModelComparisonMeasurements, type ModelComparisonMeasurements } from "./model-comparison-measurements.js";
import { modelComparisonReviewVerdict, readNativeModelReview } from "./model-evaluation-review.js";
import { nativeComparisonContextEvidence } from "./native-runtime/native-comparison-context.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const terminalStatuses = ["succeeded", "failed", "cancelled", "timed_out", "interrupted"];
type Run = typeof heartbeatRuns.$inferSelect;

export { modelComparisonReviewVerdict } from "./model-evaluation-review.js";

export function modelComparisonOutcome(run: Run, binding: NativeModelComparisonBinding,
  verdict: ReturnType<typeof modelComparisonReviewVerdict>, measurements?: ModelComparisonMeasurements): ComparisonOutcomeInput | null {
  if (!terminalStatuses.includes(run.status) || !binding.receiptId) return null;
  const receipt = record(run.contextSnapshot?.modelIntelligence), comparison = record(receipt.comparisonBinding);
  const { assignment } = binding;
  if (receipt.id !== binding.receiptId || receipt.id !== run.id || receipt.namespace !== run.companyId
    || comparison.comparisonId !== assignment.comparisonId || comparison.caseId !== assignment.caseId || comparison.arm !== assignment.arm
    || comparison.inputDigest !== assignment.inputDigest || comparison.checkDigest !== assignment.checkDigest) throw conflict("The comparison outcome has no exact selection receipt");
  const native = record(run.runnerProfileJson?.nativeExecutionInput), task = record(native.task), owner = record(native.binding);
  const taskMatches = owner.companyId === run.companyId && owner.runId === run.id && owner.agentId === run.agentId && owner.issueId === run.issueId
    && task.workMode === "standard" && typeof task.title === "string" && (typeof task.description === "string" || task.description === null)
    && modelComparisonTaskScope({ title: task.title, description: task.description }).inputDigest === assignment.inputDigest
    && !native.executionPurpose && !run.contextSnapshot?.nativeReviewInteractionId;
  const outcome = run.status === "cancelled" ? "cancelled" : run.status === "succeeded" ? taskMatches ? verdict?.outcome ?? "unknown" : "unknown" : "failed";
  return { namespace: run.companyId, id: run.id, comparisonId: assignment.comparisonId, caseId: assignment.caseId, arm: assignment.arm,
    attempt: binding.attempt, receiptId: binding.receiptId, inputDigest: assignment.inputDigest, checkDigest: assignment.checkDigest,
    // The preparation manifest does not yet bind every delivered context/tool
    // input. Preserve that gap explicitly.
    // A native exit/review alone must never qualify this arm for promotion.
    observedVariant: null, provenance: "observed", outcome, terminal: outcome !== "failed" || binding.attempt === 10,
    iterations: measurements?.runId === run.id ? measurements.iterations : null,
    latencyMs: measurements?.runId === run.id ? measurements.latencyMs : null,
    source: verdict?.evaluator.startsWith("user:") ? "human" : "checks", evaluator: verdict?.evaluator ?? "native_execution",
    evidenceRef: `native-run:${run.id}${verdict ? `:review:${verdict.reviewId}` : ""}` };
}

const pending = and(
  sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->>'schema' = 'agentos.native-model-comparison.v1'`,
  inArray(heartbeatRuns.status, terminalStatuses),
  sql`coalesce(${heartbeatRuns.runnerProfileJson}->'nativeModelComparisonDelivery'->>'state', 'waiting') not in ('delivered', 'unselected')`,
);

/** Native rows are the outbox. Freeze before crossing stores, then replay the
 * same payload after a crash. Review/accounting waits have event-driven wakes;
 * only a frozen, undelivered outcome is a concrete retry obligation. */
export function modelComparisonDeliveryService(db: Db) {
  async function save(tx: Db, runId: string, delivery: Record<string, unknown>) {
    await tx.update(heartbeatRuns).set({ runnerProfileJson: sql`jsonb_set(${heartbeatRuns.runnerProfileJson}, '{nativeModelComparisonDelivery}', ${JSON.stringify(delivery)}::jsonb)` })
      .where(eq(heartbeatRuns.id, runId));
  }
  async function freeze(runId: string) {
    return db.transaction(async connection => {
      const tx = connection as unknown as Db;
      const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), pending)).for("update");
      const binding = run && readNativeModelComparison(run);
      if (!run || !binding) return null;
      const delivery = record(run.runnerProfileJson?.[NATIVE_MODEL_COMPARISON_DELIVERY_KEY]);
      if (delivery.state === "ready") {
        if (delivery.fingerprint !== modelProfileDigest(delivery.outcome)) throw conflict("The frozen comparison payload changed");
        return delivery.outcome as unknown as ComparisonOutcomeInput;
      }
      // Selection may have committed in SQLite before either PostgreSQL
      // acknowledgement. Recover that historical receipt without reselecting
      // under today's block policy or inventing a new provider attempt.
      if (!binding.receiptId || !run.contextSnapshot?.modelIntelligence) {
        const receipt = await modelIntelligenceProduct()!.selectionReceipt({ namespace: run.companyId, receiptId: run.id });
        const request = record(run.contextSnapshot?.modelIntelligenceRequest);
        if (receipt && request.requestId === run.id && request.namespace === run.companyId
          && modelProfileDigest(request.comparisonBinding) === modelProfileDigest(receipt.comparisonBinding)) {
          binding.receiptId = receipt.id;
          run.contextSnapshot = { ...run.contextSnapshot, modelIntelligence: receipt };
          await tx.update(heartbeatRuns).set({
            runnerProfileJson: sql`jsonb_set(${heartbeatRuns.runnerProfileJson}, '{nativeModelComparison,receiptId}', to_jsonb(${receipt.id}::text))`,
            contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify({ modelIntelligence: receipt })}::jsonb`,
          }).where(eq(heartbeatRuns.id, run.id));
        }
      }
      if (!binding.receiptId) {
        await save(tx, runId, { state: "unselected", outcome: "unknown", reason: "execution_ended_before_selection" });
        return null;
      }
      if (run.costAccountingPending) { await save(tx, runId, { state: "waiting_accounting" }); return null; }
      let verdict: ReturnType<typeof modelComparisonReviewVerdict> = null;
      if (run.status === "succeeded") {
        verdict = await readNativeModelReview(tx, run);
        if (!verdict) { await save(tx, runId, { state: "waiting_review", outcome: "unknown" }); return null; }
        const [contract] = run.completionContractId ? await tx.select().from(completionContracts).where(and(
          eq(completionContracts.companyId, run.companyId), eq(completionContracts.issueId, run.issueId!), eq(completionContracts.id, run.completionContractId))) : [];
        if (!contract || modelComparisonCheckDigest(contract.contractJson.criteria, contract) !== binding.assignment.checkDigest) verdict = null;
      }
      const { measurements, events } = await readModelComparisonMeasurements(tx, run, binding, verdict?.resolvedAt ?? null);
      const contextEvidence = nativeComparisonContextEvidence(run, binding, events);
      const outcome = modelComparisonOutcome(run, binding, verdict, measurements);
      if (!outcome) return null;
      await save(tx, runId, { state: "ready", outcome, fingerprint: modelProfileDigest(outcome), measurements, contextEvidence,
        measurementFingerprint: modelProfileDigest(measurements), gaps: ["execution_context_not_fully_bound", ...measurements.gaps] });
      return outcome;
    });
  }
  return {
    async sweepPending(signal?: AbortSignal) {
      const engine = modelIntelligenceProduct();
      if (!engine) return;
      let afterId: string | undefined;
      while (!signal?.aborted) {
        const rows = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(pending, afterId ? gt(heartbeatRuns.id, afterId) : undefined))
          .orderBy(heartbeatRuns.id).limit(100);
        if (!rows.length) return;
        for (const row of rows) {
          if (signal?.aborted) return;
          const outcome = await freeze(row.id);
          if (!outcome) continue;
          await engine.recordComparisonOutcome(outcome);
          await db.transaction(async connection => {
            const tx = connection as unknown as Db;
            const [run] = await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, row.id)).for("update");
            const delivery = record(run?.runnerProfileJson?.[NATIVE_MODEL_COMPARISON_DELIVERY_KEY]);
            if (delivery.fingerprint !== modelProfileDigest(outcome)) throw conflict("The frozen comparison delivery changed");
            await save(tx, row.id, { ...delivery, state: "delivered", deliveredAt: new Date().toISOString() });
          });
        }
        afterId = rows.at(-1)!.id;
      }
    },
    async hasPending() {
      if (!modelIntelligenceProduct()) return false;
      const [row] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(pending,
        sql`coalesce(${heartbeatRuns.runnerProfileJson}->'nativeModelComparisonDelivery'->>'state', 'waiting') in ('waiting', 'ready')`)).limit(1);
      return Boolean(row);
    },
  };
}
