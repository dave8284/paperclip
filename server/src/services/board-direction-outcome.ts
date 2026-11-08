import { and, desc, eq, or, sql } from "drizzle-orm";
import { heartbeatRuns, issues, type Db } from "@paperclipai/db";
import type { BoardDirectionExecution } from "@paperclipai/shared";
import { readNativeIndependentReview } from "./native-independent-review.js";

/** Caller holds current private-task authority and the task's read lock. Return
 * only native execution/review metadata, never run output or provider context. */
export async function readBoardDirectionOutcome(db: Db, companyId: string, issueId: string): Promise<BoardDirectionExecution | null> {
  const pinned = sql`${heartbeatRuns.runnerProfileJson}->'nativeExecutionInput'`;
  const [run] = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId,
    issueId: issues.id, status: heartbeatRuns.status, startedAt: heartbeatRuns.startedAt, finishedAt: heartbeatRuns.finishedAt,
    scopeMatches: sql<boolean>`coalesce((${pinned}->'binding'->>'companyId' = ${companyId}
      and ${pinned}->'binding'->>'agentId' = ${heartbeatRuns.agentId}::text
      and ${pinned}->'binding'->>'runId' = ${heartbeatRuns.id}::text
      and ${pinned}->'binding'->>'issueId' = ${issueId}
      and ${pinned}->'task'->>'workMode' = 'standard'
      and ${pinned}->'task'->>'title' is not distinct from ${issues.title}
      and ${pinned}->'task'->>'description' is not distinct from ${issues.description}), false)`,
  }).from(heartbeatRuns).innerJoin(issues, and(eq(issues.companyId, heartbeatRuns.companyId), eq(issues.id, issueId)))
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.runtimeMode, "native"),
      or(eq(heartbeatRuns.issueId, issueId), eq(heartbeatRuns.nativeIssueId, issueId)),
      sql`${heartbeatRuns.contextSnapshot}->>'nativeReviewInteractionId' is null`,
      sql`${pinned}->>'executionPurpose' is null`))
    .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id)).limit(1);
  if (!run) return null;
  const review = run.status === "succeeded" ? await readNativeIndependentReview(db, run) : null;
  return { runId: run.id, agentId: run.agentId, status: run.status, startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null, scopeMatchesCurrentTask: run.scopeMatches,
    independentReview: review ? { reviewId: review.reviewId, verdict: review.outcome === "passed" ? "accepted" : "rejected",
      evaluator: review.evaluator, resolvedAt: review.resolvedAt.toISOString() } : null };
}
