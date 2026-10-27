import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { agents, cases, caseHandoffs, issueComments, issues,
  issueWorkProducts, managedApplications, managedApplicationProjects, projects, type Db } from "@paperclipai/db";
import type { FridayWork, FridayWorkQuery } from "@paperclipai/shared";
import { issueReadSqlCondition, projectReadSqlCondition, type AuthorizationActor } from "./authorization.js";
import { caseReadSqlCondition, filterCasesForActor } from "./case-access.js";
import { executionIssueCondition } from "./issue-visibility.js";
import { managedApplicationService } from "./managed-applications.js";
import { notFound } from "../errors.js";

/** Rebuildable, request-driven views of native records. No model calls, timers,
 * credentials or independent work state. Permissions precede counts and paging. */
export function fridayAwarenessService(db: Db) {
  async function scope(companyId: string, actor: AuthorizationActor, query: FridayWorkQuery) {
    const projectAccess = and(eq(projects.companyId, companyId), await projectReadSqlCondition(db, actor));
    const visibleProjects = db.select({ id: projects.id }).from(projects).where(projectAccess);
    const issueAccess = and(eq(issues.companyId, companyId), await issueReadSqlCondition(db, actor),
      or(isNull(issues.projectId), inArray(issues.projectId, visibleProjects)));
    if (query.projectId) {
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(projectAccess, eq(projects.id, query.projectId))).limit(1);
      if (!project) throw notFound("Project not found");
    }
    if (query.agentId) {
      const [agent] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, query.agentId))).limit(1);
      if (!agent) throw notFound("Agent not found");
    }
    if (query.applicationId) await managedApplicationService(db).read(companyId, query.applicationId, actor);
    const linkedProjects = query.applicationId ? db.select({ id: managedApplicationProjects.projectId }).from(managedApplicationProjects)
      .where(and(eq(managedApplicationProjects.companyId, companyId), eq(managedApplicationProjects.applicationId, query.applicationId))) : null;
    const work = and(issueAccess, query.projectId ? eq(issues.projectId, query.projectId) : undefined,
      linkedProjects ? inArray(issues.projectId, linkedProjects) : undefined,
      query.agentId ? eq(issues.assigneeAgentId, query.agentId) : undefined);
    const projectScope = and(projectAccess, query.projectId ? eq(projects.id, query.projectId) : isNull(projects.archivedAt),
      linkedProjects ? inArray(projects.id, linkedProjects) : undefined,
      query.agentId ? or(eq(projects.leadAgentId, query.agentId), inArray(projects.id,
        db.select({ id: issues.projectId }).from(issues).where(and(issueAccess, executionIssueCondition(), eq(issues.assigneeAgentId, query.agentId))))) : undefined);
    return { work, projectScope, visibleProjects };
  }

  return {
    async work(companyId: string, actor: AuthorizationActor, query: FridayWorkQuery): Promise<FridayWork> {
      const { work, projectScope, visibleProjects } = await scope(companyId, actor, query);
      const predicate = and(work, executionIssueCondition());
      const taskPredicate = and(predicate, query.status === "active" ? notInArray(issues.status, ["done", "cancelled"])
        : query.status === "completed" ? inArray(issues.status, ["done", "cancelled"]) : undefined);
      const [projectRows, totals, counts, taskRows, assignments] = await Promise.all([
        db.select({ id: projects.id, name: projects.name, status: projects.status, leadAgentId: projects.leadAgentId })
          .from(projects).where(projectScope).orderBy(asc(projects.name), asc(projects.id)).offset(query.projectOffset).limit(201),
        db.select({ count: sql<number>`count(*)::int` }).from(projects).where(projectScope),
        db.select({ status: issues.status, count: sql<number>`count(*)::int` }).from(issues).where(predicate).groupBy(issues.status),
        db.select({ id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status, priority: issues.priority,
          projectId: issues.projectId, assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId,
          parentId: issues.parentId, createdByAgentId: issues.createdByAgentId, updatedAt: issues.updatedAt })
          .from(issues).where(taskPredicate).orderBy(desc(issues.updatedAt), desc(issues.id)).offset(query.offset).limit(query.limit + 1),
        db.select({ agentId: issues.assigneeAgentId, projectId: issues.projectId, status: issues.status, count: sql<number>`count(*)::int` })
          .from(issues).where(and(predicate, isNotNull(issues.assigneeAgentId))).groupBy(issues.assigneeAgentId, issues.projectId, issues.status)
          .orderBy(asc(issues.assigneeAgentId), asc(issues.projectId), asc(issues.status)).limit(2001),
      ]);
      const tasks = taskRows.slice(0, query.limit);
      const taskIds = tasks.map(task => task.id);
      // A parent outside this visible page is expanded through its native task,
      // never exposed as an unchecked relationship to a private record.
      const taskSet = new Set(taskIds);
      const projectIds = [...new Set([...projectRows.slice(0, 200).map(project => project.id), ...tasks.flatMap(task => task.projectId ? [task.projectId] : [])])];
      const [applicationRows, comments, products, handoffs] = await Promise.all([
        projectIds.length ? db.select({ id: managedApplications.id, name: managedApplications.name, kind: managedApplications.kind, projectId: managedApplicationProjects.projectId })
          .from(managedApplicationProjects).innerJoin(managedApplications, and(eq(managedApplications.id, managedApplicationProjects.applicationId), eq(managedApplications.companyId, companyId)))
          .where(and(eq(managedApplicationProjects.companyId, companyId), inArray(managedApplicationProjects.projectId, projectIds), inArray(managedApplications.homeProjectId, visibleProjects))) : [],
        taskIds.length ? db.select({ id: issueComments.id, taskId: issueComments.issueId, agentId: issueComments.authorAgentId, createdAt: issueComments.createdAt })
          .from(issueComments).where(and(eq(issueComments.companyId, companyId), inArray(issueComments.issueId, taskIds), isNull(issueComments.deletedAt)))
          .orderBy(desc(issueComments.createdAt), desc(issueComments.id)).limit(201) : [],
        taskIds.length ? db.select({ id: issueWorkProducts.id, taskId: issueWorkProducts.issueId, title: issueWorkProducts.title, createdAt: issueWorkProducts.createdAt })
          .from(issueWorkProducts).where(and(eq(issueWorkProducts.companyId, companyId), inArray(issueWorkProducts.issueId, taskIds)))
          .orderBy(desc(issueWorkProducts.createdAt), desc(issueWorkProducts.id)).limit(201) : [],
        taskIds.length ? db.select({ id: caseHandoffs.id, caseId: caseHandoffs.caseId, taskId: caseHandoffs.issueId, fromAgentId: caseHandoffs.fromAgentId,
          toAgentId: caseHandoffs.toAgentId, phase: caseHandoffs.phase, state: caseHandoffs.state, createdAt: caseHandoffs.createdAt })
          .from(caseHandoffs).innerJoin(cases, and(eq(cases.id, caseHandoffs.caseId), eq(cases.companyId, companyId)))
          .where(and(eq(caseHandoffs.companyId, companyId), inArray(caseHandoffs.issueId, taskIds), await caseReadSqlCondition(db, actor)))
          .orderBy(desc(caseHandoffs.createdAt), desc(caseHandoffs.id)).limit(201) : [],
      ]);
      const applications = new Map<string, FridayWork["applications"][number]>();
      const allowedCases = new Set((await filterCasesForActor(db, actor, [...new Set(handoffs.map(row => row.caseId))].map(id => ({ id })))).map(row => row.id));
      const visibleHandoffs = handoffs.filter(row => allowedCases.has(row.caseId));
      for (const row of applicationRows) {
        const app = applications.get(row.id) ?? { id: row.id, name: row.name, kind: row.kind as "application" | "platform", projectIds: [] };
        app.projectIds.push(row.projectId); applications.set(row.id, app);
      }
      return { observedAt: new Date().toISOString(), projects: projectRows.slice(0, 200), projectCount: totals[0].count,
        nextProjectOffset: projectRows.length > 200 ? query.projectOffset + 200 : null, applications: [...applications.values()],
        tasks: tasks.map(task => ({ ...task, parentId: task.parentId && taskSet.has(task.parentId) ? task.parentId : null })),
        counts: Object.fromEntries(counts.map(row => [row.status, Number(row.count)])),
        nextOffset: taskRows.length > query.limit ? query.offset + query.limit : null,
        assignments: assignments.slice(0, 2000).map(row => ({ ...row, agentId: row.agentId! })), assignmentsTruncated: assignments.length > 2000,
        evidence: [...comments.slice(0, 200).map(row => ({ ...row, title: "Recorded message", kind: "comment" as const })),
          ...products.slice(0, 200).map(row => ({ ...row, agentId: null, kind: "artifact" as const }))],
        evidenceTruncated: comments.length > 200 || products.length > 200, handoffs: visibleHandoffs.slice(0, 200).map(({ caseId: _, ...row }) => row), handoffsTruncated: handoffs.length > 200 };
    },

  };
}
