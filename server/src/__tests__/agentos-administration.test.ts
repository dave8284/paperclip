import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentosAdminEvents, agentosUserInvitations, authAccounts, authSessions, authUsers, boardApiKeys,
  companies, companyMemberships, costEvents, createDb, instanceUserRoles, invites } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentosAdministrationRoutes } from "../routes/agentos-administration.js";
import { accessRoutes } from "../routes/access.js";
import { initialRegistrationStatus, userApprovalGuard } from "../auth/agentos-registration.js";
import { administrationService } from "../services/agentos-administration.js";
import { boardAuthService } from "../services/board-auth.js";
import { claimFirstInstanceAdmin } from "../first-admin-claim.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";
import { publishLiveEvent } from "../services/live-events.js";

describe("Agent OS registration and administration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("agentos-administration-"); db = createDb(database.connectionString); }, 60000);
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => { await db.delete(instanceUserRoles); });
  async function user(status = "approved", admin = false) {
    const id = randomUUID();
    const [row] = await db.insert(authUsers).values({ id, email: `${id}@example.com`, name: "Person", approvalStatus: status, createdAt: new Date(), updatedAt: new Date() }).returning();
    if (admin) await db.insert(instanceUserRoles).values({ userId: id, role: "instance_admin" });
    return row;
  }
  function app(userId?: string, local = false) {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = userId ? { type: "board", userId, source: local ? "local_implicit" : "session", isInstanceAdmin: true, companyIds: [] } : { type: "none", source: "none" }; next(); });
    const router = express.Router(); router.use(userApprovalGuard(db));
    router.use(agentosAdministrationRoutes(db, { deploymentMode: "authenticated" }));
    router.use(accessRoutes(db, { deploymentMode: "authenticated", deploymentExposure: "public", bindHost: "127.0.0.1", allowedHostnames: [] }));
    router.post("/companies", (_req, res) => res.json({ executed: true }));
    app.use("/api", router); app.use(errorHandler); return app;
  }
  const principal = (userId: string) => ({ userId, local: false });

  it("holds pending registrations at the server boundary, despite stale admin claims", async () => {
    const pending = await user("pending");
    const api = app(pending.id);
    await request(api).get("/api/registration").expect(200).expect(res => expect(res.body.status).toBe("pending"));
    await request(api).get("/api/registration/options").expect(200);
    await request(api).post("/api/companies").send({}).expect(403);
    await request(api).get("/api/admin/people").expect(403);
    await request(app()).get("/api/admin/overview").expect(403);
    await request(app((await user()).id)).get("/api/admin/overview").expect(403);
  });

  it("approves with optimistic concurrency, records an audit and preserves scoped membership", async () => {
    const admin = await user("approved", true), pending = await user("pending");
    const api = app(admin.id);
    const path = `/api/admin/people/${pending.id}`;
    await request(api).patch(path).send({ action: "approve", expectedRevision: 1, reason: "Approved by owner" }).expect(200);
    await request(api).patch(path).send({ action: "reject", expectedRevision: 1 }).expect(409);
    const access = await boardAuthService(db).resolveBoardAccess(pending.id);
    expect(access.companyIds).toEqual([]); expect(access.isInstanceAdmin).toBe(false);
    const audit = await db.select().from(agentosAdminEvents).where(eq(agentosAdminEvents.targetUserId, pending.id));
    expect(audit).toHaveLength(1); expect(audit[0].action).toBe("user.approve");
  });

  it("suspends existing credentials, sessions and authority while preserving company data", async () => {
    const admin = await user("approved", true), member = await user();
    const [company] = await db.insert(companies).values({ name: "Keep company", issuePrefix: `A${randomUUID().slice(0, 6)}` }).returning();
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: member.id, membershipRole: "member", status: "active" });
    await db.insert(authSessions).values({ id: randomUUID(), userId: member.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60000), createdAt: new Date(), updatedAt: new Date() });
    await db.insert(boardApiKeys).values({ userId: member.id, name: "CLI", keyHash: randomUUID() });
    await request(app(admin.id)).patch(`/api/admin/people/${member.id}`).send({ action: "suspend", expectedRevision: 1 }).expect(200);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, member.id))).toHaveLength(0);
    const [key] = await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, member.id));
    expect(key.revokedAt).not.toBeNull();
    expect(await boardAuthService(db).resolveBoardAccess(member.id)).toMatchObject({ user: null, companyIds: [], isInstanceAdmin: false });
    await request(app(member.id)).post("/api/companies").send({}).expect(403);
    expect(await db.select().from(companies).where(eq(companies.id, company.id))).toHaveLength(1);
  });

  it("preapproves only verified unexpired identities and supports revocation", async () => {
    const admin = await user("approved", true);
    const email = `${randomUUID()}@example.com`;
    const api = app(admin.id);
    const response = await request(api).post("/api/admin/preapprovals").send({ name: "Invited", email }).expect(201);
    expect(await initialRegistrationStatus(db, email, false)).toBe("pending");
    expect(await initialRegistrationStatus(db, email.toUpperCase(), true)).toBe("approved");
    await db.update(agentosUserInvitations).set({ expiresAt: new Date(0) }).where(eq(agentosUserInvitations.id, response.body.id));
    expect(await initialRegistrationStatus(db, email, true)).toBe("pending");
    await request(api).post("/api/admin/preapprovals").send({ name: "Invited", email }).expect(201);
    await request(api).delete(`/api/admin/preapprovals/${response.body.id}`).expect(200);
    expect(await initialRegistrationStatus(db, email, true)).toBe("pending");
  });

  it.each(["revoke_sessions", "suspend"])("closes an existing live feed on %s before delivering another event", async action => {
    const admin = await user("approved", true), member = await user();
    const [company] = await db.insert(companies).values({ name: "Live access", issuePrefix: `L${randomUUID().slice(0, 6)}` }).returning();
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: member.id, membershipRole: "member", status: "active" });
    const sessionId = randomUUID();
    await db.insert(authSessions).values({ id: sessionId, userId: member.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60000), createdAt: new Date(), updatedAt: new Date() });
    const server = createServer();
    setupLiveEventsWebSocketServer(server, db, { deploymentMode: "authenticated",
      resolveSessionFromHeaders: async () => ({ session: { id: sessionId, userId: member.id }, user: { id: member.id, name: member.name, email: member.email } }),
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/companies/${company.id}/events/ws`);
    const messages: unknown[] = []; socket.on("message", data => messages.push(data));
    try {
      await once(socket, "open");
      await request(app(admin.id)).patch(`/api/admin/people/${member.id}`).send({ action, expectedRevision: 1 }).expect(200);
      const closed = once(socket, "close");
      publishLiveEvent({ companyId: company.id, type: "activity.logged", payload: { entityType: "company", entityId: company.id, action: "company.updated" } });
      const [code] = await closed;
      expect(code).toBe(1008); expect(messages).toHaveLength(0);
    } finally { socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it("protects the last administrator and self access, including concurrent changes", async () => {
    const first = await user("approved", true), second = await user("approved", true);
    const service = administrationService(db);
    const results = await Promise.allSettled([
      service.updatePerson(principal(first.id), second.id, { action: "demote", expectedRevision: 1, reason: "" }),
      service.updatePerson(principal(second.id), first.id, { action: "demote", expectedRevision: 1, reason: "" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const roles = await db.select().from(instanceUserRoles);
    expect(roles).toHaveLength(1);
    const admin = roles[0].userId;
    const [row] = await db.select().from(authUsers).where(eq(authUsers.id, admin));
    await request(app(admin)).patch(`/api/admin/people/${admin}`).send({ action: "suspend", expectedRevision: row.approvalRevision }).expect(409);
    await request(app("local-board", true)).patch(`/api/admin/people/${admin}`).send({ action: "demote", expectedRevision: row.approvalRevision }).expect(409);
  });

  it("preserves legacy administrator role responses and audits changes", async () => {
    const admin = await user("approved", true), member = await user();
    const api = app(admin.id);
    const promoted = await request(api).post(`/api/admin/users/${member.id}/promote-instance-admin`).send({}).expect(201);
    expect(promoted.body).toMatchObject({ userId: member.id, role: "instance_admin", id: expect.any(String), createdAt: expect.any(String) });
    const demoted = await request(api).post(`/api/admin/users/${member.id}/demote-instance-admin`).send({}).expect(200);
    expect(demoted.body).toEqual(promoted.body);
    await request(api).post(`/api/admin/users/${member.id}/demote-instance-admin`).send({}).expect(404);
    const audit = await db.select().from(agentosAdminEvents).where(eq(agentosAdminEvents.targetUserId, member.id));
    expect(audit.map(row => row.action).sort()).toEqual(["user.demote", "user.promote"]);
    const [updated] = await db.select().from(authUsers).where(eq(authUsers.id, member.id));
    expect(updated.approvalRevision).toBe(3);
  });

  it("deletes the identity and credentials while retaining the administrative audit", async () => {
    const admin = await user("approved", true), member = await user();
    await db.insert(authAccounts).values({ id: randomUUID(), userId: member.id, providerId: "credential", accountId: member.id, issuer: "local:credential", password: "never-return", createdAt: new Date(), updatedAt: new Date() });
    await request(app(admin.id)).delete(`/api/admin/people/${member.id}`).send({ expectedRevision: 1, confirmEmail: "wrong@example.com" }).expect(409);
    await request(app(admin.id)).delete(`/api/admin/people/${member.id}`).send({ expectedRevision: 1, confirmEmail: member.email }).expect(200);
    expect(await db.select().from(authUsers).where(eq(authUsers.id, member.id))).toHaveLength(0);
    expect(await db.select().from(authAccounts).where(eq(authAccounts.userId, member.id))).toHaveLength(0);
    expect(await db.select().from(agentosAdminEvents).where(and(eq(agentosAdminEvents.targetUserId, member.id), eq(agentosAdminEvents.action, "user.deleted")))).toHaveLength(1);
  });

  it("rolls approval back when its durable audit cannot be written", async () => {
    const admin = await user("approved", true), pending = await user("pending");
    await db.execute(sql`create function agentos_admin_test_failure() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$`);
    await db.execute(sql`create trigger agentos_admin_test_failure before insert on agentos_admin_events for each row execute function agentos_admin_test_failure()`);
    try {
      await request(app(admin.id)).patch(`/api/admin/people/${pending.id}`).send({ action: "approve", expectedRevision: 1 }).expect(500);
      const [row] = await db.select().from(authUsers).where(eq(authUsers.id, pending.id));
      expect(row.approvalStatus).toBe("pending"); expect(row.approvalRevision).toBe(1);
    } finally {
      await db.execute(sql`drop trigger agentos_admin_test_failure on agentos_admin_events`);
      await db.execute(sql`drop function agentos_admin_test_failure()`);
    }
  });

  it("bootstrap approves the first owner, without granting later registrants authority", async () => {
    const first = await user("pending"), second = await user("pending");
    expect((await claimFirstInstanceAdmin(db, { userId: first.id })).status).toBe("claimed");
    expect((await claimFirstInstanceAdmin(db, { userId: second.id })).status).toBe("already_claimed");
    const rows = await db.select().from(authUsers).where(sql`${authUsers.id} in (${first.id}, ${second.id})`);
    expect(rows.find(row => row.id === first.id)?.approvalStatus).toBe("approved");
    expect(rows.find(row => row.id === second.id)?.approvalStatus).toBe("pending");
  });

  it("allows the public first-owner invitation through the gate, but blocks ordinary invitations", async () => {
    const pending = await user("pending"), token = randomUUID(), ordinary = randomUUID();
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    await db.insert(invites).values([
      { tokenHash: hash(token), inviteType: "bootstrap_ceo", allowedJoinTypes: "human", expiresAt: new Date(Date.now() + 60000) },
      { tokenHash: hash(ordinary), inviteType: "company_join", allowedJoinTypes: "human", expiresAt: new Date(Date.now() + 60000) },
    ]);
    const api = app(pending.id);
    await request(api).post(`/api/invites/${ordinary}/accept`).send({ requestType: "human" }).expect(403);
    await request(api).get(`/api/invites/${token}`).expect(200);
    await request(api).post(`/api/invites/${token}/accept`).send({ requestType: "human" }).expect(202);
    const status = await request(api).get("/api/registration").expect(200);
    expect(status.body).toMatchObject({ status: "approved", isInstanceAdmin: true });
  });

  it("returns real model accounting without credentials or fabricated learning results", async () => {
    const admin = await user("approved", true);
    const [company] = await db.insert(companies).values({ name: "Model accounting", issuePrefix: `M${randomUUID().slice(0, 6)}` }).returning();
    await db.insert(costEvents).values({ companyId: company.id, usageKind: "decision", provider: "test", model: "seat-model", billingType: "subscription_included", inputTokens: 90, outputTokens: 10, costCents: "0", occurredAt: new Date() });
    const response = await request(app(admin.id)).get("/api/admin/model-intelligence").expect(200);
    expect(response.body.usage.find((row: { model: string }) => row.model === "seat-model")).toMatchObject({ inputTokens: 90, outputTokens: 10, receipts: 1 });
    expect(response.body.learning).toMatchObject({ status: "not_connected", evaluations: null, policyReleases: null });
    const people = await request(app(admin.id)).get("/api/admin/people").expect(200);
    expect(JSON.stringify(people.body)).not.toContain("password");
    expect(JSON.stringify(people.body)).not.toContain("accessToken");
  });
});
