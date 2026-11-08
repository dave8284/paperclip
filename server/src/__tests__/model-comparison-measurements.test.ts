import { describe, expect, it } from "vitest";
import type { heartbeatRuns, heartbeatRunEvents } from "@paperclipai/db";
import type { NativeModelComparisonBinding } from "../services/model-comparison-admission.js";
import { comparisonWorkIterations, measureModelComparison } from "../services/model-comparison-measurements.js";
import { modelComparisonOutcome } from "../services/model-comparison-delivery.js";
import { modelComparisonTaskScope } from "../services/model-comparison-scope.js";

type Run = typeof heartbeatRuns.$inferSelect;
type Event = typeof heartbeatRunEvents.$inferSelect;
const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
function fixture() {
  const task = { title: "Classify", description: "Classify the supplied data", workMode: "standard" };
  const assignment = { comparisonId: "comparison", caseId: "case", arm: "baseline", ...modelComparisonTaskScope(task) };
  const run = { id: "run", companyId: "company", agentId: "author", issueId: "issue", runtimeMode: "native", status: "succeeded",
    sessionIdBefore: null, createdAt: at(0), startedAt: at(2), finishedAt: at(10),
    contextSnapshot: { modelIntelligence: { id: "run", namespace: "company", comparisonBinding: assignment } },
    runnerProfileJson: { nativeExecutionInput: { binding: { companyId: "company", runId: "run", agentId: "author", issueId: "issue" }, task } },
  } as unknown as Run;
  const binding = { runId: run.id, attempt: 1, admittedAt: at(3).toISOString(), receiptId: run.id, assignment } as NativeModelComparisonBinding;
  let seq = 0;
  const event = (eventType: string, payload: Record<string, unknown> = {}, turnId = "turn") => {
    seq++;
    const envelope = { runId: run.id, sourceInstanceId: "runner", sourceEventId: `event-${seq}`, sourceSeq: seq,
      normalizedSessionId: "session", turnId, eventType,
      payload: eventType.startsWith("turn.") ? { providerTurnId: "provider-turn", ...payload } : payload };
    return { companyId: run.companyId, runId: run.id, agentId: run.agentId, seq, eventType, sourceInstanceId: "runner",
      sourceEventId: envelope.sourceEventId, sourceSeq: seq, sourcePayloadSha256: String(seq).padStart(64, "0"),
      protocolSchemaVersion: 3, payload: { prpEvent: envelope } } as Event;
  };
  const finish = (key: string, turnId = "turn", callId = key) => event("semantic_tool.input", { semantic_tool: {
    operationId: "paperclip_finish", callId, idempotencyKey: key, correlation: { runId: run.id, normalizedSessionId: "session", turnId },
  } }, turnId);
  return { run, binding, event, finish };
}

describe("native comparison measurements", () => {
  it("includes queue and independent review in accepted-output latency", () => {
    const { run, binding, event } = fixture();
    const events = [event("turn.started"), event("turn.completed"), event("run.terminal", { runTerminalState: "succeeded" })];
    const measured = measureModelComparison(run, binding, events, at(25));
    expect(measured).toMatchObject({ iterations: 1, latencyMs: 25_000, startedAt: at(0).toISOString(), completedAt: at(25).toISOString(), gaps: [] });
    expect(modelComparisonOutcome(run, binding, { outcome: "passed", evaluator: "user:reviewer", reviewId: "review", resolvedAt: at(25) }, measured))
      .toMatchObject({ iterations: 1, latencyMs: 25_000, outcome: "passed", observedVariant: null });
  });

  it("counts repaired completion submissions and later turns while deduplicating delivery retries", () => {
    const { run, event, finish } = fixture();
    const events = [event("turn.started"), finish("first"), finish("first", "turn", "transport-replay"), finish("repaired"),
      event("turn.completed"), event("turn.started", { providerTurnId: "second" }), finish("final"),
      event("turn.completed", { providerTurnId: "second" }),
      event("run.terminal", { runTerminalState: "succeeded" })];
    expect(comparisonWorkIterations(run, events)).toBe(3);
  });

  it("includes failed work, retry delay and the final review exactly once", () => {
    const f = fixture();
    const failed = { ...f.run, status: "failed" };
    const first = measureModelComparison(failed, f.binding,
      [f.event("turn.started"), f.event("turn.failed"), f.event("run.terminal", { runTerminalState: "failed" })], null);
    const secondRun = { ...f.run, id: "retry", createdAt: at(20), startedAt: at(24), finishedAt: at(30) };
    const second = measureModelComparison(secondRun, { ...f.binding, runId: "retry", attempt: 2, admittedAt: at(25).toISOString() }, [], at(40), first);
    expect(first).toMatchObject({ iterations: 1, latencyMs: 10_000 });
    expect(second).toMatchObject({ startedAt: at(10).toISOString(), latencyMs: 30_000, iterations: null });
    expect(first.latencyMs! + second.latencyMs!).toBe(40_000);
  });

  it.each(["missing start", "missing terminal", "sequence gap", "foreign run", "invalid envelope", "unfinished turn", "replayed source", "wrong terminal", "missing provider identity", "wrong provider terminal", "overlapping turns", "early run terminal"])("leaves %s unknown", fault => {
    const { run, event } = fixture();
    const events = [event("turn.started"), event("turn.completed"), event("run.terminal", { runTerminalState: "succeeded" })];
    if (fault === "missing start") events.shift();
    if (fault === "missing terminal") events.pop();
    if (fault === "sequence gap") events[1].sourceSeq = 9;
    if (fault === "foreign run") events[1].runId = "other";
    if (fault === "invalid envelope") events[1].payload = {};
    if (fault === "unfinished turn") events.splice(1, 1);
    if (fault === "replayed source") events.splice(1, 0, events[0]);
    if (fault === "wrong terminal") (events[2].payload!.prpEvent as { payload: object }).payload = { runTerminalState: "failed" };
    if (fault === "missing provider identity") (events[0].payload!.prpEvent as { payload: object }).payload = {};
    if (fault === "wrong provider terminal") (events[1].payload!.prpEvent as { payload: object }).payload = { providerTurnId: "other" };
    if (fault === "overlapping turns") {
      events[1].eventType = "turn.started";
      Object.assign(events[1].payload!.prpEvent as object, { eventType: "turn.started", payload: { providerTurnId: "other" } });
    }
    if (fault === "early run terminal") {
      events[1].eventType = "run.terminal";
      Object.assign(events[1].payload!.prpEvent as object, { eventType: "run.terminal", payload: { runTerminalState: "succeeded" } });
    }
    expect(comparisonWorkIterations(run, events)).toBeNull();
  });

  it("does not invent review time, missing retry history or invalid clock order", () => {
    const { run, binding } = fixture();
    expect(measureModelComparison(run, binding, [], null).latencyMs).toBeNull();
    expect(measureModelComparison(run, { ...binding, attempt: 2 }, [], at(20)).latencyMs).toBeNull();
    expect(measureModelComparison(run, binding, [], at(9)).latencyMs).toBeNull();
    expect(measureModelComparison(run, binding, [], at(20), null, at(15).getTime()).latencyMs).toBeNull();
    expect(measureModelComparison({ ...run, createdAt: at(4) }, binding, [], at(20)).latencyMs).toBeNull();
  });
});
