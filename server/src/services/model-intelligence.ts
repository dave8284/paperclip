import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { and, desc, eq, lte, sql } from "drizzle-orm";
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

/** Observation only, after native managed-account preparation. The catalog and
 * old usage from another grant/credential epoch cannot establish this evidence.
 * This does not certify current entitlement, model identity or answer quality,
 * and cannot add an automatically eligible routing candidate. */
export async function observeSelectedModelAccountAccess(db: Db, input: {
  companyId: string; agentId: string; runId: string; model: string;
  account: { provider: string; method: string; subscriptionId?: string; sessionIdentity: string };
}) {
  const { companyId, agentId, runId, model, account } = input;
  const base = {
    schema: "agentos.model-account-access.v1" as const,
    provider: account.provider, requestedModel: model,
    lookbackExecutions: 100 as const,
    currentEntitlementVerified: false as const, actualProviderModelVerified: false as const,
    automaticAlternatives: "current_account_qualification_required" as const,
  };
  if (account.method !== "subscription" || !account.subscriptionId || !account.sessionIdentity
    || !["openai", "anthropic"].includes(account.provider) || !model) {
    return { ...base, state: "not_observed" as const, reason: "managed_subscription_account_required" as const };
  }
  const accountFingerprint = fingerprint({ companyId, provider: account.provider,
    subscriptionId: account.subscriptionId, sessionIdentity: account.sessionIdentity });
  const unavailable = () => ({ ...base, accountFingerprint, state: "not_observed" as const,
    reason: "observation_unavailable" as const });
  // Bound work using the existing company/agent/started-at index before
  // inspecting account/model fields. Only scalar projections leave PostgreSQL;
  // no task bodies, provider probes or credential values are needed.
  const recent = await db.select({ id: heartbeatRuns.id, status: heartbeatRuns.status,
    finishedAt: heartbeatRuns.finishedAt,
    receiptReady: sql<boolean>`${heartbeatRuns.usageJson}->'accountingReceiptReady' = 'true'::jsonb`,
    captureFailed: sql<boolean>`${heartbeatRuns.usageJson}->'accountingCaptureFailed' = 'true'::jsonb`,
    errorCode: heartbeatRuns.errorCode, accountingPending: heartbeatRuns.costAccountingPending,
    accountedAt: heartbeatRuns.costAccountedAt, runtimeMode: heartbeatRuns.runtimeMode,
    sessionIdentity: sql<string>`${heartbeatRuns.contextSnapshot} #>> '{aiConnection,sessionIdentity}'`,
    subscriptionId: sql<string>`${heartbeatRuns.contextSnapshot} #>> '{aiConnection,subscriptionId}'`,
    provider: sql<string>`${heartbeatRuns.contextSnapshot} #>> '{aiConnection,provider}'`,
    method: sql<string>`${heartbeatRuns.contextSnapshot} #>> '{aiConnection,method}'`,
    nativeCompanyId: sql<string>`${heartbeatRuns.runnerProfileJson} #>> '{nativeExecutionInput,binding,companyId}'`,
    nativeRunId: sql<string>`${heartbeatRuns.runnerProfileJson} #>> '{nativeExecutionInput,binding,runId}'`,
    nativeAgentId: sql<string>`${heartbeatRuns.runnerProfileJson} #>> '{nativeExecutionInput,binding,agentId}'`,
    nativeModel: sql<string>`${heartbeatRuns.runnerProfileJson} #>> '{nativeExecutionInput,provider,model}'`,
    nativeProvider: sql<string>`${heartbeatRuns.runnerProfileJson} #>> '{nativeExecutionInput,provider,kind}'`,
    nativeAcpxAgent: sql<string>`${heartbeatRuns.runnerProfileJson} #>> '{nativeExecutionInput,provider,agent}'`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
    sql`${heartbeatRuns.id} <> ${runId}`, sql`${heartbeatRuns.startedAt} <= now()`,
  )).orderBy(desc(heartbeatRuns.startedAt)).limit(100).catch(() => null);
  if (!recent) return unavailable();
  // Include failures and unfinished runs; never search past a newer matching
  // execution to report an older success as the latest account observation.
  const previous = recent.find(row => row.runtimeMode === "native" && row.sessionIdentity === account.sessionIdentity
    && row.subscriptionId === account.subscriptionId && row.provider === account.provider && row.method === "subscription"
    && row.nativeCompanyId === companyId && row.nativeRunId === row.id && row.nativeAgentId === agentId
    && row.nativeModel === model && row.nativeProvider === (account.provider === "openai" ? "codex" : "acpx")
    && (account.provider !== "anthropic" || row.nativeAcpxAgent === "claude"));
  const unobserved = (reason: "no_matching_native_execution" | "latest_execution_not_confirmed") => ({
    ...base, accountFingerprint, state: "not_observed" as const, reason,
    evidenceRunId: previous?.id ?? null, observedAt: previous?.finishedAt?.toISOString() ?? null,
  });
  if (!previous) return unobserved("no_matching_native_execution");
  if (previous.status !== "succeeded" || !previous.finishedAt || previous.finishedAt.getTime() > Date.now()
    || previous.errorCode || previous.accountingPending || !previous.accountedAt
    || previous.receiptReady !== true || previous.captureFailed === true) {
    return unobserved("latest_execution_not_confirmed");
  }
  const usage = await db.select({ model: costEvents.model, provider: costEvents.provider,
    subscriptionId: costEvents.subscriptionId, billingType: costEvents.billingType,
    outputTokens: costEvents.outputTokens,
  }).from(costEvents).where(and(eq(costEvents.companyId, companyId), eq(costEvents.heartbeatRunId, previous.id))).catch(() => null);
  if (!usage) return unavailable();
  if (!usage.length || !usage.some(row => row.outputTokens > 0)
    || !usage.every(row => row.model === model && row.provider === account.provider
      && row.subscriptionId === account.subscriptionId && row.billingType === "subscription_included")) {
    return unobserved("latest_execution_not_confirmed");
  }
  return { ...base, accountFingerprint, state: "observed_same_account" as const,
    source: "completed_native_execution" as const, evidenceRunId: previous.id,
    observedAt: previous.finishedAt!.toISOString() };
}

/** Local product integration at execution-configuration admission. Record the
 * operator-configured profile, subject to native managed-account admission.
 * Historical usage and the harness catalog do not prove current-account model
 * access. Automatic alternatives require a qualification owner not yet present. */
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
  const [task] = await db.select({ title: issues.title, description: issues.description,
    conversationAgentId: issues.conversationAgentId, conversationUserId: issues.conversationUserId,
  }).from(issues).where(and(eq(issues.id, input.issueId), eq(issues.companyId, agent.companyId))).limit(1);
  if (!task) throw notFound("Model routing task not found");
  const provider = harness === "codex_local" ? "openai" : "anthropic";
  if (binding.provider !== provider || binding.method !== "subscription") return { config };
  const instructionHeads = await db.select({ file: agentInstructionHeads.entryFile, revisionId: agentInstructionHeads.revisionId }).from(agentInstructionHeads).where(and(eq(agentInstructionHeads.companyId, agent.companyId), eq(agentInstructionHeads.agentId, agent.id))).orderBy(agentInstructionHeads.entryFile).limit(100);
  // Match the effective effort used by the native Codex and Claude profiles.
  const instructionHash = fingerprint({ revisions: instructionHeads, instructions: agent.adapterConfig.instructionsFilePath ?? null, prompt: agent.adapterConfig.promptTemplate ?? null, effort: config.modelReasoningEffort ?? config.reasoningEffort ?? config.effort ?? null });
  const id = (model: string) => `${harness}:${model}:${instructionHash.slice(0, 16)}`;
  const explicitOverride = typeof agent.adapterConfig.model === "string" && agent.adapterConfig.model !== config.model;
  // The independent engine's available flag admits this configured attempt; it
  // is not a provider entitlement assertion. Until an account-bound qualification
  // receipt exists, learning cannot replace the configured model automatically.
  const candidates = [{ id: id(config.model), provider, model: config.model, method: "subscription" as const, available: true as const }];
  const request: SelectionInput = { namespace: agent.companyId, requestId: input.runId,
    taskKey: `${input.issueId}:${agent.id}${explicitOverride ? `:override:${config.model}` : ""}`, ...classifyModelWork(task.title, task.description),
    defaultCandidateId: id(config.model), candidates, contextFingerprint: fingerprint({ title: task.title, description: task.description }), promptFingerprint: instructionHash };
  // Freeze the request before calling the independent store. A credential-wait retry
  // must replay the same candidate/context snapshot. The native row also bridges
  // a crash between stores. Legacy alternative candidates require explicit review.
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
  }, { interactiveConversation: Boolean(task.conversationAgentId && task.conversationUserId) });
  // Selection and shadow observations are retained together before execution.
  // Triage never changes the selected profile or claims an independent review.
  await db.update(heartbeatRuns).set({ contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify({ modelIntelligence: receipt, modelTriage: triage,
    modelIntelligenceQualification: { mode: "configured_only", source: "operator_configuration", accountModelAccess: "not_verified", automaticAlternatives: "current_account_qualification_required" },
  })}::jsonb` }).where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, agent.companyId)));
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
