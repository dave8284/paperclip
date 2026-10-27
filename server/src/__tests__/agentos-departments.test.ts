import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, companies, projects, agents, activityLog, agentosDepartmentProjects, agentosDepartments, companyMemberships } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { departmentService } from "../services/agentos-departments.js";
import { deleteCompany } from "../services/company-deletion.js";
import { deleteAgentDependencies } from "../services/agent-deletion.js";
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
const companyId = randomUUID(), otherId = randomUUID(), projectId = randomUUID();
const actor = { type: "board" as const, userId: "local-board", source: "local_implicit" as const, isInstanceAdmin: true };
const who = { actorType: "user" as const, actorId: "local-board", agentId: null, runId: null };
beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("agentos-departments-"); db = createDb(database.connectionString); await db.insert(companies).values([{ id: companyId, name: "Company", issuePrefix: "DPT" }, { id: otherId, name: "Other", issuePrefix: "DPO" }]); await db.insert(projects).values({ id: projectId, companyId, name: "Launch" }); }, 90000);
afterAll(async () => database?.cleanup());
describe("company departments", () => {
  it("groups existing projects, audits mutations, rejects stale changes and preserves projects on deletion", async () => {
    const service = departmentService(db);
    const department = await service.save(companyId, actor, who, { name: "Marketing", description: "Launch and growth" });
    await service.assign(companyId, projectId, department.id, actor, who);
    expect((await service.list(companyId, actor))[0]).toMatchObject({ name: "Marketing", projectIds: [projectId] });
    await service.save(companyId, actor, who, { name: "Growth", description: "Growth", expectedRevision: 1 }, department.id);
    await expect(service.save(companyId, actor, who, { name: "Stale", description: "", expectedRevision: 1 }, department.id)).rejects.toThrow("changed");
    await expect(service.remove(companyId, department.id, 1, actor, who)).rejects.toThrow("changed");
    await service.remove(companyId, department.id, 2, actor, who);
    expect(await db.select().from(agentosDepartmentProjects)).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(1);
    expect((await db.select().from(activityLog).where(eq(activityLog.companyId, companyId))).map(row => row.action)).toEqual(expect.arrayContaining(["department.created", "project.department_changed", "department.updated", "department.deleted"]));
  });
  it("rejects cross-company assignments at service and database boundaries", async () => {
    const service = departmentService(db), department = await service.save(otherId, actor, who, { name: "Engineering", description: "" });
    await expect(service.assign(companyId, projectId, department.id, actor, who)).rejects.toThrow("Department not found");
    await expect(db.insert(agentosDepartmentProjects).values({ companyId, projectId, departmentId: department.id })).rejects.toThrow();
  });
  it("does not expose private project memberships to other company members", async () => {
    const service = departmentService(db), department = await service.save(companyId, actor, who, { name: "Private work", description: "" });
    const privateId = randomUUID();
    await db.insert(projects).values({ id: privateId, companyId, name: "Private", visibility: "private", privacyOwnerUserId: "owner" });
    await db.insert(companyMemberships).values({ companyId, principalId: "viewer", principalType: "user", membershipRole: "member", status: "active" });
    await service.assign(companyId, privateId, department.id, actor, who);
    const rows = await service.list(companyId, { type: "board", source: "session", userId: "viewer", companyIds: [companyId] });
    expect(rows.find(row => row.id === department.id)?.projectIds).not.toContain(privateId);
  });
  it("assigns only active company employees, preserves heads on legacy edits and records changes", async () => {
    const service = departmentService(db);
    const [lead, retired, foreign] = await db.insert(agents).values([
      { companyId, name: "Engineering head" },
      { companyId, name: "Retired head", status: "terminated" },
      { companyId: otherId, name: "Other company head" },
    ]).returning();
    for (const invalid of [retired, foreign]) {
      await expect(service.save(companyId, actor, who, { name: "Rejected head", description: "", leadAgentId: invalid.id })).rejects.toThrow("active employee in this company");
    }
    const department = await service.save(companyId, actor, who, { name: "Led department", description: "", leadAgentId: lead.id });
    await expect(deleteAgentDependencies(db, companyId, lead.id)).rejects.toThrow("Reassign or clear");
    expect((await db.select().from(agents).where(eq(agents.id, lead.id)))[0].lifecycleState).toBe("ready");
    const [privateProject] = await db.insert(projects).values({ companyId, name: "Confidential launch", visibility: "private", privacyOwnerUserId: "owner" }).returning();
    await service.assign(companyId, privateProject.id, department.id, actor, who);
    const headView = await service.list(companyId, { type: "agent", agentId: lead.id, companyId, source: "agent_key" });
    expect(headView.find(row => row.id === department.id)?.projectIds).not.toContain(privateProject.id);
    const updated = await service.save(companyId, actor, who, { name: "Led department", description: "More context", expectedRevision: 1 }, department.id);
    expect(updated.leadAgentId).toBe(lead.id);
    await expect(db.update(agentosDepartments).set({ leadAgentId: foreign.id }).where(eq(agentosDepartments.id, department.id))).rejects.toThrow();
    await service.save(companyId, actor, who, { name: "Led department", description: "", expectedRevision: 2, leadAgentId: null }, department.id);
    await expect(service.save(companyId, actor, who, { name: "Stale head", description: "", expectedRevision: 2, leadAgentId: lead.id }, department.id)).rejects.toThrow("changed");
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, department.id), eq(activityLog.action, "department.updated")));
    expect(audit.map(row => row.details)).toEqual(expect.arrayContaining([expect.objectContaining({ previousLeadAgentId: lead.id, leadAgentId: null, revision: 3 })]));
    expect((await service.list(companyId, actor)).find(row => row.id === department.id)?.leadAgentId).toBeNull();
  });
  it("keeps native company deletion working when a department has a head", async () => {
    const [company] = await db.insert(companies).values({ name: "Temporary company", issuePrefix: "DLT" }).returning();
    const [lead] = await db.insert(agents).values({ companyId: company.id, name: "Temporary head", adapterType: "process" }).returning();
    const department = await departmentService(db).save(company.id, actor, who, { name: "Temporary department", description: "", leadAgentId: lead.id });
    // The isolated database has no lifecycle worker. Seed its completed
    // termination receipt; native deletion must still enforce that boundary.
    await db.update(agents).set({ status: "terminated", lifecycleState: "terminated" }).where(eq(agents.id, lead.id));
    await expect(deleteCompany(db, company.id)).resolves.toMatchObject({ id: company.id });
    expect(await db.select().from(agentosDepartments).where(eq(agentosDepartments.id, department.id))).toHaveLength(0);
    expect(await db.select().from(agents).where(eq(agents.id, lead.id))).toHaveLength(0);
  }, 30000);
});
