import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, agentosEmployees, agentosPortfolioCompanies, agentosPortfolios, authUsers, companies, companyMemberships, createDb, issues, principalPermissionGrants, projects } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { errorHandler } from "../middleware/index.js";
import { companyRoutes } from "../routes/companies.js";
import { companyService } from "../services/companies.js";
import { agentosWorkforceService } from "../services/agentos-workforce.js";

describe("AgentOS platform context", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("agentos-platform-context-"); db = createDb(database.connectionString); }, 90000);
  afterAll(async () => database?.cleanup());
  function app(actor: Express.Request["actor"]) {
    const result = express(); result.use(express.json());
    result.use((req, _res, next) => { req.actor = actor; next(); });
    result.use("/api/companies", companyRoutes(db)); result.use(errorHandler); return result;
  }
  async function seed() {
    const owner = randomUUID(), viewer = randomUUID();
    // Workforce admission rechecks approved identities from durable state,
    // independently of the middleware's admitted membership snapshot.
    await db.insert(authUsers).values([owner, viewer].map(id => ({ id, name: "Platform context fixture", email: `${id}@example.com`,
      approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() })));
    const [home, business, foreign] = await db.insert(companies).values(["Core context", "Customer venture", "Outside company"].map(name => ({ name, issuePrefix: `P${randomUUID().slice(0, 7)}` }))).returning();
    await db.insert(companyMemberships).values([home, business].flatMap(company => [
      { companyId: company.id, principalId: owner, principalType: "user", membershipRole: "owner", status: "active" },
      { companyId: company.id, principalId: viewer, principalType: "user", membershipRole: "viewer", status: "active" },
    ]));
    await db.insert(principalPermissionGrants).values([home, business].map(company => ({ companyId: company.id, principalId: owner, principalType: "user", permissionKey: "users:manage_permissions" })));
    const [portfolio] = await db.insert(agentosPortfolios).values({ name: "Portfolio", homeCompanyId: home.id, ownerUserId: owner }).returning();
    await db.insert(agentosPortfolioCompanies).values([home, business].map(company => ({ companyId: company.id, portfolioId: portfolio.id })));
    const [employee] = await db.insert(agentosEmployees).values({ portfolioId: portfolio.id, name: "Reusable engineer" }).returning();
    const [agent] = await db.insert(agents).values({ companyId: home.id, name: "Friday", role: "ceo", adapterConfig: { preserved: "configuration" } }).returning();
    await db.insert(agents).values({ companyId: business.id, name: "Venture lead" });
    const [project] = await db.insert(projects).values({ companyId: home.id, name: "Preserved internal project" }).returning();
    const [issue] = await db.insert(issues).values({ companyId: home.id, projectId: project.id, title: "Preserved conversation", assigneeAgentId: agent.id }).returning();
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId: owner, companyIds: [home.id, business.id], memberships: [home, business].map(company => ({ companyId: company.id, membershipRole: "owner", status: "active" })) };
    return { owner, viewer, home, business, foreign, portfolio, employee, agent, project, issue, actor, api: app(actor) };
  }
  it("classifies only an explicitly managed portfolio home, audits it and preserves core records", async () => {
    const f = await seed();
    expect(f.business.purpose).toBe("business");
    const changed = await request(f.api).patch(`/api/companies/${f.home.id}`).send({ purpose: "platform" }).expect(200);
    expect(changed.body.purpose).toBe("platform");
    await request(f.api).patch(`/api/companies/${f.business.id}`).send({ purpose: "platform" }).expect(422);
    const audits = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home.id), eq(activityLog.action, "company.purpose_changed")));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "user", actorId: f.owner, details: { previousPurpose: "business", purpose: "platform" } });
    expect((await db.select().from(agents).where(eq(agents.id, f.agent.id)))[0].adapterConfig).toEqual({ preserved: "configuration" });
    expect(await db.select().from(projects).where(eq(projects.id, f.project.id))).toHaveLength(1);
    expect(await db.select().from(issues).where(eq(issues.id, f.issue.id))).toHaveLength(1);
    await request(f.api).get(`/api/companies/${f.home.id}`).expect(200);
    const workforce = await agentosWorkforceService(db).read(f.actor, f.portfolio.id);
    expect(workforce.portfolio.homeCompanyId).toBe(f.home.id);
    expect(workforce.companies.map(company => company.id)).toEqual([f.business.id]);
    expect(workforce.employees.map(employee => employee.id)).toEqual([f.employee.id]);
  });
  it("excludes internal work by default without expanding explicit internal access", async () => {
    const f = await seed();
    await request(f.api).patch(`/api/companies/${f.home.id}`).send({ purpose: "platform" }).expect(200);
    const normal = await request(f.api).get("/api/companies?scope=accessible").expect(200);
    expect(normal.body.map((company: { id: string }) => company.id)).toEqual([f.business.id]);
    const explicit = await request(f.api).get("/api/companies?scope=accessible&includeInternal=true").expect(200);
    expect(explicit.body.map((company: { id: string }) => company.id).sort()).toEqual([f.home.id, f.business.id].sort());
    const stats = await request(f.api).get("/api/companies/stats").expect(200);
    expect(Object.keys(stats.body)).toEqual([f.business.id]);
    const scoped = app({ ...f.actor, companyIds: [f.business.id] });
    expect((await request(scoped).get("/api/companies?scope=accessible&includeInternal=true").expect(200)).body.map((company: { id: string }) => company.id)).toEqual([f.business.id]);
    await request(scoped).get(`/api/companies/${f.home.id}`).expect(403);
    await request(f.api).get(`/api/companies/${f.foreign.id}`).expect(403);
    const onlyInternal = app({ ...f.actor, companyIds: [f.home.id] });
    expect((await request(onlyInternal).get("/api/companies?scope=accessible").expect(200)).body).toEqual([]);
    expect((await request(onlyInternal).get("/api/companies?scope=accessible&includeInternal=true").expect(200)).body.map((company: { id: string }) => company.id)).toEqual([f.home.id]);
  });
  it("rejects classification by a viewer, CEO executor or non-user service actor", async () => {
    const f = await seed();
    const viewer = app({ ...f.actor, userId: f.viewer, memberships: [{ companyId: f.home.id, membershipRole: "viewer", status: "active" }] });
    await request(viewer).patch(`/api/companies/${f.home.id}`).send({ purpose: "platform" }).expect(403);
    const ceo = app({ type: "agent", source: "agent_key", companyId: f.home.id, agentId: f.agent.id });
    await request(ceo).patch(`/api/companies/${f.home.id}`).send({ purpose: "platform" }).expect(400);
    await expect(companyService(db).update(f.home.id, { purpose: "platform" }, { actorType: "agent", actorId: f.agent.id })).rejects.toThrow("authorized operator");
    expect((await companyService(db).getById(f.home.id))?.purpose).toBe("business");
  });
});
