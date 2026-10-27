import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, companies, projects, activityLog, agentosDepartmentProjects, agentosDepartments, companyMemberships } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { departmentService } from "../services/agentos-departments.js";
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
});
