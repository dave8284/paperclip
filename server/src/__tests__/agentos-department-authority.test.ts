import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog, agents, agentosDepartments, agentosDepartmentProjects, authUsers, companies,
  companyMemberships, companyOperatingProfiles, createDb, heartbeatRuns, principalPermissionGrants, projects,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { departmentService } from "../services/agentos-departments.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { resolveAgentHiringAuthority } from "../services/agent-hiring-authority.js";
import { prepareAgentHire } from "../services/agent-hiring.js";
import { prepareAgentConfiguration } from "../services/agent-configuration.js";
import { authorizeInstructionCommit } from "../services/agent-instruction-authorization.js";
import { accessService } from "../services/access.js";
import { normalizeAgentPermissions } from "../lib/agent-permissions.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
beforeAll(async () => {
  database = await startEmbeddedPostgresTestDatabase("department-authority-");
  db = createDb(database.connectionString);
}, 90000);
afterAll(async () => database?.cleanup());

async function fixture() {
  const [company, foreign] = await db.insert(companies).values(["Company", "Other"].map(name => ({ name, issuePrefix: randomUUID().slice(0, 8) }))).returning();
  const owner = randomUUID();
  await db.insert(authUsers).values({ id: owner, name: "Owner", email: `${owner}@example.test`, approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
  const [ceo, head, otherHead, specialist, friday, foreignHead] = await db.insert(agents).values([
    { companyId: company.id, name: "CEO", role: "ceo" },
    { companyId: company.id, name: "Engineering head", role: "engineer" },
    { companyId: company.id, name: "Marketing head", role: "general" },
    { companyId: company.id, name: "Specialist", title: "Department head", role: "general" },
    { companyId: company.id, name: "Friday", role: "ceo" },
    { companyId: foreign.id, name: "Foreign CEO", role: "ceo" },
  ]).returning();
  await db.insert(companyOperatingProfiles).values({ companyId: company.id, fridayAgentId: friday.id });
  await db.insert(companyMemberships).values([
    { companyId: company.id, principalType: "user", principalId: owner, membershipRole: "owner", status: "active" },
    ...[ceo, head, otherHead, specialist, friday].map(agent => ({ companyId: company.id, principalType: "agent", principalId: agent.id, membershipRole: "member", status: "active" })),
  ]);
  await db.insert(principalPermissionGrants).values([
    { companyId: company.id, principalType: "user", principalId: owner, permissionKey: "applications:manage" },
    ...[ceo, head, otherHead, specialist, friday].map(agent => ({ companyId: company.id, principalType: "agent", principalId: agent.id, permissionKey: "applications:manage" })),
  ]);
  const actor = (id: string): AuthorizationActor => ({ type: "agent", source: "agent_jwt", companyId: company.id, agentId: id, onBehalfOfUserId: owner,
    onBehalfOfMemberships: [{ companyId: company.id, membershipRole: "owner", status: "active" }] });
  const who = (id: string) => ({ actorType: "agent" as const, actorId: id, agentId: id, runId: null });
  const service = departmentService(db);
  const engineering = await service.save(company.id, actor(ceo.id), who(ceo.id), { name: "Engineering", description: "Delivery", leadAgentId: head.id });
  const marketing = await service.save(company.id, actor(ceo.id), who(ceo.id), { name: "Marketing", description: "Growth", leadAgentId: otherHead.id });
  const [project] = await db.insert(projects).values({ companyId: company.id, name: "Launch" }).returning();
  return { companyId: company.id, foreign, owner, ceo, head, otherHead, specialist, friday, foreignHead, engineering, marketing, project, actor, who, service };
}

describe("department authority and executive delegation", () => {
  it("lets a CEO appoint a head and the head manage its department without changing reporting lines or execution", async () => {
    const f = await fixture();
    const result = await f.service.save(f.companyId, f.actor(f.head.id), f.who(f.head.id), {
      name: "Product Engineering", description: "The head owns delivery", expectedRevision: 1,
    }, f.engineering.id);
    expect(result).toMatchObject({ leadAgentId: f.head.id, revision: 2 });
    expect((await db.select().from(agents).where(eq(agents.id, f.head.id)))[0]).toMatchObject({ lifecycleState: "ready", reportsTo: null });
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.engineering.id), eq(activityLog.action, "department.updated")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ companyId: f.companyId, actorType: "agent", actorId: f.head.id });
  });

  it("does not turn a head's native management grant into authority over other departments or head appointments", async () => {
    const f = await fixture(), actor = f.actor(f.head.id), who = f.who(f.head.id);
    await expect(f.service.save(f.companyId, actor, who, { name: "Takeover", description: "", expectedRevision: 1 }, f.marketing.id)).rejects.toThrow("only their own");
    await expect(f.service.remove(f.companyId, f.marketing.id, 1, actor, who)).rejects.toThrow("only their own");
    await expect(f.service.remove(f.companyId, f.engineering.id, 1, actor, who)).rejects.toThrow("CEO or board");
    await expect(f.service.save(f.companyId, actor, who, { name: "New division", description: "", leadAgentId: f.head.id })).rejects.toThrow("only their own");
    await expect(f.service.save(f.companyId, actor, who, { name: "Engineering", description: "", leadAgentId: f.specialist.id, expectedRevision: 1 }, f.engineering.id)).rejects.toThrow("appoints department heads");
    expect((await db.select().from(agentosDepartments).where(eq(agentosDepartments.id, f.marketing.id)))[0]).toMatchObject({ name: "Marketing", leadAgentId: f.otherHead.id, revision: 1 });
    await expect(f.service.save(f.companyId, f.actor(f.ceo.id), f.who(f.ceo.id), { name: "Engineering", description: "", leadAgentId: f.specialist.id, expectedRevision: 1 }, f.engineering.id)).resolves.toMatchObject({ leadAgentId: f.specialist.id });
    await expect(f.service.save(f.companyId, actor, who, { name: "Stale authority", description: "", expectedRevision: 2 }, f.engineering.id)).rejects.toThrow("only their own");
  });

  it("lets heads organize their projects but prevents taking or reassigning another department's work", async () => {
    const f = await fixture(), head = f.actor(f.head.id), who = f.who(f.head.id);
    await f.service.assign(f.companyId, f.project.id, f.engineering.id, head, who);
    await expect(f.service.assign(f.companyId, f.project.id, f.marketing.id, head, who)).rejects.toThrow("only their own");
    await expect(f.service.assign(f.companyId, f.project.id, f.marketing.id, f.actor(f.otherHead.id), f.who(f.otherHead.id))).rejects.toThrow("only their own");
    await expect(f.service.assign(f.companyId, f.project.id, null, f.actor(f.otherHead.id), f.who(f.otherHead.id))).rejects.toThrow("only their own");
    expect((await db.select().from(agentosDepartmentProjects).where(eq(agentosDepartmentProjects.projectId, f.project.id)))[0].departmentId).toBe(f.engineering.id);
    await f.service.assign(f.companyId, f.project.id, f.marketing.id, f.actor(f.ceo.id), f.who(f.ceo.id));
    await f.service.assign(f.companyId, f.project.id, null, f.actor(f.otherHead.id), f.who(f.otherHead.id));
    expect(await db.select().from(agentosDepartmentProjects).where(eq(agentosDepartmentProjects.projectId, f.project.id))).toHaveLength(0);
  });

  it("rejects title spoofing, foreign executives, and Friday even when native grants exist", async () => {
    const f = await fixture();
    for (const agent of [f.specialist, f.friday, f.foreignHead]) {
      await expect(f.service.save(f.companyId, f.actor(agent.id), f.who(agent.id), { name: "Unauthorized", description: "", expectedRevision: 1 }, f.engineering.id)).rejects.toThrow();
    }
    for (const lead of [f.friday, f.foreignHead]) {
      await expect(f.service.save(f.companyId, f.actor(f.ceo.id), f.who(f.ceo.id), { name: "Invalid appointment", description: "", leadAgentId: lead.id })).rejects.toThrow();
    }
  });

  it("keeps native grants and current responsible-owner membership authoritative", async () => {
    const f = await fixture(), actor = f.actor(f.head.id), who = f.who(f.head.id);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.principalId, f.head.id), eq(principalPermissionGrants.permissionKey, "applications:manage")));
    await expect(f.service.save(f.companyId, actor, who, { name: "Denied", description: "", expectedRevision: 1 }, f.engineering.id)).rejects.toThrow();
    await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "agent", principalId: f.head.id, permissionKey: "applications:manage" });
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.owner)));
    await expect(f.service.save(f.companyId, actor, who, { name: "Stale owner snapshot", description: "", expectedRevision: 1 }, f.engineering.id)).rejects.toThrow();
    expect((await db.select().from(agentosDepartments).where(eq(agentosDepartments.id, f.engineering.id)))[0].revision).toBe(1);
  });

  it("checks native hiring grants and current head appointment in the hire transaction", async () => {
    const f = await fixture();
    await db.insert(principalPermissionGrants).values([
      { companyId: f.companyId, principalType: "agent", principalId: f.head.id, permissionKey: "agents:create" },
      { companyId: f.companyId, principalType: "user", principalId: f.owner, permissionKey: "agents:create" },
    ]);
    const admitted = await resolveAgentHiringAuthority(db, f.companyId, f.actor(f.head.id), { role: "engineer" });
    expect(admitted).toMatchObject({ departmentHead: true, reportsTo: f.head.id });
    await expect(db.transaction(tx => prepareAgentHire(tx as unknown as typeof db, f.companyId,
      { name: "Direct specialist", role: "engineer", adapterType: "process" },
      { runnerResolved: true, hiringAuthority: { actor: f.actor(f.head.id), departmentHead: true } }))).resolves.toMatchObject({ reportsTo: f.head.id });
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.principalId, f.head.id), eq(principalPermissionGrants.permissionKey, "agents:create")));
    await expect(db.transaction(tx => resolveAgentHiringAuthority(tx as unknown as typeof db, f.companyId, f.actor(f.head.id), { role: "engineer" },
      { lock: true, requireDepartmentHead: true }))).rejects.toThrow();
    await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "agent", principalId: f.head.id, permissionKey: "agents:create" });
    await db.update(agentosDepartments).set({ leadAgentId: f.otherHead.id }).where(eq(agentosDepartments.id, f.engineering.id));
    await expect(db.transaction(tx => resolveAgentHiringAuthority(tx as unknown as typeof db, f.companyId, f.actor(f.head.id), { role: "engineer" },
      { lock: true, requireDepartmentHead: true }))).rejects.toThrow("appointment changed");
  });

  it("does not let a head's standard employee turn default native grants into authority outside its subtree", async () => {
    const f = await fixture();
    await db.update(agents).set({ reportsTo: f.head.id, permissions: normalizeAgentPermissions(undefined, { context: "create" }) })
      .where(eq(agents.id, f.specialist.id));
    await db.insert(principalPermissionGrants).values([
      { companyId: f.companyId, principalType: "agent", principalId: f.specialist.id, permissionKey: "agents:configure" },
      { companyId: f.companyId, principalType: "user", principalId: f.owner, permissionKey: "agents:create" },
      { companyId: f.companyId, principalType: "user", principalId: f.owner, permissionKey: "agents:configure" },
    ]);
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.specialist.id,
      responsibleUserId: f.owner, status: "running" }).returning();
    const actor = { ...f.actor(f.specialist.id), runId: run.id };
    const access = accessService(db);
    await expect(access.decide({ actor, action: "agents:create", resource: { type: "company", companyId: f.companyId } })).resolves.toMatchObject({ allowed: true });
    await expect(access.decide({ actor, action: "agent_config:update", resource: { type: "agent", companyId: f.companyId, agentId: f.otherHead.id },
      scope: { targetAgentId: f.otherHead.id } })).resolves.toMatchObject({ allowed: true });
    await expect(resolveAgentHiringAuthority(db, f.companyId, actor, { role: "engineer" })).resolves.toMatchObject({ departmentHead: true, reportsTo: f.specialist.id });
    for (const input of [{ role: "ceo" }, { role: "engineer", reportsTo: f.otherHead.id }]) {
      await expect(db.transaction(tx => prepareAgentHire(tx as unknown as typeof db, f.companyId,
        { name: "Escape", adapterType: "process", ...input },
        { runnerResolved: true, hiringAuthority: { actor, departmentHead: true } }))).rejects.toMatchObject({ status: 403 });
    }
    await expect(db.transaction(async tx => {
      const [target] = await tx.select().from(agents).where(eq(agents.id, f.otherHead.id)).for("update");
      return prepareAgentConfiguration(tx as unknown as typeof db, target, { capabilities: "Take another team" },
        { departmentAuthority: { actor, departmentHead: true } });
    })).rejects.toMatchObject({ status: 403 });
    await db.update(agents).set({ reportsTo: f.ceo.id }).where(eq(agents.id, f.specialist.id));
    await expect(resolveAgentHiringAuthority(db, f.companyId, actor, { role: "engineer", reportsTo: f.ceo.id })).resolves.toMatchObject({ departmentHead: false });
  });

  it("applies the same team ceiling at the owning configuration service for PATCH and rollback", async () => {
    const f = await fixture();
    await db.update(agents).set({ reportsTo: f.head.id }).where(eq(agents.id, f.specialist.id));
    await db.insert(principalPermissionGrants).values([
      { companyId: f.companyId, principalType: "agent", principalId: f.head.id, permissionKey: "agents:configure" },
      { companyId: f.companyId, principalType: "user", principalId: f.owner, permissionKey: "agents:configure" },
    ]);
    const prepare = (patch: { role?: string; reportsTo?: string | null }) => db.transaction(async tx => {
      const [current] = await tx.select().from(agents).where(eq(agents.id, f.specialist.id)).for("update");
      return prepareAgentConfiguration(tx as unknown as typeof db, current, patch,
        { departmentAuthority: { actor: f.actor(f.head.id), departmentHead: true } });
    });
    await expect(prepare({ role: "ceo" })).rejects.toThrow("own reporting team");
    await expect(prepare({ reportsTo: f.otherHead.id })).rejects.toThrow("own reporting team");
    await expect(prepare({ role: "engineer", reportsTo: f.head.id })).resolves.toMatchObject({ role: "engineer", reportsTo: f.head.id });
    expect((await db.select().from(agents).where(eq(agents.id, f.specialist.id)))[0].role).toBe("general");
  });

  it("does not let broad native configure grants change another department's runtime or instructions", async () => {
    const f = await fixture();
    await db.update(agents).set({ reportsTo: f.otherHead.id }).where(eq(agents.id, f.specialist.id));
    await db.insert(principalPermissionGrants).values([
      { companyId: f.companyId, principalType: "agent", principalId: f.head.id, permissionKey: "agents:configure" },
      { companyId: f.companyId, principalType: "user", principalId: f.owner, permissionKey: "agents:configure" },
    ]);
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.head.id,
      responsibleUserId: f.owner, status: "running" }).returning();
    const actor = { ...f.actor(f.head.id), runId: run.id };
    for (const patch of [{ runtimeConfig: { heartbeat: { enabled: false } } }, { capabilities: "Changed remit" }]) {
      await expect(db.transaction(async tx => {
        const [current] = await tx.select().from(agents).where(eq(agents.id, f.specialist.id)).for("update");
        return prepareAgentConfiguration(tx as unknown as typeof db, current, patch,
          { departmentAuthority: { actor, departmentHead: true } });
      })).rejects.toMatchObject({ status: 403 });
    }
    const authorizeInstructions = () => db.transaction(tx => authorizeInstructionCommit(tx, actor, f.specialist));
    await expect(authorizeInstructions()).rejects.toMatchObject({ status: 403 });
    await db.update(agents).set({ reportsTo: f.head.id }).where(eq(agents.id, f.specialist.id));
    await expect(authorizeInstructions()).resolves.toMatchObject({ agentId: f.head.id });
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.principalId, f.head.id),
      eq(principalPermissionGrants.permissionKey, "agents:configure")));
    await expect(authorizeInstructions()).rejects.toMatchObject({ status: 403 });
  });
});
