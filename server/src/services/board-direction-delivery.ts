import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { agentosBoardDirections, agentWakeupRequests, heartbeatRuns, type Db } from "@paperclipai/db";
import { boardDirectionService, type BoardDirection } from "./board-directions.js";
import type { heartbeatService } from "./heartbeat.js";
import { persistActivity, publishActivity } from "./activity-log.js";

type State = "dispatched" | "cancelled";
type DeliveryPort = {
  accepted: () => Promise<boolean>;
  enqueue: () => Promise<unknown>;
  settle: (state: State, code?: string) => Promise<void>;
  retry: (code: string) => Promise<void>;
};
/** An accepted native receipt wins over later revocation/assignment changes:
 * the company already owns that work. Never enqueue a second run to repair an
 * acknowledgement gap, and never equate admission with successful delivery. */
export async function deliverBoardDirection(port: DeliveryPort) {
  try {
    if (await port.accepted()) { await port.settle("dispatched"); return; }
    await port.enqueue();
    if (await port.accepted()) await port.settle("dispatched");
    else await port.retry("native_admission_wait");
  } catch (error) {
    // Admission can commit before the client observes an error. Recover that
    // receipt first, even when the same attempt now appears forbidden/stale.
    if (await port.accepted()) { await port.settle("dispatched"); return; }
    const failure = error as { status?: number; code?: string; cause?: { code?: string }; details?: { code?: string; retryable?: boolean } };
    if (failure.details?.retryable || ["55P03", "40P01", "40001"].includes(failure.cause?.code ?? failure.code ?? "")) await port.retry("authority_busy");
    else if (failure.details?.code === "board_direction_admission_wait") await port.retry("native_admission_wait");
    else if ([403, 404, 409].includes(failure.status ?? 0)) await port.settle("cancelled", "authority_or_assignment_changed");
    else await port.retry("delivery_unconfirmed");
  }
}

export function boardDirectionDeliveryService(db: Db, options: { heartbeat: Pick<ReturnType<typeof heartbeatService>, "wakeup">; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const directions = boardDirectionService(db);
  let nextAttempt: number | null = null;
  const pending = eq(agentosBoardDirections.dispatchState, "pending");
  const lease = (row: BoardDirection) => and(eq(agentosBoardDirections.id, row.id), pending,
    eq(agentosBoardDirections.attemptCount, row.attemptCount), eq(agentosBoardDirections.leaseExpiresAt, row.leaseExpiresAt!));
  async function accepted(row: BoardDirection) {
    const [receipt] = await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests)
      .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, agentWakeupRequests.runId), eq(heartbeatRuns.wakeupRequestId, agentWakeupRequests.id),
        eq(heartbeatRuns.companyId, row.targetCompanyId), eq(heartbeatRuns.agentId, row.executiveAgentId),
        or(eq(heartbeatRuns.issueId, row.issueId), eq(heartbeatRuns.nativeIssueId, row.issueId))))
      .where(and(eq(agentWakeupRequests.id, row.wakeupRequestId), eq(agentWakeupRequests.companyId, row.targetCompanyId),
        eq(agentWakeupRequests.agentId, row.executiveAgentId), eq(agentWakeupRequests.source, "assignment"),
        eq(agentWakeupRequests.requestedByActorType, "system"), eq(agentWakeupRequests.requestedByActorId, "board-direction"),
        eq(agentWakeupRequests.idempotencyKey, `board-direction:${row.id}`), sql`${agentWakeupRequests.payload}->>'issueId' = ${row.issueId}`));
    return !!receipt;
  }
  async function settle(row: BoardDirection, state: State, code?: string) {
    const publication = await db.transaction(async connection => {
      const tx = connection as unknown as Db;
      const [saved] = await tx.update(agentosBoardDirections).set({ dispatchState: state, leaseExpiresAt: null,
        dispatchedAt: state === "dispatched" ? now() : null, lastErrorCode: code ?? null, updatedAt: now() }).where(lease(row)).returning();
      if (!saved) return null;
      return (await persistActivity(tx, { companyId: row.sourceCompanyId, actorType: "system", actorId: "board-direction",
        action: `agentos.board_direction_${state}`, entityType: "agentos_board_direction", entityId: row.id,
        details: { targetCompanyId: row.targetCompanyId, issueId: row.issueId, code: code ?? null } })).publication;
    });
    if (publication) publishActivity(publication);
  }
  async function retry(row: BoardDirection, code: string) {
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(4, Math.max(0, row.attemptCount - 1)));
    await db.update(agentosBoardDirections).set({ leaseExpiresAt: null, lastErrorCode: code,
      nextAttemptAt: new Date(now().getTime() + delay), updatedAt: now() }).where(lease(row));
  }
  return {
    async sweepPending(signal?: AbortSignal) {
      const at = now();
      const due = and(pending, lte(agentosBoardDirections.nextAttemptAt, at), or(isNull(agentosBoardDirections.leaseExpiresAt), lte(agentosBoardDirections.leaseExpiresAt, at)));
      const candidates = await db.select({ id: agentosBoardDirections.id }).from(agentosBoardDirections).where(due)
        .orderBy(asc(agentosBoardDirections.nextAttemptAt), asc(agentosBoardDirections.id)).limit(25);
      for (const candidate of candidates) {
        if (signal?.aborted) break;
        const [row] = await db.update(agentosBoardDirections).set({ attemptCount: sql`${agentosBoardDirections.attemptCount} + 1`,
          leaseExpiresAt: new Date(now().getTime() + 60_000), updatedAt: now() }).where(and(eq(agentosBoardDirections.id, candidate.id), due)).returning();
        if (!row) continue;
        await deliverBoardDirection({ accepted: () => accepted(row), settle: (state, code) => settle(row, state, code), retry: code => retry(row, code),
          enqueue: async () => {
            await directions.authorizePending(row);
            return options.heartbeat.wakeup(row.executiveAgentId, {
            source: "assignment", triggerDetail: "system", reason: "board_direction", idempotencyKey: `board-direction:${row.id}`,
            requestedByActorType: "system", requestedByActorId: "board-direction",
            payload: { issueId: row.issueId, mutation: "board_direction" },
            contextSnapshot: { issueId: row.issueId, taskKey: row.issueId, responsibleUserId: row.ownerUserId, source: "board_direction" },
            durableBoardDirectionRequest: { directionId: row.id, wakeupRequestId: row.wakeupRequestId, issueId: row.issueId,
              expectedIssueStatusVersion: row.expectedIssueStatusVersion },
            });
          },
        });
      }
    },
    async hasPending() {
      const [row] = await db.select({ at: sql<Date | string | null>`min(greatest(${agentosBoardDirections.nextAttemptAt}, coalesce(${agentosBoardDirections.leaseExpiresAt}, ${agentosBoardDirections.nextAttemptAt})))` })
        .from(agentosBoardDirections).where(pending);
      nextAttempt = row?.at == null ? null : new Date(row.at).getTime();
      if (nextAttempt !== null && !Number.isFinite(nextAttempt)) throw new Error("Board direction retry deadline is invalid");
      return nextAttempt !== null && nextAttempt <= now().getTime();
    },
    nextRunAt: () => nextAttempt,
  };
}
