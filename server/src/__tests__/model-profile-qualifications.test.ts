import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, aiSubscriptions, aiSubscriptionConnections, authUsers, companies, companyMemberships, companyOperatingProfiles,
  companySecrets, connectionGrants, costEvents, createDb, heartbeatRunEvents, heartbeatRuns, instanceUserRoles, issueExecutionDecisions, issueThreadInteractions,
  completionContracts, nativeRunResults, workAssessments, statusDecisions, issues, modelProfileQualifications } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { evaluateModelRun, modelIntelligenceProduct, selectCompanyModelProfile } from "../services/model-intelligence.js";
import { modelProfileCandidateId } from "../services/model-profile-binding.js";
import { companyService } from "../services/companies.js";
import { modelProfileQualificationService } from "../services/model-profile-qualifications.js";
import { managedAiSessionIdentity } from "../services/ai-connection-session.js";
import { fridayRoutes } from "../routes/friday.js";
import { errorHandler } from "../middleware/index.js";
import { unprocessable } from "../errors.js";
import { DEFAULT_MODEL_ROUTING_LIMITS } from "@paperclipai/shared";
import { modelComparisonProfile, modelComparisonVariantForModel } from "../services/model-comparison-scope.js";
import { modelRoutingService } from "../services/model-routing.js";
import { createIsolatedTestHome } from "./helpers/isolated-test-home.js";

vi.mock("../services/subscription-refresh.js", () => ({ refreshSubscriptionConnection: vi.fn().mockResolvedValue(undefined) }));

describe("native current-account model profile qualification", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, home: string;
  let isolatedHome: ReturnType<typeof createIsolatedTestHome>;
  beforeAll(async () => {
    isolatedHome = createIsolatedTestHome(); home = isolatedHome.home;
    vi.stubEnv("PAPERCLIP_HOME", home); vi.stubEnv("PAPERCLIP_INSTANCE_ID", "model-qualification-fixture");
    vi.stubEnv("AGENTOS_MODEL_INTELLIGENCE_DB", join(home, "learning.sqlite"));
    database = await startEmbeddedPostgresTestDatabase("agentos-model-qualification-"); db = createDb(database.connectionString);
  }, 60000);
  afterAll(async () => { await modelIntelligenceProduct()?.close(); await db?.$client.end(); await database?.cleanup(); vi.unstubAllEnvs(); isolatedHome?.cleanup(); });

  async function fixture() {
    const userId = randomUUID(), companyId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Qualification owner", email: `${userId}@example.test`, approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    await db.insert(companies).values({ id: companyId, name: "Qualified models", issuePrefix: `QM${companyId.slice(0, 5)}` });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const [agent, reviewer] = await db.insert(agents).values(["Implementer", "Independent reviewer"].map(name => ({ companyId, name, adapterType: "paperclip_runner", status: "idle", lifecycleState: "ready",
      adapterConfig: { provider: "codex", model: "gpt-6-astra", modelReasoningEffort: "high", homeMode: "isolated" } }))).returning();
    await db.insert(companyOperatingProfiles).values({ companyId, fridayAgentId: agent.id });
    const connection = await aiConnectionService(db).save(companyId, userId, { provider: "openai", method: "subscription", ownership: "personal", name: "Fixture subscription", loginSessionId: "fixture", agentIds: [], allAgents: true }, JSON.stringify({ tokens: { account_id: userId, access_token: "fixture-only", refresh_token: "fixture-only" } }));
    const [grant] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, connection.grantId));
    const secretId = grant.credentialSecretRefs[0].secretId;
    const [subscription] = await db.insert(aiSubscriptions).values({ companyId, provider: "openai", accountKey: userId, name: "Fixture seat" }).returning();
    await db.insert(aiSubscriptionConnections).values({ companyId, ...connection, credentialKey: "fixture", subscriptionId: subscription.id });
    const binding = { mode: "delegated", provider: "openai", method: "subscription", ...connection } as const;
    const attribution = { ...connection, mode: "delegated", provider: "openai", method: "subscription", responsibleUserId: userId, subscriptionId: subscription.id } as const;
    const sessionIdentity = managedAiSessionIdentity(grant.id, userId, { secretId, epoch: 0 });
    const account = { attribution, sessionIdentity, assertCurrent: vi.fn(async () => {}), readRuntimeIdentity: vi.fn(async () => ({ cliVersion: "0.160.0" })) };
    const stageId = randomUUID();
    const [task] = await db.insert(issues).values({ companyId, title: "Classify support tickets", description: "Triage the supplied tickets", status: "done", responsibleUserId: userId,
      executionState: { status: "completed", completedStageIds: [stageId] } }).returning();
    const started = new Date(Date.now() - 5000), finished = new Date(Date.now() - 3000);
    const runId = randomUUID(), instanceId = randomUUID();
    const native = { schema: "paperclip.native-execution-input.v9", homeMode: "isolated", binding: { companyId, agentId: agent.id, issueId: task.id, runId },
      task: { title: task.title, description: task.description, workMode: "standard" },
      provider: { kind: "codex", model: "gpt-6.1-sol", reasoningEffort: "high" } };
    const [run] = await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId: agent.id, issueId: task.id, nativeIssueId: task.id, runtimeMode: "native", status: "succeeded",
      runnerInstanceId: instanceId, startedAt: started, finishedAt: finished, createdAt: started, costAccountedAt: finished,
      usageJson: { accountingReceiptReady: true }, contextSnapshot: { aiConnection: { ...attribution, sessionIdentity } }, runnerProfileJson: { nativeExecutionInput: native } }).returning();
    const selected = await selectCompanyModelProfile(db, { runId, issueId: task.id, agent, config: { ...agent.adapterConfig, model: "gpt-6.1-sol" }, binding, resumed: false, account });
    await db.insert(costEvents).values({ companyId, agentId: agent.id, heartbeatRunId: run.id, subscriptionId: subscription.id,
      provider: "openai", model: "gpt-6.1-sol", billingType: "subscription_included", outputTokens: 20, inputTokens: 40, costCents: 0, occurredAt: finished });
    const observation = { cliVersion: "0.160.0", model: "gpt-6.1-sol", reasoningEffort: "high", source: "thread/start" };
    const event = { runId: run.id, sourceInstanceId: instanceId, sourceEventId: randomUUID(), sourceSeq: 1, eventType: "session.started", payload: { providerDescriptor: { observedCodexIdentity: observation } } };
    const [sessionEvent] = await db.insert(heartbeatRunEvents).values({ companyId, runId: run.id, agentId: agent.id, seq: 1, eventType: "session.started", sourceInstanceId: instanceId,
      sourceEventId: event.sourceEventId, sourceSeq: 1, sourcePayloadSha256: "a".repeat(64), protocolSchemaVersion: 2, payload: { prpEvent: event } }).returning();
    const [review] = await db.insert(issueExecutionDecisions).values({ companyId, issueId: task.id, stageId, stageType: "review", outcome: "approved", body: "Independent acceptance checks passed", actorAgentId: reviewer.id }).returning();
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId, isInstanceAdmin: true, companyIds: [companyId] };
    const api = express(); api.use(express.json()); api.use((req, _res, next) => { req.actor = actor; next(); }); api.use("/api", fridayRoutes(db)); api.use(errorHandler);
    const path = `/api/companies/${companyId}/friday/model-qualifications`;
    const input = { requestKey: randomUUID(), runId: run.id, validUntil: new Date(Date.now() + 86400000).toISOString() };
    const service = modelProfileQualificationService(db);
    const candidateInput = { companyId, agentId: agent.id, profile: { ...selected.profileBinding!, model: "gpt-6-astra" }, cliVersion: "0.160.0" };
    return { companyId, agent, reviewer, userId, actor, api, path, input, run, task, native, binding, account, secretId, connection, selected, review, service, candidateInput, sessionEvent, event };
  }
  async function nextSelectionInput(f: Awaited<ReturnType<typeof fixture>>, config = f.agent.adapterConfig) {
    const [task] = await db.insert(issues).values({ companyId: f.companyId, title: f.task.title, description: f.task.description, responsibleUserId: f.userId }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agent.id, issueId: task.id,
      contextSnapshot: { aiConnection: { ...f.account.attribution, sessionIdentity: f.account.sessionIdentity } } }).returning();
    return { runId: run.id, issueId: task.id, agent: f.agent, config, binding: f.binding, resumed: false, account: f.account };
  }
  it("separates access evidence from reviewed workflow qualification and makes retries immutable", async () => {
    const f = await fixture();
    const access = await request(f.api).post(f.path).send(f.input).expect(201);
    expect(access.body.qualification).toMatchObject({ state: "access_verified", observedModel: "gpt-6.1-sol", observedProviderVersion: "0.160.0" });
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    const reviewed = { ...f.input, requestKey: randomUUID(), reviewDecisionId: f.review.id };
    const results = await Promise.all([request(f.api).post(f.path).send(reviewed), request(f.api).post(f.path).send(reviewed)]);
    expect(results.map(row => row.status).sort()).toEqual([200, 201]);
    expect(results[0].body.qualification.id).toBe(results[1].body.qualification.id);
    expect(await f.service.candidates(f.candidateInput)).toHaveLength(1);
    await request(f.api).post(f.path).send({ ...reviewed, validUntil: new Date(Date.now() + 100000).toISOString() }).expect(409);
    await request(f.api).delete(`${f.path}/${results[0].body.qualification.id}`).expect(200);
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    expect((await request(f.api).get(f.path).expect(200)).body.qualifications.map((row: { state: string }) => row.state)).toContain("revoked");
  });
  it("rejects missing provider proof, paid accounting, self review, revoked grants and changed credential generations", async () => {
    const f = await fixture(), reviewed = { ...f.input, reviewDecisionId: f.review.id };
    await db.update(heartbeatRunEvents).set({ payload: { prpEvent: { ...f.event, payload: { providerDescriptor: { effectiveModel: "gpt-6.1-sol", providerVersion: "codex-app-server-v1" } } } } }).where(eq(heartbeatRunEvents.id, f.sessionEvent.id));
    await request(f.api).post(f.path).send(reviewed).expect(409);
    await db.update(heartbeatRunEvents).set({ payload: { prpEvent: f.event } }).where(eq(heartbeatRunEvents.id, f.sessionEvent.id));
    for (const workMode of ["ask", "planning", "skill_test"]) {
      await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: { ...f.native, task: { ...f.native.task, workMode } } } }).where(eq(heartbeatRuns.id, f.run.id));
      await request(f.api).post(f.path).send(reviewed).expect(409);
    }
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: f.native } }).where(eq(heartbeatRuns.id, f.run.id));
    await db.update(costEvents).set({ billingType: "metered_api" }).where(eq(costEvents.heartbeatRunId, f.run.id));
    await request(f.api).post(f.path).send(reviewed).expect(409);
    await db.update(costEvents).set({ billingType: "subscription_included" }).where(eq(costEvents.heartbeatRunId, f.run.id));
    await db.update(issueExecutionDecisions).set({ actorAgentId: f.agent.id }).where(eq(issueExecutionDecisions.id, f.review.id));
    await request(f.api).post(f.path).send(reviewed).expect(409);
    await db.update(issueExecutionDecisions).set({ actorAgentId: f.reviewer.id }).where(eq(issueExecutionDecisions.id, f.review.id));
    await request(f.api).post(f.path).send(reviewed).expect(201);
    await db.update(companySecrets).set({ aiSessionEpoch: 1 }).where(eq(companySecrets.id, f.secretId));
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    await request(f.api).post(f.path).send(reviewed).expect(409);
    await db.update(companySecrets).set({ aiSessionEpoch: 0 }).where(eq(companySecrets.id, f.secretId));
    await db.update(connectionGrants).set({ status: "revoked" }).where(eq(connectionGrants.id, f.connection.grantId));
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
  });
  it("binds task family, exact configuration, runtime identity and later failures without learning from a process exit", async () => {
    const f = await fixture();
    await f.service.register(f.companyId, f.actor, { ...f.input, reviewDecisionId: f.review.id });
    for (const change of [{ taskType: "other" }, { promptFingerprint: "changed" }, { requestedEffort: "low" }, { configurationFingerprint: "changed" }, { accountFingerprint: "changed" }, { complexity: "complex" as const }]) {
      expect(await f.service.candidates({ ...f.candidateInput, profile: { ...f.candidateInput.profile, ...change } })).toEqual([]);
    }
    expect(await f.service.candidates({ ...f.candidateInput, cliVersion: "0.161.0" })).toEqual([]);
    await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agent.id, issueId: f.task.id, status: "failed", errorCode: "native_provider_model_rejected",
      contextSnapshot: { modelProfileBinding: f.selected.profileBinding } });
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    expect(modelIntelligenceProduct()!.analytics(f.companyId).counts.evaluations).toBe(0);
  });
  it("only offers alternatives after managed-account admission and retains the configured default without quality evidence", async () => {
    const f = await fixture();
    await f.service.register(f.companyId, f.actor, { ...f.input, reviewDecisionId: f.review.id });
    const next = async () => {
      const [task] = await db.insert(issues).values({ companyId: f.companyId, title: f.task.title, description: f.task.description, responsibleUserId: f.userId }).returning();
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agent.id, issueId: task.id }).returning();
      return { runId: run.id, issueId: task.id, agent: f.agent, config: f.agent.adapterConfig, binding: f.binding, resumed: false };
    };
    const unbound = await selectCompanyModelProfile(db, await next());
    expect(unbound.request?.candidates.map(row => row.model)).toEqual(["gpt-6-astra"]);
    const admitted = await selectCompanyModelProfile(db, { ...await next(), account: f.account });
    expect(admitted.request?.candidates.map(row => row.model)).toEqual(["gpt-6-astra", "gpt-6.1-sol"]);
    expect(admitted.config.model).toBe("gpt-6-astra");
    expect(f.account.assertCurrent).toHaveBeenCalledWith({ model: "gpt-6.1-sol" });
    expect(admitted.qualification).toBeUndefined();
    await db.update(companyMemberships).set({ status: "revoked" }).where(and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId)));
    await request(f.api).get(f.path).expect(403);
    await request(f.api).post(f.path).send({ ...f.input, requestKey: randomUUID() }).expect(403);
    expect(await db.select().from(modelProfileQualifications).where(eq(modelProfileQualifications.companyId, f.companyId))).toHaveLength(1);
  });
  it("routes a reviewed efficient profile only through an enrolled qualified release and rechecks revocation before dispatch", async () => {
    const f = await fixture();
    const qualification = await f.service.register(f.companyId, f.actor, { ...f.input, reviewDecisionId: f.review.id });
    const engine = modelIntelligenceProduct()!;
    const initial = await selectCompanyModelProfile(db, await nextSelectionInput(f));
    expect(initial.config.model).toBe("gpt-6-astra");
    const fast = initial.request!.candidates.find(row => row.model === "gpt-6.1-sol")!;
    const strong = initial.request!.candidates.find(row => row.model === "gpt-6-astra")!;
    expect(fast.id).not.toBe(f.selected.receipt!.candidate.id);
    expect(initial.learningScope).toBeDefined();
    // Account, effort, runtime, configuration and task family cannot borrow
    // comparative outcomes even when the human-facing model name is unchanged.
    const scope = initial.learningScope!;
    for (const change of [{ accountFingerprint: "replacement" }, { configurationFingerprint: "changed" }, { requestedEffort: "low" }, { taskType: "other" }, { complexity: "complex" as const }, { promptFingerprint: "changed" }]) {
      expect(modelProfileCandidateId("codex_local", fast.model, scope.profile.promptFingerprint, { ...scope, profile: { ...scope.profile, ...change } })).not.toBe(fast.id);
    }
    expect(modelProfileCandidateId("codex_local", fast.model, scope.profile.promptFingerprint, { ...scope, cliVersion: "0.161.0" })).not.toBe(fast.id);
    // Controlled policy evidence in the disposable independent store. These
    // examples never replace the separate native qualification receipt.
    for (const candidate of [strong, fast]) for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      engine.select({ namespace: f.companyId, requestId: id, taskKey: id, taskType: f.candidateInput.profile.taskType, complexity: "routine",
        defaultCandidateId: candidate.id, candidates: [{ ...candidate, available: true }], promptFingerprint: f.candidateInput.profile.promptFingerprint });
      engine.evaluate({ namespace: f.companyId, id, receiptId: id, passed: true, iterations: 1, latencyMs: candidate === fast ? 400 : 1000,
        source: "checks", evaluator: "controlled-fixture", evidenceRef: `fixture:${id}` });
    }
    // Legacy examples remain observable but cannot authorize an alternative.
    expect((await selectCompanyModelProfile(db, await nextSelectionInput(f))).config.model).toBe("gpt-6-astra");
    const baseline = await modelComparisonProfile(db, f.agent, f.agent.adapterConfig, scope.profile.accountFingerprint, scope.cliVersion);
    const candidate = modelComparisonVariantForModel(baseline, "gpt-6.1-sol", scope.profile.accountFingerprint);
    const comparisonId = randomUUID(), datasetId = randomUUID();
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const cases = Array.from({ length: 5 }, (_, index) => ({ id: `fixture-${index}`, split: "holdout" as const,
      inputDigest: sha(`input-${comparisonId}-${index}`), checkDigest: sha(`check-${comparisonId}-${index}`), sourceRef: `fixture:${index}` }));
    await engine.registerDataset({ namespace: f.companyId, id: datasetId, version: "1", taskFamily: scope.profile.taskType,
      taskFamilyVersion: "1", complexity: "routine", provenance: "observed", cases });
    await engine.registerComparison({ namespace: f.companyId, id: comparisonId, datasetId, datasetVersion: "1", dimension: "model", baseline, candidate,
      thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } });
    // Controlled host-attested outcomes test the policy mechanics only. They
    // are never presented as actual provider evaluations outside this fixture.
    for (const item of cases) for (const arm of ["baseline", "candidate"] as const) {
      const profile = arm === "baseline" ? baseline : candidate, id = `${comparisonId}:${item.id}:${arm}`;
      await engine.select({ namespace: f.companyId, requestId: id, taskKey: id, taskType: scope.profile.taskType, complexity: "routine", defaultCandidateId: profile.profileId,
        candidates: [{ id: profile.profileId, model: profile.model, provider: profile.provider, method: "subscription", available: true }],
        promptFingerprint: profile.promptFingerprint, contextFingerprint: profile.contextFingerprint });
      await engine.recordComparisonOutcome({ namespace: f.companyId, id, comparisonId, caseId: item.id, arm, attempt: 1, receiptId: id,
        inputDigest: item.inputDigest, checkDigest: item.checkDigest, observedVariant: profile, provenance: "observed", outcome: "passed", terminal: true,
        iterations: 1, latencyMs: arm === "baseline" ? 1000 : 400, source: "checks", evaluator: "controlled-fixture", evidenceRef: `fixture:${id}` });
    }
    await modelRoutingService(db).configure(f.companyId, f.actor, { requestKey: randomUUID(), taskType: scope.profile.taskType, expectedRevision: 0,
      mode: "automatic", pinnedReleaseId: null, limits: DEFAULT_MODEL_ROUTING_LIMITS, reason: "Exercise account qualification during an enrolled canary" });
    const release = (await engine.routingRollouts({ namespace: f.companyId, taskType: scope.profile.taskType })).releases[0];
    expect(release?.state).toBe("canary");
    let taskId = "";
    for (let index = 0; index < 10000; index++) {
      const id = randomUUID();
      if (Number.parseInt(sha(JSON.stringify([release.id, `${id}:${f.agent.id}`])).slice(0, 8), 16) % 100 < release.limits.canaryPercent) { taskId = id; break; }
    }
    expect(taskId).not.toBe("");
    const [task] = await db.insert(issues).values({ id: taskId, companyId: f.companyId, title: f.task.title, description: f.task.description, responsibleUserId: f.userId }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agent.id, issueId: task.id }).returning();
    const selected = await selectCompanyModelProfile(db, { runId: run.id, issueId: task.id, agent: f.agent, config: f.agent.adapterConfig, binding: f.binding, resumed: false, account: f.account });
    expect(selected.config.model).toBe("gpt-6.1-sol");
    expect(selected.receipt?.rollout).toMatchObject({ releaseId: release.id, phase: "canary", arm: "candidate" });
    expect(selected.qualification).toEqual({ id: qualification.qualification.id, cliVersion: "0.160.0", model: "gpt-6.1-sol" });
    await expect(selected.assertQualificationCurrent?.()).resolves.toBeUndefined();
    await f.service.revoke(f.companyId, qualification.qualification.id, f.actor);
    await expect(selected.assertQualificationCurrent?.()).rejects.toThrow("qualification changed");
    await expect(selectCompanyModelProfile(db, { runId: run.id, issueId: task.id, agent: f.agent, config: f.agent.adapterConfig, binding: f.binding, resumed: false, account: f.account })).rejects.toThrow("queued execution profile changed");
  });
  it("trains scoped baseline outcomes only after matching durable native runtime and account observations", async () => {
    const f = await fixture();
    await f.service.register(f.companyId, f.actor, { ...f.input, reviewDecisionId: f.review.id });
    const input = await nextSelectionInput(f), selected = await selectCompanyModelProfile(db, input);
    expect(selected.config.model).toBe("gpt-6-astra");
    expect(selected.qualification).toBeUndefined();
    const native = { schema: "paperclip.native-execution-input.v9", homeMode: "isolated",
      binding: { companyId: f.companyId, agentId: f.agent.id, issueId: input.issueId, runId: input.runId },
      task: { title: f.task.title, description: f.task.description, workMode: "standard" },
      provider: { kind: "codex", model: "gpt-6-astra", reasoningEffort: "high" } };
    await db.update(heartbeatRuns).set({ status: "succeeded", runtimeMode: "native", nativeIssueId: input.issueId,
      startedAt: new Date(Date.now() - 2000), finishedAt: new Date(), costAccountedAt: new Date(), usageJson: { accountingReceiptReady: true },
      runnerProfileJson: { nativeExecutionInput: native } }).where(eq(heartbeatRuns.id, input.runId));
    await db.insert(costEvents).values({ companyId: f.companyId, agentId: f.agent.id, heartbeatRunId: input.runId, subscriptionId: f.account.attribution.subscriptionId,
      provider: "openai", model: "gpt-6-astra", billingType: "subscription_included", outputTokens: 20, costCents: 0, occurredAt: new Date() });
    const feedback = () => evaluateModelRun(db, f.companyId, input.runId, { passed: true, evidenceRef: "review:controlled" }, { actorType: "user", actorId: f.userId, agentId: null, runId: null });
    await expect(feedback()).rejects.toThrow("completed native session");
    const event = { ...f.event, runId: input.runId, sourceEventId: randomUUID(), payload: { providerDescriptor: { observedCodexIdentity: { cliVersion: "0.161.0", model: "gpt-6-astra", reasoningEffort: "high", source: "thread/start" } } } };
    const [savedEvent] = await db.insert(heartbeatRunEvents).values({ companyId: f.companyId, runId: input.runId, agentId: f.agent.id, seq: 1, eventType: "session.started",
      sourceInstanceId: event.sourceInstanceId, sourceEventId: event.sourceEventId, sourceSeq: 1, sourcePayloadSha256: "b".repeat(64), protocolSchemaVersion: 2, payload: { prpEvent: event } }).returning();
    await expect(feedback()).rejects.toThrow("completed native session");
    event.payload.providerDescriptor.observedCodexIdentity.cliVersion = "0.160.0";
    await db.update(heartbeatRunEvents).set({ payload: { prpEvent: event } }).where(eq(heartbeatRunEvents.id, savedEvent.id));
    const [saved] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId));
    await db.update(heartbeatRuns).set({ contextSnapshot: { ...saved.contextSnapshot, aiConnection: { ...f.account.attribution, sessionIdentity: "different-account-epoch" } } }).where(eq(heartbeatRuns.id, input.runId));
    await expect(feedback()).rejects.toThrow("completed native session");
    expect(modelIntelligenceProduct()!.analytics(f.companyId).counts.evaluations).toBe(0);
    await db.update(heartbeatRuns).set({ contextSnapshot: saved.contextSnapshot }).where(eq(heartbeatRuns.id, input.runId));
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: { ...native, task: { ...native.task, title: "Architect a new platform" } } } }).where(eq(heartbeatRuns.id, input.runId));
    await expect(feedback()).rejects.toThrow("completed native session");
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: native }, contextSnapshot: { ...saved.contextSnapshot, nativeReviewInteractionId: randomUUID() } }).where(eq(heartbeatRuns.id, input.runId));
    await expect(feedback()).rejects.toThrow("completed native session");
    await db.update(heartbeatRuns).set({ contextSnapshot: saved.contextSnapshot }).where(eq(heartbeatRuns.id, input.runId));
    await expect(feedback()).resolves.toMatchObject({ passed: true });
    const override = await selectCompanyModelProfile(db, await nextSelectionInput(f, { ...f.agent.adapterConfig, model: "gpt-6.1-sol" }));
    expect(override.request?.candidates.map(row => row.model)).toEqual(["gpt-6.1-sol"]);
    expect(override.receipt?.candidate.id).toBe(selected.request?.candidates.find(row => row.model === "gpt-6.1-sol")?.id);
  });
  it("denies ordinary and foreign actors and invalidates expiry, edited review, changed profile and another employee's later implementation", async () => {
    const f = await fixture(), input = { ...f.input, reviewDecisionId: f.review.id };
    await expect(f.service.register(f.companyId, { type: "agent", companyId: f.companyId, agentId: f.agent.id }, input)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.register(randomUUID(), f.actor, input)).rejects.toMatchObject({ status: 403 });
    await request(f.api).post(f.path).send({ ...input, validUntil: new Date(Date.now() - 1000).toISOString() }).expect(409);
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.userId));
    await request(f.api).post(f.path).send(input).expect(403);
    await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
    const saved = await f.service.register(f.companyId, f.actor, input);
    await db.update(issueExecutionDecisions).set({ body: "Review changed" }).where(eq(issueExecutionDecisions.id, f.review.id));
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    await db.update(issueExecutionDecisions).set({ body: f.review.body }).where(eq(issueExecutionDecisions.id, f.review.id));
    await db.update(agents).set({ adapterConfig: { ...f.agent.adapterConfig, promptTemplate: "Changed instruction" } }).where(eq(agents.id, f.agent.id));
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    await db.update(agents).set({ adapterConfig: f.agent.adapterConfig }).where(eq(agents.id, f.agent.id));
    await db.update(modelProfileQualifications).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(modelProfileQualifications.id, saved.qualification.id));
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    await db.update(modelProfileQualifications).set({ validUntil: new Date(f.input.validUntil) }).where(eq(modelProfileQualifications.id, saved.qualification.id));
    await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.reviewer.id, issueId: f.task.id, nativeIssueId: f.task.id, status: "succeeded" });
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
    await request(f.api).post(f.path).send({ ...input, requestKey: randomUUID() }).expect(409);
  });
  it("skips a newly disallowed optional model while preserving baseline authority and frozen account identity", async () => {
    const f = await fixture();
    await f.service.register(f.companyId, f.actor, { ...f.input, reviewDecisionId: f.review.id });
    const [task] = await db.insert(issues).values({ companyId: f.companyId, title: f.task.title, description: f.task.description, responsibleUserId: f.userId }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agent.id, issueId: task.id }).returning();
    const account = { ...f.account, assertCurrent: vi.fn(async (profile?: { model: string }) => { if (profile?.model === "gpt-6.1-sol") throw unprocessable("Optional model policy changed"); }) };
    const input = { runId: run.id, issueId: task.id, agent: f.agent, config: f.agent.adapterConfig, binding: f.binding, resumed: false, account };
    const result = await selectCompanyModelProfile(db, input);
    expect(result.request?.candidates.map(row => row.model)).toEqual(["gpt-6-astra"]);
    expect(account.assertCurrent).toHaveBeenCalledWith({ model: "gpt-6-astra" });
    await expect(selectCompanyModelProfile(db, { ...input, account: { ...account, sessionIdentity: `${account.sessionIdentity}:replaced` } })).rejects.toThrow("account or profile changed");
  });
  it("qualifies the exact accepted native completion review and never borrows another execution's review", async () => {
    const f = await fixture(), contractId = randomUUID(), resultId = randomUUID(), assessmentId = randomUUID();
    await db.insert(completionContracts).values({ id: contractId, companyId: f.companyId, issueId: f.task.id, revision: 1,
      schemaVersion: "paperclip.completion-contract.v1", policyVersion: "fixture", risk: "standard", completionAuthority: "server_arbiter",
      incompleteCriteriaPolicy: "preserve_non_terminal", contractJson: {}, canonicalSha256: contractId, createdByActorType: "system", createdByActorId: "fixture" });
    await db.update(heartbeatRuns).set({ completionContractId: contractId }).where(eq(heartbeatRuns.id, f.run.id));
    await db.insert(nativeRunResults).values({ id: resultId, companyId: f.companyId, issueId: f.task.id, runId: f.run.id, completionContractId: contractId,
      serverFingerprint: resultId, schemaStatus: "accepted", resultJson: {}, canonicalSha256: resultId });
    await db.insert(workAssessments).values({ id: assessmentId, companyId: f.companyId, issueId: f.task.id, runId: f.run.id, contractId, resultId,
      triggerKind: "native_result", triggerActorCompanyId: f.companyId, priorIssueStatus: "in_progress", priorStatusVersion: 0,
      policyVersion: "fixture", assessmentJson: {}, inputDigest: assessmentId });
    const [decision] = await db.insert(statusDecisions).values({ companyId: f.companyId, issueId: f.task.id, runId: f.run.id, assessmentId,
      decisionVersion: 1, policyVersion: "fixture", fromStatus: "in_progress", toStatus: "in_review", reasonCode: "review_required",
      decisionJson: {}, decisionDigest: assessmentId, applicationState: "applied" }).returning();
    const [interaction] = await db.insert(issueThreadInteractions).values({ companyId: f.companyId, issueId: f.task.id, sourceRunId: f.run.id,
      kind: "request_confirmation", status: "accepted", resolvedAt: new Date(), resolvedByUserId: f.userId,
      payload: { version: 1, prompt: "Review completed work", target: { type: "custom", key: "native_completion_review", revisionId: decision.id } } }).returning();
    const registered = await request(f.api).post(f.path).send({ ...f.input, nativeReviewInteractionId: interaction.id }).expect(201);
    expect(registered.body.qualification).toMatchObject({ state: "workflow_qualified", nativeReviewInteractionId: interaction.id, reviewDecisionId: null });
    expect(await f.service.candidates(f.candidateInput)).toHaveLength(1);
    const listed = await f.service.list(f.companyId, f.actor);
    expect(listed.availableEvidence).toContainEqual(expect.objectContaining({ runId: f.run.id, nativeReviewInteractionId: interaction.id }));
    await db.update(issueThreadInteractions).set({ sourceRunId: null }).where(eq(issueThreadInteractions.id, interaction.id));
    expect(await f.service.candidates(f.candidateInput)).toEqual([]);
  });
  it("propagates an evidence database outage instead of reporting no qualified profiles", async () => {
    const f = await fixture();
    await f.service.register(f.companyId, f.actor, { ...f.input, reviewDecisionId: f.review.id });
    const unavailable = new Proxy(db, { get(target, key) {
      if (key !== "select") return Reflect.get(target, key);
      return (...args: Parameters<typeof db.select>) => {
        const query = db.select(...args), from = query.from.bind(query);
        query.from = ((table: unknown) => { if (table === heartbeatRuns) throw new Error("Fixture evidence database unavailable"); return from(table as never); }) as typeof query.from;
        return query;
      };
    } });
    await expect(modelProfileQualificationService(unavailable).candidates(f.candidateInput)).rejects.toThrow("Fixture evidence database unavailable");
  });
  it("removes qualification evidence through the native company deletion lifecycle", async () => {
    const f = await fixture();
    await f.service.register(f.companyId, f.actor, { ...f.input, reviewDecisionId: f.review.id });
    await db.update(agents).set({ lifecycleState: "terminated" }).where(eq(agents.companyId, f.companyId));
    await companyService(db).remove(f.companyId);
    expect(await db.select().from(modelProfileQualifications).where(eq(modelProfileQualifications.companyId, f.companyId))).toEqual([]);
    expect(await db.select().from(companies).where(eq(companies.id, f.companyId))).toEqual([]);
  });
});
