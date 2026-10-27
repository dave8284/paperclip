import { and, desc, eq, isNull } from "drizzle-orm";
import { companies, companyPerformanceReports as reports, projects, type Db } from "@paperclipai/db";
import type { CreatePerformanceReport, CompanyPerformanceReport } from "@paperclipai/shared";
import { accessService } from "./access.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { persistActivity, publishActivity, type LogActivityInput } from "./activity-log.js";
import { conflict, forbidden, notFound } from "../errors.js";
type Who = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;
export function companyPerformanceService(db: Db) {
  return {
    async list(companyId: string, period: string, actor: AuthorizationActor) {
      // Filter project visibility before limiting so private report volume cannot
      // affect public counts or pagination. Company reports are company records.
      const rows = await db.select().from(reports).where(and(eq(reports.companyId, companyId), eq(reports.period, period))).orderBy(desc(reports.createdAt), desc(reports.revision));
      const projectIds = [...new Set(rows.flatMap(row => row.projectId ? [row.projectId] : []))];
      const access = await authorizationService(db).decideReads(actor, projectIds.map(projectId => ({ type: "project" as const, companyId, projectId })));
      const allowed = new Set(projectIds.filter((_, i) => access[i]?.allowed));
      const visible = rows.filter(row => !row.projectId || allowed.has(row.projectId));
      return { reports: visible.slice(0, 500) as CompanyPerformanceReport[], truncated: visible.length > 500 };
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
