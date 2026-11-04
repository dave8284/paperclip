import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { agentosDepartments, agentosDepartmentProjects, companies, companyPerformanceReports as reports, projects, type Db } from "@paperclipai/db";
import type { CreatePerformanceReport, CompanyPerformanceQuery, CompanyPerformanceResponse, CompanyPerformanceReport } from "@paperclipai/shared";
import { accessService } from "./access.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { persistActivity, publishActivity, type LogActivityInput } from "./activity-log.js";
import { conflict, forbidden, notFound } from "../errors.js";
type Who = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;
export function companyPerformanceService(db: Db) {
  return {
    async list(companyId: string, query: CompanyPerformanceQuery, actor: AuthorizationActor): Promise<CompanyPerformanceResponse> {
      const authorization = authorizationService(db);
      const [companyAccess] = await authorization.decideReads(actor, [{ type: "company", companyId }]);
      if (!companyAccess?.allowed) throw forbidden("Company discovery access required");
      let projectIds: string[] = [];
      if (query.scope === "department") {
        const [department] = await db.select({ id: agentosDepartments.id }).from(agentosDepartments).where(and(eq(agentosDepartments.companyId, companyId), eq(agentosDepartments.id, query.scopeId!)));
        if (!department) throw notFound("Department not found");
        projectIds = (await db.select({ id: agentosDepartmentProjects.projectId }).from(agentosDepartmentProjects).where(and(eq(agentosDepartmentProjects.companyId, companyId), eq(agentosDepartmentProjects.departmentId, department.id)))).map(row => row.id);
      } else if (query.scope !== "company") {
        projectIds = (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), query.scope === "project" ? eq(projects.id, query.scopeId!) : undefined))).map(row => row.id);
      }
      const access = await authorization.decideReads(actor, projectIds.map(projectId => ({ type: "project" as const, companyId, projectId })));
      const allowed = projectIds.filter((_, i) => access[i]?.allowed);
      if (query.scope === "project" && !allowed.length) throw notFound("Project not found");
      const includesCompany = query.scope === "company" || query.scope === "all";
      const scopeProjectIds: Array<string | null> = [...(includesCompany ? [null] : []), ...allowed];
      if (!scopeProjectIds.length) return { reports: [], truncated: false, scopeProjectIds };
      // Resolve scope and privacy before the bounded history read. Unreported
      // accessible projects remain in scope so partial coverage cannot look complete.
      const rows = await db.select().from(reports).where(and(
        eq(reports.companyId, companyId), eq(reports.period, query.period),
        or(includesCompany ? isNull(reports.projectId) : undefined, allowed.length ? inArray(reports.projectId, allowed) : undefined),
      )).orderBy(desc(reports.createdAt), desc(reports.revision)).limit(501);
      return { reports: rows.slice(0, 500) as CompanyPerformanceReport[], truncated: rows.length > 500, scopeProjectIds };
    },
    async record(companyId: string, input: CreatePerformanceReport, actor: AuthorizationActor, who: Who) {
      const saved = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const permission = await accessService(tx).decide({ actor, action: "applications:manage", resource: { type: "company", companyId } });
        if (!permission.allowed) throw forbidden(permission.explanation);
        if (input.projectId) {
          const [project] = await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, input.projectId)));
          const [read] = await authorizationService(tx).decideReads(actor, [{ type: "project", companyId, projectId: input.projectId }]);
          if (!project || !read.allowed) throw notFound("Project not found");
        }
        // One revision stream per company/project/month; no lost updates.
        const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
        if (!company) throw notFound("Company not found");
        const [previous] = await tx.select().from(reports).where(and(eq(reports.companyId, companyId), eq(reports.period, input.period), input.projectId ? eq(reports.projectId, input.projectId) : isNull(reports.projectId))).orderBy(desc(reports.revision)).limit(1);
        if ((previous?.id ?? null) !== input.expectedReportId) throw conflict("This report changed. Refresh before recording a revision.");
        const { expectedReportId: _, ...data } = input;
        const [row] = await tx.insert(reports).values({ ...data, companyId, revision: (previous?.revision ?? 0) + 1, createdBy: who.actorId }).returning();
        const { publication } = await persistActivity(tx, { ...who, companyId, action: "company.performance_recorded", entityType: "performance_report", entityId: row.id, details: { projectId: row.projectId, period: row.period, revision: row.revision, sourceLabel: row.sourceLabel } });
        return { row, publication };
      });
      publishActivity(saved.publication);
      return saved.row;
    },
  };
}
