import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { heartbeatRuns, issueThreadInteractions, statusDecisions, type Db } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import type { NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import {
  readNativeReviewAssignmentContext,
  type NativeReviewAssignment,
} from "./native-review-participant.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Describe server-prepared review input, never model-authored evidence or a
 * claim of provider delivery/isolation. The caller owns assignment validation
 * and persists this alongside the exact admitted execution under the run lock.
 */
export function buildNativeReviewContextReceipt(input: {
  run: { id: string; companyId: string; agentId: string; contextSnapshot: unknown };
  execution: NativeExecutionInput;
  review: NativeReviewAssignment;
}) {
  const { run, execution, review } = input;
  const context = readNativeReviewAssignmentContext(run.contextSnapshot);
  const { binding } = execution;
  if (!context || binding.runId !== run.id || binding.companyId !== run.companyId
    || binding.agentId !== run.agentId || binding.issueId !== review.interaction.issueId
    || review.interaction.companyId !== run.companyId
    || review.interaction.addresseeAgentId !== run.agentId
    || context.nativeReviewInteractionId !== review.interaction.id
    || context.nativeReviewDecisionId !== review.sourceDecision.id
    || review.sourceDecision.companyId !== run.companyId
    || review.sourceDecision.issueId !== binding.issueId
    || review.sourceRun.companyId !== run.companyId
    || review.sourceRun.nativeIssueId !== binding.issueId
    || review.sourceRun.id !== review.sourceDecision.runId
    || review.interaction.sourceRunId !== review.sourceRun.id) {
    // Missing/mismatched evidence must not manufacture a receipt or introduce
    // a second authorization path. Existing native guards still own dispatch.
    return null;
  }
  const runtime = "runtimeContext" in execution ? execution.runtimeContext : null;
  const continuation = "continuationPrompt" in execution ? execution.continuationPrompt : null;
  const guidance = "initialCommunicationGuidance" in execution ? execution.initialCommunicationGuidance : null;
  const purpose = "executionPurpose" in execution ? execution.executionPurpose : undefined;
  return {
    schema: "agentos.native-review-context-receipt.v1",
    stage: "server_prepared",
    method: purpose ? "egm_packet_review" : "native_completion_review",
    companyId: binding.companyId,
    issueId: binding.issueId,
    reviewerAgentId: binding.agentId,
    reviewerRunId: binding.runId,
    // These are durable references, not copies of mutable outcome text. The
    // interaction owns its final disposition/reason; the run owns its report.
    references: {
      sourceRunId: review.sourceRun.id,
      sourceDecisionId: review.sourceDecision.id,
      reviewInteractionId: review.interaction.id,
      findingsRunId: binding.runId,
      resolutionInteractionId: review.interaction.id,
      completionContractId: execution.completionContract.id,
    },
    preparedInput: {
      schema: execution.schema,
      executionSha256: digest(canonicalJson(execution)),
      taskPromptSha256: digest(execution.task.prompt),
      taskDescriptionSha256: execution.task.description === null ? null : digest(execution.task.description),
      continuationPromptSha256: continuation ? digest(continuation) : null,
      initialGuidanceSha256: guidance ? digest(guidance) : null,
      runtimeContextDigest: runtime?.aggregateDigest ?? null,
      instructionBundleDigest: runtime?.instructions.bundle.digest ?? null,
      instructionWorkingCopyPresent: Boolean(runtime?.instructions.workingCopy),
      skills: runtime?.skills.map((skill) => ({ key: skill.key, versionId: skill.versionId, bundleDigest: skill.bundle.digest })) ?? [],
      mcpAssignmentDigest: runtime?.mcp.digest ?? null,
      connectionInstructionsDigest: runtime?.connectionInstructions?.digest ?? null,
      completionContractSha256: execution.completionContract.sha256,
      provider: execution.provider.kind,
      driverKind: execution.session.driverKind,
      normalizedSessionId: execution.session.normalizedSessionId,
      homeMode: "homeMode" in execution ? execution.homeMode : null,
      ...(purpose?.kind === "egm_packet_review" ? { packetSha256: purpose.packetSha256, sourceDigests: purpose.sourceDigests } : {}),
    },
    qualification: {
      providerDelivery: "not_observed",
      parentConversationIsolation: "unverified",
      hostInstructionAndMemoryIsolation: "unverified",
      sourceReadCoverage: "unverified",
      readOnlyEnforcement: "unverified",
    },
  };
}

type ReceiptInput = Parameters<typeof buildNativeReviewContextReceipt>[0];

/** Strict consistency check, not cryptographic producer authentication. */
export function validateRetainedNativeReviewContextReceipt(input: ReceiptInput & { receipt: unknown }) {
  const candidate = record(input.receipt);
  const references = record(candidate.references);
  const historicalContext = readNativeReviewAssignmentContext({
    nativeReviewInteractionId: references.reviewInteractionId,
    nativeReviewDecisionId: references.sourceDecisionId,
  });
  if (!historicalContext) return null;
  const target = record(record(input.review.interaction.payload).target);
  if (input.review.interaction.kind !== "request_confirmation"
    || target.type !== "custom" || target.key !== "native_completion_review"
    || target.revisionId !== input.review.sourceDecision.id
    || input.review.sourceDecision.applicationState !== "applied"
    || input.review.sourceRun.agentId === input.run.agentId) return null;
  // The admitted input and historical source graph own this evidence. Current
  // wake context may have disappeared or changed; it cannot rewrite history.
  const expected = buildNativeReviewContextReceipt({
    ...input, run: { ...input.run, contextSnapshot: historicalContext },
  });
  // Deep equality enforces every key/type/literal, rejects extra metadata, and
  // survives JSONB object-key ordering without weakening array/field checks.
  return expected && isDeepStrictEqual(input.receipt, expected) ? expected : null;
}

/**
 * Read only a locked, already-admitted DB row. Public wake/profile inputs are
 * not a provenance source. The internal run store is the trust boundary; this
 * check cannot authenticate an arbitrary imported JSON blob or a DB attacker.
 * It retains historical preparation evidence, never current review authority.
 */
export async function restoreNativeReviewContextReceipt(db: Db, input: {
  run: Pick<typeof heartbeatRuns.$inferSelect,
    "id" | "companyId" | "agentId" | "contextSnapshot" | "runtimeMode" | "runtimeModeResolvedAt" | "runnerProfileJson">;
  execution: NativeExecutionInput;
}) {
  const { run, execution } = input;
  const profile = record(run.runnerProfileJson);
  const receipt = record(profile.nativeReviewContextReceipt);
  const references = record(receipt.references);
  const historicalContext = readNativeReviewAssignmentContext({
    nativeReviewInteractionId: references.reviewInteractionId,
    nativeReviewDecisionId: references.sourceDecisionId,
  });
  if (run.runtimeMode !== "native" || !run.runtimeModeResolvedAt || !profile.nativeExecutionInput
    || receipt.schema !== "agentos.native-review-context-receipt.v1" || !historicalContext
    || execution.binding.companyId !== run.companyId || execution.binding.agentId !== run.agentId
    || execution.binding.runId !== run.id) return null;
  const [review] = await db.select({ interaction: issueThreadInteractions, sourceDecision: statusDecisions, sourceRun: heartbeatRuns })
    .from(issueThreadInteractions)
    .innerJoin(statusDecisions, and(
      eq(statusDecisions.id, historicalContext.nativeReviewDecisionId),
      eq(statusDecisions.companyId, run.companyId),
      eq(statusDecisions.issueId, execution.binding.issueId),
    ))
    .innerJoin(heartbeatRuns, and(
      eq(heartbeatRuns.id, statusDecisions.runId),
      eq(heartbeatRuns.companyId, run.companyId),
      eq(heartbeatRuns.nativeIssueId, execution.binding.issueId),
    ))
    .where(and(
      eq(issueThreadInteractions.id, historicalContext.nativeReviewInteractionId),
      eq(issueThreadInteractions.companyId, run.companyId),
      eq(issueThreadInteractions.issueId, execution.binding.issueId),
    )).limit(1);
  return review ? validateRetainedNativeReviewContextReceipt({ ...input, receipt: profile.nativeReviewContextReceipt, review }) : null;
}
