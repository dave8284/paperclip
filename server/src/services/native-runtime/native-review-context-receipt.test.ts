import { describe, expect, it } from "vitest";
import type { NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import type { NativeReviewAssignment } from "./native-review-participant.js";
import { buildNativeReviewContextReceipt, validateRetainedNativeReviewContextReceipt } from "./native-review-context-receipt.js";

type NativeExecutionInputV1 = Extract<NativeExecutionInput, { schema: "paperclip.native-execution-input.v1" }>;

const companyId = "10000000-0000-4000-8000-000000000001";
const issueId = "10000000-0000-4000-8000-000000000002";
const reviewerId = "10000000-0000-4000-8000-000000000003";
const reviewRunId = "10000000-0000-4000-8000-000000000004";
const interactionId = "10000000-0000-4000-8000-000000000005";
const decisionId = "10000000-0000-4000-8000-000000000006";
const sourceRunId = "10000000-0000-4000-8000-000000000007";

function fixture() {
  const execution: NativeExecutionInputV1 = {
    schema: "paperclip.native-execution-input.v1",
    binding: { companyId, issueId, agentId: reviewerId, runId: reviewRunId, executionWorkspaceId: reviewRunId },
    task: { identifier: "REV-1", title: "Review", description: null, prompt: "Private submitted work", workMode: "standard" },
    workspace: { cwd: "/private/source", repoUrl: null, repoRef: null, branchName: null },
    session: { normalizedSessionId: "review-session", driverKind: "codex_app_server", protocolVersion: 1, lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
    provider: { kind: "codex", model: "fixture-model" },
    completionContract: { id: "contract", sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1", contract: { revision: "fixture", objective: "Review", criteria: [{ id: "objective", requirement: "Review" }] } },
    interactionResponses: [], credentialBindings: [],
  };
  return {
    execution,
    run: { id: reviewRunId, companyId, agentId: reviewerId, contextSnapshot: {
      nativeReviewInteractionId: interactionId, nativeReviewDecisionId: decisionId,
      nativeReviewContextReceipt: { qualification: { hostInstructionAndMemoryIsolation: "passed" } },
    } },
    review: {
      interaction: { id: interactionId, companyId, issueId, addresseeAgentId: reviewerId, sourceRunId, kind: "request_confirmation", payload: { target: { type: "custom", key: "native_completion_review", revisionId: decisionId } } },
      sourceDecision: { id: decisionId, companyId, issueId, runId: sourceRunId, applicationState: "applied" },
      sourceRun: { id: sourceRunId, companyId, nativeIssueId: issueId, agentId: "source-worker" },
    } as NativeReviewAssignment,
  };
}

describe("native review context receipt", () => {
  it("describes prepared native references without promoting parent claims or exposing prompt/path content", () => {
    const receipt = buildNativeReviewContextReceipt(fixture());
    expect(receipt).toMatchObject({ stage: "server_prepared", references: {
      findingsRunId: reviewRunId, resolutionInteractionId: interactionId, sourceDecisionId: decisionId,
    }, qualification: { providerDelivery: "not_observed", hostInstructionAndMemoryIsolation: "unverified" },
    preparedInput: { runtimeContextDigest: null, instructionBundleDigest: null } });
    expect(JSON.stringify(receipt)).not.toContain("Private submitted work");
    expect(JSON.stringify(receipt)).not.toContain("/private/source");
  });

  it.each(["companyId", "issueId", "agentId", "runId"] as const)("does not certify a mismatched execution %s", (key) => {
    const input = fixture(); input.execution.binding[key] = "different";
    expect(buildNativeReviewContextReceipt(input)).toBeNull();
  });

  it("does not create a receipt from a different source decision or an unbound run", () => {
    const input = fixture(); input.review.sourceDecision.runId = "different";
    expect(buildNativeReviewContextReceipt(input)).toBeNull();
    const unbound = fixture(); unbound.run.contextSnapshot.nativeReviewInteractionId = "different";
    expect(buildNativeReviewContextReceipt(unbound)).toBeNull();
  });

  it.each([null, {}, { nativeReviewInteractionId: "20000000-0000-4000-8000-000000000001", nativeReviewDecisionId: decisionId }])(
    "retains exact historical evidence independently of current context %j", (contextSnapshot) => {
      const input = fixture();
      const receipt = buildNativeReviewContextReceipt(input);
      expect(validateRetainedNativeReviewContextReceipt({ ...input, run: { ...input.run, contextSnapshot }, receipt })).toEqual(receipt);
    },
  );

  it("rejects another execution, including model changes missing from the old partial digests", () => {
    const input = fixture();
    const receipt = buildNativeReviewContextReceipt(input);
    input.execution.provider.model = "different-model";
    expect(validateRetainedNativeReviewContextReceipt({ ...input, receipt })).toBeNull();
  });

  it("strictly rejects unsupported schema, extra fields, invented qualification and swapped native references", () => {
    const input = fixture();
    const receipt = buildNativeReviewContextReceipt(input)!;
    for (const candidate of [
      { ...receipt, schema: "agentos.native-review-context-receipt.v2" },
      { ...receipt, extra: "a parent supplied field" },
      { ...receipt, qualification: { ...receipt.qualification, hostInstructionAndMemoryIsolation: "passed" } },
      { ...receipt, preparedInput: { ...receipt.preparedInput, extra: "ignored evidence" } },
      { ...receipt, references: { ...receipt.references, sourceRunId: "20000000-0000-4000-8000-000000000001" } },
    ]) expect(validateRetainedNativeReviewContextReceipt({ ...input, receipt: candidate })).toBeNull();
  });

  it("validates JSONB-reordered input by its full canonical digest and requires the historical native source graph", () => {
    const input = fixture();
    const receipt = buildNativeReviewContextReceipt(input);
    const execution = Object.fromEntries(Object.entries(input.execution).reverse()) as NativeExecutionInputV1;
    expect(validateRetainedNativeReviewContextReceipt({ ...input, execution, receipt })).toEqual(receipt);
    input.review.sourceDecision.applicationState = "proposed";
    expect(validateRetainedNativeReviewContextReceipt({ ...input, receipt })).toBeNull();
  });
});
