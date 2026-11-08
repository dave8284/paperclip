import { describe, expect, it } from "vitest";
import type { heartbeatRuns } from "@paperclipai/db";
import type { ModelComparisonEvent } from "../model-comparison-event-projection.js";
import type { NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import type { NativeModelComparisonBinding } from "../model-comparison-admission.js";
import { modelComparisonTaskScope } from "../model-comparison-scope.js";
import { nativeComparisonContextEvidence, nativeComparisonContextReceipt, nativeComparisonEnvelopeDigest,
  prepareNativeComparisonContext } from "./native-comparison-context.js";
import { publicModelComparisonRecord } from "../model-comparison-presentation.js";

type Run = typeof heartbeatRuns.$inferSelect;
type Event = ModelComparisonEvent & { seq: number };
function fixture() {
  const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const task = { identifier: "CTX-1", title: "Classify", description: "Use these private labels", prompt: "Private source text", workMode: "standard" as const };
  const execution: NativeExecutionInput = {
    schema: "paperclip.native-execution-input.v1",
    binding: { runId: id(1), companyId: id(2), agentId: id(3), issueId: id(4), executionWorkspaceId: id(5) },
    task, workspace: { cwd: "/private/comparison", repoUrl: null, repoRef: null, branchName: null },
    session: { normalizedSessionId: "comparison-session", driverKind: "codex_app_server", protocolVersion: 1,
      lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
    provider: { kind: "codex", model: "fixture-model" },
    completionContract: { id: id(6), sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
      contract: { revision: "fixture", objective: "Classify", criteria: [{ id: "objective", requirement: "Classify" }] } },
    interactionResponses: [], credentialBindings: [],
  };
  const run = { id: id(1), companyId: id(2), agentId: id(3), issueId: id(4), status: "succeeded", runtimeMode: "native",
    sessionIdBefore: null, runnerProfileJson: {} } as unknown as Run;
  const binding = { schema: "agentos.native-model-comparison.v1", companyId: run.companyId, runId: run.id,
    assignment: { ...modelComparisonTaskScope(task), sourceIssueId: "private-source", comparisonId: "comparison", caseId: "case", arm: "baseline" },
  } as NativeModelComparisonBinding;
  binding.contextReceipt = nativeComparisonContextReceipt(run, execution, binding);
  run.runnerProfileJson = { nativeModelComparison: binding, nativeExecutionInput: execution };
  let seq = 0;
  const event = (eventType: string, payload: Record<string, unknown>) => {
    ++seq;
    const envelope = { runId: run.id, normalizedSessionId: execution.session.normalizedSessionId, turnId: "native-invocation",
      sourceEventId: `event-${seq}`, sourceInstanceId: "runner", sourceSeq: seq, eventType, payload };
    return { companyId: run.companyId, runId: run.id, agentId: run.agentId, seq, eventType,
      sourceEventId: envelope.sourceEventId, sourceInstanceId: "runner", sourceSeq: seq,
      sourcePayloadSha256: "b".repeat(64), protocolSchemaVersion: 3, payload: { prpEvent: envelope } } as Event;
  };
  const events = [
    event("session.started", { providerDescriptor: { observedCodexIdentity: { contextReceipt: {
      schema: "paperclip.provider-context-receipt.v1", stage: "thread_accepted", source: "thread/start",
      parametersSha256: "c".repeat(64), instructionsSha256: "d".repeat(64),
    } } } }),
    event("turn.accepted", { providerTurnId: "provider-turn", inputReceipt: {
      schema: "paperclip.provider-context-receipt.v1", stage: "turn_accepted", source: "turn/start",
      parametersSha256: "e".repeat(64), promptSha256: "f".repeat(64), modelEnvelopeSha256: binding.contextReceipt.initialEnvelopeSha256,
    } }),
    event("turn.started", { providerTurnId: "provider-turn" }),
    event("turn.completed", { providerTurnId: "provider-turn" }),
    event("run.terminal", { runTerminalState: "succeeded" }),
  ];
  return { run, binding, execution, events, event };
}
const payload = (event: Event) => (event.payload!.prpEvent as { payload: Record<string, unknown> }).payload;
function resequence(events: Event[]) {
  events.forEach((row, index) => {
    row.sourceSeq = row.seq = index + 1; row.sourceEventId = `event-${index + 1}`;
    Object.assign(row.payload!.prpEvent as object, { sourceSeq: row.sourceSeq, sourceEventId: row.sourceEventId });
  });
}
function toolFixture() {
  const f = fixture();
  const envelope = f.events[2].payload!.prpEvent as Record<string, unknown>;
  const semantic = { operationId: "call_api", callId: "private-read", correlation: {
    runId: envelope.runId, turnId: envelope.turnId, normalizedSessionId: envelope.normalizedSessionId,
  } };
  const input = f.event("semantic_tool.input", { semantic_tool: semantic });
  const result = f.event("semantic_tool.result", { semantic_tool: { ...semantic, outcome: "succeeded" } });
  const written = f.event("harness.diagnostic", { code: "context.tool_result_written", contextReceipt: {
    schema: "paperclip.provider-context-receipt.v1", stage: "transport_written", source: "tool/result",
    callId: semantic.callId, operationId: semantic.operationId, providerTurnId: "provider-turn",
    resultSha256: "9".repeat(64), resultBytes: 14, isError: false,
  } });
  f.events.splice(3, 0, input, result, written); resequence(f.events);
  return { ...f, input, result, written };
}

describe("native comparison context chain", () => {
  it("freezes complete prepared input without copying private content or paths into its receipt", () => {
    const f = fixture();
    const initial = { ...f.run, runnerProfileJson: { nativeModelComparison: { ...f.binding, contextReceipt: undefined } } };
    expect(prepareNativeComparisonContext(initial, f.execution)?.contextReceipt).toEqual(f.binding.contextReceipt);
    const receipt = JSON.stringify(f.binding.contextReceipt);
    for (const privateText of ["Private source text", "/private/comparison", "private-source"]) expect(receipt).not.toContain(privateText);
    expect(publicModelComparisonRecord(f.run.runnerProfileJson!)).not.toHaveProperty("nativeModelComparison");
  });

  it("retains a recovery receipt and rejects a changed execution or comparison assignment", () => {
    const f = fixture();
    expect(prepareNativeComparisonContext(f.run, f.execution)).toBe(f.binding);
    const reordered = Object.fromEntries(Object.entries(f.execution).reverse()) as NativeExecutionInput;
    expect(prepareNativeComparisonContext(f.run, reordered)).toBe(f.binding);
    expect(() => prepareNativeComparisonContext(f.run, { ...f.execution, provider: { kind: "codex", model: "changed" } }))
      .toThrow("frozen comparison context changed");
    f.binding.assignment.caseId = "changed";
    expect(() => prepareNativeComparisonContext(f.run, f.execution)).toThrow("frozen comparison context changed");
  });

  it("does no work for ordinary runs and does not invent a historical receipt during recovery", () => {
    const f = fixture();
    expect(prepareNativeComparisonContext({ ...f.run, runnerProfileJson: {} }, f.execution)).toBeNull();
    delete f.binding.contextReceipt;
    expect(prepareNativeComparisonContext(f.run, f.execution)?.contextReceipt).toBeUndefined();
  });

  it("matches authenticated accepted initial input while retaining implicit/retrieved context gaps", () => {
    const f = fixture();
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ stage: "partial", initialInputMatched: true,
      receipts: [{ kind: "session.started" }, { kind: "turn.accepted" }],
      gaps: ["provider_implicit_context_unverified", "retrieved_context_unbound"] });
  });

  it("records changed actual input without treating the requested input as observed", () => {
    const f = fixture();
    (payload(f.events[1]).inputReceipt as Record<string, unknown>).modelEnvelopeSha256 = "a".repeat(64);
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ initialInputMatched: false, gaps: expect.arrayContaining(["initial_input_differs"]) });
  });

  it.each(["after start", "after completion", "after terminal"])("does not let acceptance %s backfill a turn's input evidence", order => {
    const f = fixture();
    const accepted = f.events.splice(1, 1)[0];
    f.events.splice(order === "after start" ? 2 : order === "after completion" ? 3 : 4, 0, accepted);
    resequence(f.events);
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({
      stage: "unavailable", initialInputMatched: false, gaps: ["provider_context_receipt_missing"],
    });
  });

  it("does not append a new accepted session after the native terminal event", () => {
    const f = fixture();
    f.events.push(structuredClone(f.events[0])); resequence(f.events);
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({
      stage: "unavailable", gaps: ["provider_context_receipt_out_of_order"],
    });
  });

  it("binds actual tool transport writes while retaining unknown provider acceptance and implicit retrieval", () => {
    const f = toolFixture();
    const evidence = nativeComparisonContextEvidence(f.run, f.binding, f.events);
    expect(evidence).toMatchObject({ stage: "partial", initialInputMatched: true, missingToolResultReceipts: 0,
      toolResultReceipts: [{ stage: "transport_written", operationId: "call_api", callId: "private-read", resultSha256: "9".repeat(64), resultBytes: 14 }],
      gaps: expect.arrayContaining(["provider_implicit_context_unverified", "retrieved_context_unbound", "tool_result_acceptance_unverified"]) });
    expect(evidence).not.toHaveProperty("observedVariant");
  });
  it("does not treat a persisted or rejected tool result as written", () => {
    const f = toolFixture();
    f.events = f.events.filter(row => row !== f.written); resequence(f.events);
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ stage: "partial", toolResultReceipts: [],
      missingToolResultReceipts: 1, gaps: expect.arrayContaining(["native_tool_delivery_missing"]) });
  });
  it.each(["missing input", "missing result", "wrong call", "wrong turn", "wrong stage", "bad digest", "oversized", "zero bytes", "invalid error", "duplicate", "after turn"])("rejects %s tool delivery evidence", fault => {
    const f = toolFixture();
    const receipt = payload(f.written).contextReceipt as Record<string, unknown>;
    if (fault === "missing input") f.events = f.events.filter(row => row !== f.input);
    if (fault === "missing result") f.events = f.events.filter(row => row !== f.result);
    if (fault === "wrong call") receipt.callId = "other-call";
    if (fault === "wrong turn") receipt.providerTurnId = "other-turn";
    if (fault === "wrong stage") receipt.stage = "provider_accepted";
    if (fault === "bad digest") receipt.resultSha256 = "caller-label";
    if (fault === "oversized") receipt.resultBytes = 1024 * 1024 + 1;
    if (fault === "zero bytes") receipt.resultBytes = 0;
    if (fault === "invalid error") receipt.isError = "true";
    if (fault === "duplicate") f.events.splice(6, 0, structuredClone(f.written));
    if (fault === "after turn") { f.events = f.events.filter(row => row !== f.written); f.events.splice(-1, 0, f.written); }
    resequence(f.events);
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ stage: "unavailable", gaps: ["tool_result_receipt_unbound"] });
  });
  it("retains delivery of failed tool results as failed evidence", () => {
    const f = toolFixture();
    (payload(f.result).semantic_tool as Record<string, unknown>).outcome = "failed";
    (payload(f.written).contextReceipt as Record<string, unknown>).isError = true;
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ stage: "partial", missingToolResultReceipts: 0,
      toolResultReceipts: [{ stage: "transport_written", isError: true, nativeOutcome: "failed" }] });
  });
  it("distinguishes a returned business denial from transport failure", () => {
    const f = toolFixture();
    (payload(f.result).semantic_tool as Record<string, unknown>).outcome = "denied";
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ stage: "partial",
      toolResultReceipts: [{ isError: false, nativeOutcome: "denied" }] });
  });

  it("requires an accepted-input receipt for every provider turn, including repairs", () => {
    const f = fixture();
    const repair = f.events.slice(2, 4).map(row => {
      const copy = structuredClone(row);
      payload(copy).providerTurnId = "repair-turn";
      return copy;
    });
    f.events.splice(4, 0, ...repair);
    f.events.forEach((row, index) => {
      row.sourceSeq = row.seq = index + 1;
      row.sourceEventId = `event-${index + 1}`;
      Object.assign(row.payload!.prpEvent as object, { sourceSeq: row.sourceSeq, sourceEventId: row.sourceEventId });
    });
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ stage: "unavailable", gaps: ["provider_context_receipt_missing"] });
  });

  it.each(["missing preparation", "changed input", "foreign run", "sequence gap", "missing receipt", "wrong receipt stage", "wrong session", "unbound turn"])("rejects %s evidence", fault => {
    const f = fixture();
    if (fault === "missing preparation") delete f.binding.contextReceipt;
    if (fault === "changed input") f.execution.task.prompt = "changed";
    if (fault === "foreign run") f.events[1].runId = "other";
    if (fault === "sequence gap") f.events[1].sourceSeq = 99;
    if (fault === "missing receipt") delete payload(f.events[1]).inputReceipt;
    if (fault === "wrong receipt stage") (payload(f.events[1]).inputReceipt as Record<string, unknown>).stage = "prepared";
    if (fault === "wrong session") (f.events[1].payload!.prpEvent as Record<string, unknown>).normalizedSessionId = "other";
    if (fault === "unbound turn") payload(f.events[1]).providerTurnId = "other";
    expect(nativeComparisonContextEvidence(f.run, f.binding, f.events)).toMatchObject({ stage: "unavailable", initialInputMatched: false });
  });

  it("uses protocol key ordering rather than locale sorting or JSONB order", () => {
    expect(nativeComparisonEnvelopeDigest({ z: 1, a: { z: "private", a: 2 } })).toBe(nativeComparisonEnvelopeDigest({ a: { a: 2, z: "private" }, z: 1 }));
  });
});
