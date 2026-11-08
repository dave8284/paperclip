import {
  parseNativeExecutionPurpose,
  parseNativeSkillTestPurpose,
  type NativeEgmPacketReviewPurpose,
  type NativeSkillTestPurpose,
} from "../contracts/native-execution.js";
import type { NativeRuntimeContextSnapshot } from "../contracts/runtime-context.js";

/** Frozen task profiles share provider isolation, but retain distinct authority. */
export type RestrictedExecutionPurpose = NativeEgmPacketReviewPurpose | NativeSkillTestPurpose;

export function parseRestrictedExecutionPurpose(value: unknown): RestrictedExecutionPurpose {
  if (value && typeof value === "object" && "kind" in value && value.kind === "skill_test") {
    const purpose = parseNativeSkillTestPurpose(value);
    // JSONB and restored transport records need not retain object key order.
    return { kind: purpose.kind, testRunId: purpose.testRunId, skillId: purpose.skillId,
      skillVersionId: purpose.skillVersionId, inputSha256: purpose.inputSha256, skillSha256: purpose.skillSha256 };
  }
  return parseNativeExecutionPurpose(value);
}

export function sameRestrictedExecutionPurpose(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  try { return JSON.stringify(parseRestrictedExecutionPurpose(left)) === JSON.stringify(parseRestrictedExecutionPurpose(right)); }
  catch { return false; }
}

export function assertRestrictedExecutionContext(purpose: RestrictedExecutionPurpose | undefined, context: NativeRuntimeContextSnapshot | null) {
  if (!purpose) return;
  const skill = context?.skills[0];
  if (context?.mcp.bindingId || context?.instructions.workingCopy || context?.connectionInstructions
    || (purpose.kind === "skill_test" ? context?.skills.length !== 1 || skill?.versionId !== purpose.skillVersionId
      || skill.bundle.fileCount !== 1 || skill.bundle.totalBytes > 64 * 1024 : Boolean(context?.skills.length))) {
    throw new Error("runner_restricted_execution_context_invalid");
  }
}
