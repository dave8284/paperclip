import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { agents, agentosDepartments, agentosDepartmentProjects, companyOperatingProfiles, heartbeatRuns, environmentLeases, nativeRunFinalizations, issues, projects, principalPermissionGrants, type Db } from "@paperclipai/db";
import { agentService } from "../services/agents.js";
import { assertAssignableAgent } from "../services/agent-assignability.js";
import { assertFridayRunEligible, isFridayExecutiveTarget } from "../services/friday-board-role.js";
import { authorizationService } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { operatingProfileService } from "../services/operating-profile.js";
import { describeEmbeddedPostgres, resetCompanyIssueFixtures, seedCompanyWithBoardAccess, useEmbeddedPostgres } from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("Friday's persisted board role", () => {
  const ctx = useEmbeddedPostgres("paperclip-friday-board-role-", { resetEach: async db => {
    await db.delete(environmentLeases);
    await db.delete(nativeRunFinalizations);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agentosDepartmentProjects);
    await db.delete(agentosDepartments);
    await db.delete(companyOperatingProfiles);
    await db.delete(projects);
    await db.delete(agents);
    await resetCompanyIssueFixtures(db);
  } });

  async function seed() {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Board roles");
    const staff = await ctx.db.insert(agents).values([
      { companyId: company.companyId, name: "Coordinator", role: "general", status: "idle", adapterType: "process" },
      { companyId: company.companyId, name: "CEO", role: "ceo", status: "idle", adapterType: "process" },
      { companyId: company.companyId, name: "Head", role: "general", status: "idle", adapterType: "process" },
      { companyId: company.companyId, name: "Friday", role: "engineer", title: "Department Head", status: "idle", adapterType: "process" },
    ]).returning();
    const [friday, ceo, head, worker] = staff;
    await ctx.db.insert(companyOperatingProfiles).values({ companyId: company.companyId, fridayAgentId: friday!.id });
    return { ...company, friday: friday!, ceo: ceo!, head: head!, worker: worker! };
  }

  it("rejects task/routine assignment but preserves the designated coordinator's own conversation", async () => {
    const f = await seed();
    for (const kind of ["work", "routine"] as const) {
      await expect(assertAssignableAgent(ctx.db, f.companyId, f.friday.id, { kind }))
        .rejects.toMatchObject({ details: { code: "friday_board_role" } });
    }
    await expect(issueService(ctx.db).create(f.companyId, { title: "Delivery", assigneeAgentId: f.friday.id }))
      .rejects.toMatchObject({ details: { code: "friday_board_role" } });
    await expect(assertAssignableAgent(ctx.db, f.companyId, f.worker.id)).resolves.toBeUndefined();
    const [chat, oldWork] = await ctx.db.insert(issues).values([
      { companyId: f.companyId, title: "Board conversation", assigneeAgentId: f.friday.id, conversationAgentId: f.friday.id, conversationUserId: f.userId, conversationState: "active" },
      { companyId: f.companyId, title: "Previously assigned delivery", assigneeAgentId: f.friday.id },
    ]).returning();
    await expect(assertFridayRunEligible(ctx.db, { companyId: f.companyId, agentId: f.friday.id, issueId: chat!.id })).resolves.toBeUndefined();
    await expect(assertFridayRunEligible(ctx.db, { companyId: f.companyId, agentId: f.friday.id, issueId: oldWork!.id }))
      .rejects.toMatchObject({ details: { code: "friday_board_role" } });
    await ctx.db.update(companyOperatingProfiles).set({ fridayAgentId: f.worker.id }).where(eq(companyOperatingProfiles.companyId, f.companyId));
    await expect(assertAssignableAgent(ctx.db, f.companyId, f.friday.id)).resolves.toBeUndefined();
    await expect(assertAssignableAgent(ctx.db, f.companyId, f.worker.id)).rejects.toMatchObject({ details: { code: "friday_board_role" } });
  });

  it("uses actual CEO/department assignments and retains company/project boundaries", async () => {
    const f = await seed();
    const [project, otherProject] = await ctx.db.insert(projects).values([
      { companyId: f.companyId, name: "Department project" }, { companyId: f.companyId, name: "Other project" },
    ]).returning();
    const [department] = await ctx.db.insert(agentosDepartments).values({ companyId: f.companyId, name: "Delivery", leadAgentId: f.head.id }).returning();
    await ctx.db.insert(agentosDepartmentProjects).values({ companyId: f.companyId, departmentId: department!.id, projectId: project!.id });
    const scope = { companyId: f.companyId, fridayAgentId: f.friday.id, projectId: project!.id };
    expect(await isFridayExecutiveTarget(ctx.db, { ...scope, assigneeAgentId: f.ceo.id })).toBe(true);
    expect(await isFridayExecutiveTarget(ctx.db, { ...scope, assigneeAgentId: f.head.id })).toBe(true);
    expect(await isFridayExecutiveTarget(ctx.db, { ...scope, assigneeAgentId: f.worker.id })).toBe(false);
    expect(await isFridayExecutiveTarget(ctx.db, { ...scope, assigneeAgentId: f.head.id, projectId: otherProject!.id })).toBe(false);
    const foreign = await seedCompanyWithBoardAccess(ctx.db, "Foreign company");
    expect(await isFridayExecutiveTarget(ctx.db, { ...scope, companyId: foreign.companyId, assigneeAgentId: f.ceo.id })).toBe(false);
    await ctx.db.update(agentosDepartments).set({ leadAgentId: null }).where(eq(agentosDepartments.id, department!.id));
    expect(await isFridayExecutiveTarget(ctx.db, { ...scope, assigneeAgentId: f.head.id })).toBe(false);
  });

  it("does not let broad native staffing grants turn Friday into the executive", async () => {
    const f = await seed();
    await ctx.db.insert(principalPermissionGrants).values(["applications:manage", "agents:create", "agents:configure", "workforce:retire", "tasks:assign"].map(permissionKey => ({
      companyId: f.companyId, principalType: "agent", principalId: f.friday.id, permissionKey, grantedByUserId: f.userId,
    })));
    const actor = { type: "agent" as const, companyId: f.companyId, agentId: f.friday.id, source: "agent_jwt" };
    for (const action of ["applications:manage", "agents:create", "workforce:retire"] as const) {
      const decision = await authorizationService(ctx.db).decide({ actor, action, resource: { type: "company", companyId: f.companyId } });
      expect(decision).toMatchObject({ allowed: false, reason: "deny_scope" });
    }
    const directWorker = await authorizationService(ctx.db).decide({ actor, action: "tasks:assign",
      resource: { type: "issue", companyId: f.companyId, issueId: null, assigneeAgentId: f.worker.id } });
    expect(directWorker).toMatchObject({ allowed: false, reason: "deny_scope" });
    for (const action of ["agent_config:update", "agent_instructions:update", "agent:wake"] as const) {
      expect(await authorizationService(ctx.db).decide({ actor, action,
        resource: { type: "agent", companyId: f.companyId, agentId: f.worker.id } }))
        .toMatchObject({ allowed: false, reason: "deny_scope" });
    }
  });

  it("projects the current role for task pickers without hiding Friday from the directory", async () => {
    const f = await seed();
    const directory = await agentService(ctx.db).list(f.companyId);
    expect(directory.find(row => row.id === f.friday.id)).toMatchObject({ isBoardCoordinator: true });
    expect(directory.find(row => row.id === f.worker.id)).toMatchObject({ isBoardCoordinator: false });
    expect(await agentService(ctx.db).getById(f.friday.id)).toMatchObject({ isBoardCoordinator: true });
  });

  it.each(["queued", "running"])("refuses to designate an employee with %s work and preserves the existing Friday", async status => {
    const f = await seed();
    const service = operatingProfileService(ctx.db), before = await service.read(f.companyId);
    await ctx.db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.worker.id, status, runtimeMode: "native" });
    await expect(service.update(f.companyId, f.actor, { actorType: "user", actorId: f.userId },
      { expectedRevision: before.revision, fridayAgentId: f.worker.id }))
      .rejects.toMatchObject({ details: { code: "friday_execution_pending" } });
    expect(await service.read(f.companyId)).toEqual(before);
    expect((await ctx.db.select().from(heartbeatRuns))[0]?.status).toBe(status);
  });

  it("observes work admitted under the final provider lock before switching the role", async () => {
    const f = await seed(), service = operatingProfileService(ctx.db), before = await service.read(f.companyId);
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const permit = new Promise<void>(resolve => { release = resolve; });
    const dispatch = ctx.db.transaction(async connection => {
      const tx = connection as unknown as Db;
      await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`operating-profile:${f.companyId}`}, 0))`);
      acquired(); await permit;
      await tx.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.worker.id, status: "running", runtimeMode: "native" });
    });
    await locked;
    const change = service.update(f.companyId, f.actor, { actorType: "user", actorId: f.userId },
      { expectedRevision: before.revision, fridayAgentId: f.worker.id });
    const rejected = expect(change).rejects.toMatchObject({ details: { code: "friday_execution_pending" } });
    release(); await dispatch; await rejected;
    expect(await service.read(f.companyId)).toEqual(before);
  });
});
