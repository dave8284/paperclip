import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, agentApiKeys, companies, companyMemberships, principalPermissionGrants, activityLog, agentosAssignments, agentosEmployees, createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentosWorkforceRoutes } from "../routes/agentos-workforce.js";
import { deleteCompany } from "../services/company-deletion.js";
import { deleteAgentDependencies } from "../services/agent-deletion.js";

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
