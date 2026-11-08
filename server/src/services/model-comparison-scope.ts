import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agentInstructionHeads, type agents, type Db } from "@paperclipai/db";
import type { ComparisonVariant } from "@agentos/model-intelligence";
import { modelProfileDigest } from "./model-profile-binding.js";
import { buildNativeCompletionContract, NATIVE_COMPLETION_POLICY_VERSION, resolveNativeCompletionPolicy } from "./native-runtime/completion-contracts.js";
import { unprocessable } from "../errors.js";
import { readNativeComparisonInstructionSnapshot } from "./native-runtime/runtime-context.js";

/** These task/check identities are derived from native sources, never supplied
 * by a comparison caller. Task identity stays separate from context strategy. */
export function modelComparisonTaskScope(issue: { title: string; description: string | null; reviewPolicy?: string | null }) {
  return {
    inputDigest: createHash("sha256").update(JSON.stringify({ title: issue.title, description: issue.description })).digest("hex"),
    checkDigest: modelComparisonCheckDigest(buildNativeCompletionContract(issue).criteria, resolveNativeCompletionPolicy(issue)),
  };
}

export function modelComparisonCheckDigest(criteria: unknown, policy: { risk: string; completionAuthority: string; policyVersion?: string }) {
  return modelProfileDigest({ schema: "agentos.model-comparison-checks.v1", policyVersion: policy.policyVersion ?? NATIVE_COMPLETION_POLICY_VERSION,
    risk: policy.risk, completionAuthority: policy.completionAuthority, criteria });
}

/** A model-only alternative keeps the exact same prepared prompt/context and
 * effort. Account-bound identity is recomputed, never copied from another seat. */
export function modelComparisonVariantForModel(base: ComparisonVariant, model: string, accountFingerprint: string): ComparisonVariant {
  return { ...base, model, modelVersion: model,
    profileId: `native:${modelProfileDigest({ schema: "agentos.native-comparison-profile.v1", provider: base.provider,
      model, reasoningEffort: base.reasoningEffort, accountFingerprint })}` };
}

export async function modelComparisonProfile(db: Db, agent: typeof agents.$inferSelect, config: Record<string, unknown>, accountFingerprint: string, cliVersion: string): Promise<ComparisonVariant> {
  const instructions = await db.select({ file: agentInstructionHeads.entryFile, revisionId: agentInstructionHeads.revisionId }).from(agentInstructionHeads)
    .where(and(eq(agentInstructionHeads.companyId, agent.companyId), eq(agentInstructionHeads.agentId, agent.id))).orderBy(agentInstructionHeads.entryFile).limit(101);
  if (instructions.length > 100) throw unprocessable("The native comparison instruction scope exceeds its bounded manifest");
  if (typeof config.instructionsFilePath === "string" && config.instructionsFilePath.trim()) throw unprocessable("Comparisons require revisioned native instructions; external instruction files are not frozen evidence");
  const nativeInstructions = await readNativeComparisonInstructionSnapshot(db, agent);
  const effort = config.modelReasoningEffort ?? config.reasoningEffort ?? config.effort;
  const reasoningEffort = typeof effort === "string" ? effort : "provider_default";
  const model = String(config.model ?? "");
  const { model: _model, modelReasoningEffort: _modelEffort, reasoningEffort: _reasoningEffort, effort: _effort,
    instructionsFilePath, promptTemplate, ...contextConfiguration } = config;
  return {
    profileId: `native:${modelProfileDigest({ schema: "agentos.native-comparison-profile.v1", provider: "openai", model, reasoningEffort, accountFingerprint })}`,
    provider: "openai", model,
    // The version is the exact provider model identifier. This does not claim
    // knowledge of unreported weights or an alias's internal revision.
    modelVersion: model, reasoningEffort, method: "subscription",
    harnessFingerprint: modelProfileDigest({ schema: "agentos.native-comparison-harness.v1", provider: "codex", cliVersion, homeMode: "isolated", executionMode: "default" }),
    promptFingerprint: modelProfileDigest({ schema: "agentos.native-comparison-prompt.v1", ...nativeInstructions, promptTemplate: promptTemplate ?? null }),
    contextFingerprint: modelProfileDigest({ schema: "agentos.native-comparison-context.v1", strategy: "native_standard_task", configuration: contextConfiguration }),
  };
}
