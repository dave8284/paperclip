import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { agentosBoardDirections, agentosPortfolioMandates, chatTaskHandoffs, heartbeatRuns, issueAccessGrants,
  issues, projectAccessMembers, projects, type Db } from "@paperclipai/db";
import { conflict, forbidden } from "../errors.js";
import { agentosPortfolioMandateService } from "./agentos-portfolio-mandates.js";
import { authorizeBoardDirectionSource, boardDirectionActor, boardDirectionTaskAccess } from "./board-direction-source.js";

type Direction = typeof agentosBoardDirections.$inferSelect;
type Task = typeof issues.$inferSelect;
type Handoff = typeof chatTaskHandoffs.$inferSelect;

/** Match native privacy writers' tree fence, then retain every row that can
 * authorize this projection until publication commits. Parent UPDATE locks also
 * fence FK-backed insertion of a new grant/member between lock and predicate. */
async function lockReturnPrivacy(tx: Db, companyId: string, issueId: string, userIds: string[]) {
  const locks = await tx.execute(sql`select pg_try_advisory_xact_lock_shared(hashtextextended(${`issue-privacy-tree:${companyId}`}, 0)) as locked`);
  if (!locks[0]?.locked) throw conflict("Company privacy is changing", { retryable: true });
  const ancestors = await tx.execute<{ id: string; project_id: string | null }>(sql`
    with recursive return_ancestors as (
      select id, company_id, privacy_parent_issue_id from issues where id = ${issueId} and company_id = ${companyId}
      union
      select p.id, p.company_id, p.privacy_parent_issue_id from issues p join return_ancestors child
        on p.id = child.privacy_parent_issue_id and p.company_id = child.company_id
    ) select i.id, i.project_id from issues i join return_ancestors a on a.id = i.id and a.company_id = i.company_id
      order by i.id for update of i nowait`);
  if (!ancestors.length) throw forbidden("The directed company's task is unavailable");
  const issueIds = ancestors.map(row => row.id);
  const projectIds = [...new Set(ancestors.flatMap(row => row.project_id ? [row.project_id] : []))].sort();
  if (projectIds.length) {
    await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds)))
      .orderBy(projects.id).for("update", { noWait: true });
    await tx.select({ id: projectAccessMembers.id }).from(projectAccessMembers).where(and(eq(projectAccessMembers.companyId, companyId),
      inArray(projectAccessMembers.projectId, projectIds), eq(projectAccessMembers.subjectType, "user"), inArray(projectAccessMembers.subjectId, userIds)))
      .orderBy(projectAccessMembers.id).for("share", { noWait: true });
  }
  await tx.select({ id: issueAccessGrants.id }).from(issueAccessGrants).where(and(inArray(issueAccessGrants.issueId, issueIds),
    eq(issueAccessGrants.subjectType, "user"), inArray(issueAccessGrants.subjectId, userIds)))
    .orderBy(issueAccessGrants.id).for("share", { noWait: true });
}

/** Capture only the server-recorded conversation identity. This relation grants
 * no foreign read authority; every attempted return revalidates it below. */
export async function recordBoardDirectionHandoff(tx: Db, direction: Direction): Promise<Handoff | null> {
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, direction.sourceRunId),
    eq(heartbeatRuns.companyId, direction.sourceCompanyId), eq(heartbeatRuns.agentId, direction.sourceAgentId)));
  const sourceId = run?.nativeIssueId ?? run?.issueId;
  if (!run || run.runtimeMode !== "native" || run.responsibleUserId !== direction.ownerUserId || !sourceId) return null;
  const [source] = await tx.select().from(issues).where(and(eq(issues.id, sourceId), eq(issues.companyId, direction.sourceCompanyId),
    eq(issues.conversationAgentId, direction.sourceAgentId), eq(issues.assigneeAgentId, direction.sourceAgentId),
    eq(issues.conversationUserId, direction.ownerUserId)));
  if (!source || source.status === "cancelled" || source.conversationSessionGeneration !== run.contextSnapshot?.conversationSessionGeneration) return null;
  await tx.insert(chatTaskHandoffs).values({ taskId: direction.issueId, companyId: direction.sourceCompanyId,
    conversationId: source.id, agentId: direction.sourceAgentId, sessionGeneration: source.conversationSessionGeneration }).onConflictDoNothing();
  const [saved] = await tx.select().from(chatTaskHandoffs).where(eq(chatTaskHandoffs.taskId, direction.issueId));
  if (!saved || saved.companyId !== direction.sourceCompanyId || saved.conversationId !== source.id ||
    saved.agentId !== direction.sourceAgentId || saved.sessionGeneration !== source.conversationSessionGeneration) return null;
  return saved;
}

export async function recordBoardDirectionHandoffForTask(tx: Db, task: Task): Promise<Handoff | null> {
  const rows = await tx.select().from(agentosBoardDirections).where(and(eq(agentosBoardDirections.issueId, task.id),
    eq(agentosBoardDirections.targetCompanyId, task.companyId))).limit(2);
  return rows.length === 1 ? recordBoardDirectionHandoff(tx, rows[0]!) : null;
}

/** This is a read-return ceiling, never a replay of the old write grant. The
 * current mandate may have a new revision, but must retain the same owner,
 * Friday and target. Private result bodies stay behind the native gateway. */
export async function authorizeBoardDirectionReturn(tx: Db, input: {
  handoff: Handoff; task: Task; source: Task | null | undefined; statusVersion: number;
}) {
  const { handoff, task, source } = input;
  const rows = await tx.select().from(agentosBoardDirections).where(and(eq(agentosBoardDirections.issueId, task.id),
    eq(agentosBoardDirections.targetCompanyId, task.companyId))).limit(2).for("share", { noWait: true });
  if (!rows.length && task.companyId === handoff.companyId) return null;
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.sourceCompanyId !== handoff.companyId || row.sourceAgentId !== handoff.agentId ||
    !source || source.companyId !== row.sourceCompanyId || source.id !== handoff.conversationId ||
    source.conversationUserId !== row.ownerUserId || source.conversationAgentId !== row.sourceAgentId ||
    source.assigneeAgentId !== row.sourceAgentId || source.status === "cancelled" ||
    source.conversationSessionGeneration !== handoff.sessionGeneration || task.status !== "done" || task.statusVersion !== input.statusVersion) {
    throw forbidden("The original board-direction return audience is unavailable");
  }
  if (row.dispatchState === "pending") throw conflict("Board direction admission is still being confirmed", { retryable: true });
  if (row.dispatchState !== "dispatched") throw forbidden("This board direction was not dispatched");
  const origin = await authorizeBoardDirectionSource(tx, boardDirectionActor(row), false);
  if (origin.chat.id !== source.id || origin.run.contextSnapshot?.conversationSessionGeneration !== handoff.sessionGeneration) {
    throw forbidden("The originating Friday conversation was reset");
  }
  const [mandate] = await tx.select().from(agentosPortfolioMandates).where(eq(agentosPortfolioMandates.id, row.mandateId))
    .for("share", { noWait: true });
  if (!mandate) throw forbidden("The board-direction read mandate is unavailable");
  for (const actor of origin.contexts) await agentosPortfolioMandateService(tx).authorizePrivateRead(tx, actor, row.sourceCompanyId,
    { mandateId: row.mandateId, revision: mandate.revision, targetCompanyId: row.targetCompanyId });
  await lockReturnPrivacy(tx, row.targetCompanyId, row.issueId,
    [...new Set([row.ownerUserId, ...origin.contexts.flatMap(actor => actor.authorizingUserId ? [actor.authorizingUserId] : [])])].sort());
  const [visible] = await tx.select({ id: issues.id }).from(issues)
    .where(and(boardDirectionTaskAccess(tx, origin.contexts, row.targetCompanyId, row.issueId),
      eq(issues.status, "done"), eq(issues.statusVersion, input.statusVersion))).for("share", { noWait: true });
  if (!visible) throw forbidden("The directed company's task is no longer readable");
  return { id: row.id, sourceCompanyId: row.sourceCompanyId, targetCompanyId: row.targetCompanyId,
    mandateId: row.mandateId, revision: mandate.revision,
    outcomePath: `/api/companies/${row.sourceCompanyId}/friday/board-directions/${row.id}?revision=${mandate.revision}` };
}

/** Once per worker lifecycle, reconstruct old Done directions that predate the
 * return producer. Existing handoffs/transition receipts make restart a no-op.
 * Capture an upper ID and page through that range; never turn completed history
 * into a timer. New directions already write their relation atomically. */
export async function recoverBoardDirectionReturns(db: Db, enqueue: (tx: Db, task: Task) => Promise<unknown>) {
  const [upper] = await db.select({ id: agentosBoardDirections.id }).from(agentosBoardDirections)
    .orderBy(desc(agentosBoardDirections.id)).limit(1);
  if (!upper) return;
  let cursor: string | null = null;
  for (;;) {
    const rows: { id: string; issueId: string; targetCompanyId: string }[] = await db.select({ id: agentosBoardDirections.id,
      issueId: agentosBoardDirections.issueId, targetCompanyId: agentosBoardDirections.targetCompanyId }).from(agentosBoardDirections)
      .innerJoin(issues, and(eq(issues.id, agentosBoardDirections.issueId), eq(issues.companyId, agentosBoardDirections.targetCompanyId)))
      .where(and(eq(issues.status, "done"), eq(agentosBoardDirections.dispatchState, "dispatched"),
        lte(agentosBoardDirections.id, upper.id),
        sql`not exists (select 1 from ${chatTaskHandoffs} where ${chatTaskHandoffs.taskId} = ${agentosBoardDirections.issueId})`,
        ...(cursor ? [gt(agentosBoardDirections.id, cursor)] : [])))
      .orderBy(asc(agentosBoardDirections.id)).limit(100);
    if (!rows.length) return;
    for (const row of rows) await db.transaction(async connection => {
      const tx = connection as unknown as Db;
      const [task] = await tx.select().from(issues).where(and(eq(issues.id, row.issueId), eq(issues.companyId, row.targetCompanyId)))
        .for("update", { noWait: true });
      if (task?.status === "done" && await recordBoardDirectionHandoffForTask(tx, task)) await enqueue(tx, task);
    });
    cursor = rows[rows.length - 1]!.id;
  }
}
