import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { agents, aiSubscriptionConnections, authUsers, companyMemberships, companySecrets, costEvents, heartbeatRuns,
  instanceUserRoles, issueExecutionDecisions, issueThreadInteractions, statusDecisions, issues, modelProfileQualifications as qualifications, type Db } from "@paperclipai/db";
import { aiConnectionBindingSchema, registerModelProfileQualificationSchema,
  type ModelProfileBinding, type ModelProfileQualification, type ModelProfileQualificationEvidence, type ModelProfileQualificationList, type RegisterModelProfileQualification } from "@paperclipai/shared";
import { conflict, forbidden, notFound, HttpError } from "../errors.js";
import { ZodError } from "zod";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { aiConnectionService } from "./ai-connections.js";
import { managedAiSessionIdentity } from "./ai-connection-session.js";
import { modelAccountFingerprint, modelProfileConfiguration, modelProfileDigest, sameModelProfileScope } from "./model-profile-binding.js";
import { nativeModelTaskMatchesSelection, readNativeModelProfileEvidence } from "./native-runtime/native-model-profile-evidence.js";
import { persistActivity, publishActivity } from "./activity-log.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Qualification = typeof qualifications.$inferSelect;
type Evidence = Awaited<ReturnType<typeof readEvidence>>;

function ineligibleEvidence(error: unknown): null {
  if ((error instanceof HttpError && [400, 401, 403, 404, 409, 422].includes(error.status)) || error instanceof ZodError) return null;
  // Operational failures are unavailable evidence, not evidence of absence.
  throw error;
}

async function owner(db: Db, actor: AuthorizationActor, companyId: string) {
  if (actor.type !== "board" || !actor.userId || actor.source === "mcp_oauth") throw forbidden("A current administrator must manage model qualifications");
  if (actor.source === "local_implicit") return actor.userId;
  if (!actor.companyIds?.includes(companyId)) throw forbidden("Company access is required");
  const [user] = await db.select({ id: authUsers.id }).from(authUsers).where(and(eq(authUsers.id, actor.userId), eq(authUsers.approvalStatus, "approved"))).for("share");
  const [admin] = await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(eq(instanceUserRoles.userId, actor.userId), eq(instanceUserRoles.role, "instance_admin"))).for("share");
  const [member] = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId), eq(companyMemberships.status, "active"))).for("share");
  if (!user || !admin || !member) throw forbidden("Current administrator and company access are required");
  return actor.userId;
}

async function readEvidence(db: Db, companyId: string, runId: string, reviewDecisionId?: string | null, nativeReviewInteractionId?: string | null) {
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).for("share");
  if (!run) throw notFound("Qualification execution not found");
  const profile = run.contextSnapshot?.modelProfileBinding as ModelProfileBinding | undefined;
  const native = record(run.runnerProfileJson?.nativeExecutionInput), binding = record(native.binding), provider = record(native.provider);
  const account = record(run.contextSnapshot?.aiConnection);
  const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, run.agentId))).for("share");
  if (!agent || agent.adapterType !== "paperclip_runner" || !run.issueId || run.nativeIssueId !== run.issueId
    || run.runtimeMode !== "native" || run.status !== "succeeded" || !run.startedAt || !run.finishedAt || run.finishedAt > new Date()
    || run.errorCode || run.sessionIdBefore || run.costAccountingPending || !run.costAccountedAt
    || run.usageJson?.accountingReceiptReady !== true || run.usageJson?.accountingCaptureFailed === true
    || binding.companyId !== companyId || binding.agentId !== agent.id || binding.runId !== run.id || binding.issueId !== run.issueId
    || provider.kind !== "codex" || native.executionPurpose || native.executionMode === "plan" || native.homeMode === "preconfigured"
    || run.contextSnapshot?.nativeReviewInteractionId
    || !profile || profile.schema !== "agentos.model-profile-binding.v1" || profile.provider !== "openai"
    || provider.model !== profile.model || (provider.reasoningEffort ?? null) !== profile.requestedEffort
    || account.provider !== "openai" || account.method !== "subscription" || typeof account.subscriptionId !== "string"
    || typeof account.sessionIdentity !== "string" || typeof account.responsibleUserId !== "string") {
    throw conflict("A complete fresh native subscription execution with an exact profile binding is required");
  }
  const selection = record(run.contextSnapshot?.modelIntelligence);
  if (!nativeModelTaskMatchesSelection(run, selection.contextFingerprint) || selection.id !== run.id || selection.namespace !== companyId || selection.taskType !== profile.taskType
    || selection.complexity !== profile.complexity || selection.promptFingerprint !== profile.promptFingerprint
    || record(selection.candidate).model !== profile.model) throw conflict("The native selection and profile evidence differ");
  const current = await modelProfileConfiguration(db, agent, { ...agent.adapterConfig, model: profile.model,
    ...(profile.requestedEffort ? { modelReasoningEffort: profile.requestedEffort } : {}) });
  if (current.promptFingerprint !== profile.promptFingerprint || current.configurationFingerprint !== profile.configurationFingerprint) throw conflict("The employee profile changed after this execution");
  const observation = await readNativeModelProfileEvidence(db, run);
  if (!observation || observation.model !== profile.model
    || (profile.requestedEffort !== null && observation.reasoningEffort !== null && observation.reasoningEffort !== profile.requestedEffort)) throw conflict("Provider-reported model and runtime evidence is missing or differs");
  const usage = await db.select().from(costEvents).where(and(eq(costEvents.companyId, companyId), eq(costEvents.heartbeatRunId, run.id))).for("share");
  if (!usage.length || !usage.some(row => row.outputTokens > 0) || usage.some(row => row.billingType !== "subscription_included"
    || row.subscriptionId !== account.subscriptionId || row.provider !== "openai" || row.model !== profile.model)) throw conflict("Complete subscription-only accounting evidence is required");
  const nativeBinding = aiConnectionBindingSchema.parse({ mode: account.mode, provider: account.provider, method: account.method,
    ...(account.mode === "responsible_user" ? {} : { grantId: account.grantId, connectionId: account.connectionId }) });
  const selected = await aiConnectionService(db).select({ companyId, agentId: agent.id, userId: account.responsibleUserId,
    adapterType: agent.adapterType, runnerProvider: "codex", model: profile.model, binding: nativeBinding });
  const credential = selected.grant.credentialSecretRefs.find(ref => ref.configPath === "ai.credential");
  const [secret] = credential ? await db.select({ epoch: companySecrets.aiSessionEpoch, deleted: companySecrets.deletedAt }).from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.id, credential.secretId))).for("share") : [];
  const [subscription] = await db.select().from(aiSubscriptionConnections).where(and(eq(aiSubscriptionConnections.companyId, companyId), eq(aiSubscriptionConnections.grantId, selected.grant.id))).for("share");
  if (!credential || !secret || secret.deleted || selected.grant.id !== account.grantId || selected.connection.id !== account.connectionId
    || selected.attribution.method !== "subscription" || subscription?.subscriptionId !== account.subscriptionId
    || managedAiSessionIdentity(selected.grant.id, account.responsibleUserId, { secretId: credential.secretId, epoch: secret.epoch }) !== account.sessionIdentity
    || modelAccountFingerprint(companyId, { provider: "openai", subscriptionId: account.subscriptionId, sessionIdentity: account.sessionIdentity }) !== profile.accountFingerprint) {
    throw conflict("The selected account or credential generation changed after this execution");
  }
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, run.issueId))).for("share");
  if (!task) throw notFound("Qualification task not found");
  let review: typeof issueExecutionDecisions.$inferSelect | undefined;
  let nativeReview: typeof issueThreadInteractions.$inferSelect | undefined;
  let nativeReviewDecision: typeof statusDecisions.$inferSelect | undefined;
  if (nativeReviewInteractionId) {
    [nativeReview] = await db.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, task.id),
      eq(issueThreadInteractions.id, nativeReviewInteractionId), eq(issueThreadInteractions.sourceRunId, run.id))).for("share");
    const target = record(record(nativeReview?.payload).target);
    [nativeReviewDecision] = typeof target.revisionId === "string" ? await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId, companyId),
      eq(statusDecisions.issueId, task.id), eq(statusDecisions.id, target.revisionId), eq(statusDecisions.runId, run.id))).for("share") : [];
    if (!nativeReview || task.status !== "done" || nativeReview.kind !== "request_confirmation" || nativeReview.status !== "accepted"
      || target.type !== "custom" || target.key !== "native_completion_review" || !nativeReviewDecision || nativeReviewDecision.applicationState !== "applied"
      || !nativeReview.resolvedAt || nativeReview.resolvedAt < run.finishedAt || nativeReview.resolvedAt > new Date()
      || nativeReview.resolvedByAgentId === run.agentId || (!nativeReview.resolvedByAgentId && !nativeReview.resolvedByUserId)) {
      throw conflict("An independent accepted native review bound to this exact execution is required");
    }
    if (nativeReview.resolvedByAgentId) {
      const [reviewRun] = nativeReview.resolvedByRunId ? await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, nativeReview.resolvedByRunId),
        eq(heartbeatRuns.agentId, nativeReview.resolvedByAgentId), eq(heartbeatRuns.nativeIssueId, task.id))).for("share") : [];
      if (!reviewRun || reviewRun.status !== "succeeded" || reviewRun.contextSnapshot?.nativeReviewInteractionId !== nativeReview.id
        || reviewRun.contextSnapshot?.nativeReviewDecisionId !== nativeReviewDecision.id) throw conflict("The independent native review execution is incomplete");
    }
  }
  if (reviewDecisionId) {
    [review] = await db.select().from(issueExecutionDecisions).where(and(eq(issueExecutionDecisions.companyId, companyId), eq(issueExecutionDecisions.issueId, task.id), eq(issueExecutionDecisions.id, reviewDecisionId))).for("share");
    const completed = record(task.executionState).completedStageIds;
    if (!review || task.status !== "done" || review.stageType !== "review" || review.outcome !== "approved" || !review.body.trim()
      || review.createdAt < run.finishedAt || review.createdAt > new Date() || review.actorAgentId === run.agentId
      || (!review.actorAgentId && !review.actorUserId) || !Array.isArray(completed) || !completed.includes(review.stageId)) {
      throw conflict("An independent accepted native review of this task is required");
    }
  }
  if (review || nativeReview) {
    const later = await db.select({ id: heartbeatRuns.id, profile: heartbeatRuns.runnerProfileJson, context: heartbeatRuns.contextSnapshot }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.issueId, task.id), gt(heartbeatRuns.createdAt, run.createdAt))).limit(101);
    // Native review-only runs are bound to the exact source. A later ordinary
    // run by any employee may have replaced its output and invalidates proof.
    const isBoundReview = (candidate: typeof later[number]) => {
      const receipt = record(candidate.profile?.nativeReviewContextReceipt), references = record(receipt.references);
      return receipt.schema === "agentos.native-review-context-receipt.v1" && receipt.companyId === companyId && receipt.issueId === task.id
        && receipt.reviewerRunId === candidate.id && references.sourceRunId === run.id
        && references.reviewInteractionId === candidate.context?.nativeReviewInteractionId
        && references.sourceDecisionId === candidate.context?.nativeReviewDecisionId;
    };
    if (later.length > 100 || later.some(candidate => !isBoundReview(candidate))) throw conflict("A later implementation attempt superseded this reviewed execution");
  }
  return { run, agent, task, profile, observation, review, nativeReview,
    fingerprint: modelProfileDigest({ profile, runId: run.id, finishedAt: run.finishedAt.toISOString(), observation,
      usage: usage.map(row => ({ id: row.id, model: row.model, provider: row.provider, subscriptionId: row.subscriptionId, billingType: row.billingType,
        inputTokens: row.inputTokens, outputTokens: row.outputTokens })).sort((a, b) => a.id.localeCompare(b.id)),
      review: review ? { id: review.id, stageId: review.stageId, body: review.body, outcome: review.outcome, actorAgentId: review.actorAgentId, actorUserId: review.actorUserId, updatedAt: review.updatedAt.toISOString() } : null,
      nativeReview: nativeReview ? { id: nativeReview.id, sourceRunId: nativeReview.sourceRunId, resolvedAt: nativeReview.resolvedAt!.toISOString(),
        resolvedByAgentId: nativeReview.resolvedByAgentId, resolvedByUserId: nativeReview.resolvedByUserId, resolvedByRunId: nativeReview.resolvedByRunId,
        result: nativeReview.result, decisionId: nativeReviewDecision!.id, applicationState: nativeReviewDecision!.applicationState } : null }) };
}

function publicQualification(row: Qualification, stale = false): ModelProfileQualification {
  return { id: row.id, agentId: row.agentId, runId: row.runId, issueId: row.issueId, reviewDecisionId: row.reviewDecisionId,
    nativeReviewInteractionId: row.nativeReviewInteractionId,
    state: row.revokedAt ? "revoked" : stale || row.validUntil <= new Date() ? "stale" : row.state, profile: row.profile,
    observedProviderVersion: row.observedProviderVersion, observedModel: row.observedModel, observedEffort: row.observedEffort,
    observedAt: row.observedAt.toISOString(), validUntil: row.validUntil.toISOString(), qualifiedByUserId: row.qualifiedByUserId,
    evidenceScope: "completed_native_session" };
}

export function modelProfileQualificationService(db: Db) {
  return {
    async hasCandidates(companyId: string, agentId: string, profile: ModelProfileBinding) {
      if (profile.complexity !== "routine") return false;
      const [row] = await db.select({ id: qualifications.id }).from(qualifications).where(and(eq(qualifications.companyId, companyId), eq(qualifications.agentId, agentId),
        eq(qualifications.accountFingerprint, profile.accountFingerprint), eq(qualifications.state, "workflow_qualified"), isNull(qualifications.revokedAt), gt(qualifications.validUntil, new Date()),
        sql`${qualifications.profile}->>'taskType' = ${profile.taskType}`, sql`${qualifications.profile}->>'promptFingerprint' = ${profile.promptFingerprint}`,
        sql`${qualifications.profile}->>'configurationFingerprint' = ${profile.configurationFingerprint}`)).limit(1);
      return Boolean(row);
    },
    async register(companyId: string, actor: AuthorizationActor, raw: RegisterModelProfileQualification) {
      const input = registerModelProfileQualificationSchema.parse(raw);
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`model-qualification:${companyId}:${input.requestKey}`}, 0))`);
        const userId = await owner(tx, actor, companyId);
        const evidence = await readEvidence(tx, companyId, input.runId, input.reviewDecisionId, input.nativeReviewInteractionId);
        const access = await authorizationService(tx).decide({ actor, action: "issue:read", resource: { type: "issue", companyId, issueId: evidence.task.id } });
        if (!access.allowed) throw notFound("Qualification task not found");
        const requestFingerprint = modelProfileDigest(input);
        const [prior] = await tx.select().from(qualifications).where(and(eq(qualifications.companyId, companyId), eq(qualifications.requestKey, input.requestKey))).for("update");
        if (prior) {
          if (prior.requestFingerprint !== requestFingerprint || prior.evidenceFingerprint !== evidence.fingerprint) throw conflict("This qualification request key names different evidence");
          return { row: prior, created: false, publication: null };
        }
        const validUntil = new Date(input.validUntil);
        // Explicit finite evidence lifetime, bounded to one month; never an
        // indefinite assertion about subscription entitlement or answer quality.
        if (validUntil <= new Date() || validUntil.getTime() > evidence.run.finishedAt!.getTime() + 30 * 86_400_000) throw conflict("Choose an evidence expiry within thirty days of the execution");
        const [row] = await tx.insert(qualifications).values({ companyId, agentId: evidence.agent.id, runId: evidence.run.id, issueId: evidence.task.id,
          requestKey: input.requestKey, requestFingerprint, reviewDecisionId: evidence.review?.id ?? null,
          nativeReviewInteractionId: evidence.nativeReview?.id ?? null,
          state: evidence.review || evidence.nativeReview ? "workflow_qualified" : "access_verified", accountFingerprint: evidence.profile.accountFingerprint,
          profile: evidence.profile, evidenceFingerprint: evidence.fingerprint, observedProviderVersion: evidence.observation.cliVersion,
          observedModel: evidence.observation.model, observedEffort: evidence.observation.reasoningEffort, observedAt: evidence.run.finishedAt!,
          validUntil, qualifiedByUserId: userId }).returning();
        const { publication } = await persistActivity(tx, { companyId, actorType: "user", actorId: userId, action: "model_profile.qualified",
          entityType: "model_profile_qualification", entityId: row.id, issueId: row.issueId,
          details: { runId: row.runId, reviewDecisionId: row.reviewDecisionId, nativeReviewInteractionId: row.nativeReviewInteractionId, state: row.state, model: row.profile.model, validUntil: row.validUntil.toISOString() } });
        return { row, created: true, publication };
      });
      if (result.publication) publishActivity(result.publication);
      return { created: result.created, qualification: publicQualification(result.row) };
    },
    async list(companyId: string, actor: AuthorizationActor): Promise<ModelProfileQualificationList> {
      return db.transaction(async connection => {
        const tx = connection as unknown as Db;
        await owner(tx, actor, companyId);
        const rows = await tx.select().from(qualifications).where(eq(qualifications.companyId, companyId)).orderBy(desc(qualifications.createdAt)).limit(100);
        // Bounded, on-demand evidence discovery. This reads native receipts;
        // it never launches a probe, acquires credentials, or evaluates prose.
        const recent = await tx.select({ id: heartbeatRuns.id, issueId: heartbeatRuns.issueId }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.status, "succeeded"),
            gt(heartbeatRuns.finishedAt, new Date(Date.now() - 30 * 86_400_000)), sql`${heartbeatRuns.contextSnapshot}->'modelProfileBinding' is not null`))
          .orderBy(desc(heartbeatRuns.finishedAt)).limit(20);
        const availableEvidence: ModelProfileQualificationEvidence[] = [];
        const evidenceMemo = new Map<string, Promise<Evidence | null>>();
        const evidenceFor = (runId: string, reviewId?: string | null, interactionId?: string | null) => {
          const key = `${runId}:${reviewId ?? ""}:${interactionId ?? ""}`;
          let result = evidenceMemo.get(key);
          if (!result) { result = readEvidence(tx, companyId, runId, reviewId, interactionId).catch(ineligibleEvidence); evidenceMemo.set(key, result); }
          return result;
        };
        for (const run of recent) {
          const [interaction] = await tx.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId),
            eq(issueThreadInteractions.sourceRunId, run.id), eq(issueThreadInteractions.status, "accepted"),
            sql`${issueThreadInteractions.payload} #>> '{target,key}' = 'native_completion_review'`)).orderBy(desc(issueThreadInteractions.resolvedAt)).limit(1);
          const [review] = run.issueId ? await tx.select({ id: issueExecutionDecisions.id }).from(issueExecutionDecisions).where(and(eq(issueExecutionDecisions.companyId, companyId),
            eq(issueExecutionDecisions.issueId, run.issueId), eq(issueExecutionDecisions.stageType, "review"), eq(issueExecutionDecisions.outcome, "approved")))
            .orderBy(desc(issueExecutionDecisions.createdAt)).limit(1) : [];
          const evidence = (interaction ? await evidenceFor(run.id, null, interaction.id) : null)
            ?? await evidenceFor(run.id, review?.id) ?? (review ? await evidenceFor(run.id) : null);
          if (!evidence) continue;
          availableEvidence.push({ runId: run.id, issueId: evidence.task.id, issueIdentifier: evidence.task.identifier, issueTitle: evidence.task.title,
            agentId: evidence.agent.id, agentName: evidence.agent.name, model: evidence.profile.model, reviewDecisionId: evidence.review?.id ?? null,
            nativeReviewInteractionId: evidence.nativeReview?.id ?? null,
            state: evidence.review || evidence.nativeReview ? "workflow_qualified" : "access_verified", observedAt: evidence.run.finishedAt!.toISOString(),
            maximumValidUntil: new Date(evidence.run.finishedAt!.getTime() + 30 * 86_400_000).toISOString() });
        }
        const projected: ModelProfileQualification[] = [];
        for (const row of rows) {
          const evidence = row.revokedAt || row.validUntil <= new Date() ? null : await evidenceFor(row.runId, row.reviewDecisionId, row.nativeReviewInteractionId);
          projected.push(publicQualification(row, !evidence || evidence.fingerprint !== row.evidenceFingerprint));
        }
        return { qualifications: projected, availableEvidence, limit: 100, evidenceLimit: 20 };
      });
    },
    async revoke(companyId: string, id: string, actor: AuthorizationActor) {
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const userId = await owner(tx, actor, companyId);
        const [prior] = await tx.select().from(qualifications).where(and(eq(qualifications.companyId, companyId), eq(qualifications.id, id))).for("update");
        if (!prior) throw notFound("Model qualification not found");
        if (prior.revokedAt) return { row: prior, publication: null };
        const [row] = await tx.update(qualifications).set({ revokedAt: new Date(), revokedByUserId: userId }).where(eq(qualifications.id, id)).returning();
        const { publication } = await persistActivity(tx, { companyId, actorType: "user", actorId: userId, action: "model_profile.revoked",
          entityType: "model_profile_qualification", entityId: row.id, issueId: row.issueId, details: { runId: row.runId } });
        return { row, publication };
      });
      if (result.publication) publishActivity(result.publication);
      return publicQualification(result.row);
    },
    async candidates(input: { companyId: string; agentId: string; profile: ModelProfileBinding; cliVersion: string }) {
      if (input.profile.complexity !== "routine") return [];
      const rows = await db.select().from(qualifications).where(and(eq(qualifications.companyId, input.companyId), eq(qualifications.agentId, input.agentId),
        eq(qualifications.accountFingerprint, input.profile.accountFingerprint), eq(qualifications.state, "workflow_qualified"), isNull(qualifications.revokedAt), gt(qualifications.validUntil, new Date())))
        .orderBy(desc(qualifications.createdAt)).limit(20);
      const eligible: Qualification[] = [];
      for (const row of rows) {
        if ((!row.reviewDecisionId && !row.nativeReviewInteractionId) || row.observedProviderVersion !== input.cliVersion || !sameModelProfileScope(row.profile, input.profile)) continue;
        const evidence: Evidence | null = await readEvidence(db, input.companyId, row.runId, row.reviewDecisionId, row.nativeReviewInteractionId).catch(ineligibleEvidence);
        if (!evidence || evidence.fingerprint !== row.evidenceFingerprint) continue;
        // A newer rejection invalidates the model's old access proof. Never
        // search past it to resurrect an earlier successful account attempt.
        const [failure] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId),
          gt(heartbeatRuns.createdAt, evidence.run.createdAt), sql`${heartbeatRuns.errorCode} in ('native_provider_model_rejected','ai_auth_required','authentication_failed')`,
          sql`${heartbeatRuns.contextSnapshot} #>> '{modelProfileBinding,accountFingerprint}' = ${row.accountFingerprint}`,
          sql`${heartbeatRuns.contextSnapshot} #>> '{modelProfileBinding,model}' = ${row.profile.model}`)).limit(1);
        if (!failure && !eligible.some(prior => prior.profile.model === row.profile.model)) eligible.push(row);
      }
      return eligible;
    },
  };
}
