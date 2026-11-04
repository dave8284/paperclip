import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { issues, projects, type Db } from "@paperclipai/db";
import { fridayDiagnosticsQuerySchema } from "@paperclipai/shared";
import { fridayDiagnosticsService } from "../services/friday-diagnostics.js";

const native = vi.hoisted(() => ({ company: vi.fn(), issues: vi.fn(), projects: vi.fn(), voice: vi.fn(), supervisor: vi.fn(), triageStatus: vi.fn(), triageDecide: vi.fn() }));
vi.mock("../services/authorization.js", () => ({ authorizationService: () => ({ decideReads: native.company }), issueReadSqlCondition: native.issues, projectReadSqlCondition: native.projects }));
vi.mock("../services/friday-voice.js", () => ({ fridayVoiceStatus: native.voice }));
vi.mock("../dev-server-status.js", () => ({ readPersistedDevServerStatus: native.supervisor }));
vi.mock("../services/local-triage.js", () => ({ localTriageRuntime: { status: native.triageStatus, decide: native.triageDecide } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId: "worker", runId: "run", onBehalfOfUserId: "responsible", authorizingUserId: "authorizer" };
const query = fridayDiagnosticsQuerySchema.parse({ limit: 1 });
function database(options: { failRuns?: boolean; project?: boolean; code?: string } = {}) {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const db = drizzle(async (text, params) => {
    statements.push({ text, params });
    if (text.includes('from "heartbeat_runs"')) {
      if (options.failRuns) throw new Error("private-provider-token-and-stderr");
      return { rows: [["run-1", "Readable task", "failed", options.code ?? "adapter_failed", "conversation"], ["run-2", "Older task", "timed_out", "timeout", "task"]] };
    }
    if (text.startsWith('select "id" from "projects"')) return { rows: options.project ? [[projectId]] : [] };
    return { rows: [["task-1", "Readable blocked task", "blocked"], ["task-2", "Older blocked task", "blocked"]] };
  }) as unknown as Db;
  return { db, statements };
}
beforeEach(() => {
  vi.clearAllMocks();
  native.company.mockResolvedValue([{ allowed: true }]);
  native.issues.mockResolvedValue(eq(issues.title, "native-task-read-guard"));
  native.projects.mockResolvedValue(eq(projects.name, "native-project-read-guard"));
  native.voice.mockResolvedValue({ available: true, reason: "private-install-path" });
  native.triageStatus.mockResolvedValue("disabled");
  native.supervisor.mockReturnValue({ dirty: true, changedPathCount: 1, pendingMigrations: ["private-migration"], changedPathsSample: ["private-path"] });
});

describe("Friday diagnostic native projection without a database listener", () => {
  it("applies native task/project privacy before both ordered pages and retains actor identity", async () => {
    const { db, statements } = database();
    const result = await fridayDiagnosticsService(db).read(companyId, actor, query);
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.text).toContain('"issues"."company_id" =');
      expect(statement.text).toContain('"issues"."hidden_at" is null');
      expect(statement.text).toContain('"issues"."title" =');
      expect(statement.text).toContain('"projects"."company_id" =');
      expect(statement.text).toContain('"projects"."name" =');
      expect(statement.params).toContain(companyId);
      expect(statement.params).toContain("native-task-read-guard");
      expect(statement.params).toContain("native-project-read-guard");
      expect(statement.text).toMatch(/where[\s\S]*order by[\s\S]*limit/);
      expect(statement.params.at(-1)).toBe(2);
      const projection = statement.text.slice(0, statement.text.indexOf(" from "));
      expect(projection).not.toMatch(/stderr_excerpt|stdout_excerpt|context_snapshot|result_json|runner_profile_json/);
    }
    const runs = statements.find(statement => statement.text.includes('from "heartbeat_runs"'))!;
    expect(runs.text).toContain('"issues"."id" = "heartbeat_runs"."issue_id"');
    expect(runs.text).toContain('"heartbeat_runs"."scope_kind" =');
    expect(runs.params).toContain("issue");
    expect(runs.text).toContain('"issues"."conversation_agent_id" =');
    expect(runs.text).toContain('"issues"."conversation_user_id" =');
    for (const identity of ["worker", "responsible", "authorizer"]) expect(runs.params).toContain(identity);
    expect(native.company.mock.calls[0][0]).toMatchObject(actor);
    expect(native.issues.mock.calls[0][1]).toMatchObject(actor);
    expect(native.projects.mock.calls[0][1]).toMatchObject(actor);
    expect(result.checks[0]).toMatchObject({ status: "checked", nextOffset: 1, records: [{ id: "task-1" }] });
    expect(result.checks[1]).toMatchObject({ status: "checked", nextOffset: 1, records: [{ errorCode: "adapter_failed", kind: "conversation" }] });
    expect(result.checks.find(check => check.id === "server_readiness")?.status).toBe("unknown");
    expect(result.checks.find(check => check.id === "connections")?.status).toBe("unknown");
    expect(native.supervisor).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-|responsible|authorizer/);
  });

  it.each([
    { type: "none" as const },
    { ...actor, companyId: "another-company" },
    { ...actor, keyScope: { kind: "issue" } as never },
  ])("rejects inadmissible actors before any diagnostic work", async invalid => {
    const { db, statements } = database();
    await expect(fridayDiagnosticsService(db).read(companyId, invalid, query)).rejects.toMatchObject({ status: 403 });
    expect(statements).toHaveLength(0); expect(native.company).not.toHaveBeenCalled(); expect(native.voice).not.toHaveBeenCalled(); expect(native.triageStatus).not.toHaveBeenCalled();
  });

  it("rejects revoked company access before predicates and installation reads", async () => {
    native.company.mockResolvedValue([{ allowed: false }]);
    const { db, statements } = database();
    await expect(fridayDiagnosticsService(db).read(companyId, actor, query)).rejects.toMatchObject({ status: 403 });
    expect(statements).toHaveLength(0); expect(native.issues).not.toHaveBeenCalled(); expect(native.voice).not.toHaveBeenCalled(); expect(native.triageStatus).not.toHaveBeenCalled();
  });

  it("rejects an unreadable requested project before exposing other diagnostics", async () => {
    const { db, statements } = database();
    await expect(fridayDiagnosticsService(db).read(companyId, actor, { ...query, projectId })).rejects.toMatchObject({ status: 404 });
    expect(statements).toHaveLength(1); expect(native.voice).not.toHaveBeenCalled(); expect(native.triageStatus).not.toHaveBeenCalled();
  });

  it("reports a failed check as unknown while retaining successful checks and omitting error payloads", async () => {
    const { db } = database({ failRuns: true });
    const result = await fridayDiagnosticsService(db).read(companyId, actor, query);
    expect(result.checks.find(check => check.id === "failed_runs")).toMatchObject({ status: "unknown", result: "unknown" });
    expect(result.checks.find(check => check.id === "blocked_tasks")?.status).toBe("checked");
    expect(JSON.stringify(result)).not.toContain("private-provider");
  });

  it("projects only allowlisted failure codes and a minimal administrator restart result", async () => {
    const { db } = database({ code: "private-provider-token" });
    const result = await fridayDiagnosticsService(db).read(companyId, { type: "board", source: "session", userId: "admin", isInstanceAdmin: true }, query);
    expect(result.checks.find(check => check.id === "failed_runs")?.records?.[0].errorCode).toBe("unclassified_failure");
    expect(result.checks.find(check => check.id === "server_readiness")).toMatchObject({ status: "checked", result: "attention" });
    expect(native.supervisor).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it.each(["disabled", "setup_required", "cold", "warming", "ready", "busy", "unavailable"] as const)(
    "reads local triage %s without warming, inference or paid fallback", async readiness => {
      native.triageStatus.mockResolvedValue(readiness);
      const { db } = database();
      const result = await fridayDiagnosticsService(db).read(companyId, actor, query);
      const check = result.checks.find(item => item.id === "local_triage");
      expect(check).toMatchObject({ status: "checked", localTriageStatus: readiness,
        result: readiness === "setup_required" || readiness === "unavailable" ? "attention" : "clear",
        sourcePath: `/api/companies/${companyId}/friday/diagnostics` });
      expect(check?.nextStep).toContain("never loads a model, runs inference or uses a paid fallback");
      expect(native.triageStatus).toHaveBeenCalledExactlyOnceWith({ readOnly: true });
      expect(native.triageDecide).not.toHaveBeenCalled();
      expect(check).not.toHaveProperty("records");
    },
  );

  it("withholds local triage dependency failures while keeping other checks", async () => {
    native.triageStatus.mockRejectedValue(new Error("private-model-path-and-credentials"));
    const { db } = database();
    const result = await fridayDiagnosticsService(db).read(companyId, actor, query);
    expect(result.checks.find(item => item.id === "local_triage")).toMatchObject({ status: "unknown", result: "unknown" });
    expect(result.checks.find(item => item.id === "local_voice")?.status).toBe("checked");
    expect(JSON.stringify(result)).not.toContain("private-model");
    expect(native.triageDecide).not.toHaveBeenCalled();
  });

  it("refreshes membership evidence and does not schedule repeat reads after a request settles", async () => {
    const { db, statements } = database();
    await fridayDiagnosticsService(db).read(companyId, { ...actor, memberships: [{ companyId, status: "active" }], onBehalfOfMemberships: [{ companyId, status: "active" }] }, query);
    expect(native.company.mock.calls[0][0].memberships).toBeUndefined();
    expect(native.company.mock.calls[0][0].onBehalfOfMemberships).toBeUndefined();
    const reads = statements.length;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(statements).toHaveLength(reads); expect(native.voice).toHaveBeenCalledOnce(); expect(native.triageStatus).toHaveBeenCalledOnce(); expect(native.triageDecide).not.toHaveBeenCalled();
  });
});
