import { createHash } from "node:crypto";
import type { heartbeatRuns } from "@paperclipai/db";
import { buildNativeModelEnvelope, parseNativeExecutionInput, type NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { conflict } from "../../errors.js";
import { modelProfileDigest } from "../model-profile-binding.js";
import { modelComparisonTaskScope } from "../model-comparison-scope.js";
import { readNativeModelComparison, type NativeModelComparisonBinding } from "../model-comparison-admission.js";
import { comparisonWorkIterations } from "../model-comparison-measurements.js";
import type { ModelComparisonEvent } from "../model-comparison-event-projection.js";

type Run = Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "agentId" | "issueId" | "runnerProfileJson">;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// Match serde_json's sorted object representation, independently of JSONB key
// order. Native envelopes have protocol-owned ASCII field names.
export function nativeComparisonEnvelopeDigest(value: unknown): string {
  return sha(JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));
}

/** Native admission owns the entire prepared input, including dynamic context.
 * Digests identify protected run data; they are not provider-delivery evidence. */
export function nativeComparisonContextReceipt(run: Run, execution: NativeExecutionInput, binding: NativeModelComparisonBinding) {
  if (binding.runId !== run.id || binding.companyId !== run.companyId
    || execution.binding.runId !== run.id || execution.binding.companyId !== run.companyId
    || execution.binding.agentId !== run.agentId || execution.binding.issueId !== run.issueId
    || execution.task.workMode !== "standard" || execution.provider.kind !== "codex"
    || modelComparisonTaskScope(execution.task).inputDigest !== binding.assignment.inputDigest) {
    throw conflict("The comparison context does not belong to the admitted task");
  }
  const runtime = "runtimeContext" in execution ? execution.runtimeContext : null;
  return {
    schema: "agentos.native-comparison-context.v1" as const,
    stage: "server_prepared" as const,
    runId: run.id,
    assignmentSha256: modelProfileDigest(binding.assignment),
    executionSha256: modelProfileDigest(execution),
    taskPromptSha256: sha(execution.task.prompt),
    initialEnvelopeSha256: nativeComparisonEnvelopeDigest(buildNativeModelEnvelope(execution)),
    runtimeContextDigest: runtime?.aggregateDigest ?? null,
    promptDigest: runtime?.prompt.digest ?? null,
    instructionBundleDigest: runtime?.instructions.bundle.digest ?? null,
    instructionWorkingCopyPresent: !!runtime?.instructions.workingCopy,
    skills: runtime?.skills.map(skill => ({ key: skill.key, versionId: skill.versionId, bundleDigest: skill.bundle.digest })) ?? [],
    mcpAssignmentDigest: runtime?.mcp.digest ?? null,
    connectionInstructionsDigest: runtime?.connectionInstructions?.digest ?? null,
    completionContractSha256: execution.completionContract.sha256,
    normalizedSessionId: execution.session.normalizedSessionId,
  };
}

export type NativeComparisonContextReceipt = ReturnType<typeof nativeComparisonContextReceipt>;

/** Called only after full event authentication/continuity checks. A persisted
 * semantic result precedes its write; it cannot stand in for this later receipt.
 * Replays retain the first write, without counting the same call twice. */
function writtenToolResults(events: ModelComparisonEvent[]) {
  const active = new Map<string, string>();
  const calls = new Map<string, { operationId: string; outcome: string | null; written: boolean }>();
  const receipts: Array<{ eventId: string; eventSha256: string; callId: string; operationId: string;
    providerTurnId: string; resultSha256: string; resultBytes: number; isError: boolean; nativeOutcome: string; stage: "transport_written" }> = [];
  const invalid = () => ({ valid: false as const, receipts: [], missing: 0 });
  for (const row of events) {
    const event = record(record(row.payload).prpEvent), payload = record(event.payload);
    const invocation = JSON.stringify([event.normalizedSessionId, event.turnId]);
    if (row.eventType === "turn.started") active.set(invocation, String(payload.providerTurnId));
    if (["turn.completed", "turn.failed", "turn.cancelled", "turn.interrupted"].includes(row.eventType)) active.delete(invocation);
    const turn = active.get(invocation);
    if (row.eventType === "semantic_tool.input" || row.eventType === "semantic_tool.result") {
      const tool = record(payload.semantic_tool), correlation = record(tool.correlation);
      if (!turn) continue; // Settled after a closed turn cannot imply a provider write.
      if (typeof tool.callId !== "string" || !tool.callId || typeof tool.operationId !== "string" || !tool.operationId
        || correlation.runId !== event.runId || correlation.turnId !== event.turnId
        || correlation.normalizedSessionId !== event.normalizedSessionId) return invalid();
      const key = JSON.stringify([invocation, turn, tool.callId]);
      if (row.eventType === "semantic_tool.input") {
        if (calls.has(key)) return invalid();
        calls.set(key, { operationId: tool.operationId, outcome: null, written: false });
      } else {
        const call = calls.get(key);
        if (!call || call.operationId !== tool.operationId || call.outcome !== null
          || !["succeeded", "denied", "conflict", "duplicate", "unavailable", "failed"].includes(String(tool.outcome))) return invalid();
        call.outcome = String(tool.outcome);
      }
    }
    if (row.eventType !== "harness.diagnostic" || payload.code !== "context.tool_result_written") continue;
    const receipt = record(payload.contextReceipt);
    const call = calls.get(JSON.stringify([invocation, turn, receipt.callId]));
    if (!turn || !call?.outcome || call.written || call.operationId !== receipt.operationId || typeof receipt.isError !== "boolean"
      || receipt.schema !== "paperclip.provider-context-receipt.v1" || receipt.stage !== "transport_written"
      || receipt.source !== "tool/result" || receipt.providerTurnId !== turn || !digest(receipt.resultSha256)
      || !Number.isSafeInteger(receipt.resultBytes) || Number(receipt.resultBytes) < 1 || Number(receipt.resultBytes) > 1024 * 1024) return invalid();
    call.written = true;
    receipts.push({ eventId: row.sourceEventId!, eventSha256: row.sourcePayloadSha256!, callId: receipt.callId as string,
      operationId: call.operationId, providerTurnId: turn, resultSha256: receipt.resultSha256,
      resultBytes: Number(receipt.resultBytes), isError: receipt.isError, nativeOutcome: call.outcome, stage: "transport_written" });
  }
  return { valid: true as const, receipts, missing: [...calls.values()].filter(call => !call.written).length };
}

/** Called inside the existing native-selection run lock, before any dispatch.
 * Ordinary runs gain no work; recovery never backfills delivery authority. */
export function prepareNativeComparisonContext(run: Run, execution: NativeExecutionInput): NativeModelComparisonBinding | null {
  const binding = readNativeModelComparison(run);
  if (!binding) return null;
  const expected = nativeComparisonContextReceipt(run, execution, binding);
  if (binding.contextReceipt) {
    if (modelProfileDigest(binding.contextReceipt) !== modelProfileDigest(expected)) {
      throw conflict("The frozen comparison context changed during recovery");
    }
    return binding;
  }
  if (run.runnerProfileJson?.nativeExecutionInput) return binding;
  return { ...binding, contextReceipt: expected };
}

/** Consume authenticated native receipts, never requested configuration or model
 * prose. Matching the initial envelope alone cannot certify implicit provider
 * context, later retrieval or filesystem reads, so it cannot promote a variant. */
export function nativeComparisonContextEvidence(run: typeof heartbeatRuns.$inferSelect, binding: NativeModelComparisonBinding,
  events: ModelComparisonEvent[]) {
  const unavailable = (reason: string) => ({ schema: "agentos.native-comparison-context-evidence.v1" as const,
    stage: "unavailable" as const, initialInputMatched: false, gaps: [reason], receipts: [] });
  if (!binding.contextReceipt) return unavailable("prepared_context_receipt_missing");
  let expected: NativeComparisonContextReceipt;
  let execution: NativeExecutionInput;
  try { execution = parseNativeExecutionInput(run.runnerProfileJson?.nativeExecutionInput); expected = nativeComparisonContextReceipt(run, execution, binding); }
  catch { return unavailable("prepared_context_invalid"); }
  if (modelProfileDigest(expected) !== modelProfileDigest(binding.contextReceipt)) return unavailable("prepared_context_changed");
  if (execution.session.lifecyclePolicy.mode !== "per_turn") return unavailable("warm_context_history_unavailable");
  if (comparisonWorkIterations(run, events) === null) return unavailable("context_event_history_incomplete");
  const turnKey = (event: Record<string, unknown>) => JSON.stringify([event.normalizedSessionId, event.turnId, record(event.payload).providerTurnId]);
  const starts = new Set(events.filter(row => row.eventType === "turn.started").map(row => turnKey(record(record(row.payload).prpEvent))));
  const accepted = new Set<string>();
  const receipts: Array<{ eventId: string; eventSha256: string; kind: string; parametersSha256: string; contentSha256: string }> = [];
  let initialInputMatched = false, sessions = 0, turns = 0, terminal = false;
  for (const row of events) {
    const event = record(record(row.payload).prpEvent), payload = record(event.payload);
    if (row.eventType === "run.terminal") terminal = true;
    if (row.eventType === "turn.started") {
      const key = turnKey(event);
      // Native admission emits acceptance before execution starts. A later
      // receipt cannot retroactively attest inputs for an already-running turn.
      if (!accepted.has(key)) return unavailable("provider_context_receipt_missing");
    }
    if (!["session.started", "session.resumed", "turn.accepted"].includes(row.eventType)) continue;
    if (terminal) return unavailable("provider_context_receipt_out_of_order");
    if (event.normalizedSessionId !== (expected.normalizedSessionId ?? `session-${run.id}`)) return unavailable("context_session_changed");
    const isTurn = row.eventType === "turn.accepted";
    const receipt = isTurn ? record(payload.inputReceipt)
      : record(record(record(payload.providerDescriptor).observedCodexIdentity).contextReceipt);
    const content = isTurn ? receipt.promptSha256 : receipt.instructionsSha256;
    if (receipt.schema !== "paperclip.provider-context-receipt.v1"
      || receipt.stage !== (isTurn ? "turn_accepted" : "thread_accepted")
      || receipt.source !== (isTurn ? "turn/start" : row.eventType === "session.started" ? "thread/start" : "thread/resume")
      || !digest(receipt.parametersSha256) || !digest(content)) return unavailable("provider_context_receipt_missing");
    if (isTurn) {
      const key = turnKey(event);
      if (!sessions || !starts.has(key) || accepted.has(key)
        || typeof payload.providerTurnId !== "string") return unavailable("provider_context_turn_unbound");
      accepted.add(key);
      if (turns++ === 0) initialInputMatched = receipt.modelEnvelopeSha256 === expected.initialEnvelopeSha256;
    } else sessions++;
    receipts.push({ eventId: row.sourceEventId!, eventSha256: row.sourcePayloadSha256!, kind: row.eventType,
      parametersSha256: receipt.parametersSha256, contentSha256: content });
  }
  if (!sessions || !turns || accepted.size !== starts.size) return unavailable("provider_context_receipt_missing");
  const toolResults = writtenToolResults(events);
  if (!toolResults.valid) return unavailable("tool_result_receipt_unbound");
  return { schema: "agentos.native-comparison-context-evidence.v1" as const, stage: "partial" as const, initialInputMatched, receipts,
    toolResultReceipts: toolResults.receipts, missingToolResultReceipts: toolResults.missing,
    gaps: [...(initialInputMatched ? [] : ["initial_input_differs"]), "provider_implicit_context_unverified", "retrieved_context_unbound",
      ...(toolResults.missing ? ["native_tool_delivery_missing"] : []), ...(toolResults.receipts.length ? ["tool_result_acceptance_unverified"] : [])] };
}
