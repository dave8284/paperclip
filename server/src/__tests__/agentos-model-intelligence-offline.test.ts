import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import type { EvaluationInput, SelectionInput, SelectionReceipt } from "@agentos/model-intelligence";

const learning = vi.hoisted(() => ({ select: vi.fn(), evaluate: vi.fn(), close: vi.fn(), audit: vi.fn() }));
vi.mock("@agentos/model-intelligence", async (importOriginal) => ({
  ...await importOriginal<typeof import("@agentos/model-intelligence")>(),
  createModelIntelligence: () => learning,
}));
vi.mock("../services/activity-log.js", () => ({ logActivity: learning.audit }));
import { evaluateModelRun, selectCompanyModelProfile } from "../services/model-intelligence.js";

// Real service functions and Drizzle SQL/row decoding, controlled query results
// and learning writes. This proves ordering and contract wiring, not PostgreSQL
// persistence, native provider execution, or live model quality.
const companyId = "company-1", runId = "run-1", agentId = "agent-1", subscriptionId = "subscription-at-execution";
const model = "gpt-6-astra";
const candidate = { id: "codex-profile", model, provider: "openai", method: "subscription" as const };
const evidence = { evaluations: 0, passed: 0, lowerBound: 0, medianLatencyMs: null, medianIterations: null, recentFailures: 0 };
const receipt: SelectionReceipt = {
  id: runId, namespace: companyId, taskKey: "issue-1:agent-1", taskType: "engineering.building",
  complexity: "routine", candidate, policyVersion: "fixture", reason: "baseline", evidence,
  contextFingerprint: null, promptFingerprint: null, createdAt: "2026-11-04T00:00:00Z",
};
const execution = { provider: "openai", method: "subscription", subscriptionId,
  connectionId: "connection-at-execution", grantId: "grant-at-execution", mode: "shared", responsibleUserId: "owner-1" };
const usage = { model, provider: "openai", billingType: "subscription_included", subscriptionId };
const who = { actorType: "user" as const, actorId: "reviewer", agentId: null, runId: null };
const review = { passed: true, evidenceRef: "review:offline-fixture" };
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "agentos-model-service-offline-"));
  vi.stubEnv("AGENTOS_MODEL_INTELLIGENCE_DB", join(directory, "unused.sqlite"));
});
beforeEach(() => {
  vi.clearAllMocks();
  learning.evaluate.mockImplementation((input: EvaluationInput) => input);
  learning.select.mockImplementation((input: SelectionInput) => ({ ...receipt,
    id: input.requestId, namespace: input.namespace, promptFingerprint: input.promptFingerprint,
    candidate: input.candidates.find(entry => entry.id === input.defaultCandidateId),
  }));
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

type Statement = { text: string; params: unknown[] };
function evaluationDatabase(options: {
  attribution?: unknown; rows?: Array<Record<string, unknown>>; selected?: unknown;
  status?: string; found?: boolean;
} = {}) {
  const statements: Statement[] = [];
  const run: Record<string, unknown> = {
    id: runId, companyId, agentId, issueId: "issue-1", status: options.status ?? "succeeded",
    startedAt: "2026-11-04T00:00:00Z", finishedAt: "2026-11-04T00:00:02Z", createdAt: "2026-11-04T00:00:00Z",
    contextSnapshot: { modelIntelligence: options.selected ?? receipt,
      aiConnection: Object.hasOwn(options, "attribution") ? options.attribution : execution },
  };
  const db = drizzle(async (text, params) => {
    statements.push({ text, params });
    if (text.includes("count(*)")) return { rows: [[3]] };
    if (text.includes('from "heartbeat_runs"')) return { rows: options.found === false ? [] : [Object.keys(getTableColumns(heartbeatRuns)).map(key => run[key] ?? null)] };
    if (text.includes('from "cost_events"')) return { rows: (options.rows ?? [usage]).map(row => [row.model, row.provider, row.billingType, row.subscriptionId]) };
    throw new Error(`Unexpected database query: ${text}`);
  }) as unknown as Db;
  return { db, statements };
}

describe("native subscription learning receipt gate", () => {
  it.each(["succeeded", "failed"])("qualifies all matching receipts on a %s run using its recorded account", async (status) => {
    const { db, statements } = evaluationDatabase({ status, rows: [usage, { ...usage }] });
    const result = await evaluateModelRun(db, companyId, runId, review, who);
    expect(result).toMatchObject({ ...review, namespace: companyId, receiptId: runId, iterations: 3, latencyMs: 2000, source: "human" });
    expect(learning.evaluate).toHaveBeenCalledExactlyOnceWith(result);
    expect(learning.audit).toHaveBeenCalledOnce();
    expect(learning.evaluate.mock.invocationCallOrder[0]).toBeLessThan(learning.audit.mock.invocationCallOrder[0]);
    const usageRead = statements.find(statement => statement.text.includes('from "cost_events"'))!;
    expect(usageRead.params).toEqual([companyId, runId]);
    expect(usageRead.text.split(" where ")[1]).toBe('("cost_events"."company_id" = $1 and "cost_events"."heartbeat_run_id" = $2)');
    expect(usageRead.text).toContain('"model", "provider", "billing_type", "subscription_id"');
    // No current account/default lookup can change historical qualification.
    expect(statements.every(statement => /from "(heartbeat_runs|cost_events)"/.test(statement.text))).toBe(true);
  });

  const rejected: Array<[string, Parameters<typeof evaluationDatabase>[0]]> = [
    ["missing usage", { rows: [] }],
    ["different model", { rows: [{ ...usage, model: "gpt-6.1-sol" }] }],
    ["different usage provider", { rows: [{ ...usage, provider: "anthropic" }] }],
    ["API-funded usage", { rows: [{ ...usage, billingType: "api_metered" }] }],
    ["unknown funding", { rows: [{ ...usage, billingType: "unknown" }] }],
    ["missing usage account", { rows: [{ ...usage, subscriptionId: null }] }],
    ["different usage account", { rows: [{ ...usage, subscriptionId: "other-subscription" }] }],
    ["mixed same-model accounts", { rows: [usage, { ...usage, subscriptionId: "other-subscription" }] }],
    ["mixed same-model funding", { rows: [usage, { ...usage, billingType: "api_metered" }] }],
    ["missing execution attribution", { attribution: undefined }],
    ["null execution attribution", { attribution: null }],
    ["legacy execution without account", { attribution: { ...execution, subscriptionId: undefined } }],
    ["empty execution account", { attribution: { ...execution, subscriptionId: "" } }],
    ["execution with API credentials", { attribution: { ...execution, method: "api_key" } }],
    ["execution provider mismatch", { attribution: { ...execution, provider: "anthropic" } }],
    ["non-subscription selection", { selected: { ...receipt, candidate: { ...candidate, method: "api_key" } } }],
    ["missing selected candidate", { selected: { ...receipt, candidate: undefined } }],
  ];
  it.each(rejected)("rejects %s before learning or audit writes", async (_name, options) => {
    const { db, statements } = evaluationDatabase(options);
    await expect(evaluateModelRun(db, companyId, runId, review, who)).rejects.toThrow("Actual model receipts");
    expect(learning.evaluate).not.toHaveBeenCalled();
    expect(learning.audit).not.toHaveBeenCalled();
    expect(statements).toHaveLength(2);
    expect(statements.every(statement => statement.text.startsWith("select "))).toBe(true);
  });

  it("preserves company/run lookup and receipt namespace checks before reading usage", async () => {
    const missing = evaluationDatabase({ found: false });
    await expect(evaluateModelRun(missing.db, "other-company", runId, review, who)).rejects.toThrow("Run not found");
    expect(missing.statements[0].params).toEqual(["other-company", runId]);
    const mismatched = evaluationDatabase({ selected: { ...receipt, namespace: "other-company" } });
    await expect(evaluateModelRun(mismatched.db, companyId, runId, review, who)).rejects.toThrow("no Model Intelligence selection receipt");
    expect(mismatched.statements).toHaveLength(1);
    expect(learning.evaluate).not.toHaveBeenCalled();
  });
});

function selectionDatabase() {
  let frozen: SelectionInput | undefined;
  const db = drizzle(async (text, params) => {
    if (text.includes('from "company_operating_profiles"')) return { rows: [[]] };
    if (text.includes('from "issues"')) return { rows: [["Implement a task list", null]] };
    if (text.includes('from "cost_events"')) return { rows: [] };
    if (text.includes('from "agent_instruction_heads"')) return { rows: [["AGENTS.md", "revision-1"]] };
    if (text.startsWith('update "heartbeat_runs"')) {
      if (!text.includes(" returning ")) return { rows: [] };
      const proposed = params.find(value => typeof value === "string" && value.startsWith('{"modelIntelligenceRequest":')) as string;
      frozen ??= JSON.parse(proposed).modelIntelligenceRequest;
      return { rows: [[{ modelIntelligenceRequest: frozen }]] };
    }
    throw new Error(`Unexpected database query: ${text}`);
  }) as unknown as Db;
  return db;
}
const agent = { id: agentId, companyId, adapterType: "codex_local", adapterConfig: { model } } as typeof agents.$inferSelect;
const binding = { mode: "responsible_user" as const, method: "subscription" as const, provider: "openai" as const };
function select(db: Db, effort: Record<string, unknown>) {
  return selectCompanyModelProfile(db, { runId, issueId: "issue-1", agent, binding, config: { model, ...effort }, resumed: false });
}

describe("native model profile effort identity", () => {
  it("gives equivalent aliases the same profile, using native nullish precedence", async () => {
    const variants = [
      { modelReasoningEffort: "medium" }, { reasoningEffort: "medium" }, { effort: "medium" },
      { modelReasoningEffort: "medium", reasoningEffort: "high", effort: "low" },
      { modelReasoningEffort: null, reasoningEffort: "medium", effort: "low" },
      { modelReasoningEffort: null, reasoningEffort: null, effort: "medium" },
    ];
    const results = [];
    for (const variant of variants) results.push(await select(selectionDatabase(), variant));
    expect(new Set(results.map(result => result.request!.promptFingerprint)).size).toBe(1);
    expect(new Set(results.map(result => result.receipt!.candidate.id)).size).toBe(1);
    const changed = await select(selectionDatabase(), { reasoningEffort: "high" });
    expect(changed.request!.promptFingerprint).not.toBe(results[0].request!.promptFingerprint);
    expect(changed.receipt!.candidate.id).not.toBe(results[0].receipt!.candidate.id);
  });

  it("rejects changed effective effort on a queued run before selecting again", async () => {
    const db = selectionDatabase();
    await select(db, { reasoningEffort: "medium" });
    learning.select.mockClear();
    await expect(select(db, { reasoningEffort: "high" })).rejects.toThrow("queued execution profile changed");
    expect(learning.select).not.toHaveBeenCalled();
  });

  it("replays a queued profile when only a shadowed alias changes", async () => {
    const db = selectionDatabase();
    const first = await select(db, { modelReasoningEffort: "medium", reasoningEffort: "low" });
    const second = await select(db, { modelReasoningEffort: "medium", reasoningEffort: "high" });
    expect(second.request).toEqual(first.request);
    expect(second.receipt!.candidate.id).toEqual(first.receipt!.candidate.id);
  });
});
