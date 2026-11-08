import { and, eq, isNotNull, sql } from "drizzle-orm";
import { heartbeatRunEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import type { NativeModelComparisonBinding } from "./model-comparison-admission.js";
import { modelProfileDigest } from "./model-profile-binding.js";
import { nativeModelComparisonEventProjection, type ModelComparisonEvent } from "./model-comparison-event-projection.js";
import { MAX_COMPARISON_EVENTS, NATIVE_COMPARISON_EVENT } from "./native-runtime/native-comparison-event-projection.js";

type Run = typeof heartbeatRuns.$inferSelect;
type Event = ModelComparisonEvent;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const MAX_EVENTS = MAX_COMPARISON_EVENTS;
const terminalTurns = new Set(["turn.completed", "turn.failed", "turn.cancelled", "turn.interrupted"]);
export interface ModelComparisonMeasurements {
  schema: "agentos.model-comparison-measurements.v1";
  runId: string;
  iterations: number | null;
  latencyMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  eventDigest: string | null;
  gaps: string[];
}

/** Count observable work cycles, including repeated completion submissions in
 * one provider turn. Tool loops/internal model reasoning are not iterations.
 * Only a complete authenticated protocol history can establish this count. */
export function comparisonWorkIterations(run: Run, events: Event[]): number | null {
  if (!events.length || events.length > MAX_EVENTS || run.runtimeMode !== "native" || run.sessionIdBefore) return null;
  const sources = new Map<string, number>();
  const turns = new Map<string, { terminal: boolean; reports: Set<string> }>();
  const activeTurns = new Map<string, string>();
  const seen = new Set<string>();
  let terminal = false;
  for (const row of events) {
    const event = record(record(row.payload).prpEvent);
    // Current runnerd uses v1 for native lifecycle/semantic events and v2 for
    // goal/capability events. Only the authenticated journal projection may
    // supply that mixed history; a legacy facade cannot establish its origin.
    const nativeV1 = row.protocolSchemaVersion === 1 && record(row.payload).nativeEvidenceSchema === "agentos.native-comparison-event.v1";
    if (row.companyId !== run.companyId || row.runId !== run.id || row.agentId !== run.agentId
      || !row.sourceInstanceId || !row.sourceEventId || !row.sourcePayloadSha256
      || (!nativeV1 && ![2, 3].includes(row.protocolSchemaVersion ?? 0))
      || event.runId !== run.id || event.sourceInstanceId !== row.sourceInstanceId || event.sourceEventId !== row.sourceEventId
      || event.sourceSeq !== row.sourceSeq || event.eventType !== row.eventType
      || !Number.isSafeInteger(row.sourceSeq) || row.sourceSeq !== (sources.get(row.sourceInstanceId) ?? 0) + 1
      || seen.has(row.sourceEventId)) return null;
    sources.set(row.sourceInstanceId, row.sourceSeq!);
    seen.add(row.sourceEventId);
    const payload = record(event.payload);
    // The protocol envelope's turnId identifies the native invocation. Several
    // provider turns can occur inside it; normalized provider lifecycle events
    // supply their actual identity. Semantic inputs retain the outer identity
    // and belong to its sole currently active provider turn.
    const invocationKey = typeof event.normalizedSessionId === "string" && typeof event.turnId === "string"
      ? JSON.stringify([event.normalizedSessionId, event.turnId]) : null;
    const turnKey = invocationKey && typeof payload.providerTurnId === "string" && payload.providerTurnId
      ? JSON.stringify([invocationKey, payload.providerTurnId]) : null;
    if (row.eventType === "turn.started") {
      if (!invocationKey || !turnKey || turns.has(turnKey) || activeTurns.has(invocationKey) || terminal) return null;
      turns.set(turnKey, { terminal: false, reports: new Set() });
      activeTurns.set(invocationKey, turnKey);
    } else if (terminalTurns.has(row.eventType)) {
      const turn = turnKey && turns.get(turnKey);
      if (!invocationKey || !turn || turn.terminal || activeTurns.get(invocationKey) !== turnKey || terminal) return null;
      turn.terminal = true;
      activeTurns.delete(invocationKey);
    } else if (row.eventType === "semantic_tool.input") {
      const tool = record(payload.semantic_tool);
      if (tool.operationId === "finish_task" || tool.operationId === "paperclip_finish") {
        const activeKey = invocationKey && activeTurns.get(invocationKey);
        const turn = activeKey && turns.get(activeKey), correlation = record(tool.correlation);
        if (!turn || turn.terminal || typeof tool.callId !== "string" || !tool.callId
          || correlation.runId !== run.id || correlation.turnId !== event.turnId
          || correlation.normalizedSessionId !== event.normalizedSessionId) return null;
        // A transport replay with a new call ID retains its native idempotency
        // key. It is delivery recovery, not another work/repair cycle.
        const key = tool.idempotencyKey ?? record(tool.input).idempotencyKey;
        turn.reports.add(typeof key === "string" && key ? key : tool.callId);
      }
    } else if (row.eventType === "run.terminal") {
      if (terminal || activeTurns.size || payload.runTerminalState !== run.status) return null;
      terminal = true;
    }
  }
  if (!terminal || !turns.size || [...turns.values()].some(turn => !turn.terminal)) return null;
  const iterations = [...turns.values()].reduce((sum, turn) => sum + Math.max(1, turn.reports.size), 0);
  return iterations <= 100 ? iterations : null;
}

const timestamp = (value: unknown) => {
  const time = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

export function measureModelComparison(run: Run, binding: Pick<NativeModelComparisonBinding, "attempt" | "admittedAt">, events: Event[], reviewedAt: Date | null,
  previous: ModelComparisonMeasurements | null = null, now = Date.now()): ModelComparisonMeasurements {
  const finished = timestamp(run.finishedAt), admitted = timestamp(binding.admittedAt), created = timestamp(run.createdAt);
  const end = run.status === "succeeded" ? timestamp(reviewedAt) : finished;
  // Later segments start at the previous reviewed/failed outcome. Summing them
  // includes retry queues and human review waits without counting time twice.
  const start = binding.attempt === 1 ? created : previous?.latencyMs != null ? timestamp(previous.completedAt) : null;
  const timingValid = start !== null && end !== null && created !== null && admitted !== null && finished !== null
    && created <= admitted && start <= admitted && admitted <= finished && finished <= end && end <= now
    && end - start <= Number.MAX_SAFE_INTEGER / 10;
  const iterations = comparisonWorkIterations(run, events);
  return {
    schema: "agentos.model-comparison-measurements.v1", runId: run.id, iterations,
    latencyMs: timingValid ? end - start : null,
    startedAt: timingValid ? new Date(start).toISOString() : null,
    completedAt: timingValid ? new Date(end).toISOString() : null,
    eventDigest: iterations === null ? null : modelProfileDigest(events.map(row => ({ id: row.sourceEventId, sha256: row.sourcePayloadSha256 }))),
    gaps: [...(iterations === null ? ["work_iterations_unmeasured"] : []), ...(timingValid ? [] : ["end_to_end_latency_unmeasured"])],
  };
}

/** Runs own the frozen measurement chain; no polling, provider calls or global
 * history scan. The existing terminal/review/accounting producer wakes delivery. */
export function readModelComparisonEvents(db: Db, run: Run) {
  return db.select(nativeModelComparisonEventProjection).from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, run.companyId),
    eq(heartbeatRunEvents.runId, run.id), eq(heartbeatRunEvents.eventType, NATIVE_COMPARISON_EVENT),
    isNotNull(heartbeatRunEvents.sourceEventId))).orderBy(heartbeatRunEvents.seq).limit(MAX_EVENTS + 1);
}
export async function readModelComparisonMeasurements(db: Db, run: Run, binding: NativeModelComparisonBinding, reviewedAt: Date | null) {
  const events = await readModelComparisonEvents(db, run);
  let previous: ModelComparisonMeasurements | null = null;
  if (binding.attempt > 1) {
    const assignment = binding.assignment;
    const prior = await db.select({ id: heartbeatRuns.id, profile: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, run.companyId),
      sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->'assignment'->>'comparisonId' = ${assignment.comparisonId}`,
      sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->'assignment'->>'caseId' = ${assignment.caseId}`,
      sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->'assignment'->>'arm' = ${assignment.arm}`,
      sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->>'attempt' = ${String(binding.attempt - 1)}`,
    )).limit(2);
    const delivery = record(prior[0]?.profile?.nativeModelComparisonDelivery), measurements = record(delivery.measurements);
    if (prior.length === 1 && delivery.state === "delivered" && delivery.fingerprint === modelProfileDigest(delivery.outcome)
      && delivery.measurementFingerprint === modelProfileDigest(measurements)
      && measurements.schema === "agentos.model-comparison-measurements.v1" && measurements.runId === prior[0].id) {
      previous = measurements as unknown as ModelComparisonMeasurements;
    }
  }
  return { measurements: measureModelComparison(run, binding, events, reviewedAt, previous), events };
}
