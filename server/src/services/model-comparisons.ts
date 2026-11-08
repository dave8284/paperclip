import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { activityLog, agents, aiSubscriptionConnections, authUsers, companyMemberships, companySecrets, heartbeatRuns, instanceUserRoles, issues, type Db } from "@paperclipai/db";
import { aiConnectionBindingSchema, prepareModelComparisonSchema, type ModelComparisonDiscovery, type PrepareModelComparison, type PreparedModelComparisonResult } from "@paperclipai/shared";
import type { ComparisonDefinition, ComparisonVariant } from "@agentos/model-intelligence";
import { readLocalCodexIdentity } from "../vendor/paperclip-runner/index.js";
import { conflict, forbidden, notFound, HttpError } from "../errors.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { documentService } from "./documents.js";
import { persistActivity, publishActivity } from "./activity-log.js";
import { aiConnectionService } from "./ai-connections.js";
import { resolveAiCredentialOwner } from "./ai-account-credential-owner.js";
import { defaultCompanyModelBinding } from "./company-model-policy.js";
import { managedAiSessionIdentity } from "./ai-connection-session.js";
import { modelAccountFingerprint, modelProfileConfiguration, modelProfileDigest } from "./model-profile-binding.js";
import { modelComparisonProfile, modelComparisonTaskScope } from "./model-comparison-scope.js";
import { classifyModelWork, modelIntelligenceProduct } from "./model-intelligence.js";

export const MODEL_COMPARISON_ASSIGNMENT_KEY = "model-comparison-assignment";
export const MODEL_COMPARISON_ASSIGNMENT_SCHEMA = "agentos.model-comparison-assignment.v1";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const absent = (error: unknown) => { if (error instanceof HttpError && [400, 401, 403, 404, 409, 422].includes(error.status)) return null; throw error; };
type Task = typeof issues.$inferSelect;
type Employee = typeof agents.$inferSelect;

export interface NativeModelComparisonAssignment extends PrepareModelComparison {
  schema: typeof MODEL_COMPARISON_ASSIGNMENT_SCHEMA;
  companyId: string;
  agentId: string;
  preparedByUserId: string;
  sourceIssueId: string;
  inputDigest: string;
  checkDigest: string;
  accountFingerprint: string;
  configurationFingerprint: string;
  profile: ComparisonVariant;
  cliVersion: string;
}

export async function assertModelComparisonOwner(db: Db, companyId: string, actor: AuthorizationActor) {
  if (actor.type !== "board" || !actor.userId || actor.source === "mcp_oauth" || !actor.companyIds?.includes(companyId)) throw forbidden("A current company administrator must prepare model comparisons");
  const [user] = await db.select({ id: authUsers.id }).from(authUsers).where(and(eq(authUsers.id, actor.userId), eq(authUsers.approvalStatus, "approved"))).for("share");
  const [role] = await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(eq(instanceUserRoles.userId, actor.userId), eq(instanceUserRoles.role, "instance_admin"))).for("share");
  const [member] = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId), eq(companyMemberships.status, "active"))).for("share");
  if (!user || !role || !member) throw forbidden("Current administrator and company membership are required");
  return actor.userId;
}

export async function readableModelComparisonTask(db: Db, companyId: string, issueId: string, actor: AuthorizationActor, lock = false) {
  const access = await authorizationService(db).decide({ actor, action: "issue:read", resource: { type: "issue", companyId, issueId } });
  if (!access.allowed) throw notFound("Native comparison task is unavailable");
  const query = db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).limit(1);
  const [task] = await (lock ? query.for("update") : query);
  if (!task) throw notFound("Native comparison task is unavailable");
  return task;
}

export function supportedModelComparisonTask(task: Task) {
  return Object.keys(record(task.assigneeAdapterOverrides)).length === 0 && task.workMode === "standard" && !task.conversationAgentId && !task.conversationUserId
    && ["human_only", "not_creator"].includes(task.reviewPolicy ?? "");
}

export async function readModelComparisonAccount(db: Db, agent: Employee, task: Task, config: Record<string, unknown>) {
  if (agent.adapterType !== "paperclip_runner" || config.provider !== "codex" || config.homeMode === "preconfigured" || config.lifecycleMode === "warm" || !task.responsibleUserId) throw conflict("Comparisons require a fresh native isolated Codex subscription execution with a responsible user");
  const supplied = record(agent.runtimeConfig).aiConnection;
  const binding = supplied ? aiConnectionBindingSchema.parse(supplied) : await defaultCompanyModelBinding(db, agent.companyId, agent.adapterType, config);
  if (!binding || binding.provider !== "openai" || binding.method !== "subscription") throw conflict("Comparisons require the current native subscription account");
  const selected = await aiConnectionService(db).select({ companyId: agent.companyId, agentId: agent.id, userId: task.responsibleUserId,
    adapterType: agent.adapterType, runnerProvider: "codex", model: String(config.model ?? ""), binding });
  const credentialOwner = await resolveAiCredentialOwner(db, selected, { lock: true });
  const credential = credentialOwner.grant.credentialSecretRefs.find(ref => ref.configPath === "ai.credential");
  const [secret] = credential ? await db.select({ epoch: companySecrets.aiSessionEpoch, deleted: companySecrets.deletedAt, status: companySecrets.status }).from(companySecrets)
    .where(and(eq(companySecrets.companyId, credentialOwner.connection.companyId), eq(companySecrets.id, credential.secretId))).for("share") : [];
  const [subscription] = await db.select({ id: aiSubscriptionConnections.subscriptionId }).from(aiSubscriptionConnections)
    .where(and(eq(aiSubscriptionConnections.companyId, agent.companyId), eq(aiSubscriptionConnections.grantId, selected.grant.id))).for("share");
  if (!credential || !secret || secret.deleted || secret.status !== "active" || !subscription?.id) throw conflict("The current native subscription credential is unavailable");
  const sessionIdentity = managedAiSessionIdentity(selected.grant.id, task.responsibleUserId, { secretId: credential.secretId, epoch: secret.epoch });
  return { accountFingerprint: modelAccountFingerprint(agent.companyId, { provider: "openai", subscriptionId: subscription.id, sessionIdentity }), sessionIdentity };
}

export async function readModelComparisonCase(db: Db, companyId: string, actor: AuthorizationActor, definition: ComparisonDefinition, caseId: string) {
  const item = definition.dataset.cases.find(item => item.id === caseId);
  const sourceId = item?.sourceRef.match(/^issue:([0-9a-f-]{36})$/i)?.[1];
  if (!item || !sourceId) throw notFound("The comparison case has no supported native task source");
  const source = await readableModelComparisonTask(db, companyId, sourceId, actor);
  const scope = modelComparisonTaskScope(source), family = classifyModelWork(source.title, source.description);
  if (!supportedModelComparisonTask(source) || scope.inputDigest !== item.inputDigest || scope.checkDigest !== item.checkDigest
    || family.taskType !== definition.dataset.taskFamily || family.complexity !== definition.dataset.complexity) throw conflict("The native comparison source or acceptance checks changed");
  return { source, item, scope };
}

export function modelComparisonService(db: Db, options: { readRuntimeIdentity?: (config: Record<string, unknown>) => Promise<{ cliVersion: string }> } = {}) {
  const runtimeIdentity = options.readRuntimeIdentity ?? (async (config: Record<string, unknown>) => readLocalCodexIdentity({
    ...(typeof config.command === "string" && config.command ? { command: config.command } : {}),
    ...(typeof config.cwd === "string" && config.cwd ? { workingDirectory: config.cwd } : {}),
  }));
  async function employeeScope(tx: Db, task: Task, source: Task, cache?: Map<string, Promise<Awaited<ReturnType<typeof profileScope>>>>) {
    const [agent] = task.assigneeAgentId ? await tx.select().from(agents).where(and(eq(agents.companyId, task.companyId), eq(agents.id, task.assigneeAgentId))).for("share") : [];
    if (!agent || agent.lifecycleState !== "ready" || ["paused", "terminated", "pending_approval"].includes(agent.status)) throw conflict("Choose a current native employee on this task");
    const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: task.companyId, agentId: agent.id, onBehalfOfUserId: task.responsibleUserId ?? undefined };
    await readableModelComparisonTask(tx, task.companyId, task.id, actor);
    await readableModelComparisonTask(tx, source.companyId, source.id, actor);
    const key = modelProfileDigest({ agentId: agent.id, config: agent.adapterConfig, runtime: agent.runtimeConfig, responsibleUserId: task.responsibleUserId });
    if (!cache) return profileScope(tx, agent, task);
    if (!cache.has(key)) cache.set(key, profileScope(tx, agent, task));
    return cache.get(key)!;
  }
  async function profileScope(tx: Db, agent: Employee, task: Task) {
    const config = agent.adapterConfig;
    const account = await readModelComparisonAccount(tx, agent, task, config);
    const identity = await runtimeIdentity(config);
    const profile = await modelComparisonProfile(tx, agent, config, account.accountFingerprint, identity.cliVersion);
    const configuration = await modelProfileConfiguration(tx, agent, config);
    return { agent, profile, accountFingerprint: account.accountFingerprint, cliVersion: identity.cliVersion, configurationFingerprint: configuration.configurationFingerprint };
  }
  return {
    async discover(companyId: string, actor: AuthorizationActor): Promise<ModelComparisonDiscovery> {
      await assertModelComparisonOwner(db, companyId, actor);
      const engine = modelIntelligenceProduct();
      if (!engine) return { enabled: false, comparisons: [] };
      const tasks = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.status, "backlog"), eq(issues.workMode, "standard")))
        .orderBy(desc(issues.updatedAt)).limit(100);
      const profileCache = new Map<string, Promise<Awaited<ReturnType<typeof profileScope>>>>();
      const taskCache = new Map<string, Promise<boolean>>();
      const output: ModelComparisonDiscovery["comparisons"] = [];
      for (const definition of await engine.comparisonCatalog(companyId)) {
        const cases: ModelComparisonDiscovery["comparisons"][number]["cases"] = [];
        for (const item of definition.dataset.cases) {
          const native = await readModelComparisonCase(db, companyId, actor, definition, item.id).catch(absent);
          if (!native) continue;
          const choices: ModelComparisonDiscovery["comparisons"][number]["cases"][number]["tasks"] = [];
          for (const task of tasks) {
            if (!supportedModelComparisonTask(task) || modelProfileDigest(modelComparisonTaskScope(task)) !== modelProfileDigest(native.scope)) continue;
            if (!taskCache.has(task.id)) taskCache.set(task.id, (async () => {
              if (!await readableModelComparisonTask(db, companyId, task.id, actor).catch(absent)) return false;
              const [existingRun] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.issueId, task.id))).limit(1);
              return !existingRun;
            })());
            if (!await taskCache.get(task.id)) continue;
            const candidate = await employeeScope(db, task, native.source, profileCache).catch(absent);
            if (!candidate) continue;
            const arms = (["baseline", "candidate"] as const).filter(arm => modelProfileDigest(candidate.profile) === modelProfileDigest(definition.comparison[arm]));
            if (arms.length) choices.push({ issueId: task.id, identifier: task.identifier, title: task.title, agentId: candidate.agent.id, agentName: candidate.agent.name, arms });
          }
          cases.push({ id: item.id, split: item.split, label: native.source.title, tasks: choices });
        }
        // Even a dataset label can disclose a private case; withhold the whole
        // definition when no case has current native read authority.
        if (cases.length) output.push({ id: definition.comparison.id, dimension: definition.comparison.dimension,
          datasetId: definition.dataset.id, datasetVersion: definition.dataset.version, taskFamily: definition.dataset.taskFamily,
          baseline: { model: definition.comparison.baseline.model, reasoningEffort: definition.comparison.baseline.reasoningEffort },
          candidate: { model: definition.comparison.candidate.model, reasoningEffort: definition.comparison.candidate.reasoningEffort }, cases });
      }
      return { enabled: true, comparisons: output };
    },
    async prepare(companyId: string, actor: AuthorizationActor, raw: PrepareModelComparison): Promise<PreparedModelComparisonResult> {
      const input = prepareModelComparisonSchema.parse(raw), engine = modelIntelligenceProduct();
      if (!engine) throw conflict("Model Intelligence is not configured");
      if (actor.type !== "board" || !actor.userId) throw forbidden("A current administrator must prepare this comparison");
      const result = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`model-comparison:${companyId}:${actor.userId}:${input.requestKey}`}, 0))`);
        const userId = await assertModelComparisonOwner(tx, companyId, actor);
        const task = await readableModelComparisonTask(tx, companyId, input.issueId, actor, true);
        const definition = await engine.comparisonDefinition({ namespace: companyId, comparisonId: input.comparisonId });
        const native = await readModelComparisonCase(tx, companyId, actor, definition, input.caseId);
        if (!supportedModelComparisonTask(task) || modelProfileDigest(modelComparisonTaskScope(task)) !== modelProfileDigest(native.scope)) throw conflict("The target task and native case acceptance checks differ");
        const candidate = await employeeScope(tx, task, native.source);
        if (modelProfileDigest(candidate.profile) !== modelProfileDigest(definition.comparison[input.arm])) throw conflict("The assigned employee does not match this frozen native comparison profile");
        const assignment: NativeModelComparisonAssignment = { schema: MODEL_COMPARISON_ASSIGNMENT_SCHEMA, ...input, companyId, agentId: candidate.agent.id,
          preparedByUserId: userId, sourceIssueId: native.source.id, ...native.scope, accountFingerprint: candidate.accountFingerprint,
          configurationFingerprint: candidate.configurationFingerprint, profile: candidate.profile, cliVersion: candidate.cliVersion };
        const requestFingerprint = modelProfileDigest(assignment);
        const [prior] = await tx.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.actorId, userId), eq(activityLog.action, "model_comparison.prepared"), sql`${activityLog.details}->>'requestKey' = ${input.requestKey}`)).limit(1);
        const documents = documentService(tx);
        if (prior) {
          const details = record(prior.details);
          if (details.targetIssueId !== task.id || details.requestFingerprint !== requestFingerprint) throw conflict("The comparison preparation key already names a different assignment");
          const current = await documents.getIssueDocumentByKey(task.id, MODEL_COMPARISON_ASSIGNMENT_KEY);
          if (!current || typeof current.body !== "string" || current.id !== details.documentId || current.latestRevisionId !== details.revisionId || current.lockedByUserId !== userId || hash(current.body) !== details.sha256) throw conflict("The prepared comparison document changed");
          return { created: false, task, documentId: current.id, revisionId: current.latestRevisionId!, publication: null };
        }
        const [previous] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.issueId, task.id))).limit(1);
        if (task.status !== "backlog" || previous || await documents.getIssueDocumentByKey(task.id, MODEL_COMPARISON_ASSIGNMENT_KEY)) throw conflict("Prepare a fresh backlog task before any execution or selection");
        // Task readers receive no private case, account or source provenance.
        // The native source-scoped audit owns the authoritative assignment.
        const assignmentReceiptId = randomUUID();
        const body = JSON.stringify({ schema: MODEL_COMPARISON_ASSIGNMENT_SCHEMA, assignmentReceiptId }, null, 2);
        const saved = await documents.upsertIssueDocument({ issueId: task.id, key: MODEL_COMPARISON_ASSIGNMENT_KEY, title: "Prepared isolated model comparison", format: "markdown", body, createdByUserId: userId });
        await documents.lockIssueDocument({ issueId: task.id, key: MODEL_COMPARISON_ASSIGNMENT_KEY, lockedByUserId: userId });
        const { publication } = await persistActivity(tx, { companyId, actorType: "user", actorId: userId, issueId: native.source.id, entityType: "issue", entityId: native.source.id,
          action: "model_comparison.prepared", details: { assignmentReceiptId, assignment, targetIssueId: task.id, requestKey: input.requestKey, requestFingerprint, documentId: saved.document.id, revisionId: saved.document.latestRevisionId, sha256: hash(body), executionStarted: false } });
        return { created: true, task, documentId: saved.document.id, revisionId: saved.document.latestRevisionId!, publication };
      });
      if (result.publication) publishActivity(result.publication);
      return { created: result.created, companyId, task: { id: result.task.id, identifier: result.task.identifier, title: result.task.title, status: result.task.status },
        assignment: { documentId: result.documentId, revisionId: result.revisionId } };
    },
  };
}
