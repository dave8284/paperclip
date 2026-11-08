import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { describe, expect, it } from "vitest";
import { assertAssignableAgent } from "../services/agent-assignability.js";
import { authorizationService } from "../services/authorization.js";
import { assertFridayRunEligible, isFridayExecutiveTarget } from "../services/friday-board-role.js";
import { prepareHeartbeatExecutionConfiguration, type HeartbeatExecutionConfigurationInput } from "../services/heartbeat/execution-configuration.js";

function controlledRows(rows: unknown[][][]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (!rows.length) throw new Error("Unexpected dependency read");
    return { rows: rows.shift()! };
  }) as unknown as Db;
  return { db, queries };
}

describe("Friday board role at native boundaries", () => {
  it.each(["applications:manage", "agents:create", "workforce:retire", "project:write_workspace"] as const)(
    "denies Friday's %s before grants, provider work or impersonation", async action => {
      const companyId = randomUUID(), agentId = randomUUID();
      const { db, queries } = controlledRows([[[agentId, companyId, "ceo", "idle", null, {}, true]]]);
      const decision = await authorizationService(db).decide({
        actor: { type: "agent", agentId, companyId, onBehalfOfUserId: "owner", authorizingUserId: "authorizer" }, action,
        resource: action === "project:write_workspace" ? { type: "issue", companyId, projectId: randomUUID() }
          : { type: "company", companyId },
      });
      expect(decision).toMatchObject({ allowed: false, reason: "deny_scope" });
      expect(queries).toHaveLength(1);
    });

  it("denies specialist assignment through native authorization despite a CEO label on Friday", async () => {
    const companyId = randomUUID(), agentId = randomUUID();
    const { db, queries } = controlledRows([[[agentId, companyId, "ceo", "idle", null, {}, true]], []]);
    const decision = await authorizationService(db).decide({ actor: { type: "agent", agentId, companyId }, action: "tasks:assign",
      resource: { type: "issue", companyId, assigneeAgentId: randomUUID() } });
    expect(decision).toMatchObject({ allowed: false, reason: "deny_scope" });
    expect(queries).toHaveLength(2);
  });

  it.each(["agent_config:update", "agent_instructions:update", "agent:wake"] as const)(
    "cannot bypass executive delegation through another agent's %s", async action => {
      const companyId = randomUUID(), agentId = randomUUID();
      const { db, queries } = controlledRows([[[agentId, companyId, "ceo", "idle", null, {}, true]], ...(action === "agent:wake" ? [[]] : [])]);
      const decision = await authorizationService(db).decide({ actor: { type: "agent", agentId, companyId }, action,
        resource: { type: "agent", companyId, agentId: randomUUID() } });
      expect(decision).toMatchObject({ allowed: false, reason: "deny_scope" });
      expect(queries).toHaveLength(action === "agent:wake" ? 2 : 1);
    });

  it.each(["work", "routine"] as const)("rejects %s assignment before traversing the org chain", async kind => {
    const companyId = randomUUID(), agentId = randomUUID();
    const { db, queries } = controlledRows([[[agentId, companyId, "Any name", "idle", null, true]]]);
    await expect(assertAssignableAgent(db, companyId, agentId, { kind }))
      .rejects.toMatchObject({ status: 409, details: { code: "friday_board_role" } });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('friday_profile.friday_agent_id = "agents"."id"');
    expect(queries[0]!.sql).toContain('friday_profile.company_id = "agents"."company_id"');
  });

  it("preserves Friday's native conversation assignment", async () => {
    const companyId = randomUUID(), agentId = randomUUID();
    const row = [agentId, companyId, "Friday", "idle", null];
    const { db } = controlledRows([[[...row, true]], [row]]);
    await expect(assertAssignableAgent(db, companyId, agentId, { kind: "conversation" })).resolves.toBeUndefined();
  });

  it("does not infer the role from a worker named Friday", async () => {
    const companyId = randomUUID(), agentId = randomUUID();
    const row = [agentId, companyId, "Friday", "idle", null];
    const { db } = controlledRows([[[...row, false]], [row]]);
    await expect(assertAssignableAgent(db, companyId, agentId)).resolves.toBeUndefined();
  });

  it.each([null, "CASE-17", "00000000-0000-4000-8000-000000000001"])("rejects nonconversation preparation for %s", async issueId => {
    const companyId = randomUUID(), agentId = randomUUID();
    const { db, queries } = controlledRows([[[true, false]]]);
    // Intentionally no provider/secret/config dependencies: refusal must happen
    // before preparation can acquire them, including for a recovered attempt.
    const input = { run: { id: randomUUID() }, agent: { id: agentId, companyId }, task: { issueId } } as unknown as HeartbeatExecutionConfigurationInput;
    await expect(prepareHeartbeatExecutionConfiguration(db, input))
      .rejects.toMatchObject({ details: { code: "friday_board_role" } });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('friday_conversation.conversation_user_id is not null');
    expect(queries[0]!.sql).toContain('friday_conversation.company_id =');
    expect(queries[0]!.sql).toContain('friday_conversation.assignee_agent_id =');
  });

  it.each([[true, true], [false, false]])("admits role=%s ownConversation=%s at the role ceiling", async (isFriday, ownConversation) => {
    const { db } = controlledRows([[[isFriday, ownConversation]]]);
    await expect(assertFridayRunEligible(db, { companyId: randomUUID(), agentId: randomUUID(), issueId: randomUUID() }))
      .resolves.toBeUndefined();
  });

  it("rejects missing agents", async () => {
    const { db } = controlledRows([[]]);
    await expect(assertFridayRunEligible(db, { companyId: randomUUID(), agentId: randomUUID(), issueId: null }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("rejects self, human and unassigned executive targets without a query", async () => {
    const { db, queries } = controlledRows([]);
    const companyId = randomUUID(), fridayAgentId = randomUUID();
    for (const target of [{}, { assigneeAgentId: fridayAgentId }, { assigneeAgentId: randomUUID(), assigneeUserId: "owner" }]) {
      expect(await isFridayExecutiveTarget(db, { companyId, fridayAgentId, ...target })).toBe(false);
    }
    expect(queries).toEqual([]);
  });

  it("checks an executive's native company and department/project assignment", async () => {
    const companyId = randomUUID(), fridayAgentId = randomUUID(), assigneeAgentId = randomUUID(), projectId = randomUUID();
    const { db, queries } = controlledRows([[[assigneeAgentId]], []]);
    expect(await isFridayExecutiveTarget(db, { companyId, fridayAgentId, assigneeAgentId, projectId })).toBe(true);
    expect(await isFridayExecutiveTarget(db, { companyId, fridayAgentId, assigneeAgentId, projectId })).toBe(false);
    expect(queries[0]!.sql).toContain('"agents"."role" = \'ceo\'');
    expect(queries[0]!.sql).toContain('"agentos_departments"."lead_agent_id"');
    expect(queries[0]!.sql).toContain('"agentos_department_projects"."project_id"');
    expect(queries[0]!.params).toContain(projectId);
    expect(queries[0]!.params).toContain(companyId);
  });
});
