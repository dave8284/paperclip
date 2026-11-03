import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, agentApiKeys, authUsers, companies, companyMemberships, companyOperatingProfiles, principalPermissionGrants, activityLog, agentosAssignments, agentosEmployees, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentosWorkforceRoutes } from "../routes/agentos-workforce.js";
import { deleteCompany } from "../services/company-deletion.js";
import { deleteAgentDependencies } from "../services/agent-deletion.js";
import { accessService } from "../services/access.js";

describe("Agent OS shared workforce", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("agentos-workforce-"); db = createDb(database.connectionString); }, 60000);
  afterAll(async () => { await database?.cleanup(); });
  function app(actor: Express.Request["actor"]) {
    const result = express(); result.use(express.json());
    result.use((req, _res, next) => { req.actor = actor; next(); });
    result.use("/api", agentosWorkforceRoutes(db)); result.use(errorHandler); return result;
  }
  async function seed() {
    const owner = randomUUID();
    const [one, two] = await db.insert(companies).values(["One", "Two"].map(name => ({ name, issuePrefix: `W${randomUUID().slice(0, 6)}` }))).returning();
    await db.insert(companyMemberships).values([one, two].map(company => ({ companyId: company.id, principalId: owner, principalType: "user", membershipRole: "owner", status: "active" })));
    await db.insert(principalPermissionGrants).values([one, two].map(company => ({ companyId: company.id, principalId: owner, principalType: "user", permissionKey: "users:manage_permissions" })));
    const [first, second] = await db.insert(agents).values([one, two].map(company => ({ companyId: company.id, name: "Engineer", role: "general", adapterType: "paperclip_runner", adapterConfig: { privateValue: "never-in-the-portfolio" } }))).returning();
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId: owner, companyIds: [one.id, two.id], memberships: [one, two].map(company => ({ companyId: company.id, membershipRole: "owner", status: "active" })) };
    const api = app(actor), root = "/api/agentos/portfolios";
    const portfolioInput = { id: randomUUID(), name: "Portfolio", homeCompanyId: one.id };
    await request(api).post(root).send(portfolioInput).expect(201);
    const base = `${root}/${portfolioInput.id}`;
    await request(api).post(`${base}/companies`).send({ companyId: two.id }).expect(201);
    const employeeInput = { id: randomUUID(), name: "Shared engineer", specialty: "Engineering" };
    await request(api).post(`${base}/employees`).send(employeeInput).expect(201);
    const assignments = [first, second].map(agent => ({ id: randomUUID(), employeeId: employeeInput.id, companyId: agent.companyId, agentId: agent.id, department: "Engineering" }));
    for (const assignment of assignments) await request(api).post(`${base}/assignments`).send(assignment).expect(201);
    return { one, two, first, second, owner, actor, api, root, base, portfolioInput, employeeInput, assignments };
  }
  async function delegatedSeed(coordinator = false) {
    const f = await seed(), now = new Date();
    await db.insert(authUsers).values({ id: f.owner, name: "Portfolio owner", email: `${f.owner}@example.test`, createdAt: now, updatedAt: now });
    const [manager] = await db.insert(agents).values({ companyId: f.two.id, name: coordinator ? "Friday" : "CEO", role: coordinator ? "general" : "ceo" }).returning();
    await db.insert(companyMemberships).values({ companyId: f.two.id, principalType: "agent", principalId: manager.id, membershipRole: "member", status: "active" });
    for (const principal of [{ principalType: "agent" as const, principalId: manager.id }, { principalType: "user" as const, principalId: f.owner }]) {
      await db.insert(principalPermissionGrants).values((["applications:manage", "agents:create", "agents:configure"] as const).map(permissionKey => ({ companyId: f.two.id, ...principal, permissionKey })));
    }
    if (coordinator) await db.insert(companyOperatingProfiles).values({ companyId: f.two.id, fridayAgentId: manager.id });
    const delegate: Express.Request["actor"] = { type: "agent", source: "agent_jwt", companyId: f.two.id, agentId: manager.id,
      onBehalfOfUserId: f.owner, onBehalfOfMemberships: [{ companyId: f.two.id, membershipRole: "owner", status: "active" }] };
    const [target] = await db.insert(agents).values({ companyId: f.two.id, name: "Approved specialist" }).returning();
    const employee = { id: randomUUID(), name: "New shared specialist" };
    await request(f.api).post(`${f.base}/employees`).send(employee).expect(201);
    return { ...f, manager, delegate, delegated: app(delegate), target, employee, companyPath: `/api/companies/${f.two.id}/workforce`,
      binding: { id: randomUUID(), employeeId: employee.id, agentId: target.id } };
  }
  it("lets a delegated CEO read and bind only its company's approved workforce without portfolio authority", async () => {
    const f = await delegatedSeed();
    const view = await request(f.delegated).get(f.companyPath).expect(200);
    expect(view.body.assignments.map((row: { assignment: { agentId: string } }) => row.assignment.agentId)).toEqual([f.second.id]);
    expect(JSON.stringify(view.body)).not.toContain(f.one.id);
    expect(JSON.stringify(view.body)).not.toContain("never-in-the-portfolio");
    for (let attempt = 0; attempt < 2; attempt++) await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(201);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.binding.id), eq(activityLog.action, "agentos.assignment_created")));
    expect(audit).toHaveLength(1); expect(audit[0].actorId).toBe(f.manager.id);
    expect(audit[0].companyId).toBe(f.two.id);
    await request(f.delegated).get(f.base).expect(403);
    await request(f.delegated).post(`${f.base}/assignments/${f.assignments[1].id}/retire`).send({ expectedRevision: 1, reason: "Not delegated" }).expect(403);
    await request(f.delegated).get(`/api/companies/${f.one.id}/workforce`).expect(403);
    expect((await request(f.api).get(f.base).expect(200)).body.assignments.find((row: { id: string }) => row.id === f.assignments[0].id).status).toBe("active");
  });
  it("requires the current coordinator binding or CEO role, not an agent name", async () => {
    const f = await delegatedSeed(true);
    await request(f.delegated).get(f.companyPath).expect(200);
    await db.update(companyOperatingProfiles).set({ fridayAgentId: null }).where(eq(companyOperatingProfiles.companyId, f.two.id));
    await request(f.delegated).get(f.companyPath).expect(403);
    await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(403);
  });
  it("rechecks responsible-owner approval, membership, active manager and restricted key boundaries", async () => {
    const f = await delegatedSeed();
    await request(app({ ...f.delegate, onBehalfOfUserId: null })).get(f.companyPath).expect(403);
    await request(app({ ...f.delegate, onBehalfOfUserId: randomUUID() })).get(f.companyPath).expect(403);
    await request(app({ ...f.delegate, keyScope: { kind: "skill_test", issueId: randomUUID() } })).get(f.companyPath).expect(403);
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.manager.id));
    await request(f.delegated).get(f.companyPath).expect(403);
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.manager.id));
    await db.update(authUsers).set({ approvalStatus: "suspended" }).where(eq(authUsers.id, f.owner));
    await request(f.delegated).get(f.companyPath).expect(403);
    await db.update(authUsers).set({ approvalStatus: "approved" }).where(eq(authUsers.id, f.owner));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.principalId, f.owner), eq(companyMemberships.companyId, f.one.id)));
    await request(f.delegated).get(f.companyPath).expect(404);
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.principalId, f.owner), eq(companyMemberships.companyId, f.one.id)));
    // The actor deliberately retains the prior membership snapshot.
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.principalId, f.owner), eq(companyMemberships.companyId, f.two.id)));
    await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(403);
    expect(await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.binding.id))).toHaveLength(0);
  });
  it("requires native staffing/configuration grants and rejects foreign or unapproved targets", async () => {
    const f = await delegatedSeed();
    await request(f.delegated).post(`${f.companyPath}/assignments`).send({ ...f.binding, companyId: f.one.id }).expect(400);
    await request(f.delegated).post(`${f.companyPath}/assignments`).send({ ...f.binding, agentId: f.first.id }).expect(404);
    await db.update(agents).set({ status: "pending_approval" }).where(eq(agents.id, f.target.id));
    await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(409);
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.target.id));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.principalId, f.manager.id), eq(principalPermissionGrants.permissionKey, "agents:configure")));
    await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(404);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.principalId, f.manager.id), eq(principalPermissionGrants.permissionKey, "applications:manage")));
    await request(f.delegated).get(f.companyPath).expect(403);
  });
  it("honors target-scoped configure grants for both the delegate and responsible owner", async () => {
    const f = await delegatedSeed(), access = accessService(db);
    for (const principal of [{ type: "agent" as const, id: f.manager.id }, { type: "user" as const, id: f.owner }]) {
      await access.setPrincipalPermission(f.two.id, principal.type, principal.id, "agents:configure", true, f.owner, { agentIds: [f.target.id] });
    }
    await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(201);
    // An operator's direct request uses the same exact target scope.
    await request(f.api).post(`${f.companyPath}/assignments`).send(f.binding).expect(201);
    const [excluded] = await db.insert(agents).values({ companyId: f.two.id, name: "Outside scoped configure grant" }).returning();
    await request(f.delegated).post(`${f.companyPath}/assignments`).send({ ...f.binding, id: randomUUID(), agentId: excluded.id }).expect(404);
    await access.setPrincipalPermission(f.two.id, "agent", f.manager.id, "agents:configure", true, f.owner);
    // The caller is now broad, but cannot exceed its responsible owner's scope.
    await request(f.delegated).post(`${f.companyPath}/assignments`).send({ ...f.binding, id: randomUUID(), agentId: excluded.id }).expect(404);
    await access.setPrincipalPermission(f.two.id, "user", f.owner, "agents:configure", true, f.owner, { agentIds: [excluded.id] });
    await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(404);
  });
  it("rejects authority revoked while binding waits on the target agent", async () => {
    const f = await delegatedSeed();
    let release!: () => void, locked!: (pid: number) => void;
    const releaseLock = new Promise<void>(resolve => { release = resolve; });
    const targetLocked = new Promise<number>(resolve => { locked = resolve; });
    const holder = db.transaction(async tx => {
      await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, f.target.id)).for("update");
      const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked(row.pid);
      await releaseLock;
    });
    const holderPid = await targetLocked;
    const binding = request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).then(response => response);
    try {
      await expect.poll(async () => {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_stat_activity waiter
          where waiter.datname=current_database() and ${holderPid}=any(pg_blocking_pids(waiter.pid))) as waiting`);
        return row.waiting;
      }, { timeout: 5000, interval: 25 }).toBe(true);
      await accessService(db).setPrincipalPermission(f.two.id, "agent", f.manager.id, "applications:manage", false, f.owner);
      release(); await holder;
      expect((await binding).status).toBe(403);
      expect(await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.binding.id))).toHaveLength(0);
      expect(await db.select().from(activityLog).where(eq(activityLog.entityId, f.binding.id))).toHaveLength(0);
    } finally { release(); await holder; await binding; }
  });
  it("holds native authority through the binding and durable audit commit", async () => {
    const f = await delegatedSeed();
    // Hold the actual SQL audit boundary after authorization and assignment
    // insertion, then observe native grant revocation waiting on the binder.
    await db.execute(sql`create function agentos_test_binding_barrier() returns trigger language plpgsql as $$ begin if NEW.action = 'agentos.assignment_created' then perform pg_advisory_xact_lock(830811031); end if; return NEW; end $$`);
    await db.execute(sql`create trigger agentos_test_binding_barrier before insert on activity_log for each row execute function agentos_test_binding_barrier()`);
    let release!: () => void, locked!: (pid: number) => void;
    const releaseLock = new Promise<void>(resolve => { release = resolve; });
    const barrierLocked = new Promise<number>(resolve => { locked = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(830811031)`);
      const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked(row.pid); await releaseLock;
    });
    const holderPid = await barrierLocked;
    const binding = request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).then(response => response);
    let revocation: Promise<void> | undefined;
    try {
      let binderPid: number | undefined;
      await expect.poll(async () => {
        const [row] = await db.execute<{ pid: number }>(sql`select waiter.pid from pg_stat_activity waiter
          where waiter.datname=current_database() and ${holderPid}=any(pg_blocking_pids(waiter.pid))`);
        binderPid = row?.pid; return !!binderPid;
      }, { timeout: 5000, interval: 25 }).toBe(true);
      revocation = accessService(db).setPrincipalPermission(f.two.id, "agent", f.manager.id, "applications:manage", false, f.owner);
      await expect.poll(async () => {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_stat_activity waiter
          where waiter.datname=current_database() and ${binderPid!}=any(pg_blocking_pids(waiter.pid))) as waiting`);
        return row.waiting;
      }, { timeout: 5000, interval: 25 }).toBe(true);
      release(); await holder;
      expect((await binding).status).toBe(201); await revocation;
      await request(f.delegated).get(f.companyPath).expect(403);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.binding.id), eq(activityLog.action, "agentos.assignment_created")))).toHaveLength(1);
    } finally {
      release(); await holder; await binding; await revocation;
      await db.execute(sql`drop trigger agentos_test_binding_barrier on activity_log`);
      await db.execute(sql`drop function agentos_test_binding_barrier()`);
    }
  });
  it("shares identity across companies, with narrow company runtime data and idempotent creation", async () => {
    const f = await seed();
    const result = await request(f.api).get(f.base).expect(200);
    expect(result.body.employees).toHaveLength(1);
    expect(result.body.assignments).toHaveLength(2);
    expect(result.body.companies).toHaveLength(2);
    expect(result.body.canManage).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("never-in-the-portfolio");
    await request(f.api).post(f.root).send(f.portfolioInput).expect(201);
    await request(f.api).post(`${f.base}/employees`).send(f.employeeInput).expect(201);
    await request(f.api).post(`${f.base}/assignments`).send(f.assignments[0]).expect(201);
    await request(f.api).post(`${f.base}/assignments`).send({ ...f.assignments[0], department: "Other" }).expect(409);
    const rows = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.one.id), eq(activityLog.action, "agentos.assignment_created")));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(f.owner);
  });
  it("retires only one company assignment, revokes its key and records native termination atomically", async () => {
    const f = await seed();
    await db.insert(agentApiKeys).values([f.first, f.second].map(agent => ({ agentId: agent.id, companyId: agent.companyId, name: "test", keyHash: randomUUID() })));
    const path = `${f.base}/assignments/${f.assignments[0].id}/retire`, intent = { expectedRevision: 1, reason: "Trial did not meet quality targets" };
    const responses = await Promise.all([request(f.api).post(path).send(intent), request(f.api).post(path).send(intent)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const result = await request(f.api).get(f.base).expect(200);
    expect(result.body.assignments.find((row: { id: string }) => row.id === f.assignments[0].id)).toMatchObject({ status: "retired", revision: 2, lifecycleState: "terminating", retirementReason: intent.reason });
    expect(result.body.assignments.find((row: { id: string }) => row.id === f.assignments[1].id)).toMatchObject({ status: "active", revision: 1, lifecycleState: "ready" });
    const keys = await db.select().from(agentApiKeys).where(eq(agentApiKeys.companyId, f.one.id));
    expect(keys[0].revokedAt).not.toBeNull();
    const otherKeys = await db.select().from(agentApiKeys).where(eq(agentApiKeys.companyId, f.two.id));
    expect(otherKeys[0].revokedAt).toBeNull();
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.assignments[0].id), eq(activityLog.action, "agentos.assignment_retired")));
    expect(audit).toHaveLength(1);
    await request(f.api).post(path).send({ expectedRevision: 1, reason: "Changed reason" }).expect(409);
  });
  it("rolls back retirement, key revocation and lifecycle changes when durable audit fails", async () => {
    const f = await seed();
    await db.insert(agentApiKeys).values({ agentId: f.first.id, companyId: f.one.id, name: "test", keyHash: randomUUID() });
    // Fault at the actual database boundary after the lifecycle writes.
    await db.execute(sql`create function agentos_test_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action = 'agentos.assignment_retired' then raise exception 'simulated audit unavailable'; end if; return NEW; end $$`);
    await db.execute(sql`create trigger agentos_test_audit_failure before insert on activity_log for each row execute function agentos_test_audit_failure()`);
    try {
      await request(f.api).post(`${f.base}/assignments/${f.assignments[0].id}/retire`).send({ expectedRevision: 1, reason: "Trial" }).expect(500);
      const [agent] = await db.select().from(agents).where(eq(agents.id, f.first.id));
      const [assignment] = await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.assignments[0].id));
      const [key] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, f.first.id));
      expect(agent.lifecycleState).toBe("ready"); expect(assignment.status).toBe("active"); expect(key.revokedAt).toBeNull();
    } finally {
      await db.execute(sql`drop trigger agentos_test_audit_failure on activity_log`);
      await db.execute(sql`drop function agentos_test_audit_failure()`);
    }
  });
  it("blocks replacement within a company while its previous runtime stop remains unresolved", async () => {
    const f = await seed();
    await request(f.api).post(`${f.base}/assignments/${f.assignments[0].id}/retire`).send({ expectedRevision: 1, reason: "Replace after evaluation" }).expect(200);
    const [replacement] = await db.insert(agents).values({ companyId: f.one.id, name: "Replacement", role: "general", adapterType: "paperclip_runner" }).returning();
    const intent = { id: randomUUID(), employeeId: f.employeeInput.id, companyId: f.one.id, agentId: replacement.id };
    await request(f.api).post(`${f.base}/assignments`).send(intent).expect(409);
    // Simulate the native worker's confirmed terminal state; this tests binding
    // admission, not a real remote host's stop proof (owned by lifecycle tests).
    await db.update(agents).set({ lifecycleState: "terminated", status: "terminated", lifecycleOperation: null }).where(eq(agents.id, f.first.id));
    await request(f.api).post(`${f.base}/assignments`).send(intent).expect(201);
    const view = await request(f.api).get(f.base).expect(200);
    expect(view.body.assignments.filter((row: { companyId: string; status: string }) => row.companyId === f.one.id && row.status === "active")).toHaveLength(1);
    expect(view.body.assignments.find((row: { id: string }) => row.id === f.assignments[1].id).status).toBe("active");
  });
  it("uses fresh membership, hides revoked companies and denies agents and other owners", async () => {
    const f = await seed();
    await request(app({ ...f.actor, userId: randomUUID() })).get(f.base).expect(404);
    await request(app({ type: "agent", source: "agent_key", companyId: f.one.id, agentId: f.first.id })).get(f.base).expect(403);
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.principalId, f.owner), eq(companyMemberships.companyId, f.two.id)));
    const view = await request(f.api).get(f.base).expect(200);
    expect(view.body.companies.map((row: { id: string }) => row.id)).toEqual([f.one.id]);
    expect(JSON.stringify(view.body)).not.toContain(f.second.id);
    await request(f.api).post(`${f.base}/assignments/${f.assignments[1].id}/retire`).send({ expectedRevision: 1, reason: "Forbidden" }).expect(404);
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.principalId, f.owner), eq(companyMemberships.companyId, f.one.id)));
    const readonly = await request(f.api).get(f.base).expect(200);
    expect(readonly.body.canManage).toBe(false);
    await request(f.api).post(`${f.base}/employees`).send({ id: randomUUID(), name: "Forbidden" }).expect(404);
  });
  it("intersects portfolio visibility with a token's admitted companies even when its user owns both", async () => {
    const f = await seed();
    const scoped = app({ ...f.actor, source: "mcp_oauth", companyIds: [f.one.id], isInstanceAdmin: true });
    const view = await request(scoped).get(f.base).expect(200);
    expect(view.body.companies.map((row: { id: string }) => row.id)).toEqual([f.one.id]);
    expect(JSON.stringify(view.body)).not.toContain(f.second.id);
    await request(scoped).post(`${f.base}/companies`).send({ companyId: f.two.id }).expect(404);
    await request(scoped).post(`${f.base}/assignments/${f.assignments[1].id}/retire`).send({ expectedRevision: 1, reason: "Outside token scope" }).expect(404);
    await request(app({ ...f.actor, companyIds: [] })).get(f.base).expect(404);
  });
  it("rejects cross-company runtime binding, malformed requests, competing assignments and managers with reports", async () => {
    const f = await seed();
    const employee = { id: randomUUID(), name: "Second employee" };
    await request(f.api).post(`${f.base}/employees`).send(employee).expect(201);
    await request(f.api).post(`${f.base}/assignments`).send({ id: randomUUID(), employeeId: employee.id, companyId: f.one.id, agentId: f.second.id }).expect(404);
    await request(f.api).post(`${f.base}/assignments`).send({ id: randomUUID(), employeeId: employee.id, companyId: f.one.id, agentId: f.first.id }).expect(409);
    await request(f.api).post(`${f.base}/employees`).send({ name: "No request ID" }).expect(400);
    await request(f.api).get(`${f.root}/bad-id`).expect(400);
    await db.insert(agents).values({ companyId: f.one.id, name: "Report", reportsTo: f.first.id, role: "general", adapterType: "paperclip_runner" });
    await request(f.api).post(`${f.base}/assignments/${f.assignments[0].id}/retire`).send({ expectedRevision: 1, reason: "Replace manager" }).expect(409);
    const [row] = await db.select().from(agentosEmployees).where(eq(agentosEmployees.id, f.employeeInput.id));
    expect(row.name).toBe("Shared engineer");
  });
  it("preserves portfolio audit ownership and workforce history through native permanent-delete paths", async () => {
    const f = await seed();
    await expect(deleteCompany(db, f.one.id)).rejects.toThrow("portfolio's administration");
    await expect(deleteAgentDependencies(db, f.one.id, f.first.id)).rejects.toThrow("assignment history");
    const [agent] = await db.select().from(agents).where(eq(agents.id, f.first.id));
    expect(agent.lifecycleState).toBe("ready"); // rejected before starting destructive lifecycle work
    const retained = await request(f.api).get(f.base).expect(200);
    expect(retained.body.assignments).toHaveLength(2);
  });
});
