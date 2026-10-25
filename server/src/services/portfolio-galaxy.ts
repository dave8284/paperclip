import { and, asc, eq, inArray } from "drizzle-orm";
import { issues, managedApplicationProjects, projects, type Db } from "@paperclipai/db";
import type { PortfolioGalaxyData } from "@paperclipai/shared";
import { managedApplicationService } from "./managed-applications.js";
import { issueReadSqlCondition, projectReadSqlCondition, type AuthorizationActor } from "./authorization.js";
import { executionIssueCondition } from "./issue-visibility.js";

/** A bounded, read-only projection of native work, never a parallel work store. */
export async function readPortfolioGalaxy(db: Db, companyId: string, actor: AuthorizationActor,
  options: { after?: string; limit: number; kind?: "application" | "platform" | "all" }): Promise<PortfolioGalaxyData> {
  const page = await managedApplicationService(db).list(companyId, actor, options);
  const empty = { ...page, projects: [], tasks: [], tasksTruncated: false, observedAt: new Date().toISOString() };
  if (!page.applications.length) return empty;
  const visibleProjects = db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.companyId, companyId), await projectReadSqlCondition(db, actor)));
  const membership = and(eq(managedApplicationProjects.companyId, companyId),
    inArray(managedApplicationProjects.applicationId, page.applications.map(item => item.id)),
    inArray(managedApplicationProjects.projectId, visibleProjects));
  const [projectRows, taskRows] = await Promise.all([
    db.select({ applicationId: managedApplicationProjects.applicationId, id: projects.id,
      name: projects.name, status: projects.status, leadAgentId: projects.leadAgentId })
      .from(managedApplicationProjects).innerJoin(projects, and(eq(projects.id, managedApplicationProjects.projectId), eq(projects.companyId, companyId)))
      .where(membership).orderBy(asc(projects.id)),
    db.select({ applicationId: managedApplicationProjects.applicationId, id: issues.id, identifier: issues.identifier,
      title: issues.title, status: issues.status, priority: issues.priority, projectId: issues.projectId,
      assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId, updatedAt: issues.updatedAt })
      .from(managedApplicationProjects).innerJoin(issues, and(eq(issues.projectId, managedApplicationProjects.projectId), eq(issues.companyId, companyId)))
      .where(and(membership, executionIssueCondition(), await issueReadSqlCondition(db, actor)))
      .orderBy(asc(issues.id), asc(managedApplicationProjects.applicationId)).limit(501),
  ]);
  return { ...page, projects: projectRows, tasks: taskRows.slice(0, 500), tasksTruncated: taskRows.length > 500,
    observedAt: new Date().toISOString() };
}
