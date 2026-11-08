import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, companies, companySkills, companySkillTestRuns, companySkillVersions, createDb, heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { documentService } from "../documents.js";
import { buildNativeSkillTestRequest, buildNativeSkillTestRuntimeContext, loadNativeSkillTestPreparation } from "./native-skill-test.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";

describe("native skill-test tool isolation", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const companyId = randomUUID(), agentId = randomUUID();
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("native-skill-test-tools-");
    db = createDb(temporary.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Skill isolation", issuePrefix: "SKI" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Test agent", status: "active", adapterType: "paperclip_runner",
      adapterConfig: { provider: "codex", privateValue: "PRIVATE_AGENT_CONFIGURATION" } });
  });
  afterAll(async () => { await temporary?.cleanup(); });

  async function fixture() {
    const issueId = randomUUID(), runId = randomUUID(), skillId = randomUUID(), skillVersionId = randomUUID(), testRunId = randomUUID();
    const binding = { companyId, agentId, issueId, runId };
    const markdown = "# Frozen skill\nReturn the input in uppercase.\n";
    await db.insert(companySkills).values({ id: skillId, companyId, key: `skill-${skillId}`, slug: `skill-${skillId}`, name: "Pinned skill", markdown });
    await db.insert(companySkillVersions).values({ id: skillVersionId, companyId, companySkillId: skillId, revisionNumber: 1,
      fileInventory: [{ path: "SKILL.md", kind: "skill", content: markdown }] });
    await db.insert(issues).values({ id: issueId, companyId, title: "Harness", description: "PRIVATE_MUTABLE_ISSUE_TEXT", status: "in_progress",
      workMode: "skill_test", harnessKind: "skill_test", originKind: "skill_test", originId: testRunId, assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId,
      invocationSource: "assignment", contextSnapshot: { issueId, paperclipAgentJwtScope: { kind: "skill_test", issueId } } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    await db.insert(companySkillTestRuns).values({ id: testRunId, companyId, skillId, skillVersionId, agentId, issueId, inputSnapshot: "hello", status: "running" });
    const pinned = await loadNativeSkillTestPreparation(db, binding);
    const runtimeContext = await buildNativeSkillTestRuntimeContext(pinned);
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: { schema: "paperclip.native-execution-input.v10",
      binding, executionPurpose: pinned.purpose, runtimeContext, task: { description: buildNativeSkillTestRequest(pinned) } } } }).where(eq(heartbeatRuns.id, runId));
    const authority = new PaperclipRunnerToolAuthority(db, { ...binding, workMode: "skill_test", skillTestPurpose: pinned.purpose, runtimeContext,
      apiToolsEnabled: true, workspaceRoot: "/must-never-be-opened", workspaceBridge: true });
    const call = (tool: string, args: unknown = {}) => authority.execute({ tool, callId: randomUUID(), arguments: args });
    return { ...binding, skillId, skillVersionId, testRunId, markdown, pinned, runtimeContext, authority, call };
  }

  it("exposes only the frozen test and writes its own output once", async () => {
    const f = await fixture();
    expect(f.authority.definitions().map(tool => tool.name).sort()).toEqual([
      "get_task_context", "list_assigned_skills", "read_assigned_skill", "read_document", "report_progress", "write_document",
    ]);
    await db.update(companySkills).set({ markdown: "CHANGED_CURRENT_SKILL" }).where(eq(companySkills.id, f.skillId));
    await db.update(issues).set({ title: "CHANGED_LIVE_TITLE", description: "CHANGED_LIVE_INSTRUCTIONS" }).where(eq(issues.id, f.issueId));
    const context = await f.call("get_task_context");
    expect(context).toMatchObject({ activeTask: { title: "Skill Studio test", description: buildNativeSkillTestRequest(f.pinned) } });
    expect(JSON.stringify(context)).toContain('hello');
    expect(JSON.stringify(context)).not.toMatch(/PRIVATE_MUTABLE_ISSUE_TEXT|PRIVATE_AGENT_CONFIGURATION|CHANGED_CURRENT_SKILL|CHANGED_LIVE_TITLE|CHANGED_LIVE_INSTRUCTIONS/);
    expect(await f.call("read_assigned_skill", { skill: f.pinned.skillKey })).toMatchObject({ text: f.markdown, versionId: f.skillVersionId });
    for (const tool of ["call_api", "search_api", "get_task", "get_task_history", "search_tasks", "list_agents", "get_agent", "list_people",
      "get_identity", "connections_search", "connections_request", "slack_history", "assigned_mcp_tool", "read_tool_result",
      "workspace_read", "workspace_run", "workspace_write", "read_chat_attachment", "read_task_attachment", "resolve_review", "create_skill", "update_skill", "hire_agent"]) {
      await expect(f.call(tool, { taskId: randomUUID() })).rejects.toMatchObject({ status: 403 });
    }
    await expect(f.call("read_assigned_skill", { skill: f.pinned.skillKey, path: "references/private.md" })).rejects.toMatchObject({ status: 403 });
    await expect(f.call("read_document", { key: "private" })).rejects.toMatchObject({ status: 403 });
    await expect(f.call("write_document", { key: "output", taskId: randomUUID() })).rejects.toMatchObject({ status: 400 });
    const output = { key: "output", title: "Test output", body: "HELLO", baseRevisionId: null, idempotencyKey: "same-output" };
    const first = await f.call("write_document", output);
    expect(await f.call("write_document", output)).toEqual(first);
    expect((await documentService(db).getIssueDocumentByKey(f.issueId, "output"))?.latestRevisionNumber).toBe(1);
    await f.call("report_progress", { body: "Saved the test output", idempotencyKey: "same-progress" });
    await f.call("report_progress", { body: "Saved the test output", idempotencyKey: "same-progress" });
    expect(await db.select().from(issueComments).where(and(eq(issueComments.companyId, companyId), eq(issueComments.issueId, f.issueId)))).toHaveLength(1);
    expect(await f.call("read_document", { key: "output" })).toMatchObject({ document: { body: "HELLO" } });
  });

  it.each(["cancelled", "superseded", "deleted", "reassigned", "changed_mode"])("revokes reads, writes and replay after %s", async change => {
    const f = await fixture();
    const output = { key: "output", title: "Original", body: "HELLO", baseRevisionId: null, idempotencyKey: "original" };
    await f.call("write_document", output);
    if (change === "cancelled") await db.update(companySkillTestRuns).set({ status: "cancelled" }).where(eq(companySkillTestRuns.id, f.testRunId));
    if (change === "superseded") await db.update(companySkillTestRuns).set({ supersededAt: new Date() }).where(eq(companySkillTestRuns.id, f.testRunId));
    if (change === "deleted") await db.update(companySkillTestRuns).set({ deletedAt: new Date() }).where(eq(companySkillTestRuns.id, f.testRunId));
    if (change === "reassigned") await db.update(issues).set({ executionRunId: null }).where(eq(issues.id, f.issueId));
    if (change === "changed_mode") await db.update(issues).set({ workMode: "standard", harnessKind: null }).where(eq(issues.id, f.issueId));
    for (const [tool, args] of [["get_task_context", {}], ["read_document", { key: "output" }], ["write_document", output]] as const) {
      await expect(f.call(tool, args)).rejects.toThrow();
    }
    const ordinary = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId: f.issueId, runId: f.runId, workMode: "standard" });
    await expect(ordinary.execute({ tool: "list_agents", callId: randomUUID(), arguments: {} })).rejects.toThrow();
    expect((await documentService(db).getIssueDocumentByKey(f.issueId, "output"))?.latestRevisionNumber).toBe(1);
  });

  it("rejects substituted version content and reconstructed runtime scope", async () => {
    const f = await fixture();
    const tampered = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId: f.issueId, runId: f.runId,
      skillTestPurpose: f.pinned.purpose, runtimeContext: { ...f.runtimeContext, aggregateDigest: "0".repeat(64) } });
    await expect(tampered.execute({ tool: "get_task_context", callId: randomUUID(), arguments: {} })).rejects.toMatchObject({ status: 403 });
    await db.update(companySkillVersions).set({ fileInventory: [{ path: "SKILL.md", kind: "skill", content: "OTHER_BYTES" }] }).where(eq(companySkillVersions.id, f.skillVersionId));
    await expect(f.call("read_assigned_skill", { skill: f.pinned.skillKey })).rejects.toMatchObject({ status: 409 });
  });
});
