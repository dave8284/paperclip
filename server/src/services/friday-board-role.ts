import { and, eq, getTableName, is, sql, type SQLWrapper } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { agents, agentosDepartments, agentosDepartmentProjects, type Db } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";

/** Current designation, never an agent name, title, prompt or client flag. */
export function fridayCoordinatorSql(companyId: string | SQLWrapper, agentId: string | SQLWrapper) {
  // Drizzle strips Column table qualifiers inside a SELECT projection. Preserve
  // explicit identifier nodes so the subquery cannot capture its outer columns.
  const outer = (value: string | SQLWrapper) => is(value, PgColumn)
    ? sql`${sql.identifier(getTableName(value.table))}.${sql.identifier(value.name)}` : value;
  return sql<boolean>`exists (
    select 1 from company_operating_profiles friday_profile
    where friday_profile.company_id = ${outer(companyId)}
      and friday_profile.friday_agent_id = ${outer(agentId)}
  )`;
}

export function fridayOwnConversationSql(input: { companyId: string; agentId: string; issueId: string | null }) {
  const issueReference = input.issueId
    ? isUuidLike(input.issueId) ? sql`friday_conversation.id = ${input.issueId}::uuid` : sql`friday_conversation.identifier = ${input.issueId}`
    : sql`false`;
  return sql<boolean>`exists (select 1 from issues friday_conversation where ${issueReference}
      and friday_conversation.company_id = ${input.companyId}::uuid
      and friday_conversation.conversation_agent_id = ${input.agentId}::uuid
      and friday_conversation.assignee_agent_id = ${input.agentId}::uuid
      and friday_conversation.conversation_user_id is not null)`;
}

export const FRIDAY_DELIVERY_BLOCK_REASON = "Friday directs the company CEO or department heads. Assign delivery work to the company team.";

/** Re-read the designation and real task before any provider preparation. */
export async function assertFridayRunEligible(db: Pick<Db, "select">, input: { companyId: string; agentId: string; issueId: string | null }) {
  const [role] = await db.select({
    isBoardCoordinator: fridayCoordinatorSql(agents.companyId, agents.id),
    ownConversation: fridayOwnConversationSql(input),
  }).from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)));
  if (!role) throw notFound("Agent not found");
  assertFridayWorkEligible({ ...input, isBoardCoordinator: role.isBoardCoordinator,
    kind: role.ownConversation ? "conversation" : "work" });
}

/** A direction targets an actual executive assignment, never a title match. */
export function companyExecutiveRoleCondition(companyId: string, projectId?: string | null) {
  const projectScope = projectId ? sql`and exists (select 1 from ${agentosDepartmentProjects}
    where ${agentosDepartmentProjects.companyId} = ${companyId}
      and ${agentosDepartmentProjects.departmentId} = ${agentosDepartments.id}
      and ${agentosDepartmentProjects.projectId} = ${projectId})` : sql``;
  return and(eq(agents.companyId, companyId),
    sql`not ${fridayCoordinatorSql(agents.companyId, agents.id)}`,
    sql`(${agents.role} = 'ceo' or exists (select 1 from ${agentosDepartments}
      where ${agentosDepartments.companyId} = ${companyId}
        and ${agentosDepartments.leadAgentId} = ${agents.id} ${projectScope}))`,
  );
}

export async function isFridayExecutiveTarget(db: Pick<Db, "select">, input: {
  companyId: string; fridayAgentId: string; assigneeAgentId?: string | null; assigneeUserId?: string | null; projectId?: string | null;
}) {
  if (!input.assigneeAgentId || input.assigneeUserId || input.assigneeAgentId === input.fridayAgentId) return false;
  const [target] = await db.select({ id: agents.id }).from(agents).where(and(
    eq(agents.id, input.assigneeAgentId), companyExecutiveRoleCondition(input.companyId, input.projectId),
  ));
  // Lifecycle, membership, private resource rights and task-assignment policy
  // remain native authorization/assignability checks after this role ceiling.
  return !!target;
}

export function assertFridayWorkEligible(input: {
  isBoardCoordinator?: boolean; companyId: string; agentId: string;
  kind: "work" | "routine" | "conversation";
}) {
  if (input.isBoardCoordinator && input.kind !== "conversation") {
    throw conflict(FRIDAY_DELIVERY_BLOCK_REASON, {
      code: "friday_board_role", companyId: input.companyId, agentId: input.agentId, kind: input.kind,
    });
  }
}
