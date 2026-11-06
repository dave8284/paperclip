import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agentInstructionHeads, type agents, type Db } from "@paperclipai/db";
import type { ModelProfileBinding } from "@paperclipai/shared";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export const modelProfileDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export interface ModelProfileLearningScope {
  schema: "agentos.model-profile-learning-scope.v1";
  profile: ModelProfileBinding;
  cliVersion: string;
}

export function modelProfileCandidateId(harness: string, model: string, promptFingerprint: string, scope?: ModelProfileLearningScope) {
  const legacy = `${harness}:${model}:${promptFingerprint.slice(0, 16)}`;
  if (!scope) return legacy;
  // Models in one comparison share the same account/configuration/runtime
  // scope, but retain separate outcome histories. Legacy history stays intact.
  const { model: _model, ...profile } = scope.profile;
  return `${legacy}:qualified:${modelProfileDigest({ schema: scope.schema, profile, cliVersion: scope.cliVersion })}`;
}

export function modelAccountFingerprint(companyId: string, account: { provider: string; subscriptionId: string; sessionIdentity: string }) {
  return modelProfileDigest({ companyId, provider: account.provider, subscriptionId: account.subscriptionId, sessionIdentity: account.sessionIdentity });
}

export async function modelProfileConfiguration(db: Db, agent: typeof agents.$inferSelect, config: Record<string, unknown>) {
  const instructions = await db.select({ file: agentInstructionHeads.entryFile, revisionId: agentInstructionHeads.revisionId }).from(agentInstructionHeads)
    .where(and(eq(agentInstructionHeads.companyId, agent.companyId), eq(agentInstructionHeads.agentId, agent.id))).orderBy(agentInstructionHeads.entryFile).limit(100);
  const effort = config.modelReasoningEffort ?? config.reasoningEffort ?? config.effort ?? null;
  const requestedEffort = typeof effort === "string" ? effort : null;
  const { model: _model, ...agentConfiguration } = agent.adapterConfig;
  return {
    requestedEffort,
    // Preserve the existing learning-profile identity while adding the wider
    // configuration binding; an upgrade must not silently reset old evidence.
    promptFingerprint: createHash("sha256").update(JSON.stringify({ revisions: instructions, instructions: agent.adapterConfig.instructionsFilePath ?? null, prompt: agent.adapterConfig.promptTemplate ?? null, effort: requestedEffort })).digest("hex"),
    configurationFingerprint: modelProfileDigest({ adapterType: agent.adapterType, configuration: agentConfiguration,
      provider: config.provider ?? null, homeMode: config.homeMode ?? "isolated", requestedEffort }),
  };
}

export function sameModelProfileScope(left: ModelProfileBinding, right: ModelProfileBinding) {
  return left.schema === right.schema && left.provider === right.provider && left.accountFingerprint === right.accountFingerprint
    && left.taskType === right.taskType && left.complexity === right.complexity && left.promptFingerprint === right.promptFingerprint
    && left.configurationFingerprint === right.configurationFingerprint && left.requestedEffort === right.requestedEffort;
}
