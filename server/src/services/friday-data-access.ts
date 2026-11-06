import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { agents, toolCatalogEntries, toolConnections, toolInvocations, type Db } from "@paperclipai/db";
import type { FridayDataAccess } from "@paperclipai/shared";
import { accessService } from "./access.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { toolAccessService } from "./tool-access.js";

const EMPLOYEE_LIMIT = 8;
const PERMISSION_LIMIT = 100;
const ACTION_LIMIT = 100;

/** On-demand Agent Map read. Native profile resolution performs local DB reads;
 * it never discovers tools or invokes a provider. Limit its employee cohort,
 * and keep this opt-in projection off normal work/summary/live count reads. */
export async function fridayDataAccess(db: Db, companyId: string, actor: AuthorizationActor,
  taskIds: string[], employeeIds: string[]): Promise<FridayDataAccess> {
  const result: FridayDataAccess = { configuredAccess: "restricted", observedAccess: "restricted",
    resources: [], permissions: [], actions: [], permissionsTruncated: false, actionsTruncated: false };
  // Native effective-profile routes are board + company access, independently
  // of work-read authority. Agents never inherit this management read.
  if (actor.type !== "board") return result;
  const [company] = await authorizationService(db).decideReads(actor, [{ type: "company", companyId }]);
  if (!company.allowed) return result;
  result.configuredAccess = "available";
  // Match tool-gateway/audit, including its native local/admin exceptions.
  const canAudit = actor.source === "local_implicit" || actor.isInstanceAdmin === true
    || !!actor.userId && await accessService(db).canUser(companyId, actor.userId, "tools:view_audit");
  result.observedAccess = canAudit ? "available" : "restricted";
  const resources = new Map<string, FridayDataAccess["resources"][number]>();
  const cohort = employeeIds.length ? await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.companyId, companyId), inArray(agents.id, [...new Set(employeeIds)])))
    .orderBy(asc(agents.id)).limit(EMPLOYEE_LIMIT + 1) : [];
  result.permissionsTruncated = cohort.length > EMPLOYEE_LIMIT;
  const profileOwner = toolAccessService(db);
  for (const employee of cohort.slice(0, EMPLOYEE_LIMIT)) {
    const configured = await profileOwner.getEffectiveToolAssignmentsForAgent(companyId, employee.id);
    for (const tool of configured.allowedTools) {
      if (result.permissions.length >= PERMISSION_LIMIT) { result.permissionsTruncated = true; break; }
      const resourceId = `catalog:${tool.id}`;
      resources.set(resourceId, { id: resourceId, companyId, name: tool.toolName, kind: "catalog" });
      result.permissions.push({ agentId: employee.id, resourceId });
    }
  }
  if (canAudit && taskIds.length) {
    // The caller supplies only its already-authorized loaded task page. Never
    // broaden to all company invocations, null task links or hidden-task counts.
    const rows = await db.select({ id: toolInvocations.id, taskId: toolInvocations.issueId,
      agentId: agents.id, catalogId: toolCatalogEntries.id, connectionId: toolConnections.id,
      toolName: toolInvocations.toolName, riskLevel: toolInvocations.riskLevel, status: toolInvocations.status,
      completedAt: toolInvocations.completedAt, startedAt: toolInvocations.startedAt, createdAt: toolInvocations.createdAt })
      .from(toolInvocations)
      .leftJoin(agents, and(eq(agents.id, toolInvocations.agentId), eq(agents.companyId, companyId)))
      .leftJoin(toolCatalogEntries, and(eq(toolCatalogEntries.id, toolInvocations.catalogEntryId), eq(toolCatalogEntries.companyId, companyId)))
      .leftJoin(toolConnections, and(eq(toolConnections.id, toolInvocations.connectionId), eq(toolConnections.companyId, companyId)))
      .where(and(eq(toolInvocations.companyId, companyId), inArray(toolInvocations.issueId, taskIds)))
      .orderBy(desc(toolInvocations.createdAt), desc(toolInvocations.id)).limit(ACTION_LIMIT + 1);
    result.actionsTruncated = rows.length > ACTION_LIMIT;
    for (const row of rows.slice(0, ACTION_LIMIT)) {
      const resourceId = row.catalogId ? `catalog:${row.catalogId}` : row.connectionId ? `connection:${row.connectionId}` : null;
      if (resourceId && !resources.has(resourceId)) resources.set(resourceId, { id: resourceId, companyId,
        name: row.catalogId ? row.toolName : "Recorded connection", kind: row.catalogId ? "catalog" : "connection" });
      result.actions.push({ id: row.id, taskId: row.taskId!, agentId: row.agentId, resourceId, toolName: row.toolName,
        operation: row.riskLevel === "read" || row.riskLevel === "write" || row.riskLevel === "destructive" ? row.riskLevel : "unknown",
        status: row.status, completedAt: row.completedAt?.toISOString() ?? null,
        observedAt: (row.completedAt ?? row.startedAt ?? row.createdAt).toISOString() });
    }
  }
  result.resources = [...resources.values()];
  return result;
}
