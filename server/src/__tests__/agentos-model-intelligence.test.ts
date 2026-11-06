import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, companyOperatingProfiles, costEvents, createDb, heartbeatRuns, issues, activityLog, projects, agentInstructionHeads, agentInstructionRevisions, aiSubscriptions } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { evaluateModelRun, modelIntelligenceProduct, observeSelectedModelAccountAccess, selectCompanyModelProfile } from "../services/model-intelligence.js";
import { activityService } from "../services/activity.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>, directory: string;
const previousPath = process.env.AGENTOS_MODEL_INTELLIGENCE_DB;
const companyId = randomUUID(), otherCompanyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), projectId = randomUUID();
const subscriptionId = randomUUID();
const binding = { mode: "responsible_user" as const, method: "subscription" as const, provider: "openai" as const };
const config = { model: "gpt-6-astra" };
const who = { actorType: "user" as const, actorId: "local-board", agentId: null, runId: null };
let agent: typeof agents.$inferSelect;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "agentos-model-product-"));
  process.env.AGENTOS_MODEL_INTELLIGENCE_DB = join(directory, "learning.sqlite");
  database = await startEmbeddedPostgresTestDatabase("agentos-model-admission-"); db = createDb(database.connectionString);
  await db.insert(companies).values([{ id: companyId, name: "Company", issuePrefix: "MLI" }, { id: otherCompanyId, name: "Other", issuePrefix: "MLJ" }]);
  await db.insert(aiSubscriptions).values({ id: subscriptionId, companyId, provider: "openai", accountKey: "fixture-account", name: "Fixture subscription" });
  [agent] = await db.insert(agents).values({ id: agentId, companyId, name: "Engineer", adapterType: "codex_local", adapterConfig: config }).returning();
  const revisionId = randomUUID();
  await db.insert(agentInstructionRevisions).values({ id: revisionId, companyId, agentId, entryFile: "AGENTS.md", contentBase64: "VGVzdA==", contentHash: "fixture", byteLength: 4, source: "api" });
  await db.insert(agentInstructionHeads).values({ companyId, agentId, entryFile: "AGENTS.md", revisionId });
  await db.insert(companyOperatingProfiles).values({ companyId, fridayAgentId: agentId });
  await db.insert(projects).values({ id: projectId, companyId, name: "Launch" });
  await db.insert(issues).values({ id: issueId, companyId, projectId, title: "Implement a task list", status: "todo" });
}, 90000);
afterAll(async () => { modelIntelligenceProduct()?.close(); if (previousPath) process.env.AGENTOS_MODEL_INTELLIGENCE_DB = previousPath; else delete process.env.AGENTOS_MODEL_INTELLIGENCE_DB; await database?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function newRun() {
  const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, issueId, invocationSource: "on_demand", status: "succeeded", startedAt: new Date(Date.now() - 2000), finishedAt: new Date(), contextSnapshot: { aiConnection: { provider: "openai", method: "subscription", subscriptionId } } }).returning();
  return run;
}
it("records the configured subscription baseline before execution and requires actual model receipts for feedback", async () => {
  const run = await newRun();
  const selected = await selectCompanyModelProfile(db, { runId: run.id, issueId, agent, config, binding, resumed: false });
  expect(selected.config.model).toBe(config.model);
  expect(selected.receipt?.evidence.evaluations).toBe(0);
  const [saved] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
  expect(saved.contextSnapshot?.modelIntelligence).toMatchObject({ id: run.id, namespace: companyId, taskType: "engineering.building" });
  // Historical use never qualifies an alternative for today's execution account.
  // A queued retry must also preserve its original configured selection request.
  await db.insert(costEvents).values({ companyId, agentId, model: "gpt-6.1-sol", provider: "openai", billingType: "subscription_included", costCents: 0, occurredAt: new Date() });
  const retried = await selectCompanyModelProfile(db, { runId: run.id, issueId, agent, config, binding, resumed: false });
  expect(retried.receipt).toEqual(selected.receipt);
  const nextRun = await newRun();
  await db.update(heartbeatRuns).set({ contextSnapshot: saved.contextSnapshot }).where(eq(heartbeatRuns.id, nextRun.id));
  const next = await selectCompanyModelProfile(db, { runId: nextRun.id, issueId, agent, config, binding, resumed: false });
  expect(next.request?.requestId).toBe(nextRun.id);
  expect(next.request?.candidates.map(candidate => candidate.model)).toEqual([config.model]);
  expect(next.receipt?.id).toBe(nextRun.id);
  expect(next.receipt?.candidate).toEqual(selected.receipt?.candidate);
  await expect(evaluateModelRun(db, companyId, run.id, { passed: true, evidenceRef: "review:fixture" }, who)).rejects.toThrow("Actual model receipts");
  await db.insert(costEvents).values({ companyId, agentId, heartbeatRunId: run.id, subscriptionId, model: config.model, provider: "openai", billingType: "subscription_included", costCents: 0, occurredAt: new Date() });
  const evaluation = await evaluateModelRun(db, companyId, run.id, { passed: true, evidenceRef: "review:fixture" }, who);
  expect(evaluation).toMatchObject({ iterations: 1, latencyMs: 2000, source: "human" });
  expect(modelIntelligenceProduct()!.analytics(companyId).counts.evaluations).toBe(1);
  expect(modelIntelligenceProduct()!.analytics(otherCompanyId).counts.selections).toBe(0);
  await expect(evaluateModelRun(db, otherCompanyId, run.id, { passed: true, evidenceRef: "review:fixture" }, who)).rejects.toThrow("Run not found");
});
it("leaves retained sessions and API bindings alone and enforces an explicit profile block", async () => {
  const run = await newRun();
  expect(await selectCompanyModelProfile(db, { runId: run.id, issueId, agent, config, binding, resumed: true })).toEqual({ config });
  expect(await selectCompanyModelProfile(db, { runId: run.id, issueId, agent, config, binding: { ...binding, method: "api_key" }, resumed: false })).toEqual({ config });
  const candidate = modelIntelligenceProduct()!.analytics(companyId).receipts[0].candidate;
  modelIntelligenceProduct()!.policy({ namespace: companyId, candidateId: candidate.id, action: "block", reason: "Regressed quality in review" });
  await expect(selectCompanyModelProfile(db, { runId: run.id, issueId, agent, config, binding, resumed: false })).rejects.toThrow("blocked");
});
it("scopes project audit history before applying the result limit", async () => {
  const common = { companyId, actorType: "user", actorId: "reviewer", action: "fixture.reviewed" };
  await db.insert(activityLog).values([{ ...common, entityType: "project", entityId: projectId }, { ...common, entityType: "issue", entityId: issueId }, { ...common, entityType: "company", entityId: companyId }]);
  const rows = await activityService(db).list({ companyId, projectId });
  expect(rows.map(row => row.entityId)).toEqual(expect.arrayContaining([projectId, issueId]));
  expect(rows.every(row => row.entityType === "issue" || row.entityType === "project")).toBe(true);
});

it("observes only completed native inference for the exact prepared account and credential epoch", async () => {
  const run = await newRun();
  const priorId = randomUUID(), sessionIdentity = "fixture-grant:fixture-user:fixture-secret:0";
  const account = { provider: "openai", method: "subscription", subscriptionId, sessionIdentity };
  const input = { companyId, agentId, runId: run.id, model: config.model, account };
  const nativeInput = { binding: { companyId, agentId, runId: priorId }, provider: { kind: "codex", model: config.model } };
  await db.insert(heartbeatRuns).values({ id: priorId, companyId, agentId, issueId,
    status: "succeeded", runtimeMode: "native", startedAt: new Date(Date.now() - 5000), finishedAt: new Date(Date.now() - 1000),
    contextSnapshot: { aiConnection: account }, runnerProfileJson: { nativeExecutionInput: nativeInput },
    usageJson: { accountingReceiptReady: true }, costAccountingPending: false, costAccountedAt: new Date(),
  });
  expect(await observeSelectedModelAccountAccess(db, input)).toMatchObject({ state: "not_observed", reason: "latest_execution_not_confirmed" });
  const [usage] = await db.insert(costEvents).values({ companyId, agentId, heartbeatRunId: priorId, subscriptionId,
    model: config.model, provider: "openai", billingType: "subscription_included", costCents: 0, outputTokens: 10, occurredAt: new Date(),
  }).returning();
  const observed = await observeSelectedModelAccountAccess(db, input);
  expect(observed).toMatchObject({ state: "observed_same_account", evidenceRunId: priorId,
    currentEntitlementVerified: false, actualProviderModelVerified: false,
    automaticAlternatives: "current_account_qualification_required" });
  expect(JSON.stringify(observed)).not.toContain(sessionIdentity);
  for (const accountChange of [
    { sessionIdentity: "fixture-grant:fixture-user:fixture-secret:1" },
    { sessionIdentity: "other-grant:fixture-user:fixture-secret:0" },
    { subscriptionId: randomUUID() }, { method: "api_key" }, { provider: "anthropic" },
  ]) {
    expect(await observeSelectedModelAccountAccess(db, { ...input, account: { ...account, ...accountChange } })).toMatchObject({ state: "not_observed" });
  }
  expect(await observeSelectedModelAccountAccess(db, { ...input, companyId: otherCompanyId })).toMatchObject({ state: "not_observed" });
  expect(await observeSelectedModelAccountAccess(db, { ...input, model: "other-model" })).toMatchObject({ state: "not_observed" });
  await db.update(costEvents).set({ billingType: "api" }).where(eq(costEvents.id, usage.id));
  expect(await observeSelectedModelAccountAccess(db, input)).toMatchObject({ state: "not_observed" });
  await db.update(costEvents).set({ billingType: "subscription_included" }).where(eq(costEvents.id, usage.id));
  await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: { ...nativeInput, binding: { ...nativeInput.binding, runId: randomUUID() } } } }).where(eq(heartbeatRuns.id, priorId));
  expect(await observeSelectedModelAccountAccess(db, input)).toMatchObject({ state: "not_observed" });
  await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: nativeInput } }).where(eq(heartbeatRuns.id, priorId));

  const failedId = randomUUID();
  await db.insert(heartbeatRuns).values({ id: failedId, companyId, agentId, issueId,
    status: "failed", runtimeMode: "native", startedAt: new Date(Date.now() - 500), finishedAt: new Date(), errorCode: "model_not_found",
    contextSnapshot: { aiConnection: account }, runnerProfileJson: { nativeExecutionInput: { ...nativeInput, binding: { ...nativeInput.binding, runId: failedId } } },
  });
  expect(await observeSelectedModelAccountAccess(db, input)).toMatchObject({ state: "not_observed",
    reason: "latest_execution_not_confirmed", evidenceRunId: failedId });
  await db.insert(heartbeatRuns).values(Array.from({ length: 100 }, () => ({
    companyId, agentId, issueId, status: "succeeded", startedAt: new Date(Date.now() - 100), finishedAt: new Date(),
  })));
  expect(await observeSelectedModelAccountAccess(db, input)).toMatchObject({ state: "not_observed",
    reason: "no_matching_native_execution", lookbackExecutions: 100 });
});
