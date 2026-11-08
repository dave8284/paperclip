import { describe, expect, it } from "vitest";
import { readExactNativeReviewRetryContext } from "./native-review-retry.js";

const expected = { companyId: "company", agentId: "reviewer", issueId: "task" };
const review = {
  nativeReviewInteractionId: "11111111-1111-4111-8111-111111111111",
  nativeReviewDecisionId: "22222222-2222-4222-8222-222222222222",
};
function preparedFailure(): Parameters<typeof readExactNativeReviewRetryContext>[0] {
  return {
    companyId: expected.companyId, agentId: expected.agentId, issueId: expected.issueId,
    status: "failed", runtimeMode: "legacy", executionStage: "preparing", errorCode: "adapter_failed",
    contextSnapshot: { issueId: expected.issueId, ...review },
    runnerProfileJson: { adapterDispatch: { adapterType: "paperclip_runner" } },
    runtimeModeResolvedAt: null, runtimeModeResolverVersion: null, nativeIssueId: null,
    nativeSessionId: null, nativePhase: null, runnerInstanceId: null, driverKind: null,
    processPid: null, processGroupId: null, processStartedAt: null, sessionIdAfter: null,
  };
}

describe("exact native review retry evidence", () => {
  it("recovers saved review intent from a failed preparation without changing its historical runtime state", () => {
    const run = preparedFailure();
    const before = structuredClone(run);
    expect(readExactNativeReviewRetryContext(run, expected)).toEqual(review);
    expect(run).toEqual(before);
  });

  it("preserves exact native provider-model rejection retry", () => {
    expect(readExactNativeReviewRetryContext({ ...preparedFailure(), runtimeMode: "native",
      nativeIssueId: expected.issueId, errorCode: "native_provider_model_rejected",
      runtimeModeResolvedAt: new Date(), executionStage: "running" }, expected)).toEqual(review);
  });

  it.each([
    { companyId: "other" }, { agentId: "other" }, { issueId: "other" }, { issueId: null },
    { status: "running" }, { status: "cancelled" }, { status: "timed_out" },
    { runtimeMode: "native" }, { errorCode: "native_session_cleanup_quarantined" }, { executionStage: "running" },
    { runtimeModeResolvedAt: new Date() }, { runtimeModeResolverVersion: "selected" },
    { nativeIssueId: expected.issueId }, { nativeSessionId: "session" }, { nativePhase: "executing" },
    { runnerInstanceId: "runner" }, { driverKind: "local" }, { processPid: 123 }, { processGroupId: 123 },
    { processStartedAt: new Date() }, { sessionIdAfter: "session" },
    { runnerProfileJson: {} }, { runnerProfileJson: { adapterDispatch: { adapterType: "codex_local" } } },
    { runnerProfileJson: { adapterDispatch: { adapterType: "paperclip_runner" }, nativeExecutionInput: {} } },
    { contextSnapshot: { issueId: "other", ...review } },
    { contextSnapshot: { issueId: expected.issueId } },
    { contextSnapshot: { issueId: expected.issueId, ...review, nativeReviewDecisionId: "invalid" } },
  ])("rejects missing or contradictory preparation evidence %j", (patch) => {
    expect(readExactNativeReviewRetryContext({ ...preparedFailure(), ...patch }, expected)).toBeNull();
  });
});
