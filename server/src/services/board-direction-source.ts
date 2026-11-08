import { and, eq, sql } from "drizzle-orm";
import { agents, heartbeatRuns, issues, projects, type agentosBoardDirections, type Db } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { portfolioOwnerReadSqlConditions, type AuthorizationActor } from "./authorization.js";
import { nativeHandoffSourceAuthority, nativeHandoffSourceContexts } from "./native-handoff-source-authority.js";
import { fridayOwnConversationSql } from "./friday-board-role.js";

export function boardDirectionActor(row: typeof agentosBoardDirections.$inferSelect): AuthorizationActor {
  return { type: "agent", source: "agent_jwt", companyId: row.sourceCompanyId, agentId: row.sourceAgentId,
    runId: row.sourceRunId, onBehalfOfUserId: row.ownerUserId, authorizingUserId: row.authorizingUserId ?? undefined };
}

export function boardDirectionTaskAccess(tx: Db, contexts: AuthorizationActor[], companyId: string, issueId: string) {
  return and(eq(issues.id, issueId), eq(issues.companyId, companyId), ...contexts.map(actor => {
    const rights = portfolioOwnerReadSqlConditions(actor);
    return and(rights.issue, sql`(${issues.projectId} is null or exists (${tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, issues.projectId), rights.project))}))`);
  }));
}

/** Original native identity and external ceilings remain authoritative after a
 * conversation turn settles. Call inside the operation's transaction. */
export async function authorizeBoardDirectionSource(tx: Db, actor: AuthorizationActor, creating: boolean) {
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || !actor.agentId || !actor.runId || !actor.companyId
    || !actor.onBehalfOfUserId || (actor.keyScope && actor.keyScope.kind !== "standard")) {
    throw forbidden("Board directions require Friday's authenticated native conversation execution");
  }
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, actor.runId),
    eq(heartbeatRuns.companyId, actor.companyId), eq(heartbeatRuns.agentId, actor.agentId))).for("share", { noWait: true });
  if (!run || run.runtimeMode !== "native" || run.responsibleUserId !== actor.onBehalfOfUserId || (creating && run.status !== "running")
    || ["cancelled", "timed_out", "interrupted"].includes(run.status)) throw forbidden("Friday's originating execution is unavailable");
  const nativeAuthority = await nativeHandoffSourceAuthority(tx, run);
  const [conversation] = await tx.select({ own: fridayOwnConversationSql({ companyId: actor.companyId, agentId: actor.agentId,
    issueId: run.nativeIssueId ?? run.issueId ?? null }) }).from(agents).where(and(eq(agents.companyId, actor.companyId), eq(agents.id, actor.agentId)));
  if (!conversation?.own) throw forbidden("Board directions must originate in Friday's own conversation");
  const [chat] = await tx.select({ id: issues.id, conversationSessionGeneration: issues.conversationSessionGeneration,
    status: issues.status }).from(issues).where(and(eq(issues.id, run.nativeIssueId ?? run.issueId!),
    eq(issues.companyId, actor.companyId), eq(issues.conversationUserId, actor.onBehalfOfUserId))).for("share", { noWait: true });
  if (!chat) throw forbidden("The originating conversation must belong to the mandate owner");
  return { ...nativeHandoffSourceContexts(actor, nativeAuthority), run, chat };
}
