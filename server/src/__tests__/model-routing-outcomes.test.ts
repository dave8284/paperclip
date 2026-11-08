import { describe, expect, it } from "vitest";
import type { heartbeatRuns } from "@paperclipai/db";
import type { ComparisonVariant, SelectionInput, SelectionReceipt } from "@agentos/model-intelligence";
import { nativeModelRoutingAdmission, readNativeModelRoutingAdmission, exactNativeRoutingSelection } from "../services/model-routing-binding.js";
import { nativeRoutingOutcome } from "../services/model-routing-delivery.js";
import type { ModelComparisonMeasurements } from "../services/model-comparison-measurements.js";
import { publicModelComparisonRecord } from "../services/model-comparison-presentation.js";
type Run = typeof heartbeatRuns.$inferSelect;
function fixture() {
  const companyId = "10000000-0000-4000-8000-000000000001", runId = "10000000-0000-4000-8000-000000000002";
  const variant: ComparisonVariant = { profileId: "profile", provider: "openai", model: "fixture-model", modelVersion: "fixture-model", reasoningEffort: "high",
    method: "subscription", harnessFingerprint: "a".repeat(64), promptFingerprint: "b".repeat(64), contextFingerprint: "c".repeat(64) };
  const request: SelectionInput = { namespace: companyId, requestId: runId, taskKey: "task:agent", taskType: "operations.support", complexity: "routine",
    defaultCandidateId: "profile", candidates: [{ id: "profile", model: variant.model, provider: variant.provider, method: "subscription", available: true, variant }],
    contextFingerprint: "d".repeat(64), promptFingerprint: "e".repeat(64) };
  const admission = nativeModelRoutingAdmission(request)!;
  const receipt: SelectionReceipt = { id: runId, namespace: companyId, taskKey: request.taskKey, taskType: request.taskType, complexity: "routine",
    candidate: { id: "profile", model: variant.model, provider: variant.provider, method: "subscription", variant }, policyVersion: "fixture", reason: "Canary",
    evidence: { evaluations: 0, passed: 0, lowerBound: 0, medianLatencyMs: null, medianIterations: null, recentFailures: 0 },
    contextFingerprint: request.contextFingerprint!, promptFingerprint: request.promptFingerprint!, createdAt: new Date().toISOString(),
    rollout: { releaseId: "release", releaseVersion: 1, policyRevision: 1, phase: "canary", arm: "candidate", assignmentId: runId } };
  const run = { id: runId, companyId, agentId: "agent", issueId: "task", status: "succeeded", runtimeMode: "native", contextSnapshot: { modelIntelligenceRequest: request },
    runnerProfileJson: { nativeModelRoutingAdmission: admission, nativeExecutionInput: { binding: { runId, companyId, agentId: "agent", issueId: "task" }, task: { workMode: "standard" } } } } as unknown as Run;
  const measurements: ModelComparisonMeasurements = { schema: "agentos.model-comparison-measurements.v1", runId, iterations: 1, latencyMs: 5000,
    startedAt: new Date(Date.now() - 5000).toISOString(), completedAt: new Date().toISOString(), eventDigest: "f".repeat(64), gaps: [] };
  const verdict = { outcome: "passed" as const, evaluator: "user:reviewer", reviewId: "independent-review", resolvedAt: new Date() };
  return { run, request, receipt, measurements, verdict };
}
describe("native versioned routing evidence", () => {
  it("recovers an exact stored selection after its native acknowledgement gap without inventing observed dimensions", () => {
    const f = fixture();
    expect(f.run.contextSnapshot?.modelIntelligence).toBeUndefined();
    expect(exactNativeRoutingSelection(f.run, f.receipt)).toBe(true);
    expect(nativeRoutingOutcome(f.run, f.receipt, f.verdict, f.measurements)).toMatchObject({ outcome: "passed", observedVariant: null, iterations: 1,
      latencyMs: 5000, source: "human", evaluator: "user:reviewer", evidenceRef: `native-run:${f.run.id}:review:independent-review` });
  });
  it("does no preparation work for ordinary or controlled-comparison selection requests", () => {
    const f = fixture();
    expect(nativeModelRoutingAdmission({ ...f.request, candidates: f.request.candidates.map(({ variant: _variant, ...candidate }) => candidate) })).toBeNull();
    expect(nativeModelRoutingAdmission({ ...f.request, comparisonBinding: { comparisonId: "comparison", caseId: "case", arm: "baseline", inputDigest: "input", checkDigest: "check" } })).toBeNull();
    expect(readNativeModelRoutingAdmission({ ...f.run, contextSnapshot: null })).toBeNull();
  });
  it.each(["company", "request", "task", "model", "variant", "continuation"])("rejects a changed or non-originating %s selection", kind => {
    const f = fixture();
    if (kind === "company") f.run.companyId = "foreign";
    if (kind === "request") f.request.contextFingerprint = "changed";
    if (kind === "task") f.receipt.taskKey = "another task";
    if (kind === "model") f.receipt.candidate.model = "another model";
    if (kind === "variant") f.receipt.candidate = { ...f.receipt.candidate, variant: { ...f.receipt.candidate.variant!, contextFingerprint: "changed" } };
    if (kind === "continuation") f.receipt.rollout!.assignmentId = "original-run";
    expect(nativeRoutingOutcome(f.run, f.receipt, f.verdict, f.measurements)).toBeNull();
  });
  it("never treats an exit, a review-only run or a foreign measurement as qualifying work", () => {
    const f = fixture();
    expect(nativeRoutingOutcome(f.run, f.receipt, null, f.measurements)?.outcome).toBe("unknown");
    (f.run.runnerProfileJson!.nativeExecutionInput as Record<string, unknown>).executionPurpose = { kind: "egm_packet_review" };
    expect(nativeRoutingOutcome(f.run, f.receipt, f.verdict, { ...f.measurements, runId: "foreign" })).toMatchObject({ outcome: "unknown", observedVariant: null, latencyMs: null, iterations: null });
  });
  it.each(["failed", "cancelled", "timed_out", "interrupted"])("retains a %s attempt instead of omitting it", status => {
    const f = fixture(); f.run.status = status;
    expect(nativeRoutingOutcome(f.run, f.receipt, null, f.measurements)).toMatchObject({ outcome: status === "cancelled" ? "cancelled" : "failed", observedVariant: null });
  });
  it("keeps private admission and outbox data out of public run responses", () => {
    const f = fixture();
    expect(publicModelComparisonRecord({ ...f.run.runnerProfileJson, nativeModelRoutingDelivery: { outcome: "private-evidence" }, visible: true })).toEqual({
      nativeExecutionInput: f.run.runnerProfileJson!.nativeExecutionInput, visible: true,
    });
  });
});
