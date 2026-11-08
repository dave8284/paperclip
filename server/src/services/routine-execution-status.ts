import { and, eq } from "drizzle-orm";
import { issues, routineRuns, routines, type Db } from "@paperclipai/db";

const EXECUTION_ISSUE_TRANSIENT_FAILURE_CODE = "execution_issue_status";
const EXECUTION_ISSUE_TRANSIENT_FAILURE_STATUSES = ["blocked", "cancelled"] as const;
type ExecutionIssueTransientFailureStatus = (typeof EXECUTION_ISSUE_TRANSIENT_FAILURE_STATUSES)[number];

function executionIssueTransientFailureReason(status: ExecutionIssueTransientFailureStatus) {
  return `Execution issue moved to ${status}`;
}

function executionIssueTransientFailureStatusFromPayload(payload: unknown): ExecutionIssueTransientFailureStatus | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const transientFailure = (payload as Record<string, unknown>).transientFailure;
  if (!transientFailure || typeof transientFailure !== "object" || Array.isArray(transientFailure)) return null;
  const record = transientFailure as Record<string, unknown>;
  if (record.code !== EXECUTION_ISSUE_TRANSIENT_FAILURE_CODE) return null;
  return EXECUTION_ISSUE_TRANSIENT_FAILURE_STATUSES.find((status) => record.status === status) ?? null;
}

function executionIssueTransientFailureClearedAtFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const transientFailure = (payload as Record<string, unknown>).transientFailure;
  if (!transientFailure || typeof transientFailure !== "object" || Array.isArray(transientFailure)) return null;
  const clearedAt = (transientFailure as Record<string, unknown>).clearedAt;
  return typeof clearedAt === "string" ? clearedAt : null;
}

function legacyExecutionIssueTransientFailureStatus(
  failureReason: string | null,
): ExecutionIssueTransientFailureStatus | null {
  return EXECUTION_ISSUE_TRANSIENT_FAILURE_STATUSES.find(
    (status) => failureReason === executionIssueTransientFailureReason(status),
  ) ?? null;
}

/** Routine status owns this projection. Call inside the issue writer's transaction
 * so native decisions and service callers cannot commit a finished task without
 * its cycle. The routine facade retains its existing HTTP/repair entry point. */
export async function syncRoutineRunStatusForIssue(db: Db, issueId: string) {
  const [issue] = await db.select({ id: issues.id, companyId: issues.companyId, status: issues.status,
    originKind: issues.originKind, originId: issues.originId, originRunId: issues.originRunId,
  }).from(issues).where(eq(issues.id, issueId));
  if (!issue || issue.originKind !== "routine_execution" || !issue.originId || !issue.originRunId) return null;
  const binding = and(eq(routineRuns.id, issue.originRunId), eq(routineRuns.companyId, issue.companyId),
    eq(routineRuns.routineId, issue.originId), eq(routineRuns.linkedIssueId, issue.id));
  const [run] = await db.select({ id: routineRuns.id, status: routineRuns.status,
    failureReason: routineRuns.failureReason, triggerPayload: routineRuns.triggerPayload,
  }).from(routineRuns).innerJoin(routines, and(eq(routines.id, routineRuns.routineId),
    eq(routines.companyId, issue.companyId))).where(binding).for("update", { of: routineRuns });
  if (!run) return null;
  const transientStatus = executionIssueTransientFailureStatusFromPayload(run.triggerPayload)
    ?? legacyExecutionIssueTransientFailureStatus(run.failureReason);
  const now = new Date();
  let patch: Partial<typeof routineRuns.$inferInsert>;
  if (issue.status === "done") {
    // Exact replay preserves the original completion time and history.
    if (run.status === "completed") return null;
    if (run.status !== "issue_created" && !(run.status === "failed" && transientStatus)) return null;
    patch = { status: "completed", failureReason: null, completedAt: now,
      ...(transientStatus ? { triggerPayload: { ...(run.triggerPayload ?? {}), transientFailure: {
        code: EXECUTION_ISSUE_TRANSIENT_FAILURE_CODE, status: transientStatus,
        reason: executionIssueTransientFailureReason(transientStatus),
        clearedAt: executionIssueTransientFailureClearedAtFromPayload(run.triggerPayload) ?? now.toISOString(),
      } } } : {}),
    };
  } else if (issue.status === "blocked" || issue.status === "cancelled") {
    if (run.status === "failed" && transientStatus === issue.status) return null;
    if (!["issue_created", "completed"].includes(run.status) && !(run.status === "failed" && transientStatus)) return null;
    patch = { status: "failed", failureReason: executionIssueTransientFailureReason(issue.status), completedAt: now,
      triggerPayload: { ...(run.triggerPayload ?? {}), transientFailure: {
        code: EXECUTION_ISSUE_TRANSIENT_FAILURE_CODE, status: issue.status,
        reason: executionIssueTransientFailureReason(issue.status), recordedAt: now.toISOString(),
      } },
    };
  } else if (run.status === "failed" && transientStatus) {
    patch = { status: "issue_created", failureReason: null, completedAt: null,
      triggerPayload: { ...(run.triggerPayload ?? {}), transientFailure: {
        code: EXECUTION_ISSUE_TRANSIENT_FAILURE_CODE, status: transientStatus,
        reason: executionIssueTransientFailureReason(transientStatus), clearedAt: now.toISOString(),
      } },
    };
  } else return null;
  const [updated] = await db.update(routineRuns).set({ ...patch, updatedAt: now })
    .where(and(binding, eq(routineRuns.status, run.status))).returning();
  return updated ?? null;
}
