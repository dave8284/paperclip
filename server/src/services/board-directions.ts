import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { agentosBoardDirections, agentosDepartments, agentosDepartmentProjects, agents, heartbeatRuns, issues,
  principalPermissionGrants, projects, type Db } from "@paperclipai/db";
import { createBoardDirectionSchema, type CreateBoardDirection, type BoardDirectionReceipt } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { authorizationService, portfolioOwnerReadSqlConditions, type AuthorizationActor } from "./authorization.js";
import { agentosPortfolioMandateService, assertPortfolioMandateActor } from "./agentos-portfolio-mandates.js";
import { boardDirectionFingerprint, boardDirectionMatchesTask } from "./board-direction-intent.js";
import { authorizeBoardDirectionSource as sourceRun, boardDirectionTaskAccess as taskAccess, boardDirectionActor } from "./board-direction-source.js";
import { recordBoardDirectionHandoff } from "./board-direction-return.js";
export { boardDirectionActor } from "./board-direction-source.js";
import { readBoardDirectionOutcome } from "./board-direction-outcome.js";
import { matchesBoardDirectionGrant } from "./board-direction-grants.js";
import { isFridayExecutiveTarget } from "./friday-board-role.js";
import { assertAssignableAgent } from "./agent-assignability.js";
import { issueService } from "./issues.js";
import { persistActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
import { notifyDeliveryWork, DELIVERY_QUEUES } from "./delivery-work-notifications.js";

export type BoardDirection = typeof agentosBoardDirections.$inferSelect;
const receiptTaskColumns = { id: issues.id, identifier: issues.identifier, status: issues.status, assigneeAgentId: issues.assigneeAgentId };
function receipt(row: BoardDirection, task: Pick<typeof issues.$inferSelect, "id" | "identifier" | "status" | "assigneeAgentId">): BoardDirectionReceipt {
  return { id: row.id, targetCompanyId: row.targetCompanyId, taskId: task.id, taskIdentifier: task.identifier,
    executiveAgentId: row.executiveAgentId, dispatchState: row.dispatchState,
    taskStatus: task.status, currentAssigneeAgentId: task.assigneeAgentId, observedAt: new Date().toISOString(),
    createdAt: row.createdAt.toISOString(), dispatchedAt: row.dispatchedAt?.toISOString() ?? null };
}
/** The mandate gateway owns foreign authority; task creation/execution retain
 * their native owners. No source agent is installed as a target-company member. */
export function boardDirectionService(db: Db) {
  function changing(error: unknown): never {
    const failure = error as { code?: string; cause?: { code?: string } };
    if (["55P03", "40P01", "40001"].includes(failure.cause?.code ?? failure.code ?? ""))
      throw conflict("Company authority or work is changing. Retry this request.", { retryable: true });
    throw error;
  }
  async function authority(tx: Db, actor: AuthorizationActor, sourceCompanyId: string,
    input: Pick<CreateBoardDirection, "mandateId" | "revision" | "grantId" | "targetCompanyId" | "executiveAgentId" | "projectId">, creating: boolean) {
    const { effectiveActor, contexts } = await sourceRun(tx, actor, creating);
    const { row } = await agentosPortfolioMandateService(tx).authorizePrivateRead(tx, effectiveActor, sourceCompanyId, input);
    for (const context of contexts.slice(1)) await agentosPortfolioMandateService(tx).authorizePrivateRead(tx, context, sourceCompanyId, input);
    const [grant] = await tx.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.id, input.grantId)).for("share", { noWait: true });
    if (!matchesBoardDirectionGrant(row, grant)) throw forbidden("A separate, current board-direction write grant is required");
    // No source run/workspace/configuration is passed to native target work.
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`operating-profile:${input.targetCompanyId}`}, 0))`);
    const [executive] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, input.targetCompanyId),
      eq(agents.id, input.executiveAgentId))).for("share", { noWait: true });
    if (!executive) throw notFound("Executive not found");
    const heads = await tx.select({ id: agentosDepartments.id }).from(agentosDepartments).where(and(eq(agentosDepartments.companyId, input.targetCompanyId),
      eq(agentosDepartments.leadAgentId, input.executiveAgentId))).for("share", { noWait: true });
    if (heads.length) await tx.select().from(agentosDepartmentProjects).where(inArray(agentosDepartmentProjects.departmentId, heads.map(head => head.id))).for("share", { noWait: true });
    if (!await isFridayExecutiveTarget(tx, { companyId: input.targetCompanyId, fridayAgentId: row.sourceAgentId,
      assigneeAgentId: input.executiveAgentId, projectId: input.projectId })) throw forbidden("Direct company work to its actual CEO or responsible department head");
    await assertAssignableAgent(tx, input.targetCompanyId, input.executiveAgentId, { kind: "work" });
    if (input.projectId) for (const context of contexts) {
      const rights = portfolioOwnerReadSqlConditions(context);
      const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, input.targetCompanyId),
        eq(projects.id, input.projectId), rights.project)).for("share", { noWait: true });
      if (!project) throw notFound("Project not found");
    }
    // Owner authority is a ceiling only. The mutation's actor/provenance stays
    // Friday; this principal never becomes the task creator or dispatch actor.
    for (const userId of [...new Set([row.ownerUserId, ...contexts.flatMap(context => context.authorizingUserId ? [context.authorizingUserId] : [])])]) {
      const ceiling = await authorizationService(tx).decide({ actor: { type: "board", source: "session", userId,
        companyIds: [input.targetCompanyId], ignoreInstanceAdmin: true }, action: "tasks:assign",
        resource: { type: "issue", companyId: input.targetCompanyId, issueId: null, projectId: input.projectId,
          assigneeAgentId: input.executiveAgentId } });
      if (!ceiling.allowed) throw forbidden("The owner and every external authorizer must be able to assign work in this company and project");
    }
    assertPortfolioMandateActor(row, effectiveActor, input.targetCompanyId, input.revision);
    return { mandate: row, effectiveActor, contexts };
  }
  return {
    async authorizeNativeAdmission(tx: Db, row: BoardDirection,
      task: Parameters<typeof boardDirectionMatchesTask>[1] & { status: string; statusVersion: number }) {
      if (!boardDirectionMatchesTask(row, task) || task.statusVersion !== row.expectedIssueStatusVersion
        || !["todo", "in_progress"].includes(task.status)) throw conflict("The company changed this task assignment");
      await authority(tx, boardDirectionActor(row), row.sourceCompanyId, { mandateId: row.mandateId, revision: row.mandateRevision,
        grantId: row.grantId, targetCompanyId: row.targetCompanyId, executiveAgentId: row.executiveAgentId, projectId: task.projectId }, false);
    },
    async create(actor: AuthorizationActor, sourceCompanyId: string, raw: CreateBoardDirection) {
      const input = createBoardDirectionSchema.parse(raw), fingerprint = boardDirectionFingerprint(input);
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`board-direction:${sourceCompanyId}:${actor.agentId}:${input.idempotencyKey}`}, 0))`);
        const { mandate, effectiveActor, contexts } = await authority(tx, actor, sourceCompanyId, input, true);
        const [existing] = await tx.select().from(agentosBoardDirections).where(and(eq(agentosBoardDirections.sourceCompanyId, sourceCompanyId),
          eq(agentosBoardDirections.sourceAgentId, actor.agentId!), eq(agentosBoardDirections.idempotencyKey, input.idempotencyKey)));
        if (existing) {
          if (existing.inputFingerprint !== fingerprint) throw conflict("This direction key was already used for different work");
          const [task] = await tx.select(receiptTaskColumns).from(issues).where(taskAccess(tx, contexts, input.targetCompanyId, existing.issueId));
          if (!task) throw notFound("Task not found");
          return { created: false, direction: receipt(existing, task) };
        }
        const id = randomUUID();
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.boardDirections, id);
        const task = await issueService(tx).create(input.targetCompanyId, { title: input.title, description: input.description,
          priority: input.priority, projectId: input.projectId, assigneeAgentId: input.executiveAgentId, status: "todo",
          parentId: null, originKind: "board_direction", responsibleUserId: mandate.ownerUserId,
          trustExplicitResponsibleUserId: true, skipExecutionWorkspaceInheritance: true, allowDuplicate: true,
          idempotencyKey: `board-direction:${id}` }, tx);
        assertPortfolioMandateActor(mandate, actor, input.targetCompanyId, input.revision);
        const [saved] = await tx.insert(agentosBoardDirections).values({ id, sourceCompanyId, sourceAgentId: actor.agentId!, sourceRunId: actor.runId!,
          ownerUserId: mandate.ownerUserId, authorizingUserId: effectiveActor.authorizingUserId ?? null, mandateId: mandate.id, mandateRevision: mandate.revision,
          grantId: input.grantId, targetCompanyId: input.targetCompanyId, executiveAgentId: input.executiveAgentId, issueId: task.id,
          expectedIssueStatusVersion: task.statusVersion, idempotencyKey: input.idempotencyKey, inputFingerprint: fingerprint,
          wakeupRequestId: randomUUID() }).returning();
        if (!await recordBoardDirectionHandoff(tx, saved)) throw forbidden("The originating conversation generation is unavailable");
        publications.push((await persistActivity(tx, { companyId: sourceCompanyId, actorType: "agent", actorId: actor.agentId!, agentId: actor.agentId,
          runId: actor.runId, action: "agentos.board_direction_created", entityType: "agentos_board_direction", entityId: id,
          details: { targetCompanyId: input.targetCompanyId, issueId: task.id, executiveAgentId: input.executiveAgentId, mandateId: mandate.id, revision: mandate.revision } })).publication);
        publications.push((await persistActivity(tx, { companyId: input.targetCompanyId, actorType: "system", actorId: "board-direction",
          action: "issue.created", entityType: "issue", entityId: task.id,
          details: { title: task.title, assigneeAgentId: task.assigneeAgentId, status: task.status, source: "board_direction" } })).publication);
        return { created: true, direction: receipt(saved, task) };
      }).catch(changing);
      publications.forEach(publishActivity);
      return result;
    },
    async read(actor: AuthorizationActor, sourceCompanyId: string, id: string, currentMandateRevision: number) {
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const [row] = await tx.select().from(agentosBoardDirections).where(and(eq(agentosBoardDirections.id, id),
          eq(agentosBoardDirections.sourceCompanyId, sourceCompanyId), eq(agentosBoardDirections.sourceAgentId, actor.agentId ?? "00000000-0000-0000-0000-000000000000")));
        if (!row) throw notFound("Direction not found");
        const contexts = actor.source === "agent_jwt" && actor.runId ? (await sourceRun(tx, actor, false)).contexts : [actor];
        for (const context of contexts) await agentosPortfolioMandateService(tx).authorizePrivateRead(tx, context, sourceCompanyId,
          { mandateId: row.mandateId, revision: currentMandateRevision, targetCompanyId: row.targetCompanyId });
        // Current private-resource rights remain necessary, even after a handoff.
        const visible = taskAccess(tx, contexts, row.targetCompanyId, row.issueId);
        const [task] = await tx.select(receiptTaskColumns).from(issues).where(visible).for("share", { noWait: true });
        if (!task) throw notFound("Task not found");
        const execution = await readBoardDirectionOutcome(tx, row.targetCompanyId, row.issueId);
        // Review evidence spans several bounded native statements. Recheck the
        // resource predicate after them, including independent project privacy.
        if (!(await tx.select({ id: issues.id }).from(issues).where(visible)).length) throw notFound("Task not found");
        publications.push((await persistActivity(tx, { companyId: sourceCompanyId, actorType: "agent", actorId: actor.agentId!, agentId: actor.agentId,
          runId: actor.runId, action: "agentos.board_direction_read", entityType: "agentos_board_direction", entityId: row.id,
          details: { targetCompanyId: row.targetCompanyId, issueId: row.issueId, revision: currentMandateRevision } })).publication);
        return { ...receipt(row, task), execution };
      }).catch(changing);
      publications.forEach(publishActivity);
      return result;
    },
    async authorizePending(row: BoardDirection): Promise<void> {
      return db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const [task] = await tx.select().from(issues).where(and(eq(issues.id, row.issueId), eq(issues.companyId, row.targetCompanyId)));
        if (!task || !boardDirectionMatchesTask(row, task)
          || task.statusVersion !== row.expectedIssueStatusVersion || !["todo", "in_progress"].includes(task.status)) throw conflict("The company changed this task assignment");
        await authority(tx, boardDirectionActor(row), row.sourceCompanyId, { mandateId: row.mandateId, revision: row.mandateRevision,
          grantId: row.grantId, targetCompanyId: row.targetCompanyId, executiveAgentId: row.executiveAgentId, projectId: task.projectId }, false);
      });
    },
  };
}
