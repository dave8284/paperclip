import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { issues, managedApplications, managedApplicationProjects, projects, type Db } from "@paperclipai/db";
import type { ApplicationWork, CreateManagedApplication, ManagedApplication, ManagedApplicationPage, UpdateManagedApplication } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { issueReadSqlCondition, projectReadSqlCondition, type AuthorizationActor } from "./authorization.js";
import { persistActivity, publishActivity, type LogActivityInput } from "./activity-log.js";
import { executionIssueCondition } from "./issue-visibility.js";

type ApplicationRow = typeof managedApplications.$inferSelect;
type MutationActor = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;

function publicApplication(row: ApplicationRow): ManagedApplication {
  const { creationKey: _key, creationHash: _hash, ...application } = row;
  return application as ManagedApplication;
}

export function managedApplicationService(db: Db) {
  async function read(companyId: string, id: string, actor: AuthorizationActor, connection: Db = db) {
    const [row] = await connection.select({ application: managedApplications }).from(managedApplications)
      .innerJoin(projects, and(eq(projects.id, managedApplications.homeProjectId), eq(projects.companyId, managedApplications.companyId)))
      .where(and(eq(managedApplications.companyId, companyId), eq(managedApplications.id, id),
        await projectReadSqlCondition(connection, actor)));
    if (!row) throw notFound("Application not found");
    return publicApplication(row.application);
  }

  async function assertProjectReadable(connection: Db, companyId: string, projectId: string, actor: AuthorizationActor) {
    const [project] = await connection.select({ id: projects.id }).from(projects).where(and(
      eq(projects.companyId, companyId), eq(projects.id, projectId), await projectReadSqlCondition(connection, actor),
    ));
    if (!project) throw notFound("Project not found");
  }

  async function audit(connection: Db, application: ManagedApplication, actor: MutationActor, action: string, changedKeys: string[]) {
    // Use the home project's existing activity privacy boundary. Do not publish
    // names, briefs, or references to other private projects in live payloads.
    return persistActivity(connection, {
      ...actor, companyId: application.companyId, action,
      entityType: "project", entityId: application.homeProjectId,
      details: { applicationId: application.id, changedKeys },
    });
  }

  return {
    read,
    async list(companyId: string, actor: AuthorizationActor, options: { after?: string; limit: number; kind?: "application" | "platform" | "all" }): Promise<ManagedApplicationPage> {
      const rows = await db.select({ application: managedApplications }).from(managedApplications)
        .innerJoin(projects, and(eq(projects.id, managedApplications.homeProjectId), eq(projects.companyId, managedApplications.companyId)))
        .where(and(eq(managedApplications.companyId, companyId), await projectReadSqlCondition(db, actor),
          options.kind === "all" ? undefined : eq(managedApplications.kind, options.kind ?? "application"),
          options.after ? gt(managedApplications.id, options.after) : undefined))
        .orderBy(asc(managedApplications.id)).limit(options.limit + 1);
      const applications = rows.slice(0, options.limit).map(row => publicApplication(row.application));
      const summaries: ManagedApplicationPage["summaries"] = Object.fromEntries(applications.map(app => [app.id, { projectCount: 0, agentCount: 0, taskCounts: {} }]));
      if (applications.length) {
        const visibleProjects = db.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.companyId, companyId), await projectReadSqlCondition(db, actor)));
        const membership = and(eq(managedApplicationProjects.companyId, companyId),
          inArray(managedApplicationProjects.applicationId, applications.map(app => app.id)),
          inArray(managedApplicationProjects.projectId, visibleProjects));
        const [projectCounts, taskCounts, taskAgents, projectLeads] = await Promise.all([
          db.select({ id: managedApplicationProjects.applicationId, count: sql<number>`count(*)::int` })
            .from(managedApplicationProjects).where(membership).groupBy(managedApplicationProjects.applicationId),
          db.select({ id: managedApplicationProjects.applicationId, status: issues.status, count: sql<number>`count(*)::int` })
            .from(managedApplicationProjects).innerJoin(issues, and(eq(issues.projectId, managedApplicationProjects.projectId), eq(issues.companyId, companyId)))
            .where(and(membership, executionIssueCondition(), await issueReadSqlCondition(db, actor)))
            .groupBy(managedApplicationProjects.applicationId, issues.status),
          db.selectDistinct({ id: managedApplicationProjects.applicationId, agentId: issues.assigneeAgentId })
            .from(managedApplicationProjects).innerJoin(issues, and(eq(issues.projectId, managedApplicationProjects.projectId), eq(issues.companyId, companyId)))
            .where(and(membership, executionIssueCondition(), await issueReadSqlCondition(db, actor), isNotNull(issues.assigneeAgentId))),
          db.selectDistinct({ id: managedApplicationProjects.applicationId, agentId: projects.leadAgentId })
            .from(managedApplicationProjects).innerJoin(projects, and(eq(projects.id, managedApplicationProjects.projectId), eq(projects.companyId, companyId)))
            .where(and(membership, isNotNull(projects.leadAgentId))),
        ]);
        for (const row of projectCounts) summaries[row.id].projectCount = Number(row.count);
        for (const row of taskCounts) summaries[row.id].taskCounts[row.status] = Number(row.count);
        const agentsByApplication = new Map<string, Set<string>>();
        for (const row of [...taskAgents, ...projectLeads]) {
          if (!row.agentId) continue;
          const agents = agentsByApplication.get(row.id) ?? new Set<string>();
          agents.add(row.agentId);
          agentsByApplication.set(row.id, agents);
        }
        for (const [id, agents] of agentsByApplication) summaries[id].agentCount = agents.size;
      }
      return { applications, summaries, nextCursor: rows.length > options.limit ? applications.at(-1)!.id : null };
    },

    async create(companyId: string, actor: AuthorizationActor, who: MutationActor, input: CreateManagedApplication) {
      const creationKey = `${who.actorType}:${who.actorId}:${input.idempotencyKey}`;
      const { kind, ...originalFields } = input;
      // Preserve retries submitted before portfolio classification existed.
      const creationHash = createHash("sha256").update(JSON.stringify(!kind || kind === "application" ? originalFields : input)).digest("hex");
      const explicitDefaultHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const result = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`application:${companyId}:${creationKey}`}, 0))`);
        await assertProjectReadable(tx, companyId, input.homeProjectId, actor);
        const [prior] = await tx.select().from(managedApplications)
          .where(and(eq(managedApplications.companyId, companyId), eq(managedApplications.creationKey, creationKey)));
        if (prior) {
          if (prior.creationHash !== creationHash && prior.creationHash !== explicitDefaultHash) throw conflict("Application creation key was used with different inputs");
          return { application: await read(companyId, prior.id, actor, tx), publication: null, created: false };
        }
        const { idempotencyKey: _key, ...fields } = input;
        const [row] = await tx.insert(managedApplications).values({ companyId, creationKey, creationHash, ...fields })
          .onConflictDoNothing().returning();
        if (!row) throw conflict("This home project already belongs to an application");
        await tx.insert(managedApplicationProjects).values({ companyId, applicationId: row.id, projectId: input.homeProjectId });
        const application = publicApplication(row);
        const { publication } = await audit(tx, application, who, "managed_application.created", ["name", "brief", "source", "homeProjectId"]);
        return { application, publication, created: true };
      });
      if (result.publication) publishActivity(result.publication);
      return { application: result.application, created: result.created };
    },

    async update(companyId: string, id: string, actor: AuthorizationActor, who: MutationActor, input: UpdateManagedApplication) {
      const result = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        await read(companyId, id, actor, tx);
        const [row] = await tx.update(managedApplications).set({ ...input, updatedAt: new Date() })
          .where(and(eq(managedApplications.companyId, companyId), eq(managedApplications.id, id))).returning();
        if (!row) throw notFound("Application not found");
        const application = publicApplication(row);
        const { publication } = await audit(tx, application, who, "managed_application.updated", Object.keys(input));
        return { application, publication };
      });
      publishActivity(result.publication);
      return result.application;
    },

    async linkProject(companyId: string, id: string, projectId: string, actor: AuthorizationActor, who: MutationActor, remove = false) {
      const result = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        const application = await read(companyId, id, actor, tx);
        await assertProjectReadable(tx, companyId, projectId, actor);
        if (remove && projectId === application.homeProjectId) throw conflict("The home project defines application access and cannot be unlinked");
        const changed = remove
          ? await tx.delete(managedApplicationProjects).where(and(eq(managedApplicationProjects.companyId, companyId),
            eq(managedApplicationProjects.applicationId, id), eq(managedApplicationProjects.projectId, projectId))).returning()
          : await tx.insert(managedApplicationProjects).values({ companyId, applicationId: id, projectId })
            .onConflictDoNothing().returning();
        if (!changed.length) return null;
        const { publication } = await audit(tx, application, who,
          remove ? "managed_application.project_unlinked" : "managed_application.project_linked", ["projects"]);
        return publication;
      });
      if (result) publishActivity(result);
    },

    async work(companyId: string, id: string, actor: AuthorizationActor, options: { offset: number; limit: number; projectId?: string; assigneeAgentId?: string }): Promise<ApplicationWork> {
      const application = await read(companyId, id, actor);
      const linkedProjects = await db.select({ id: projects.id, name: projects.name, status: projects.status, leadAgentId: projects.leadAgentId })
        .from(managedApplicationProjects).innerJoin(projects, and(
          eq(projects.id, managedApplicationProjects.projectId), eq(projects.companyId, managedApplicationProjects.companyId)))
        .where(and(eq(managedApplicationProjects.companyId, companyId), eq(managedApplicationProjects.applicationId, id),
          await projectReadSqlCondition(db, actor))).orderBy(asc(projects.name), asc(projects.id));
      if (options.projectId && !linkedProjects.some(project => project.id === options.projectId)) throw notFound("Project not found");
      const ids = options.projectId ? [options.projectId] : linkedProjects.map(project => project.id);
      if (!ids.length) return { application, projects: [], counts: {}, agentWork: [], tasks: [], nextOffset: null };
      const accessibleWork = and(eq(issues.companyId, companyId), inArray(issues.projectId, ids),
        executionIssueCondition(), await issueReadSqlCondition(db, actor));
      const predicate = and(accessibleWork, options.assigneeAgentId ? eq(issues.assigneeAgentId, options.assigneeAgentId) : undefined);
      const [counts, tasks, assignments] = await Promise.all([
        db.select({ status: issues.status, count: sql<number>`count(*)::int` }).from(issues).where(predicate).groupBy(issues.status),
        db.select({ id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status, priority: issues.priority,
          projectId: issues.projectId, assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId, updatedAt: issues.updatedAt })
          .from(issues).where(predicate).orderBy(desc(issues.updatedAt), desc(issues.id)).offset(options.offset).limit(options.limit + 1),
        db.select({ agentId: issues.assigneeAgentId, status: issues.status, count: sql<number>`count(*)::int` })
          .from(issues).where(and(accessibleWork, isNotNull(issues.assigneeAgentId))).groupBy(issues.assigneeAgentId, issues.status),
      ]);
      const agentWork = new Map<string, Record<string, number>>();
      for (const project of linkedProjects) {
        if (ids.includes(project.id) && project.leadAgentId) agentWork.set(project.leadAgentId, {});
      }
      for (const row of assignments) {
        if (!row.agentId) continue;
        const taskCounts = agentWork.get(row.agentId) ?? {};
        taskCounts[row.status] = Number(row.count);
        agentWork.set(row.agentId, taskCounts);
      }
      return { application, projects: linkedProjects, counts: Object.fromEntries(counts.map(row => [row.status, Number(row.count)])),
        agentWork: [...agentWork].sort(([a], [b]) => a.localeCompare(b)).map(([agentId, taskCounts]) => ({ agentId, taskCounts })),
        tasks: tasks.slice(0, options.limit), nextOffset: tasks.length > options.limit ? options.offset + options.limit : null };
    },
  };
}
