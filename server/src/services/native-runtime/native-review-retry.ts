import type { heartbeatRuns } from "@paperclipai/db";
import { claimedAdapterType } from "../conversation-continuation.js";
import { readNativeReviewAssignmentContext } from "./native-review-participant.js";

type FailedRun = Pick<typeof heartbeatRuns.$inferSelect,
  "companyId" | "agentId" | "status" | "runtimeMode" | "runtimeModeResolvedAt" | "runtimeModeResolverVersion" |
  "issueId" | "nativeIssueId" | "nativeSessionId" | "nativePhase" | "runnerInstanceId" | "driverKind" |
  "processPid" | "processGroupId" | "processStartedAt" | "sessionIdAfter" | "runnerProfileJson" |
  "contextSnapshot" | "executionStage" | "errorCode">;

/** Read only the selected server record. This identifies an exact retry intent,
 * not execution authority: callers still require the current pending review,
 * normal queue/cleanup gates and strict native admission after runtime selection. */
export function readExactNativeReviewRetryContext(run: FailedRun, expected: {
  companyId: string; agentId: string; issueId: string;
}) {
  if (run.companyId !== expected.companyId || run.agentId !== expected.agentId || run.status !== "failed" ||
    run.contextSnapshot?.issueId !== expected.issueId || (run.issueId != null && run.issueId !== expected.issueId)) return null;
  const context = readNativeReviewAssignmentContext(run.contextSnapshot);
  if (!context) return null;
  if (run.runtimeMode === "native" && run.errorCode === "native_provider_model_rejected" && run.nativeIssueId === expected.issueId) return context;
  // Native runners are claimed as legacy/preparing until selection commits.
  // A preparation failure must remain that historical state; never relabel it
  // native merely to pass a reviewer retry gate.
  if (run.runtimeMode !== "legacy" || run.errorCode !== "adapter_failed" || run.executionStage !== "preparing" ||
    run.issueId !== expected.issueId || claimedAdapterType(run) !== "paperclip_runner" ||
    run.runtimeModeResolvedAt != null || run.runtimeModeResolverVersion != null || run.nativeIssueId != null ||
    run.nativeSessionId != null || run.nativePhase != null || run.runnerInstanceId != null || run.driverKind != null ||
    run.processPid != null || run.processGroupId != null || run.processStartedAt != null || run.sessionIdAfter != null ||
    run.runnerProfileJson?.nativeExecutionInput != null) return null;
  return context;
}
