import { and, desc, eq, or, sql } from "drizzle-orm";
import { heartbeatRunEvents, heartbeatRuns, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { NativeSessionProtocolIntegrityError, validatePrpEvent, type NativeExecutionInput, type PrpEvent } from "../../vendor/paperclip-runner/index.js";
import { allocateHeartbeatRunEventSeq } from "../heartbeat-run-events.js";
import { readNativeModelComparison, type NativeModelComparisonBinding } from "../model-comparison-admission.js";
import { modelProfileDigest } from "../model-profile-binding.js";
import { nativeSha256 } from "./canonical.js";
import { MAX_COMPARISON_EVENTS, NATIVE_COMPARISON_EVENT, NATIVE_COMPARISON_SOURCE, projectNativeComparisonEvent } from "./native-comparison-event-projection.js";

export interface NativeComparisonEventAuthority {
  leaseOwner: string;
  attempt: number;
  controller: { bootId: string; pid: number; processStartedAt: Date };
  assertActive: () => void;
}
const admissionDigest = ({ receiptId: _acknowledgement, ...binding }: NativeModelComparisonBinding) => nativeSha256(binding);

export function matchesNativeComparisonEvent(event: PrpEvent, scope: {
  runId: string; normalizedSessionId: string; runnerInstanceId: string;
}): boolean {
  return event.sourceKind === "runner" && event.runId === scope.runId && event.sourceInstanceId === scope.runnerInstanceId
    && event.normalizedSessionId === scope.normalizedSessionId && event.turnId === `turn-${scope.runId}`
    && event.itemId === `item-${scope.runId}` && event.sourceEventId.length <= 240;
}

/** No callback or per-event work for ordinary runs. Warm sessions can inherit
 * an acknowledged prefix and retain callbacks across runs: this narrow path
 * deliberately leaves their history unavailable instead of inferring it. */
export function nativeComparisonEventSink(db: Db, input: {
  execution: NativeExecutionInput;
  runnerInstanceId: string;
  binding: NativeModelComparisonBinding | null;
  authority?: NativeComparisonEventAuthority;
}): ((event: PrpEvent) => Promise<void>) | undefined {
  if (!input.binding || input.execution.session.lifecyclePolicy.mode !== "per_turn") return undefined;
  if (!input.authority || !input.binding.contextReceipt || input.binding.runId !== input.execution.binding.runId
    || input.binding.companyId !== input.execution.binding.companyId
    || input.binding.contextReceipt.executionSha256 !== modelProfileDigest(input.execution)) {
    throw new Error("native_comparison_event_admission_missing");
  }
  const authority = input.authority, bindingDigest = admissionDigest(input.binding), executionDigest = nativeSha256(input.execution);
  const scope = input.execution.binding;
  return async value => {
    const parsed = validatePrpEvent(value);
    if (!parsed.ok) throw new Error("native_comparison_event_invalid");
    const event = parsed.event;
    if (!matchesNativeComparisonEvent(event, { runId: scope.runId, runnerInstanceId: input.runnerInstanceId,
      normalizedSessionId: input.execution.session.normalizedSessionId ?? `session-${scope.runId}` })) throw new Error("native_comparison_event_binding_changed");
    const sourceInstanceId = `${NATIVE_COMPARISON_SOURCE}${event.sourceInstanceId}`;
    const sourceEventId = `${NATIVE_COMPARISON_SOURCE}${event.sourceEventId}`;
    // Hash the actual authenticated event in memory. Only its allowlisted
    // projection is persisted; raw prompts, results and credentials stay owned
    // by the existing native journal.
    const originalDigest = nativeSha256(event);
    await db.transaction(async connection => {
      const tx = connection as unknown as Db;
      const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, scope.runId),
        eq(heartbeatRuns.companyId, scope.companyId), eq(heartbeatRuns.agentId, scope.agentId),
        eq(heartbeatRuns.nativeIssueId, scope.issueId), eq(heartbeatRuns.nativeSessionId, event.normalizedSessionId),
        eq(heartbeatRuns.runnerInstanceId, input.runnerInstanceId), eq(heartbeatRuns.runtimeMode, "native"),
      )).for("update").limit(1);
      const currentBinding = run && readNativeModelComparison(run);
      if (!run || !currentBinding || admissionDigest(currentBinding) !== bindingDigest
        || currentBinding.receiptId != null && currentBinding.receiptId !== scope.runId
        || nativeSha256(run.runnerProfileJson?.nativeExecutionInput) !== executionDigest) {
        throw new Error("native_comparison_event_binding_changed");
      }
      const [existing] = await tx.select().from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, scope.runId), or(
        eq(heartbeatRunEvents.sourceEventId, sourceEventId),
        and(eq(heartbeatRunEvents.sourceInstanceId, sourceInstanceId), eq(heartbeatRunEvents.sourceSeq, event.sourceSeq)),
      ))).limit(1);
      if (existing) {
        if (existing.eventType !== NATIVE_COMPARISON_EVENT || existing.sourcePayloadSha256 !== originalDigest
          || existing.sourceInstanceId !== sourceInstanceId || existing.sourceEventId !== sourceEventId || existing.sourceSeq !== event.sourceSeq) {
          throw new NativeSessionProtocolIntegrityError("source_event_replay_conflict");
        }
        // A lost final ACK can replay after finalization released its lease.
        // This only acknowledges the exact existing immutable receipt: no
        // insertion, sequence allocation or execution authority is granted.
        return;
      }
      const [previous] = await tx.select({ sourceSeq: heartbeatRunEvents.sourceSeq }).from(heartbeatRunEvents)
        .where(and(eq(heartbeatRunEvents.runId, scope.runId), eq(heartbeatRunEvents.sourceInstanceId, sourceInstanceId)))
        .orderBy(desc(heartbeatRunEvents.sourceSeq)).limit(1);
      // A durable over-limit witness makes all later positions unavailable.
      // Discarding the suffix is read-only, including a lost terminal ACK after
      // lease release. It never certifies those discarded bytes as evidence.
      if ((previous?.sourceSeq ?? 0) > MAX_COMPARISON_EVENTS) return;
      authority.assertActive();
      // Native result publication locks run → coordinator; restart claims can
      // start with coordinator. Never wait for that second lock while holding
      // the run: a competing claim rolls this attempt back and native delivery
      // replays before ACK. The lease then stays fenced through the insert.
      const [coordinator] = await tx.select().from(nativeRunFinalizations).where(and(
        eq(nativeRunFinalizations.runId, scope.runId), eq(nativeRunFinalizations.companyId, scope.companyId),
        eq(nativeRunFinalizations.issueId, scope.issueId),
      )).for("share", { noWait: true }).limit(1);
      if (!coordinator || coordinator.leaseOwner !== authority.leaseOwner || coordinator.attempt !== authority.attempt
        || coordinator.controllerBootId !== authority.controller.bootId || coordinator.controllerPid !== authority.controller.pid
        || coordinator.controllerProcessStartedAt?.getTime() !== authority.controller.processStartedAt.getTime()
        || !coordinator.leaseExpiresAt || coordinator.leaseExpiresAt.getTime() <= Date.now() || run.status !== "running") {
        throw new Error("native_comparison_event_authority_lost");
      }
      // Retain one explicit over-limit position, then stop storing. Missing
      // terminal/full history keeps the run unmeasured, never silently sampled.
      if (previous && event.sourceSeq !== previous.sourceSeq! + 1) throw new Error("native_comparison_event_source_gap");
      const projection = event.sourceSeq > MAX_COMPARISON_EVENTS ? null : projectNativeComparisonEvent(event);
      const seq = await allocateHeartbeatRunEventSeq(tx, scope.runId);
      authority.assertActive();
      await tx.insert(heartbeatRunEvents).values({ companyId: scope.companyId, runId: scope.runId, agentId: scope.agentId,
        seq, eventType: NATIVE_COMPARISON_EVENT, stream: "system", level: "info",
        payload: { schema: "agentos.native-comparison-event.v1", event: projection },
        sourceInstanceId, sourceEventId, sourceSeq: event.sourceSeq, sourcePayloadSha256: originalDigest, protocolSchemaVersion: event.schemaVersion,
      });
      // Use the database clock too; application clock skew must not extend a
      // controller lease while the transaction waits for the event/run lock.
      const [live] = await tx.select({ runId: nativeRunFinalizations.runId }).from(nativeRunFinalizations)
        .where(and(eq(nativeRunFinalizations.runId, scope.runId), sql`${nativeRunFinalizations.leaseExpiresAt} > clock_timestamp()`)).limit(1);
      authority.assertActive();
      if (!live) throw new Error("native_comparison_event_authority_lost");
    });
  };
}
