import { describe, expect, it } from "vitest";
import type { heartbeatRuns, issueThreadInteractions, statusDecisionEffects, statusDecisions } from "@paperclipai/db";
import { modelComparisonOutcome, modelComparisonReviewVerdict } from "../services/model-comparison-delivery.js";
import { modelComparisonTaskScope } from "../services/model-comparison-scope.js";
import type { NativeModelComparisonBinding } from "../services/model-comparison-admission.js";
import { redactCurrentUserValue } from "../log-redaction.js";
import { redactEventPayload } from "../redaction.js";

type Run = typeof heartbeatRuns.$inferSelect;
type Review = typeof issueThreadInteractions.$inferSelect;
type Decision = typeof statusDecisions.$inferSelect;
function fixture() {
  const task = { title: "Classify support tickets", description: "Compare each category against the supplied labels.", workMode: "standard" };
  const scope = modelComparisonTaskScope({ ...task, reviewPolicy: "human_only" });
  const comparisonBinding = { comparisonId: "private-comparison", caseId: "private-case", arm: "baseline", ...scope };
  const run = { id: "run", companyId: "company", agentId: "author", issueId: "issue", nativeIssueId: "issue", runtimeMode: "native",
    status: "succeeded", finishedAt: new Date("2026-01-01T00:00:00Z"),
    contextSnapshot: { modelIntelligence: { id: "run", namespace: "company", comparisonBinding } },
    runnerProfileJson: { nativeExecutionInput: { task, binding: { companyId: "company", runId: "run", agentId: "author", issueId: "issue" } } },
  } as unknown as Run;
  const binding = { companyId: "company", runId: "run", receiptId: "run", attempt: 1,
    assignment: { ...comparisonBinding, sourceIssueId: "private-source" } } as NativeModelComparisonBinding;
  const review = { id: "review", companyId: "company", issueId: "issue", sourceRunId: "run", kind: "request_confirmation",
    status: "accepted", idempotencyKey: "native-review:decision", payload: { target: { type: "custom", key: "native_completion_review", revisionId: "decision" } },
    resolvedAt: new Date("2026-01-01T00:00:01Z"), resolvedByUserId: "reviewer", resolvedByAgentId: null,
  } as unknown as Review;
  const decision = { id: "decision", companyId: "company", issueId: "issue", runId: "run", applicationState: "applied", toStatus: "in_review", decisionJson: { effects: [{ kind: "bind_reviewer", prompt: "Review the output" }] } } as Decision;
  const effect = { companyId: "company", issueId: "issue", decisionId: "decision", ordinal: 1, effectKind: "bind_reviewer",
    targetType: "issue_thread_interaction", targetId: "review", idempotencyKey: "native-status:decision:1", deliveryState: "delivered",
    payload: { interactionId: "review", interactionKind: "request_confirmation" } } as typeof statusDecisionEffects.$inferSelect;
  return { run, binding, review, decision, effect };
}

describe("exact native comparison outcomes", () => {
  it("retains an independent human acceptance without inventing context or resource measurements", () => {
    const { run, binding, review, decision, effect } = fixture();
    const verdict = modelComparisonReviewVerdict(run, review, decision, null, effect);
    expect(verdict).toMatchObject({ outcome: "passed", evaluator: "user:reviewer" });
    expect(modelComparisonOutcome(run, binding, verdict)).toMatchObject({ outcome: "passed", terminal: true,
      observedVariant: null, iterations: null, latencyMs: null, source: "human", receiptId: "run" });
  });

  it.each([
    ["foreign company", { companyId: "foreign" }],
    ["different implementation", { sourceRunId: "other" }],
    ["different task", { issueId: "other" }],
    ["unbound task-wide verdict", { idempotencyKey: "other" }],
    ["unresolved review", { status: "pending" }],
    ["no reviewer", { resolvedByUserId: null }],
    ["author self-review", { resolvedByAgentId: "author" }],
    ["review predating execution", { resolvedAt: new Date("2025-12-31T00:00:00Z") }],
  ])("does not turn %s into acceptance", (_name, patch) => {
    const { run, review, decision, effect } = fixture();
    expect(modelComparisonReviewVerdict(run, { ...review, ...patch } as Review, decision, null, effect)).toBeNull();
  });

  it("requires an applied exact decision and a completed independent review execution", () => {
    const { run, review, decision, effect } = fixture();
    expect(modelComparisonReviewVerdict(run, review, { ...decision, applicationState: "proposed" }, null, effect)).toBeNull();
    const agentReview = { ...review, resolvedByUserId: null, resolvedByAgentId: "reviewer", resolvedByRunId: "review-run", addresseeAgentId: "reviewer" };
    const agentDecision = { ...decision, decisionJson: { effects: [{ kind: "bind_reviewer", prompt: "Review the output", ownerAgentId: "reviewer" }] } };
    const agentEffect = { ...effect, payload: { ...effect.payload, ownerAgentId: "reviewer" } };
    const reviewer = { id: "review-run", companyId: "company", agentId: "reviewer", nativeIssueId: "issue", status: "succeeded",
      contextSnapshot: { nativeReviewInteractionId: "review", nativeReviewDecisionId: "decision" },
      runnerProfileJson: { nativeReviewContextReceipt: { schema: "agentos.native-review-context-receipt.v1", companyId: "company",
        issueId: "issue", reviewerRunId: "review-run", references: { sourceRunId: "run", sourceDecisionId: "decision", reviewInteractionId: "review" } } },
    } as unknown as Run;
    expect(modelComparisonReviewVerdict(run, agentReview, agentDecision, reviewer, agentEffect)).toMatchObject({ outcome: "passed" });
    expect(modelComparisonReviewVerdict(run, agentReview, agentDecision, { ...reviewer, status: "failed" }, agentEffect)).toBeNull();
    expect(modelComparisonReviewVerdict(run, agentReview, agentDecision, { ...reviewer, runnerProfileJson: {} }, agentEffect)).toBeNull();
  });

  it("keeps process success, changed inputs and missing evidence unknown", () => {
    const { run, binding, review, decision, effect } = fixture();
    expect(modelComparisonOutcome(run, binding, null)?.outcome).toBe("unknown");
    const changed = { ...run, runnerProfileJson: { nativeExecutionInput: { task: { title: "Changed" } } } };
    expect(modelComparisonOutcome(changed, binding, modelComparisonReviewVerdict(run, review, decision, null, effect))?.outcome).toBe("unknown");
    expect(modelComparisonOutcome(run, { ...binding, receiptId: null }, null)).toBeNull();
    expect(() => modelComparisonOutcome({ ...run, contextSnapshot: {} }, binding, null)).toThrow("exact selection receipt");
  });

  it("retains failure and cancellation without promoting either to acceptance", () => {
    const { run, binding, review, decision, effect } = fixture();
    const rejected = modelComparisonReviewVerdict(run, { ...review, status: "rejected" }, decision, null, effect);
    expect(modelComparisonOutcome(run, binding, rejected)).toMatchObject({ outcome: "failed", terminal: false });
    expect(modelComparisonOutcome({ ...run, status: "failed" }, binding, null)).toMatchObject({ outcome: "failed", terminal: false });
    expect(modelComparisonOutcome({ ...run, status: "failed" }, { ...binding, attempt: 10 }, null)?.terminal).toBe(true);
    expect(modelComparisonOutcome({ ...run, status: "cancelled" }, binding, null)).toMatchObject({ outcome: "cancelled", terminal: true });
  });
});

describe("comparison run presentation", () => {
  it.each([redactCurrentUserValue, redactEventPayload])("withholds private source provenance from public run payloads", redact => {
    const { run, binding } = fixture();
    const receipt = { ...run.contextSnapshot!.modelIntelligence as object, taskKey: "private-key", candidate: { id: "private-profile", provider: "openai", model: "selected", method: "subscription" } };
    const source = { ...run, runnerProfileJson: { nativeModelComparison: binding, nativeModelComparisonDelivery: { outcome: { evidenceRef: "private-evidence" } } },
      contextSnapshot: { modelIntelligence: receipt, modelIntelligenceRequest: receipt } };
    const result = JSON.stringify(redact(source));
    for (const secret of ["private-source", "private-comparison", "private-case", "private-key", "private-profile", "private-evidence", binding.assignment.inputDigest]) expect(result).not.toContain(secret);
    expect(result).toContain("selected");
    expect(source.runnerProfileJson.nativeModelComparison).toBe(binding);
  });
});
