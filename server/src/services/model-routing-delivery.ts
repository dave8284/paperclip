import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { completionContracts, heartbeatRuns, type Db } from "@paperclipai/db";
import type { RoutingOutcomeInput, SelectionReceipt } from "@agentos/model-intelligence";
import { conflict } from "../errors.js";
import { modelIntelligenceProduct } from "./model-intelligence.js";
import { modelProfileDigest } from "./model-profile-binding.js";
import { exactNativeRoutingSelection, readNativeModelRoutingAdmission, NATIVE_MODEL_ROUTING_DELIVERY } from "./model-routing-binding.js";
import { measureModelComparison, readModelComparisonEvents, type ModelComparisonMeasurements } from "./model-comparison-measurements.js";
import { readNativeModelReview, type modelComparisonReviewVerdict } from "./model-evaluation-review.js";

type Run = typeof heartbeatRuns.$inferSelect;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const terminal = ["succeeded", "failed", "cancelled", "timed_out", "interrupted"];
const pending = and(
  sql`${heartbeatRuns.runnerProfileJson}->'nativeModelRoutingAdmission'->>'schema' = 'agentos.native-model-routing-admission.v1'`,
  inArray(heartbeatRuns.status, terminal),
  sql`coalesce(${heartbeatRuns.runnerProfileJson}->'nativeModelRoutingDelivery'->>'state', 'waiting') not in ('delivered','unselected')`,
);

export function nativeRoutingOutcome(run: Run, receipt: SelectionReceipt, verdict: ReturnType<typeof modelComparisonReviewVerdict>, measurements: ModelComparisonMeasurements): RoutingOutcomeInput | null {
  if (!terminal.includes(run.status) || !exactNativeRoutingSelection(run, receipt) || receipt.rollout?.assignmentId !== run.id) return null;
  const native = record(run.runnerProfileJson?.nativeExecutionInput), binding = record(native.binding), task = record(native.task);
  const nativeTask = run.runtimeMode === "native" && binding.runId === run.id && binding.companyId === run.companyId && binding.agentId === run.agentId
    && binding.issueId === run.issueId && task.workMode === "standard" && !native.executionPurpose && !run.contextSnapshot?.nativeReviewInteractionId;
  return { namespace: run.companyId, id: run.id, receiptId: run.id,
    outcome: run.status === "cancelled" ? "cancelled" : run.status === "succeeded" ? nativeTask ? verdict?.outcome ?? "unknown" : "unknown" : "failed",
    // As with M05, prepared input or a successful review cannot attest implicit
    // provider/retrieved context. Unknown dimensions force release rollback.
    observedVariant: null, iterations: measurements.runId === run.id ? measurements.iterations : null,
    latencyMs: measurements.runId === run.id ? measurements.latencyMs : null,
    source: verdict?.evaluator.startsWith("user:") ? "human" : "checks", evaluator: verdict?.evaluator ?? "native_execution",
    evidenceRef: `native-run:${run.id}${verdict ? `:review:${verdict.reviewId}` : ""}` };
}

/** Run rows own delivery across the native PostgreSQL/independent SQLite
 * boundary. No caller-supplied score or model prose is accepted as an outcome. */
export function modelRoutingDeliveryService(db: Db) {
  // Refreshed by the coordinator's existing asynchronous reconciliation. Its
  // synchronous deadline projection performs no remote query or idle polling.
  let nextDeadline: number | null = null;
  const save = (tx: Db, runId: string, delivery: Record<string, unknown>) => tx.update(heartbeatRuns).set({
    runnerProfileJson: sql`jsonb_set(${heartbeatRuns.runnerProfileJson}, '{nativeModelRoutingDelivery}', ${JSON.stringify(delivery)}::jsonb)`,
  }).where(eq(heartbeatRuns.id, runId));
  async function freeze(runId: string) {
    return db.transaction(async connection => {
      const tx = connection as unknown as Db;
      const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), pending)).for("update");
      if (!run) return null;
      const admission = readNativeModelRoutingAdmission(run), delivery = record(run.runnerProfileJson?.[NATIVE_MODEL_ROUTING_DELIVERY]);
      if (!admission) throw conflict("The native routing admission changed before outcome delivery");
      if (delivery.state === "ready") {
        if (delivery.fingerprint !== modelProfileDigest(delivery.outcome ?? null)) throw conflict("The frozen routing outcome changed");
        return delivery.outcome as unknown as RoutingOutcomeInput;
      }
      const receipt = await modelIntelligenceProduct()!.selectionReceipt({ namespace: run.companyId, receiptId: run.id });
      if (!receipt || receipt.rollout?.assignmentId !== run.id) { await save(tx, run.id, { state: "unselected" }); return null; }
      if (!exactNativeRoutingSelection(run, receipt)) throw conflict("The routing outcome has no exact native selection");
      if (run.contextSnapshot?.modelIntelligence && modelProfileDigest(run.contextSnapshot.modelIntelligence) !== modelProfileDigest(receipt)) throw conflict("The native routing selection changed");
      if (!run.contextSnapshot?.modelIntelligence) {
        await tx.update(heartbeatRuns).set({ contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify({ modelIntelligence: receipt })}::jsonb` }).where(eq(heartbeatRuns.id, run.id));
      }
      if (run.costAccountingPending) { await save(tx, run.id, { state: "waiting_accounting" }); return null; }
      let verdict: Awaited<ReturnType<typeof readNativeModelReview>> = null;
      if (run.status === "succeeded") {
        verdict = await readNativeModelReview(tx, run);
        if (!verdict) { await save(tx, run.id, { state: "waiting_review" }); return null; }
        const [contract] = run.completionContractId ? await tx.select().from(completionContracts).where(and(eq(completionContracts.id, run.completionContractId),
          eq(completionContracts.companyId, run.companyId), eq(completionContracts.issueId, run.issueId!))) : [];
        const frozenContract = record(record(run.runnerProfileJson?.nativeExecutionInput).completionContract);
        if (!contract || frozenContract.id !== contract.id || frozenContract.sha256 !== contract.canonicalSha256) verdict = null;
      }
      const events = await readModelComparisonEvents(tx, run);
      const measurements = measureModelComparison(run, { attempt: 1, admittedAt: admission.admittedAt }, events, verdict?.resolvedAt ?? null);
      const outcome = nativeRoutingOutcome(run, receipt, verdict, measurements);
      if (!outcome) throw conflict("The native routing outcome is unbound");
      await save(tx, run.id, { state: "ready", outcome, measurements, fingerprint: modelProfileDigest(outcome),
        measurementFingerprint: modelProfileDigest(measurements), gaps: ["execution_context_not_fully_bound", ...measurements.gaps] });
      return outcome;
    });
  }
  return {
    async sweepPending(signal?: AbortSignal) {
      const engine = modelIntelligenceProduct(); if (!engine) return;
      // One bounded expiry page; another actual due deadline schedules the next
      // slice through the shared coordinator, allowing unrelated work to run.
      if (!signal?.aborted) await engine.reconcileRoutingDeadlines();
      let afterId: string | undefined;
      while (!signal?.aborted) {
        const rows = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(pending, afterId ? gt(heartbeatRuns.id, afterId) : undefined)).orderBy(heartbeatRuns.id).limit(100);
        if (!rows.length) return;
        for (const row of rows) {
          if (signal?.aborted) return;
          const outcome = await freeze(row.id); if (!outcome) continue;
          await engine.recordRoutingOutcome(outcome);
          await db.transaction(async connection => {
            const tx = connection as unknown as Db;
            const [run] = await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, row.id)).for("update");
            const delivery = record(run?.runnerProfileJson?.[NATIVE_MODEL_ROUTING_DELIVERY]);
            if (delivery.fingerprint !== modelProfileDigest(outcome)) throw conflict("The frozen routing delivery changed");
            await save(tx, row.id, { ...delivery, state: "delivered", deliveredAt: new Date().toISOString() });
          });
        }
        afterId = rows.at(-1)!.id;
      }
    },
    async hasPending() {
      const engine = modelIntelligenceProduct();
      if (!engine) { nextDeadline = null; return false; }
      nextDeadline = await engine.nextRoutingDeadline();
      const [row] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(pending,
        sql`coalesce(${heartbeatRuns.runnerProfileJson}->'nativeModelRoutingDelivery'->>'state', 'waiting') in ('waiting','ready')`)).limit(1);
      return !!row;
    },
    nextRunAt: () => nextDeadline,
  };
}
