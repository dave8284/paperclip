import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { heartbeatRuns, issues, projects, type Db } from "@paperclipai/db";
import { fridayDiagnosticsQuerySchema, type FridayDiagnosticCheck, type FridayDiagnostics, type FridayDiagnosticsQuery } from "@paperclipai/shared";
import { forbidden, notFound } from "../errors.js";
import { readPersistedDevServerStatus } from "../dev-server-status.js";
import { authorizationService, issueReadSqlCondition, projectReadSqlCondition, type AuthorizationActor } from "./authorization.js";
import { executionIssueCondition, visibleIssueCondition } from "./issue-visibility.js";
import { fridayVoiceStatus } from "./friday-voice.js";
import { localTriageRuntime, type LocalTriageStatus } from "./local-triage.js";

// Provider messages and arbitrary error strings never enter this projection.
const safeRunCodes = new Set([
  "timeout", "cancelled", "adapter_failed", "configuration_incomplete", "codex_auth_required",
  "agent_not_found", "agent_not_invokable", "agent_chat_disabled", "issue_dependencies_blocked",
  "server_shutdown_interrupted", "provider_transport_failed", "native_provider_overloaded",
  "native_provider_model_rejected", "native_execution_ownership_unverified", "native_session_retry_exhausted",
  "turn_limit_exhausted", "max_turns_exhausted",
]);

const localTriageGuidance: Record<LocalTriageStatus, { summary: string; nextStep: string }> = {
  disabled: { summary: "Local Laya triage is disabled.", nextStep: "Local triage is optional and instance-operator controlled. Existing task execution remains available." },
  setup_required: { summary: "Local Laya triage needs installation or configuration.", nextStep: "An instance operator can review the pinned local installation. This check does not prepare or download models." },
  cold: { summary: "Local Laya triage files are configured; the model is unloaded.", nextStep: "A later native triage request may warm the model. File readiness alone does not verify that it can load or predict." },
  warming: { summary: "Local Laya triage is loading its model.", nextStep: "Let the existing load finish. Tasks continue without a local observation while it warms." },
  ready: { summary: "Local Laya triage has loaded the pinned model and is ready.", nextStep: "Readiness does not establish prediction quality or routing accuracy. Local observations do not change task routing." },
  busy: { summary: "Local Laya triage is processing an existing request.", nextStep: "Concurrent requests skip local observation rather than queue. Existing task execution remains available." },
  unavailable: { summary: "Local Laya triage could not start or remain available.", nextStep: "An instance operator can review the local installation. Tasks continue without a local observation." },
};

/** Request-driven inspection only. Native SQL privacy runs before each bounded
 * page. No inference, provider probe, credential access, mutation or timer. */
export function fridayDiagnosticsService(db: Db) {
  return {
    async read(companyId: string, actor: AuthorizationActor, input: FridayDiagnosticsQuery): Promise<FridayDiagnostics> {
      const query = fridayDiagnosticsQuerySchema.parse(input);
      if (actor.type === "none" || (actor.type === "agent" && (actor.companyId !== companyId
        || (actor.keyScope && actor.keyScope.kind !== "standard")))) throw forbidden("Diagnostics require standard company access");
      const readActor = { ...actor, memberships: undefined, onBehalfOfMemberships: undefined };
      Reflect.deleteProperty(readActor, "__responsibleUserSnapshotMemo");
      const [companyAccess] = await authorizationService(db).decideReads(readActor, [{ type: "company", companyId }]);
      if (!companyAccess?.allowed) throw forbidden("Company discovery access required");
      const projectCondition = and(eq(projects.companyId, companyId), await projectReadSqlCondition(db, readActor));
      if (query.projectId) {
        const [project] = await db.select({ id: projects.id }).from(projects).where(and(projectCondition, eq(projects.id, query.projectId))).limit(1);
        if (!project) throw notFound("Project not found");
      }
      const visibleProjects = db.select({ id: projects.id }).from(projects).where(projectCondition);
      const issueCondition = and(eq(issues.companyId, companyId), visibleIssueCondition(), await issueReadSqlCondition(db, readActor),
        or(isNull(issues.projectId), inArray(issues.projectId, visibleProjects)), query.projectId ? eq(issues.projectId, query.projectId) : undefined);
      // Native chat discovery is participant-bound even when an older chat row
      // has open task visibility. Diagnostics must not broaden that discovery.
      const conversationCondition = actor.type === "board" && actor.userId ? eq(issues.conversationUserId, actor.userId)
        : actor.type === "agent" && actor.agentId && actor.onBehalfOfUserId
          ? and(eq(issues.conversationAgentId, actor.agentId), eq(issues.conversationUserId, actor.onBehalfOfUserId),
            actor.authorizingUserId ? eq(issues.conversationUserId, actor.authorizingUserId) : undefined)
          : sql`false`;
      const workPath = `/api/companies/${companyId}/friday/work${query.projectId ? `?projectId=${query.projectId}` : ""}`;
      async function checked(id: FridayDiagnosticCheck["id"], sourcePath: string, inspect: () => Promise<FridayDiagnosticCheck>): Promise<FridayDiagnosticCheck> {
        try { return await inspect(); }
        catch { return { id, status: "unknown", result: "unknown", sourcePath, summary: "This check could not finish.", nextStep: "Read the authorized source again before drawing a conclusion; other checks may still be useful." }; }
      }
      const checks = await Promise.all([
        checked("blocked_tasks", workPath, async () => {
          const rows = await db.select({ id: issues.id, title: issues.title, status: issues.status }).from(issues)
            .where(and(issueCondition, executionIssueCondition(), eq(issues.status, "blocked"))).orderBy(desc(issues.updatedAt), desc(issues.id)).offset(query.offset).limit(query.limit + 1);
          return { id: "blocked_tasks", status: "checked", result: rows.length ? "attention" : "clear",
            summary: rows.length ? "These readable tasks are recorded as blocked." : "No blocked tasks were found on this authorized page.",
            nextStep: "Read each task's current blockers and decisions before proposing or taking an authorized next step.", sourcePath: workPath,
            records: rows.slice(0, query.limit).map(row => ({ ...row, sourcePath: `/api/issues/${row.id}` })),
            nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
        }),
        checked("failed_runs", workPath, async () => {
          // Use the native immutable run scope binding, never contextSnapshot
          // IDs or a current assignee as a substitute for task authorization.
          const rows = await db.select({ id: heartbeatRuns.id, title: issues.title, status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode,
            kind: sql<"task" | "conversation">`case when ${issues.conversationAgentId} is null then 'task' else 'conversation' end` })
            .from(heartbeatRuns).innerJoin(issues, and(eq(issues.id, heartbeatRuns.issueId), eq(issues.companyId, heartbeatRuns.companyId)))
            .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.scopeKind, "issue"), issueCondition,
              or(executionIssueCondition(), conversationCondition),
              inArray(heartbeatRuns.status, ["failed", "timed_out", "interrupted"])))
            .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id)).offset(query.offset).limit(query.limit + 1);
          return { id: "failed_runs", status: "checked", result: rows.length ? "attention" : "clear",
            summary: rows.length ? "Historical failed or interrupted runs exist for readable tasks or your conversations; a later attempt may have recovered." : "No failed task or conversation runs were found on this authorized page.",
            nextStep: "Read the current task and native run outcome before diagnosing an ongoing failure or retrying work.", sourcePath: workPath,
            records: rows.slice(0, query.limit).map(row => ({ id: row.id, title: row.title, status: row.status, kind: row.kind,
              errorCode: row.errorCode && safeRunCodes.has(row.errorCode) ? row.errorCode : "unclassified_failure", sourcePath: `/api/heartbeat-runs/${row.id}` })),
            nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
        }),
        checked("local_voice", `/api/companies/${companyId}/friday/voice`, async () => {
          const voice = await fridayVoiceStatus();
          return { id: "local_voice", status: "checked", result: voice.available ? "clear" : "attention",
            summary: voice.available ? "Local speech installation files are present." : "Local speech installation is not ready.",
            nextStep: voice.available ? "Microphone permissions, recognition quality, playback and response latency still require an actual voice turn." : "Review Settings → Voice. Typing remains available; this check does not prepare or download models.",
            sourcePath: `/api/companies/${companyId}/friday/voice` };
        }),
        checked("local_triage", `/api/companies/${companyId}/friday/diagnostics`, async () => {
          const readiness = await localTriageRuntime.status({ readOnly: true });
          const guidance = localTriageGuidance[readiness];
          return { id: "local_triage", status: "checked", localTriageStatus: readiness,
            result: readiness === "setup_required" || readiness === "unavailable" ? "attention" : "clear",
            summary: guidance.summary, nextStep: `${guidance.nextStep} This check never loads a model, runs inference or uses a paid fallback.`,
            sourcePath: `/api/companies/${companyId}/friday/diagnostics` };
        }),
        checked("server_readiness", "/api/health", async () => {
          const admin = actor.type === "board" && (actor.source === "local_implicit" || (actor.isInstanceAdmin === true && !actor.ignoreInstanceAdmin && actor.source !== "mcp_oauth"));
          if (!admin) return { id: "server_readiness", status: "unknown", result: "unknown", summary: "Instance restart readiness requires administrator access.", nextStep: "An instance administrator can inspect the native health and restart controls.", sourcePath: "/api/health" };
          // Existing bounded local status reader; omit paths, migrations, process
          // identifiers and all restart intent contents from this summary.
          const status = readPersistedDevServerStatus();
          if (!status) return { id: "server_readiness", status: "unknown", result: "unknown", summary: "No development supervisor status is available.", nextStep: "Use the deployment's native health and release controls; absence of this file is not a failed production server.", sourcePath: "/api/health" };
          const restartRequired = status.dirty || status.changedPathCount > 0 || status.pendingMigrations.length > 0;
          return { id: "server_readiness", status: "checked", result: restartRequired ? "attention" : "clear",
            summary: restartRequired ? "Saved supervisor status reports a restart is required." : "Saved supervisor status reports no restart requirement.",
            nextStep: "Recheck the native health control before an authorized restart. This saved status does not prove restart safety or deployment completion.", sourcePath: "/api/health" };
        }),
      ]);
      checks.push({ id: "connections", status: "unknown", result: "unknown", summary: "External provider connections and subscription capacity were not probed.",
        nextStep: "Use the connection owner's authorized settings and native failure receipts. Do not substitute paid billing or infer availability from a saved connection.", sourcePath: `/api/companies/${companyId}/ai-connections` });
      return { version: 1, companyId, projectId: query.projectId ?? null, observedAt: new Date().toISOString(), scope: "authorized_current_company", checks,
        limits: ["Only currently readable execution tasks and participant-bound conversations are checked. Hidden tasks, other people's conversations, company-wide and unbound runs are excluded.",
          "Task and run pages are independently bounded; follow each nextOffset using this endpoint before claiming complete coverage.",
          "No provider, physical microphone, browser playback, database backup or deployed release was tested. A clear check is not a complete platform health verdict."] };
    },
  };
}
