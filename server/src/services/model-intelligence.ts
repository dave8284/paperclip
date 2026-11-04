import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { agents, agentInstructionHeads, companyOperatingProfiles, costEvents, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { agentHarnessType, type AiConnectionAttribution, type AiConnectionBinding, type ModelTriageReceipt } from "@paperclipai/shared";
import { models as codexModels } from "@paperclipai/adapter-codex-local";
import { models as claudeModels } from "@paperclipai/adapter-claude-local";
import { createModelIntelligence, classifyWork, type ModelIntelligence, type SelectionReceipt, type SelectionInput } from "@agentos/model-intelligence";
import { observeModelTriage } from "./model-triage.js";
import { conflict, notFound } from "../errors.js";
import { logActivity } from "./activity-log.js";
import type { LogActivityInput } from "./activity-log.js";

let product: ModelIntelligence | null = null;
let currentPath: string | undefined;
export function modelIntelligenceProduct() {
  const path = process.env.AGENTOS_MODEL_INTELLIGENCE_DB;
  if (!path) return null;
  if (!product || path !== currentPath) { product?.close(); mkdirSync(dirname(path), { recursive: true }); product = createModelIntelligence(path); currentPath = path; }
  return product;
}
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const classifyModelWork = classifyWork;

/** Local product integration at execution-configuration admission. Only observed
 * subscription models in the current harness qualify as alternative candidates.
 * Managed account admission rechecks credential access and configuration;
 * it does not reserve subscription capacity or prove model entitlement. */
export async function selectCompanyModelProfile(db: Db, input: {
  runId: string; issueId: string | null; agent: typeof agents.$inferSelect;
  config: Record<string, unknown>; binding?: AiConnectionBinding; resumed: boolean;
}): Promise<{ config: Record<string, unknown>; receipt?: SelectionReceipt; request?: SelectionInput; triage?: ModelTriageReceipt }> {
  const engine = modelIntelligenceProduct();
  const { agent, config, binding } = input;
  if (!engine || input.resumed || !input.issueId || !binding) return { config };
  const harness = agentHarnessType(agent.adapterType, config);
  if (!["codex_local", "claude_local"].includes(harness) || typeof config.model !== "string" || !config.model) return { config };
  const [profile] = await db.select().from(companyOperatingProfiles).where(eq(companyOperatingProfiles.companyId, agent.companyId)).limit(1);
  if (!profile) return { config };
  const [task] = await db.select({ title: issues.title, description: issues.description }).from(issues).where(and(eq(issues.id, input.issueId), eq(issues.companyId, agent.companyId))).limit(1);
  if (!task) throw notFound("Model routing task not found");
  const provider = harness === "codex_local" ? "openai" : "anthropic";
  if (binding.provider !== provider || binding.method !== "subscription") return { config };
  const supported = harness === "codex_local" ? codexModels : claudeModels;
  const observations = await db.selectDistinct({ model: costEvents.model }).from(costEvents)
    .where(and(eq(costEvents.companyId, agent.companyId), eq(costEvents.agentId, agent.id), eq(costEvents.provider, provider), eq(costEvents.billingType, "subscription_included"), gte(costEvents.occurredAt, new Date(Date.now() - 30 * 86400000)))).limit(100);
  const instructionHeads = await db.select({ file: agentInstructionHeads.entryFile, revisionId: agentInstructionHeads.revisionId }).from(agentInstructionHeads).where(and(eq(agentInstructionHeads.companyId, agent.companyId), eq(agentInstructionHeads.agentId, agent.id))).orderBy(agentInstructionHeads.entryFile).limit(100);
  // Match the effective effort used by the native Codex and Claude profiles.
  const instructionHash = fingerprint({ revisions: instructionHeads, instructions: agent.adapterConfig.instructionsFilePath ?? null, prompt: agent.adapterConfig.promptTemplate ?? null, effort: config.modelReasoningEffort ?? config.reasoningEffort ?? config.effort ?? null });
  const id = (model: string) => `${harness}:${model}:${instructionHash.slice(0, 16)}`;
  const explicitOverride = typeof agent.adapterConfig.model === "string" && agent.adapterConfig.model !== config.model;
  const candidates = [...new Set([config.model, ...(!explicitOverride && instructionHeads.length ? observations.map(row => row.model).filter(model => supported.some(entry => entry.id === model)) : [])])].map(model => ({ id: id(model), provider, model, method: "subscription" as const, available: true as const }));
  const request: SelectionInput = { namespace: agent.companyId, requestId: input.runId,
    taskKey: `${input.issueId}:${agent.id}${explicitOverride ? `:override:${config.model}` : ""}`, ...classifyModelWork(task.title, task.description),
    defaultCandidateId: id(config.model), candidates, contextFingerprint: fingerprint(task), promptFingerprint: instructionHash };
  // Freeze the request before calling the independent store. A credential-wait retry
  // must replay the same candidate/context snapshot, even when new model usage
  // is observed meanwhile. The native row also bridges a crash between stores.
  const [admission] = await db.update(heartbeatRuns).set({ contextSnapshot: sql`
    coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || case
      when ${heartbeatRuns.contextSnapshot} #>> '{modelIntelligenceRequest,requestId}' = ${input.runId} then '{}'::jsonb
      else ${JSON.stringify({ modelIntelligenceRequest: request })}::jsonb end`
  }).where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, agent.companyId), eq(heartbeatRuns.agentId, agent.id))).returning({ context: heartbeatRuns.contextSnapshot });
  if (!admission) throw notFound("Model routing run not found");
  const frozen = admission.context?.modelIntelligenceRequest as SelectionInput | undefined;
  const candidatesStillAuthorized = Array.isArray(frozen?.candidates) && frozen.candidates.every(candidate => request.candidates.some(current => current.id === candidate.id && current.provider === candidate.provider && current.model === candidate.model && candidate.method === "subscription" && candidate.available === true));
  if (!frozen || !candidatesStillAuthorized || frozen.pinTask !== undefined || frozen.requestId !== input.runId || frozen.namespace !== agent.companyId || frozen.taskKey !== request.taskKey || frozen.promptFingerprint !== request.promptFingerprint || frozen.contextFingerprint !== request.contextFingerprint || frozen.taskType !== request.taskType || frozen.complexity !== request.complexity || frozen.defaultCandidateId !== request.defaultCandidateId) throw conflict("The queued execution profile changed. Review this task before retrying.");
  const receipt = engine.select(frozen);
  const triage = await observeModelTriage(db, {
    context: { companyId: agent.companyId, issueId: input.issueId, actor: { type: "agent", companyId: agent.companyId, agentId: agent.id, runId: input.runId } },
    runId: input.runId, taskId: input.issueId, agentId: agent.id, title: task.title, description: task.description,
    candidates: frozen.candidates.map(candidate => ({ id: candidate.id, label: `${candidate.provider} / ${candidate.model}` })),
    selectedCandidateId: receipt.candidate.id,
  });
  // Selection and shadow observations are retained together before execution.
  // Triage never changes the selected profile or claims an independent review.
  await db.update(heartbeatRuns).set({ contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify({ modelIntelligence: receipt, modelTriage: triage })}::jsonb` }).where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, agent.companyId)));
  return { config: { ...config, model: receipt.candidate.model }, receipt, request: frozen, triage };
}

export async function modelCatalog(db: Db, companyId: string, includeLearning = false) {
  const roster = await db.select({ id: agents.id, name: agents.name, adapterType: agents.adapterType, config: agents.adapterConfig }).from(agents).where(eq(agents.companyId, companyId));
  const observed = await db.selectDistinct({ provider: costEvents.provider, model: costEvents.model }).from(costEvents).where(and(eq(costEvents.companyId, companyId), eq(costEvents.billingType, "subscription_included"))).limit(100);
  return { models: [...codexModels.map(model => ({ ...model, provider: "openai" })), ...claudeModels.map(model => ({ ...model, provider: "anthropic" }))].map(model => ({ ...model,
    observed: observed.some(row => row.model === model.id && row.provider === model.provider),
    configuredAgents: roster.filter(agent => agent.config.model === model.id).map(agent => ({ id: agent.id, name: agent.name })),
  })), learning: includeLearning ? modelIntelligenceProduct()?.analytics(companyId) ?? null : null,
    learningAccess: includeLearning ? "admin" as const : "restricted" as const };
}

export async function evaluateModelRun(db: Db, companyId: string, runId: string, input: { passed: boolean; evidenceRef: string }, who: Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">) {
  const engine = modelIntelligenceProduct(); if (!engine) throw conflict("Model Intelligence is not configured");
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
  if (!run) throw notFound("Run not found");
  if (!run.startedAt || !run.finishedAt || !["succeeded", "failed"].includes(run.status)) throw conflict("Evaluate a completed run with recorded timing");
  const receipt = run.contextSnapshot?.modelIntelligence as SelectionReceipt | undefined;
  if (!receipt || receipt.id !== run.id || receipt.namespace !== companyId) throw conflict("This run has no Model Intelligence selection receipt");
  const actualUsage = await db.select({ model: costEvents.model, provider: costEvents.provider, billingType: costEvents.billingType, subscriptionId: costEvents.subscriptionId }).from(costEvents).where(and(eq(costEvents.companyId, companyId), eq(costEvents.heartbeatRunId, runId)));
  // Use the account captured for this execution, never today's mutable defaults.
  // Inspect every usage row: filtering to subscription rows would hide paid or
  // unattributed usage and incorrectly qualify the run for subscription learning.
  const execution = run.contextSnapshot?.aiConnection as Partial<AiConnectionAttribution> | undefined;
  const qualified = receipt.candidate?.method === "subscription"
    && execution?.method === "subscription"
    && execution.provider === receipt.candidate.provider
    && typeof execution.subscriptionId === "string" && execution.subscriptionId.length > 0
    && actualUsage.length > 0
    && actualUsage.every(row => row.model === receipt.candidate.model
      && row.provider === receipt.candidate.provider
      && row.billingType === "subscription_included"
      && row.subscriptionId === execution.subscriptionId);
  if (!qualified) throw conflict("Actual model receipts or execution account attribution are missing or differ from the subscription selection. Reconcile them before training.");
  const [attempts] = await db.select({ count: sql<number>`count(*)::int` }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), run.issueId ? eq(heartbeatRuns.issueId, run.issueId) : eq(heartbeatRuns.id, runId), lte(heartbeatRuns.createdAt, run.createdAt)));
  const evaluation = engine.evaluate({ namespace: companyId, id: runId, receiptId: runId, passed: input.passed, iterations: Math.max(1, attempts.count), latencyMs: run.finishedAt.getTime() - run.startedAt.getTime(), source: "human", evidenceRef: input.evidenceRef, evaluator: who.actorId });
  await logActivity(db, { ...who, companyId, action: "model_intelligence.evaluated", entityType: "heartbeat_run", entityId: runId, details: { passed: evaluation.passed, evidenceRef: evaluation.evidenceRef, source: evaluation.source } });
  return evaluation;
}
