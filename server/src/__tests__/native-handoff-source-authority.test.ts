import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { dotAgentBindings, museAgentBindings, mcpOauthGrants, type heartbeatRuns, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeHandoffSourceAuthority, nativeHandoffSourceContexts } from "../services/native-handoff-source-authority.js";
import { parseNativeExecutionInput, canonicalNativeRuntimeContextDigest, nativeRuntimePromptDigest,
  NATIVE_RUNTIME_ASSET_SCHEMA, PAPERCLIP_EXECUTION_PROMPT, PAPERCLIP_EXECUTION_PROMPT_REVISION } from "../vendor/paperclip-runner/index.js";

const broker = vi.hoisted(() => ({ authorizer: vi.fn(), bot: vi.fn() }));
vi.mock("../services/muse-runner-broker.js", () => ({ museRunnerBroker: () => ({ authorizingUserIdForBinding: broker.authorizer }) }));
vi.mock("../services/external-bot-authority.js", () => ({ authorizeExternalBotBinding: broker.bot }));
vi.mock("../modules/external-agents/index.js", async () => {
  const actual = await vi.importActual<typeof import("../modules/external-agents/admission.js")>("../modules/external-agents/admission.js");
  return { withExternalAdmissionGuard: actual.withExternalAdmissionGuard };
});
function fixture(kind: "muse" | "openai_dot" | "grok_bot" = "muse") {
  const id = randomUUID(), companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), bindingId = randomUUID(), grantId = randomUUID();
  const digest = "0".repeat(64), now = Date.now();
  const context = { prompt: { revision: PAPERCLIP_EXECUTION_PROMPT_REVISION, text: PAPERCLIP_EXECUTION_PROMPT, digest: nativeRuntimePromptDigest() },
    instructions: { entryPath: "AGENTS.md", bundle: { schema: NATIVE_RUNTIME_ASSET_SCHEMA, digest, manifestDigest: digest, rootPath: "/synthetic/handoff", fileCount: 1, totalBytes: 4 } },
    skills: [], mcp: { assignmentSetId: "none", digest, bindingId: null } };
  const driverKind = kind === "muse" ? "muse_external" : kind === "grok_bot" ? "grok_bot_mcp" : "openai_dot_mcp";
  const execution = parseNativeExecutionInput({ schema: kind === "muse" ? "paperclip.native-execution-input.v8" : "paperclip.native-execution-input.v6",
    binding: { companyId, agentId, runId: id, issueId, executionWorkspaceId: randomUUID() },
    task: { identifier: "BOARD-1", title: "Board direction", description: null, prompt: "Direct company work.", workMode: "standard" },
    provider: { kind, model: null, ...(kind === "muse" ? { bridgeRevision: "muse-v1" } : {}), binding: { companyId, agentId, bindingId,
      bindingGeneration: 7, acceptByUnixMs: now - 120000, expiresAtUnixMs: now - 60000 } },
    workspace: { access: "none", cwd: null, repoUrl: null, repoRef: null, branchName: null },
    session: { normalizedSessionId: randomUUID(), driverKind, protocolVersion: 1, lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
    executionMode: "default", planningContext: null,
    completionContract: { id: randomUUID(), sha256: `sha256:${digest}`, schemaVersion: "paperclip.completion-contract.v1",
      contract: { revision: "1", objective: "Direct company work", criteria: [{ id: "direction", requirement: "Send a direction" }] } },
    runtimeContext: { ...context, aggregateDigest: canonicalNativeRuntimeContextDigest(context) }, interactionResponses: [], credentialBindings: [] });
  const run = { id, companyId, agentId, nativeIssueId: issueId, issueId, driverKind, status: "succeeded", runnerProfileJson: { nativeExecutionInput: execution } } as typeof heartbeatRuns.$inferSelect;
  const binding = { id: bindingId, companyId, agentId, grantId, generation: 7, operatorId: "connection-owner", providerKind: kind };
  const grant = { id: grantId, companyId, agentId, userId: "connection-owner", purpose: "agent", scopes: ["paperclip:agent"] };
  const rows = new Map<string, Record<string, unknown> | null>([[getTableName(kind === "muse" ? museAgentBindings : dotAgentBindings), binding], [getTableName(mcpOauthGrants), grant]]);
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    const table = [museAgentBindings, dotAgentBindings, mcpOauthGrants].find(table => sql.includes(`from "${getTableName(table)}"`));
    if (!table) throw new Error("Unexpected authority dependency");
    const row = rows.get(getTableName(table));
    return { rows: row ? [Object.keys(getTableColumns(table)).map(key => row[key] ?? null)] : [] };
  }) as unknown as Db;
  return { run, binding, grant, db, rows, queries };
}
beforeEach(() => { vi.clearAllMocks(); broker.authorizer.mockResolvedValue("connection-owner"); });
describe("current external handoff source authority", () => {
  it("does no external work for an ordinary native provider", async () => {
    const f = fixture(); f.run.driverKind = "codex_app_server"; f.run.runnerProfileJson = {};
    expect(await nativeHandoffSourceAuthority(f.db, f.run)).toEqual({}); expect(f.queries).toHaveLength(0);
  });
  it("revalidates a settled Muse source's persistent binding without reviving its expired assignment", async () => {
    const f = fixture();
    expect(await nativeHandoffSourceAuthority(f.db, f.run)).toEqual({ authorizingUserId: "connection-owner", connectionUserId: "connection-owner" });
    expect(broker.authorizer).toHaveBeenCalledWith(expect.objectContaining({ companyId: f.run.companyId, agentId: f.run.agentId, bindingId: f.binding.id, bindingGeneration: 7 }));
    expect(f.queries[0].params).toContain(`paperclip:external-admission:${f.run.companyId}:${f.run.agentId}`);
    expect(f.queries.slice(1).every(query => query.sql.includes("for share nowait"))).toBe(true);
  });
  it.each(["companyId", "agentId", "id", "nativeIssueId"] as const)("rejects a changed native source %s before querying connection authority", async key => {
    const f = fixture(); f.run[key] = randomUUID();
    await expect(nativeHandoffSourceAuthority(f.db, f.run)).rejects.toMatchObject({ status: 403 }); expect(f.queries).toHaveLength(0);
  });
  it.each(["muse", "openai_dot", "grok_bot"] as const)("rejects a removed %s binding or OAuth grant", async kind => {
    const f = fixture(kind), table = kind === "muse" ? museAgentBindings : dotAgentBindings;
    f.rows.set(getTableName(table), null);
    await expect(nativeHandoffSourceAuthority(f.db, f.run)).rejects.toMatchObject({ status: 403 });
    f.rows.set(getTableName(table), f.binding); f.rows.set(getTableName(mcpOauthGrants), null);
    await expect(nativeHandoffSourceAuthority(f.db, f.run)).rejects.toMatchObject({ status: 403 });
    expect(broker.authorizer).not.toHaveBeenCalled(); expect(broker.bot).not.toHaveBeenCalled();
  });
  it("propagates current Muse credential/owner denial instead of trusting the saved identity", async () => {
    const f = fixture(); broker.authorizer.mockRejectedValue({ status: 403 });
    await expect(nativeHandoffSourceAuthority(f.db, f.run)).rejects.toMatchObject({ status: 403 });
  });
  it.each(["openai_dot", "grok_bot"] as const)("checks current %s binding identity/generation and retains every connection ceiling", async kind => {
    const f = fixture(kind); broker.bot.mockResolvedValue({ ...f.binding, operatorId: "different-operator" });
    expect(await nativeHandoffSourceAuthority(f.db, f.run)).toEqual({ connectionUserId: "connection-owner", additionalCeilingUserIds: ["different-operator"] });
    expect(broker.bot).toHaveBeenCalledWith(f.db, expect.objectContaining({ actor: { type: "agent", agentId: f.run.agentId, companyId: f.run.companyId } }), { provider: kind });
    broker.bot.mockResolvedValue({ ...f.binding, generation: 8 });
    await expect(nativeHandoffSourceAuthority(f.db, f.run)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects an external run with malformed or missing pinned execution input", async () => {
    const f = fixture(); f.run.runnerProfileJson = {};
    await expect(nativeHandoffSourceAuthority(f.db, f.run)).rejects.toMatchObject({ status: 403 }); expect(f.queries).toHaveLength(0);
  });
  it("adds every current authority ceiling without replacing source agent, run or responsible owner", () => {
    const actor = { type: "agent" as const, source: "agent_jwt", agentId: "friday", companyId: "source", runId: "run", onBehalfOfUserId: "owner" };
    const { contexts } = nativeHandoffSourceContexts(actor, { connectionUserId: "connection-owner", additionalCeilingUserIds: ["operator", "operator", "owner"] });
    expect(contexts.map(context => context.authorizingUserId)).toEqual(["connection-owner", "operator"]);
    for (const context of contexts) { expect(context).toMatchObject(actor); expect(context).not.toHaveProperty("userId"); }
    expect(() => nativeHandoffSourceContexts({ ...actor, authorizingUserId: "old-authorizer" }, { connectionUserId: "new-authorizer" })).toThrow("authorizer changed");
    expect(() => nativeHandoffSourceContexts({ ...actor, authorizingUserId: "old-authorizer" }, {})).toThrow("authorizer changed");
  });
});
