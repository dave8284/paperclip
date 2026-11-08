import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog, agents, aiSubscriptionConnections, aiSubscriptions, authUsers, companies, companyMemberships, companyOperatingProfiles,
  connectionGrants, createDb, documents, heartbeatRuns, heartbeatRunEvents, instanceUserRoles, issues, agentWakeupRequests,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { documentService } from "../services/documents.js";
import { classifyModelWork, modelIntelligenceProduct, selectCompanyModelProfile } from "../services/model-intelligence.js";
import { claimNativeModelComparison, finalizeNativeModelComparisonSelection } from "../services/model-comparison-admission.js";
import { modelComparisonDeliveryService } from "../services/model-comparison-delivery.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { managedAiSessionIdentity } from "../services/ai-connection-session.js";
import { modelAccountFingerprint } from "../services/model-profile-binding.js";
import { modelComparisonProfile, modelComparisonTaskScope } from "../services/model-comparison-scope.js";
import { MODEL_COMPARISON_ASSIGNMENT_KEY, modelComparisonService } from "../services/model-comparisons.js";
import { authorizationService, issueReadSqlCondition } from "../services/authorization.js";
import { activityService } from "../services/activity.js";
import { modelComparisonEventProjection } from "../services/model-comparison-event-projection.js";
import { modelRoutingService } from "../services/model-routing.js";
import { nativeModelRoutingAuthority } from "../services/model-routing-authority.js";
import { DEFAULT_MODEL_ROUTING_LIMITS } from "@paperclipai/shared";
import { modelRoutingDeliveryService } from "../services/model-routing-delivery.js";
import { nativeModelRoutingAdmission } from "../services/model-routing-binding.js";
import type { SelectionInput } from "@agentos/model-intelligence";

vi.mock("../services/subscription-refresh.js", () => ({ refreshSubscriptionConnection: vi.fn().mockResolvedValue(undefined) }));

// Real PostgreSQL permissions, native documents/tasks and the independent
// SQLite comparison store. No provider process, network account or inference.
describe("native observed comparison delivery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>, home: string;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "agentos-comparison-delivery-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "comparison-delivery-fixture");
    vi.stubEnv("AGENTOS_MODEL_INTELLIGENCE_DB", join(home, "learning.sqlite"));
    database = await startEmbeddedPostgresTestDatabase("agentos-comparison-delivery-");
    db = createDb(database.connectionString);
  }, 60000);
  afterAll(async () => {
    modelIntelligenceProduct()?.close();
    await db?.$client.end();
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (home) {
      await writableFixtureTree(home);
      await rm(home, { recursive: true, force: true });
    }
  });

  async function writableFixtureTree(path: string): Promise<void> {
    const stat = await lstat(path).catch(() => null);
    if (!stat || stat.isSymbolicLink()) return;
    await chmod(path, stat.isDirectory() ? 0o700 : 0o600);
    if (stat.isDirectory()) for (const name of await readdir(path)) await writableFixtureTree(join(path, name));
  }

  async function nativeFixture() {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Comparison owner", email: `${userId}@example.test`,
      approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    const [company] = await db.insert(companies).values({ name: "Observed comparison fixture", issuePrefix: `MC${randomUUID().slice(0, 5)}` }).returning();
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    const [agent, reviewer] = await db.insert(agents).values(["Implementer", "Independent reviewer"].map(name => ({
      companyId: company.id, name, adapterType: "paperclip_runner", status: "idle", lifecycleState: "ready" as const,
      adapterConfig: { provider: "codex", model: "gpt-6.1-sol", modelReasoningEffort: "high", homeMode: "isolated" },
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    }))).returning();
    await db.insert(companyOperatingProfiles).values({ companyId: company.id, fridayAgentId: agent.id });
    const task = await issueService(db).create(company.id, {
      title: "Classify support tickets", description: "Triage the supplied tickets and check each category against the supplied expected labels.",
      status: "backlog", priority: "medium", workMode: "standard", reviewPolicy: "human_only",
      assigneeAgentId: agent.id, createdByUserId: userId, responsibleUserId: userId, trustExplicitResponsibleUserId: true,
    });
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId, isInstanceAdmin: true,
      companyIds: [company.id], memberships: [{ companyId: company.id, membershipRole: "owner", status: "active" }] };
    return { userId, company, agent, reviewer, task, actor };
  }

  async function nativeAccount(f: Awaited<ReturnType<typeof nativeFixture>>) {
    const connection = await aiConnectionService(db).save(f.company.id, f.userId, {
      provider: "openai", method: "subscription", ownership: "personal", name: "Disposable comparison seat",
      loginSessionId: "fixture", agentIds: [], allAgents: true,
    }, JSON.stringify({ tokens: { account_id: f.userId, access_token: "fixture-only", refresh_token: "fixture-only" } }));
    const [grant] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, connection.grantId));
    const secretId = grant.credentialSecretRefs[0].secretId;
    const [subscription] = await db.insert(aiSubscriptions).values({ companyId: f.company.id, provider: "openai",
      accountKey: f.userId, name: "Disposable comparison seat" }).returning();
    await db.insert(aiSubscriptionConnections).values({ companyId: f.company.id, ...connection,
      credentialKey: "fixture", subscriptionId: subscription.id });
    const sessionIdentity = managedAiSessionIdentity(grant.id, f.userId, { secretId, epoch: 0 });
    return {
      connection, subscription, sessionIdentity,
      binding: { mode: "delegated", provider: "openai", method: "subscription", ...connection } as const,
      attribution: { ...connection, mode: "delegated", provider: "openai", method: "subscription",
        responsibleUserId: f.userId, subscriptionId: subscription.id } as const,
    };
  }

  it("reads bounded event evidence without transferring private tool output or silently dropping encoded rows", async () => {
    const f = await nativeFixture();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id, issueId: f.task.id, status: "queued" }).returning();
    const envelope = { runId: run.id, sourceInstanceId: "runner", sourceEventId: "event-1", sourceSeq: 1,
      eventType: "semantic_tool.input", normalizedSessionId: "session", turnId: "turn", payload: {
        privateToolOutput: "private tool output ".repeat(30_000), semantic_tool: { operationId: "finish_task", callId: "call-1",
          correlation: { runId: run.id, normalizedSessionId: "session", turnId: "turn" }, input: { idempotencyKey: "finish-1", privateText: "secret" } },
      } };
    for (let seq = 1; seq <= 3; seq++) {
      const item = structuredClone(envelope);
      item.sourceSeq = seq; item.sourceEventId = `event-${seq}`;
      if (seq === 2) item.payload.semantic_tool.input.idempotencyKey = "x".repeat(9_000);
      if (seq === 3) item.payload.privateToolOutput = "private\u0000output";
      await db.insert(heartbeatRunEvents).values({ companyId: f.company.id, runId: run.id, agentId: f.agent.id, seq,
        eventType: item.eventType, sourceInstanceId: item.sourceInstanceId, sourceEventId: item.sourceEventId,
        sourceSeq: seq, sourcePayloadSha256: "a".repeat(64), protocolSchemaVersion: 3, payload: { prpEvent: item } });
    }
    const rows = await db.select(modelComparisonEventProjection).from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, run.id)).orderBy(heartbeatRunEvents.seq);
    expect(rows).toHaveLength(3);
    expect(rows[0].payload).toMatchObject({ prpEvent: { ...Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== "payload")),
      payload: { semantic_tool: { operationId: "finish_task", callId: "call-1", input: { idempotencyKey: "finish-1" } } } } });
    const projected = JSON.stringify(rows[0]);
    expect(projected.length).toBeLessThan(8192);
    for (const excluded of ["private tool output", "privateText", "secret"]) expect(projected).not.toContain(excluded);
    expect(rows.slice(1).map(row => row.payload)).toEqual([null, null]);
    await db.insert(heartbeatRunEvents).values({ companyId: f.company.id, runId: run.id, agentId: f.agent.id, seq: 4,
      eventType: "harness.diagnostic", sourceInstanceId: "runner", sourceEventId: "written-4", sourceSeq: 4,
      sourcePayloadSha256: "b".repeat(64), protocolSchemaVersion: 3, payload: { prpEvent: {
        ...envelope, eventType: "harness.diagnostic", sourceEventId: "written-4", sourceSeq: 4,
        payload: { code: "context.tool_result_written", contextReceipt: { schema: "paperclip.provider-context-receipt.v1",
          stage: "transport_written", source: "tool/result", callId: "call-1", operationId: "call_api", providerTurnId: "provider-turn",
          resultSha256: "c".repeat(64), resultBytes: 100, isError: false, privateBody: "never projected" } },
      } } });
    const [written] = await db.select(modelComparisonEventProjection).from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, run.id), eq(heartbeatRunEvents.seq, 4)));
    expect(written.payload).toMatchObject({ prpEvent: { payload: { code: "context.tool_result_written",
      contextReceipt: { stage: "transport_written", resultSha256: "c".repeat(64), resultBytes: 100, isError: false } } } });
    expect(JSON.stringify(written)).not.toContain("never projected");
  });

  async function registeredFixture() {
    const f = await nativeFixture(), account = await nativeAccount(f);
    f.agent.runtimeConfig = { ...f.agent.runtimeConfig, aiConnection: account.binding };
    await db.update(agents).set({ runtimeConfig: f.agent.runtimeConfig }).where(eq(agents.id, f.agent.id));
    const source = await issueService(db).create(f.company.id, {
      title: f.task.title, description: f.task.description, status: "backlog", priority: "medium", workMode: "standard",
      reviewPolicy: f.task.reviewPolicy, assigneeAgentId: f.agent.id, createdByUserId: f.userId,
      responsibleUserId: f.userId, trustExplicitResponsibleUserId: true,
    });
    const scope = modelComparisonTaskScope(source), work = classifyModelWork(source.title, source.description);
    const fingerprint = modelAccountFingerprint(f.company.id, { provider: "openai", subscriptionId: account.subscription.id,
      sessionIdentity: account.sessionIdentity });
    const baseline = await modelComparisonProfile(db, f.agent, f.agent.adapterConfig, fingerprint, "0.160.0");
    const candidate = await modelComparisonProfile(db, f.agent, { ...f.agent.adapterConfig, model: "gpt-6-astra" }, fingerprint, "0.160.0");
    const engine = modelIntelligenceProduct()!;
    const comparisonId = randomUUID(), caseId = "ticket-categories", datasetId = randomUUID();
    engine.registerDataset({ namespace: f.company.id, id: datasetId, version: "1", taskFamily: work.taskType,
      taskFamilyVersion: "1", complexity: work.complexity, provenance: "observed",
      cases: [{ id: caseId, split: "holdout", ...scope, sourceRef: `issue:${source.id}` }] });
    engine.registerComparison({ namespace: f.company.id, id: comparisonId, datasetId, datasetVersion: "1", dimension: "model",
      baseline, candidate, thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } });
    const input = { requestKey: randomUUID(), comparisonId, caseId, arm: "baseline" as const, issueId: f.task.id };
    return { ...f, account, source, scope, work, baseline, candidate, engine, input };
  }

  const service = () => modelComparisonService(db, { readRuntimeIdentity: async () => ({ cliVersion: "0.160.0" }) });

  async function admittedFixture() {
    const f = await registeredFixture();
    await service().prepare(f.company.id, f.actor, f.input);
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id, issueId: f.task.id, status: "queued" }).returning();
    const input = { runId: run.id, companyId: f.company.id, agentId: f.agent.id, issueId: f.task.id };
    const [binding, replay] = await Promise.all([claimNativeModelComparison(db, input), claimNativeModelComparison(db, input)]);
    expect(binding).not.toBeNull();
    expect(replay).toEqual(binding);
    return { ...f, run, claimInput: input, comparisonBinding: binding! };
  }

  it("requires a committed native routing audit, recovers a cross-store acknowledgement gap, and revokes owner authority", async () => {
    const f = await registeredFixture();
    const input = { requestKey: randomUUID(), taskType: f.work.taskType, expectedRevision: 0, mode: "automatic" as const,
      pinnedReleaseId: null, limits: DEFAULT_MODEL_ROUTING_LIMITS, reason: "Enroll reviewed model improvements" };
    const { requestKey, ...settings } = input;
    // Simulate SQLite commit followed by a host transaction failure. Until the
    // exact native receipt commits, this policy cannot authorize a dispatch.
    const policy = f.engine.configureRoutingPolicy({ ...settings, namespace: f.company.id, id: requestKey });
    expect(await nativeModelRoutingAuthority(db, f.company.id, policy)).toBe(false);
    const service = modelRoutingService(db);
    const first = await service.configure(f.company.id, f.actor, input);
    expect(first).toEqual({ revision: 1, mode: "automatic" });
    expect(await service.configure(f.company.id, f.actor, input)).toEqual(first);
    expect(await nativeModelRoutingAuthority(db, f.company.id, policy)).toBe(true);
    const audit = await db.select().from(activityLog).where(eq(activityLog.id, requestKey));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: f.userId, companyId: f.company.id, action: "model_routing.policy_configured" });
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.userId));
    expect(await nativeModelRoutingAuthority(db, f.company.id, policy)).toBe(false);
    await expect(service.configure(f.company.id, f.actor, { ...input, requestKey: randomUUID(), expectedRevision: 1, mode: "off" })).rejects.toMatchObject({ status: 403 });
  });

  it("recovers both routing-store acknowledgement gaps without duplicating an outcome or qualifying unknown native context", async () => {
    const f = await registeredFixture(), comparisonId = randomUUID(), datasetId = randomUUID();
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const cases = Array.from({ length: 5 }, (_, index) => ({ id: `fixture-${index}`, split: "holdout" as const,
      inputDigest: sha(`fixture-input-${index}`), checkDigest: sha(`fixture-check-${index}`), sourceRef: `fixture:${index}` }));
    f.engine.registerDataset({ namespace: f.company.id, id: datasetId, version: "1", taskFamily: f.work.taskType, taskFamilyVersion: "1", complexity: "routine", provenance: "observed", cases });
    f.engine.registerComparison({ namespace: f.company.id, id: comparisonId, datasetId, datasetVersion: "1", dimension: "model", baseline: f.baseline, candidate: f.candidate,
      thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } });
    // Controlled fixture evidence exercises policy/outbox mechanics; these are
    // not actual provider evaluations and never leave this isolated database.
    for (const item of cases) for (const arm of ["baseline", "candidate"] as const) {
      const profile = f[arm], id = `${comparisonId}:${item.id}:${arm}`;
      f.engine.select({ namespace: f.company.id, requestId: id, taskKey: id, taskType: f.work.taskType, complexity: "routine", defaultCandidateId: profile.profileId,
        candidates: [{ id: profile.profileId, model: profile.model, provider: profile.provider, method: "subscription", available: true }],
        promptFingerprint: profile.promptFingerprint, contextFingerprint: profile.contextFingerprint });
      f.engine.recordComparisonOutcome({ namespace: f.company.id, id, comparisonId, caseId: item.id, arm, attempt: 1, receiptId: id, inputDigest: item.inputDigest,
        checkDigest: item.checkDigest, observedVariant: profile, provenance: "observed", outcome: "passed", terminal: true, iterations: 1,
        latencyMs: arm === "baseline" ? 1000 : 400, source: "checks", evaluator: "fixture-only", evidenceRef: `fixture:${id}` });
    }
    await modelRoutingService(db).configure(f.company.id, f.actor, { requestKey: randomUUID(), taskType: f.work.taskType, expectedRevision: 0,
      mode: "automatic", pinnedReleaseId: null, limits: DEFAULT_MODEL_ROUTING_LIMITS, reason: "Test recoverable routing delivery" });
    const release = f.engine.routingRollouts({ namespace: f.company.id, taskType: f.work.taskType }).releases[0];
    let taskKey = "";
    for (let index = 0; index < 10000; index++) {
      const candidate = `fixture-production-${index}`;
      if (Number.parseInt(sha(JSON.stringify([release.id, candidate])).slice(0, 8), 16) % 100 < 5) { taskKey = candidate; break; }
    }
    expect(taskKey).not.toBe("");
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id, issueId: f.task.id,
      status: "queued", runtimeMode: "native", createdAt: new Date(Date.now() - 5000) }).returning();
    const request: SelectionInput = { namespace: f.company.id, requestId: run.id, taskKey, taskType: f.work.taskType, complexity: "routine", defaultCandidateId: f.baseline.profileId,
      candidates: [f.baseline, f.candidate].map(variant => ({ id: variant.profileId, provider: variant.provider, model: variant.model, method: "subscription", available: true, variant })),
      promptFingerprint: f.baseline.promptFingerprint, contextFingerprint: sha("fresh production input") };
    const admission = nativeModelRoutingAdmission(request);
    const selected = f.engine.select(request);
    expect(selected.rollout?.assignmentId).toBe(run.id);
    // Store selection committed; native receipt acknowledgement was lost.
    await db.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date(), costAccountingPending: false,
      contextSnapshot: { modelIntelligenceRequest: request }, runnerProfileJson: { nativeModelRoutingAdmission: admission } }).where(eq(heartbeatRuns.id, run.id));
    const worker = modelRoutingDeliveryService(db);
    await Promise.all([worker.sweepPending(), modelRoutingDeliveryService(db).sweepPending()]);
    const [delivered] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
    const outbox = delivered.runnerProfileJson!.nativeModelRoutingDelivery as Record<string, unknown>;
    expect(outbox).toMatchObject({ state: "delivered", outcome: { outcome: "failed", observedVariant: null, iterations: null } });
    expect((outbox.outcome as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(5000);
    expect(delivered.contextSnapshot!.modelIntelligence).toEqual(selected);
    // Outcome committed; native delivery acknowledgement was lost.
    await db.update(heartbeatRuns).set({ runnerProfileJson: { ...delivered.runnerProfileJson, nativeModelRoutingDelivery: { ...outbox, state: "ready" } } }).where(eq(heartbeatRuns.id, run.id));
    await modelRoutingDeliveryService(db).sweepPending();
    const [replayed] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
    expect(replayed.runnerProfileJson!.nativeModelRoutingDelivery).toMatchObject({ state: "delivered", outcome: outbox.outcome, fingerprint: outbox.fingerprint });
    expect(f.engine.routingRollouts({ namespace: f.company.id, taskType: f.work.taskType }).events.filter(item => item.action === "rolled_back")).toHaveLength(1);
    expect(await worker.hasPending()).toBe(false); expect(worker.nextRunAt()).toBeNull();
  });

  it("claims one native attempt and rechecks preparation authority on retries", async () => {
    const f = await admittedFixture();
    expect(f.comparisonBinding.attempt).toBe(1);
    const [other] = await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id, issueId: f.task.id, status: "queued" }).returning();
    await expect(claimNativeModelComparison(db, { ...f.claimInput, runId: other.id })).rejects.toMatchObject({ status: 409 });
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.userId));
    await expect(claimNativeModelComparison(db, f.claimInput)).rejects.toMatchObject({ status: 403 });
    expect(f.engine.analytics(f.company.id).counts.selections).toBe(0);
  });

  it("delivers a frozen failed attempt once across recreated workers and preserves measured timing plus unmeasured context/iterations", async () => {
    const f = await admittedFixture();
    const selection = await selectCompanyModelProfile(db, { runId: f.run.id, issueId: f.task.id, agent: f.agent,
      config: f.agent.adapterConfig, binding: f.account.binding, resumed: false, comparison: f.comparisonBinding,
      account: { attribution: f.account.attribution, sessionIdentity: f.account.sessionIdentity, assertCurrent: async () => {},
        readRuntimeIdentity: async () => ({ cliVersion: "0.160.0" }) } });
    expect(selection.receipt?.comparisonBinding).toMatchObject({ comparisonId: f.input.comparisonId, caseId: f.input.caseId, arm: "baseline" });
    await expect(finalizeNativeModelComparisonSelection(db, { companyId: f.company.id, runId: f.run.id,
      receipt: { ...selection.receipt!, id: randomUUID() } })).rejects.toMatchObject({ status: 409 });
    const [selected] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    const context = { ...selected.contextSnapshot };
    delete context.modelIntelligence;
    const failedAt = new Date(f.comparisonBinding.admittedAt);
    await db.update(heartbeatRuns).set({ status: "failed", createdAt: new Date(failedAt.getTime() - 5_000),
      finishedAt: failedAt, costAccountingPending: false,
      contextSnapshot: context, runnerProfileJson: { ...selected.runnerProfileJson,
        nativeModelComparison: { ...selected.runnerProfileJson!.nativeModelComparison as object, receiptId: null },
      },
    }).where(eq(heartbeatRuns.id, f.run.id));
    f.engine.policy({ namespace: f.company.id, candidateId: f.baseline.profileId, action: "block", reason: "Blocked after interrupted selection acknowledgement" });
    await Promise.all([modelComparisonDeliveryService(db).sweepPending(), modelComparisonDeliveryService(db).sweepPending()]);
    // Recreate the cross-store crash boundary: the product has committed but
    // the native acknowledgement is absent. Replay must not append an attempt.
    const [delivered] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(delivered.runnerProfileJson?.nativeModelComparisonDelivery).toMatchObject({
      state: "delivered", measurements: { runId: f.run.id, latencyMs: 5_000, iterations: null },
      gaps: ["execution_context_not_fully_bound", "work_iterations_unmeasured"],
    });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { ...delivered.runnerProfileJson,
      nativeModelComparisonDelivery: { ...delivered.runnerProfileJson!.nativeModelComparisonDelivery as object, state: "ready" },
    } }).where(eq(heartbeatRuns.id, f.run.id));
    await modelComparisonDeliveryService(db).sweepPending();
    expect(await modelComparisonDeliveryService(db).hasPending()).toBe(false);
    const report = f.engine.comparisonReport({ namespace: f.company.id, comparisonId: f.input.comparisonId });
    expect(report.cases[0].baseline.attempts).toHaveLength(1);
    expect(report.cases[0].baseline.attempts[0]).toMatchObject({ outcome: "failed", iterations: null, latencyMs: 5_000, observedVariant: null });
    expect(report.status).toBe("not_ready");
    expect(f.engine.analytics(f.company.id).counts.evaluations).toBe(0);
  });

  it("retains a pre-selection stop as an explicit native gap without inventing a selection or accepted outcome", async () => {
    const f = await admittedFixture();
    await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, f.run.id));
    await modelComparisonDeliveryService(db).sweepPending();
    const [saved] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(saved.runnerProfileJson?.nativeModelComparisonDelivery).toMatchObject({ state: "unselected", outcome: "unknown" });
    expect(f.engine.analytics(f.company.id).counts.selections).toBe(0);
    expect(f.engine.comparisonReport({ namespace: f.company.id, comparisonId: f.input.comparisonId }).cases[0].baseline.attempts).toHaveLength(0);
    expect(await modelComparisonDeliveryService(db).hasPending()).toBe(false);
  });

  it("prepares one native locked assignment under concurrent retries without selecting or starting work", async () => {
    const f = await registeredFixture();
    const results = await Promise.all([service().prepare(f.company.id, f.actor, f.input), service().prepare(f.company.id, f.actor, f.input)]);
    expect(results.map(row => row.created).sort()).toEqual([false, true]);
    expect(results[0].assignment).toEqual(results[1].assignment);
    expect(results[0].task).toMatchObject({ id: f.task.id, status: "backlog" });
    const [assignment] = await db.select().from(documents).where(eq(documents.id, results[0].assignment.documentId));
    expect(assignment.lockedByUserId).toBe(f.userId);
    expect(assignment.latestRevisionId).toBe(results[0].assignment.revisionId);
    const [task] = await db.select().from(issues).where(eq(issues.id, f.task.id));
    expect(task).toMatchObject({ status: "backlog", title: f.task.title, description: f.task.description,
      assigneeAgentId: f.agent.id, responsibleUserId: f.userId });
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "model_comparison.prepared")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "user", actorId: f.userId, entityId: f.source.id });
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.company.id))).toHaveLength(0);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, f.company.id))).toHaveLength(0);
    expect(f.engine.analytics(f.company.id).counts).toEqual({ selections: 0, evaluations: 0, policyEvents: 0 });
    await expect(service().prepare(f.company.id, f.actor, { ...f.input, arm: "candidate" })).rejects.toMatchObject({ status: 409 });
  });

  it("requires current approved owner and company membership on initial preparation and replay", async () => {
    const f = await registeredFixture();
    const prepared = await service().prepare(f.company.id, f.actor, f.input);
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.userId));
    await expect(service().prepare(f.company.id, f.actor, f.input)).rejects.toMatchObject({ status: 403 });
    await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
    await db.update(authUsers).set({ approvalStatus: "suspended" }).where(eq(authUsers.id, f.userId));
    await expect(service().discover(f.company.id, f.actor)).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ approvalStatus: "approved" }).where(eq(authUsers.id, f.userId));
    await db.update(companyMemberships).set({ status: "revoked" }).where(and(eq(companyMemberships.companyId, f.company.id), eq(companyMemberships.principalId, f.userId)));
    for (const input of [f.input, { ...f.input, requestKey: randomUUID() }]) {
      await expect(service().prepare(f.company.id, f.actor, input)).rejects.toMatchObject({ status: 403 });
    }
    const [assignment] = await db.select().from(documents).where(eq(documents.id, prepared.assignment.documentId));
    expect(assignment.lockedByUserId).toBe(f.userId);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.company.id))).toHaveLength(0);
  });

  it("rejects post-selection retrofit and changed native task or acceptance criteria", async () => {
    const f = await registeredFixture();
    await db.update(issues).set({ description: "A different acceptance requirement" }).where(eq(issues.id, f.task.id));
    await expect(service().prepare(f.company.id, f.actor, f.input)).rejects.toMatchObject({ status: 409 });
    await db.update(issues).set({ description: f.task.description, reviewPolicy: "anyone" }).where(eq(issues.id, f.task.id));
    await expect(service().prepare(f.company.id, f.actor, f.input)).rejects.toMatchObject({ status: 409 });
    await db.update(issues).set({ reviewPolicy: f.task.reviewPolicy }).where(eq(issues.id, f.task.id));
    await db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id, issueId: f.task.id, status: "queued" });
    await expect(service().prepare(f.company.id, f.actor, f.input)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.entityId, f.task.id)))).toHaveLength(0);
    expect(f.engine.analytics(f.company.id).counts).toEqual({ selections: 0, evaluations: 0, policyEvents: 0 });
  });

  it("offers only native company task choices and never accepts an agent or foreign task reference", async () => {
    const f = await registeredFixture(), foreign = await nativeFixture();
    const discovered = await service().discover(f.company.id, f.actor);
    const comparison = discovered.comparisons.find(row => row.id === f.input.comparisonId);
    expect(comparison?.cases.find(row => row.id === f.input.caseId)?.tasks).toContainEqual(expect.objectContaining({
      issueId: f.task.id, agentId: f.agent.id, arms: ["baseline"],
    }));
    const serialized = JSON.stringify(discovered);
    for (const secret of [f.source.description!, f.scope.inputDigest, f.scope.checkDigest, f.account.sessionIdentity, foreign.task.id]) {
      expect(serialized).not.toContain(secret);
    }
    await expect(service().prepare(f.company.id, { type: "agent", source: "agent_jwt", companyId: f.company.id,
      agentId: f.agent.id, onBehalfOfUserId: f.userId }, f.input)).rejects.toMatchObject({ status: 403 });
    await expect(service().prepare(f.company.id, f.actor, { ...f.input, issueId: foreign.task.id })).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.company.id))).toHaveLength(0);
  });

  it("keeps private case and account provenance out of an open target's document and activity", async () => {
    const f = await registeredFixture();
    await issueService(db).update(f.source.id, { visibility: "private", actorUserId: f.userId });
    const reader = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.company.id,
      agentId: f.reviewer.id, onBehalfOfUserId: f.userId };
    const read = (issueId: string) => authorizationService(db).decide({ actor: reader, action: "issue:read",
      resource: { type: "issue", companyId: f.company.id, issueId } });
    expect((await read(f.source.id)).allowed).toBe(false);
    expect((await read(f.task.id)).allowed).toBe(true);
    const result = await service().prepare(f.company.id, f.actor, f.input);
    const document = await documentService(db).getIssueDocumentByKey(f.task.id, MODEL_COMPARISON_ASSIGNMENT_KEY);
    expect(document?.id).toBe(result.assignment.documentId);
    expect(document?.lockedByUserId).toBe(f.userId);
    const visibleActivity = await activityService(db).list({ companyId: f.company.id,
      readCondition: await issueReadSqlCondition(db, reader) });
    const targetContent = JSON.stringify({ document, activity: visibleActivity, result });
    for (const privateValue of [f.source.id, f.input.comparisonId, f.input.caseId, f.scope.inputDigest, f.scope.checkDigest,
      f.baseline.profileId, f.baseline.promptFingerprint, f.account.sessionIdentity]) expect(targetContent).not.toContain(privateValue);
    expect(visibleActivity.some(row => row.action === "model_comparison.prepared")).toBe(false);
    const [audit] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "model_comparison.prepared")));
    expect(audit).toMatchObject({ entityType: "issue", entityId: f.source.id });
    expect(JSON.stringify(audit.details)).toContain(f.input.comparisonId);
  });

  it("does not prepare a private native case for an employee without source task access", async () => {
    const f = await registeredFixture();
    await issueService(db).update(f.source.id, { visibility: "private", actorUserId: f.userId });
    await issueService(db).update(f.task.id, { assigneeAgentId: f.reviewer.id, actorUserId: f.userId });
    const reader = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.company.id,
      agentId: f.reviewer.id, onBehalfOfUserId: f.userId };
    expect((await authorizationService(db).decide({ actor: reader, action: "issue:read",
      resource: { type: "issue", companyId: f.company.id, issueId: f.source.id } })).allowed).toBe(false);
    await expect(service().prepare(f.company.id, f.actor, f.input)).rejects.toMatchObject({ status: 404 });
    expect(await documentService(db).getIssueDocumentByKey(f.task.id, MODEL_COMPARISON_ASSIGNMENT_KEY)).toBeNull();
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "model_comparison.prepared")))).toHaveLength(0);
  });
});
