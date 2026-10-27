import { and, eq } from "drizzle-orm";
import { agentosDepartments as departments, agentosDepartmentProjects as memberships, projects, type Db } from "@paperclipai/db";
import type { AgentOSDepartment } from "@paperclipai/shared";
import { accessService } from "./access.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { persistActivity, publishActivity, type LogActivityInput } from "./activity-log.js";
import { conflict, forbidden, notFound } from "../errors.js";

type Who = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;
export function departmentService(db: Db) {
  async function manage(tx: Db, actor: AuthorizationActor, companyId: string) {
    const decision = await accessService(tx).decide({ actor, action: "applications:manage", resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation);
  }
  return {
    async list(companyId: string, actor: AuthorizationActor): Promise<AgentOSDepartment[]> {
      const rows = await db.select().from(departments).where(eq(departments.companyId, companyId));
      const links = await db.select().from(memberships).where(eq(memberships.companyId, companyId));
      const decisions = await authorizationService(db).decideReads(actor, links.map(link => ({ type: "project" as const, companyId, projectId: link.projectId })));
      const visible = links.filter((_, index) => decisions[index]?.allowed);
      return rows.map(row => ({ ...row, projectIds: visible.filter(link => link.departmentId === row.id).map(link => link.projectId) }));
    },
    async save(companyId: string, actor: AuthorizationActor, who: Who, input: { name: string; description: string; expectedRevision?: number }, id?: string) {
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        await manage(tx, actor, companyId);
        const [row] = id ? await tx.update(departments).set({ name: input.name, description: input.description, revision: (input.expectedRevision ?? 0) + 1 })
          .where(and(eq(departments.id, id), eq(departments.companyId, companyId), eq(departments.revision, input.expectedRevision ?? 0))).returning()
          : await tx.insert(departments).values({ companyId, name: input.name, description: input.description }).returning();
        if (!row) throw conflict("Department changed. Refresh before saving.");
        const { publication } = await persistActivity(tx, { ...who, companyId, action: id ? "department.updated" : "department.created", entityType: "department", entityId: row.id, details: { name: row.name, revision: row.revision } });
        return { row, publication };
      }).catch(error => {
        if (error?.code === "23505" || error?.cause?.code === "23505") throw conflict("A department with this name already exists in the company.");
        throw error;
      });
      publishActivity(result.publication);
      return result.row;
    },
    async assign(companyId: string, projectId: string, departmentId: string | null, actor: AuthorizationActor, who: Who) {
      const publication = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        await manage(tx, actor, companyId);
        const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.companyId, companyId))).for("update");
        if (!project) throw notFound("Project not found");
        const [read] = await authorizationService(tx).decideReads(actor, [{ type: "project", companyId, projectId }]);
        if (!read.allowed) throw notFound("Project not found");
        if (departmentId) {
          const [department] = await tx.select().from(departments).where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId))).for("share");
          if (!department) throw notFound("Department not found");
          await tx.insert(memberships).values({ companyId, projectId, departmentId }).onConflictDoUpdate({ target: [memberships.companyId, memberships.projectId], set: { departmentId } });
        } else await tx.delete(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.projectId, projectId)));
        return (await persistActivity(tx, { ...who, companyId, action: "project.department_changed", entityType: "project", entityId: projectId, details: { departmentId } })).publication;
      });
      publishActivity(publication);
      return { projectId, departmentId };
    },
    async remove(companyId: string, id: string, expectedRevision: number, actor: AuthorizationActor, who: Who) {
      const publication = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        await manage(tx, actor, companyId);
        const [row] = await tx.delete(departments).where(and(eq(departments.id, id), eq(departments.companyId, companyId), eq(departments.revision, expectedRevision))).returning();
        if (!row) throw conflict("Department changed. Refresh before deleting.");
        return (await persistActivity(tx, { ...who, companyId, action: "department.deleted", entityType: "department", entityId: id, details: { name: row.name } })).publication;
      });
      publishActivity(publication);
    },
  };
}
