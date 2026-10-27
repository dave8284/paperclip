import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, companyOperatingProfiles, costEvents, createDb, heartbeatRuns, issues, activityLog, projects, agentInstructionHeads, agentInstructionRevisions } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { evaluateModelRun, modelIntelligenceProduct, selectCompanyModelProfile } from "../services/model-intelligence.js";
import { activityService } from "../services/activity.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>, directory: string;
const previousPath = process.env.AGENTOS_MODEL_INTELLIGENCE_DB;
const companyId = randomUUID(), otherCompanyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), projectId = randomUUID();
const binding = { mode: "responsible_user" as const, method: "subscription" as const, provider: "openai" as const };
const config = { model: "gpt-6-astra" };
const who = { actorType: "user" as const, actorId: "local-board", agentId: null, runId: null };
let agent: typeof agents.$inferSelect;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "agentos-model-product-"));
  process.env.AGENTOS_MODEL_INTELLIGENCE_DB = join(directory, "learning.sqlite");
  database = await startEmbeddedPostgresTestDatabase("agentos-model-admission-"); db = createDb(database.connectionString);
  await db.insert(companies).values([{ id: companyId, name: "Company", issuePrefix: "MLI" }, { id: otherCompanyId, name: "Other", issuePrefix: "MLJ" }]);
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
  const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, issueId, invocationSource: "on_demand", status: "succeeded", startedAt: new Date(Date.now() - 2000), finishedAt: new Date() }).returning();
  return run;
}
it("records the configured subscription baseline before execution and requires actual model receipts for feedback", async () => {
  const run = await newRun();
  const selected = await selectCompanyModelProfile(db, { runId: run.id, issueId, agent, config, binding, resumed: false });
  expect(selected.config.model).toBe(config.model);
  expect(selected.receipt?.evidence.evaluations).toBe(0);
  const [saved] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
  expect(saved.contextSnapshot?.modelIntelligence).toMatchObject({ id: run.id, namespace: companyId, taskType: "engineering" });
  // A new observed candidate may appear while a run waits for a subscription
  // slot. Retrying that run must replay its original selection request.
  await db.insert(costEvents).values({ companyId, agentId, model: "gpt-6.1-sol", provider: "openai", billingType: "subscription_included", costCents: 0, occurredAt: new Date() });
  const retried = await selectCompanyModelProfile(db, { runId: run.id, issueId, agent, config, binding, resumed: false });
  expect(retried.receipt).toEqual(selected.receipt);
  const nextRun = await newRun();
  await db.update(heartbeatRuns).set({ contextSnapshot: saved.contextSnapshot }).where(eq(heartbeatRuns.id, nextRun.id));
  const next = await selectCompanyModelProfile(db, { runId: nextRun.id, issueId, agent, config, binding, resumed: false });
  expect(next.request?.requestId).toBe(nextRun.id);
  expect(next.receipt?.id).toBe(nextRun.id);
  expect(next.receipt?.candidate).toEqual(selected.receipt?.candidate);
  await expect(evaluateModelRun(db, companyId, run.id, { passed: true, evidenceRef: "review:fixture" }, who)).rejects.toThrow("Actual model receipts");
  await db.insert(costEvents).values({ companyId, agentId, heartbeatRunId: run.id, model: config.model, provider: "openai", billingType: "subscription_included", costCents: 0, occurredAt: new Date() });
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
