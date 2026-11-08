import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, documentRevisions, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import type { Candidate, ComparisonSelectionBinding, SelectionInput, SelectionReceipt } from "@agentos/model-intelligence";
import type { ModelProfileBinding } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { documentService } from "./documents.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { modelProfileConfiguration, modelProfileDigest } from "./model-profile-binding.js";
import { modelComparisonProfile, modelComparisonTaskScope } from "./model-comparison-scope.js";
import { assertModelComparisonOwner, MODEL_COMPARISON_ASSIGNMENT_KEY, MODEL_COMPARISON_ASSIGNMENT_SCHEMA,
  readModelComparisonAccount, readModelComparisonCase, readableModelComparisonTask, supportedModelComparisonTask, type NativeModelComparisonAssignment } from "./model-comparisons.js";
import { modelIntelligenceProduct } from "./model-intelligence.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import type { NativeComparisonContextReceipt } from "./native-runtime/native-comparison-context.js";

export const NATIVE_MODEL_COMPARISON_KEY = "nativeModelComparison";
export const NATIVE_MODEL_COMPARISON_DELIVERY_KEY = "nativeModelComparisonDelivery";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface NativeModelComparisonBinding {
  schema: "agentos.native-model-comparison.v1";
  companyId: string;
  runId: string;
  assignment: NativeModelComparisonAssignment;
  assignmentReceiptId: string;
  assignmentDocumentId: string;
  assignmentRevisionId: string;
  assignmentSha256: string;
  configuration: Record<string, unknown>;
  attempt: number;
  admittedAt: string;
  receiptId: string | null;
  contextReceipt?: NativeComparisonContextReceipt;
}

/** Only the run profile is native-owned; wake/context payloads cannot bind a comparison. */
export function readNativeModelComparison(run: Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "runnerProfileJson">): NativeModelComparisonBinding | null {
  const value = record(run.runnerProfileJson?.[NATIVE_MODEL_COMPARISON_KEY]);
  if (value.schema !== "agentos.native-model-comparison.v1" || value.runId !== run.id || value.companyId !== run.companyId) return null;
  return value as unknown as NativeModelComparisonBinding;
}

async function currentAssignment(db: Db, companyId: string, issueId: string) {
  const documents = documentService(db);
  // Ordinary tasks pay one indexed document lookup, with no task-row lock,
  // account lookup, filesystem materialization or executable probe.
  if (!await documents.getIssueDocumentByKey(issueId, MODEL_COMPARISON_ASSIGNMENT_KEY)) return null;
  // Match native finalization and document writers: task before document/run.
  await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).for("update");
  const document = await documents.getIssueDocumentByKey(issueId, MODEL_COMPARISON_ASSIGNMENT_KEY);
  if (!document) return null;
  if (typeof document.body !== "string" || !document.latestRevisionId) throw conflict("The comparison assignment receipt is unavailable");
  if (Buffer.byteLength(document.body, "utf8") > 4096) throw conflict("The comparison assignment receipt changed");
  let pointer: Record<string, unknown>;
  try { pointer = record(JSON.parse(document.body)); } catch { throw conflict("The comparison assignment receipt is invalid"); }
  if (pointer.schema !== MODEL_COMPARISON_ASSIGNMENT_SCHEMA || typeof pointer.assignmentReceiptId !== "string"
    || Object.keys(pointer).some(key => !["schema", "assignmentReceiptId"].includes(key))) throw conflict("The comparison assignment receipt is invalid");
  const [audit] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "model_comparison.prepared"),
    sql`${activityLog.details}->>'assignmentReceiptId' = ${pointer.assignmentReceiptId}`, sql`${activityLog.details}->>'targetIssueId' = ${issueId}`)).limit(1);
  const details = record(audit?.details), assignment = record(details.assignment) as unknown as NativeModelComparisonAssignment;
  if (!audit || audit.actorType !== "user" || assignment.schema !== MODEL_COMPARISON_ASSIGNMENT_SCHEMA || assignment.companyId !== companyId
    || assignment.issueId !== issueId || assignment.preparedByUserId !== audit.actorId || audit.entityType !== "issue" || audit.entityId !== assignment.sourceIssueId
    || details.requestFingerprint !== modelProfileDigest(assignment) || details.documentId !== document.id || details.revisionId !== document.latestRevisionId
    || document.lockedByUserId !== audit.actorId || details.sha256 !== hash(document.body)) throw conflict("The locked comparison assignment has no matching native preparation receipt");
  const revision = await documents.getIssueDocumentRevision({ companyId, issueId, documentId: document.id,
    revisionId: document.latestRevisionId, maxBodyBytes: 4096, lock: true });
  const [author] = await db.select({ userId: documentRevisions.createdByUserId, agentId: documentRevisions.createdByAgentId }).from(documentRevisions)
    .where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.documentId, document.id), eq(documentRevisions.id, document.latestRevisionId))).for("share");
  if (!revision || !author || author.userId !== audit.actorId || author.agentId || hash(revision.body) !== details.sha256) throw conflict("The comparison assignment author or revision changed");
  const actor: AuthorizationActor = { type: "board", source: "session", userId: audit.actorId, companyIds: [companyId], isInstanceAdmin: true };
  await assertModelComparisonOwner(db, companyId, actor);
  const task = await readableModelComparisonTask(db, companyId, issueId, actor, true);
  const engine = modelIntelligenceProduct();
  if (!engine) throw conflict("Model Intelligence is not configured");
  const definition = await engine.comparisonDefinition({ namespace: companyId, comparisonId: assignment.comparisonId });
  const native = await readModelComparisonCase(db, companyId, actor, definition, assignment.caseId);
  if (!supportedModelComparisonTask(task) || task.assigneeAgentId !== assignment.agentId || native.source.id !== assignment.sourceIssueId
    || modelProfileDigest(modelComparisonTaskScope(task)) !== modelProfileDigest({ inputDigest: assignment.inputDigest, checkDigest: assignment.checkDigest })
    || modelProfileDigest(native.scope) !== modelProfileDigest(modelComparisonTaskScope(task))) throw conflict("The prepared task or checks changed");
  const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, assignment.agentId))).for("share");
  if (!agent || agent.lifecycleState !== "ready" || ["paused", "terminated", "pending_approval"].includes(agent.status)) throw conflict("The comparison employee is unavailable");
  const employee: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId, agentId: agent.id, onBehalfOfUserId: task.responsibleUserId ?? undefined };
  for (const row of [task, native.source]) if (!(await authorizationService(db).decide({ actor: employee, action: "issue:read", resource: { type: "issue", companyId, issueId: row.id } })).allowed) throw notFound("The native comparison task is unavailable");
  const account = await readModelComparisonAccount(db, agent, task, agent.adapterConfig);
  const configuration = await modelProfileConfiguration(db, agent, agent.adapterConfig);
  // CLI identity is freshly checked at selection; no subprocess under this run lock.
  const profile = await modelComparisonProfile(db, agent, agent.adapterConfig, account.accountFingerprint, assignment.cliVersion);
  if (account.accountFingerprint !== assignment.accountFingerprint || configuration.configurationFingerprint !== assignment.configurationFingerprint
    || modelProfileDigest(profile) !== modelProfileDigest(assignment.profile) || modelProfileDigest(profile) !== modelProfileDigest(definition.comparison[assignment.arm])) throw conflict("The prepared account or native profile changed");
  return { assignment, document: { ...document, body: document.body }, assignmentReceiptId: pointer.assignmentReceiptId, configuration: agent.adapterConfig };
}

/** Claim before credentials/selection so pre-provider failures remain durable
 * native attempts. A task start uses its prepared document; no racing run-ID UI. */
export async function claimNativeModelComparison(db: Db, input: { runId: string; companyId: string; agentId: string; issueId: string | null; reviewOnly?: boolean }) {
  if (!input.issueId || input.reviewOnly) return null;
  return db.transaction(async transaction => {
    const tx = transaction as unknown as Db;
    const current = await currentAssignment(tx, input.companyId, input.issueId!);
    if (!current) return null;
    const assignment = current.assignment;
    if (assignment.agentId !== input.agentId) throw conflict("Only the prepared employee can execute this comparison");
    const armKey = `${input.companyId}:${assignment.comparisonId}:${assignment.caseId}:${assignment.arm}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`model-comparison-attempt:${armKey}`}, 0))`);
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.issueId, input.issueId!))).for("update");
    if (!run) throw notFound("Native comparison run not found");
    const retained = readNativeModelComparison(run);
    if (retained) {
      if (retained.assignmentReceiptId !== current.assignmentReceiptId || modelProfileDigest(retained.assignment) !== modelProfileDigest(assignment)) throw conflict("The admitted comparison assignment changed");
      return retained;
    }
    if (!["queued", "running"].includes(run.status) || run.contextSnapshot?.modelIntelligence || run.contextSnapshot?.modelIntelligenceRequest
      || run.runnerProfileJson?.nativeExecutionInput || run.nativeSessionId || run.sessionIdBefore) throw conflict("A comparison must be admitted before selection and provider execution");
    const priorRuns = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->'assignment'->>'comparisonId' = ${assignment.comparisonId}`,
      sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->'assignment'->>'caseId' = ${assignment.caseId}`,
      sql`${heartbeatRuns.runnerProfileJson}->'nativeModelComparison'->'assignment'->>'arm' = ${assignment.arm}`)).limit(11);
    const report = await modelIntelligenceProduct()!.comparisonReport({ namespace: input.companyId, comparisonId: assignment.comparisonId });
    const history = report.cases.find(item => item.caseId === assignment.caseId)![assignment.arm];
    if (history.terminal || priorRuns.length >= 10 || priorRuns.some(prior => record(prior.runnerProfileJson?.[NATIVE_MODEL_COMPARISON_DELIVERY_KEY]).state !== "delivered")
      || history.attempts.length !== priorRuns.length) throw conflict("This comparison arm already has an unsettled or terminal attempt");
    const binding: NativeModelComparisonBinding = { schema: "agentos.native-model-comparison.v1", companyId: input.companyId, runId: run.id,
      assignment, assignmentReceiptId: current.assignmentReceiptId, assignmentDocumentId: current.document.id, assignmentRevisionId: current.document.latestRevisionId!,
      assignmentSha256: hash(current.document.body), configuration: current.configuration, attempt: priorRuns.length + 1, admittedAt: new Date().toISOString(), receiptId: null };
    await notifyDeliveryWork(tx, DELIVERY_QUEUES.modelComparisons, input.companyId);
    await tx.update(heartbeatRuns).set({ runnerProfileJson: sql`coalesce(${heartbeatRuns.runnerProfileJson}, '{}'::jsonb) || ${JSON.stringify({ [NATIVE_MODEL_COMPARISON_KEY]: binding, [NATIVE_MODEL_COMPARISON_DELIVERY_KEY]: { state: "waiting" } })}::jsonb` }).where(eq(heartbeatRuns.id, run.id));
    return binding;
  });
}

export async function nativeModelComparisonSelection(db: Db, input: { companyId: string; runId: string; candidates: Candidate[]; profile?: ModelProfileBinding; cliVersion?: string }) {
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId)));
  const binding = run && readNativeModelComparison(run);
  if (!binding) return null;
  const { assignment } = binding;
  if (!input.profile || input.profile.accountFingerprint !== assignment.accountFingerprint || input.profile.configurationFingerprint !== assignment.configurationFingerprint
    || input.profile.model !== assignment.profile.model || input.cliVersion !== assignment.cliVersion) throw conflict("The native comparison account, configuration or executable changed");
  const candidate = input.candidates.find(item => item.model === assignment.profile.model && item.provider === assignment.profile.provider && item.method === "subscription" && item.available);
  if (!candidate) throw conflict("The comparison arm is not a currently eligible native model");
  const comparisonBinding: ComparisonSelectionBinding = { comparisonId: assignment.comparisonId, caseId: assignment.caseId, arm: assignment.arm,
    inputDigest: assignment.inputDigest, checkDigest: assignment.checkDigest };
  return { binding, candidate, comparisonBinding };
}

export async function finalizeNativeModelComparisonSelection(db: Db, input: { companyId: string; runId: string; receipt: SelectionReceipt }) {
  if (!input.receipt.comparisonBinding) return;
  await db.transaction(async transaction => {
    const tx = transaction as unknown as Db;
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId))).for("update");
    const binding = run && readNativeModelComparison(run);
    if (!binding || input.receipt.id !== run!.id || input.receipt.namespace !== input.companyId
      || modelProfileDigest(input.receipt.comparisonBinding) !== modelProfileDigest(comparisonSelectionBinding(binding))
      || input.receipt.candidate.model !== binding.assignment.profile.model || input.receipt.candidate.provider !== binding.assignment.profile.provider
      || input.receipt.candidate.method !== "subscription" || binding.receiptId && binding.receiptId !== input.receipt.id) throw conflict("The native comparison selection binding changed");
    await notifyDeliveryWork(tx, DELIVERY_QUEUES.modelComparisons, input.companyId);
    await tx.update(heartbeatRuns).set({ runnerProfileJson: sql`jsonb_set(${heartbeatRuns.runnerProfileJson}, '{nativeModelComparison,receiptId}', to_jsonb(${input.receipt.id}::text))
      || case when ${heartbeatRuns.runnerProfileJson}->'nativeModelComparisonDelivery'->>'state' = 'unselected'
        then '{"nativeModelComparisonDelivery":{"state":"waiting"}}'::jsonb else '{}'::jsonb end` }).where(eq(heartbeatRuns.id, input.runId));
  });
}

function comparisonSelectionBinding(binding: NativeModelComparisonBinding): ComparisonSelectionBinding {
  const { comparisonId, caseId, arm, inputDigest, checkDigest } = binding.assignment;
  return { comparisonId, caseId, arm, inputDigest, checkDigest };
}

export async function assertAdmittedModelComparisonCurrent(db: Db, binding: NativeModelComparisonBinding) {
  await db.transaction(async connection => {
    const current = await currentAssignment(connection as unknown as Db, binding.companyId, binding.assignment.issueId);
    if (!current || current.assignmentReceiptId !== binding.assignmentReceiptId
      || modelProfileDigest(current.assignment) !== modelProfileDigest(binding.assignment)) throw conflict("The admitted comparison changed before execution");
    const report = await modelIntelligenceProduct()!.comparisonReport({ namespace: binding.companyId, comparisonId: binding.assignment.comparisonId });
    if (report.blockers.includes("profile_blocked_by_policy")) throw conflict("The comparison profile has been blocked");
  });
}

/** The comparison owns its single frozen arm, independent of observational
 * alternatives. This is selection only; native capacity and dispatch still own
 * permission to execute. Both stores retain an idempotent recovery receipt. */
export async function selectAdmittedModelComparison(db: Db, input: {
  binding: NativeModelComparisonBinding; config: Record<string, unknown>; profile: ModelProfileBinding;
  cliVersion: string; assertAccountCurrent: () => Promise<void>;
}) {
  const { binding, profile } = input, engine = modelIntelligenceProduct();
  if (!engine) throw conflict("Model Intelligence is unavailable for the admitted comparison");
  const assertCurrent = async () => {
    await input.assertAccountCurrent();
    await assertAdmittedModelComparisonCurrent(db, binding);
  };
  await assertCurrent();
  const candidate: Candidate = { id: binding.assignment.profile.profileId, provider: binding.assignment.profile.provider,
    model: binding.assignment.profile.model, method: "subscription", available: true };
  const selected = await nativeModelComparisonSelection(db, { companyId: binding.companyId, runId: binding.runId,
    candidates: [candidate], profile, cliVersion: input.cliVersion });
  if (!selected || modelProfileDigest(selected.binding.assignment) !== modelProfileDigest(binding.assignment)) throw conflict("The native comparison admission is unavailable");
  const request: SelectionInput = { namespace: binding.companyId, requestId: binding.runId,
    taskKey: `comparison:${binding.assignment.comparisonId}:${binding.assignment.caseId}:${binding.assignment.arm}`,
    taskType: profile.taskType, complexity: profile.complexity, candidates: [candidate], defaultCandidateId: candidate.id,
    promptFingerprint: binding.assignment.profile.promptFingerprint, contextFingerprint: binding.assignment.inputDigest,
    comparisonBinding: selected.comparisonBinding };
  const receipt = await db.transaction(async connection => {
    const tx = connection as unknown as Db;
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, binding.companyId), eq(heartbeatRuns.id, binding.runId))).for("update");
    const retained = run && readNativeModelComparison(run);
    if (!retained || !["queued", "running"].includes(run!.status) || retained.assignmentReceiptId !== binding.assignmentReceiptId) throw conflict("The native comparison is no longer executable");
    const prior = run!.contextSnapshot?.modelIntelligenceRequest;
    if (prior && modelProfileDigest(prior) !== modelProfileDigest(request)) throw conflict("The frozen comparison selection changed");
    await tx.update(heartbeatRuns).set({ contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify({
      modelIntelligenceRequest: request, modelProfileAdmission: profile, modelProfileLearningScope: null,
    })}::jsonb` }).where(eq(heartbeatRuns.id, binding.runId));
    return request;
  }).then(frozen => engine.select(frozen));
  await finalizeNativeModelComparisonSelection(db, { companyId: binding.companyId, runId: binding.runId, receipt });
  await db.update(heartbeatRuns).set({ contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify({
    modelIntelligence: receipt, modelProfileBinding: profile, modelProfileQualification: null,
  })}::jsonb` }).where(and(eq(heartbeatRuns.companyId, binding.companyId), eq(heartbeatRuns.id, binding.runId)));
  return { config: input.config, receipt, request, profileBinding: profile, profileAdmission: profile,
    assertQualificationCurrent: async () => { await assertCurrent(); await engine.select(request); } };
}
