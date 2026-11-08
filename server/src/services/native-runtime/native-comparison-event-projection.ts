import type { PrpEvent } from "../../vendor/paperclip-runner/index.js";
import { nativeSha256 } from "./canonical.js";

export const NATIVE_COMPARISON_EVENT = "model_comparison.native_event";
export const NATIVE_COMPARISON_SOURCE = "native-evidence:";
export const MAX_COMPARISON_EVENTS = 20_000;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,240}$/.test(value) ? value : null;
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
const choice = (value: unknown, choices: string[]) => typeof value === "string" && choices.includes(value) ? value : null;

function inputReceipt(value: unknown) {
  const row = record(value);
  return { schema: choice(row.schema, ["paperclip.provider-context-receipt.v1"]),
    stage: choice(row.stage, ["thread_accepted", "turn_accepted"]), source: choice(row.source, ["thread/start", "thread/resume", "turn/start"]),
    parametersSha256: digest(row.parametersSha256), instructionsSha256: digest(row.instructionsSha256),
    promptSha256: digest(row.promptSha256), modelEnvelopeSha256: digest(row.modelEnvelopeSha256) };
}

/** This is a projection, not another PRP event. Retain every original sequence
 * position, including irrelevant events, without copying its private body. */
export function projectNativeComparisonEvent(event: PrpEvent): Record<string, unknown> | null {
  const payload = record(event.payload), tool = record(payload.semantic_tool), correlation = record(tool.correlation);
  const receipt = record(payload.contextReceipt);
  const key = tool.idempotencyKey ?? record(tool.input).idempotencyKey;
  const projected = {
    runId: event.runId, sourceInstanceId: event.sourceInstanceId, sourceEventId: event.sourceEventId,
    sourceSeq: event.sourceSeq, eventType: event.eventType, normalizedSessionId: event.normalizedSessionId,
    turnId: event.turnId,
    payload: {
      providerTurnId: id(payload.providerTurnId),
      runTerminalState: choice(payload.runTerminalState, ["succeeded", "failed", "cancelled", "timed_out"]),
      ...(["session.started", "session.resumed"].includes(event.eventType) ? {
        providerDescriptor: { observedCodexIdentity: { contextReceipt: inputReceipt(record(record(payload.providerDescriptor).observedCodexIdentity).contextReceipt) } },
      } : {}),
      ...(event.eventType === "turn.accepted" ? { inputReceipt: inputReceipt(payload.inputReceipt) } : {}),
      ...(["semantic_tool.input", "semantic_tool.result"].includes(event.eventType) ? { semantic_tool: {
        operationId: id(tool.operationId), callId: id(tool.callId),
        // A model can choose this value. Equality is sufficient for repair
        // counting; neither the key nor any other argument belongs in evidence.
        idempotencyKey: typeof key === "string" && key ? nativeSha256(key) : null,
        outcome: choice(tool.outcome, ["succeeded", "denied", "conflict", "duplicate", "unavailable", "failed"]),
        correlation: { runId: id(correlation.runId), turnId: id(correlation.turnId), normalizedSessionId: id(correlation.normalizedSessionId) },
      } } : {}),
      ...(event.eventType === "harness.diagnostic" && payload.code === "context.tool_result_written" ? {
        code: "context.tool_result_written", contextReceipt: {
          schema: choice(receipt.schema, ["paperclip.provider-context-receipt.v1"]), stage: choice(receipt.stage, ["transport_written"]),
          source: choice(receipt.source, ["tool/result"]), callId: id(receipt.callId), operationId: id(receipt.operationId),
          providerTurnId: id(receipt.providerTurnId), resultSha256: digest(receipt.resultSha256),
          resultBytes: Number.isSafeInteger(receipt.resultBytes) && Number(receipt.resultBytes) > 0 && Number(receipt.resultBytes) <= 1024 * 1024 ? receipt.resultBytes : null,
          isError: typeof receipt.isError === "boolean" ? receipt.isError : null,
        },
      } : {}),
    },
  };
  return Buffer.byteLength(JSON.stringify(projected)) <= 8192 ? projected : null;
}
