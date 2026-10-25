import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, createDb, issues, managedApplications, managedApplicationProjects, projects, projectAccessMembers } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { managedApplicationRoutes } from "../routes/managed-applications.js";

describe("managed application persistence and access", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("agentos-applications-");
    db = createDb(tempDb.connectionString);
  }, 60000);
  afterAll(async () => { await tempDb?.cleanup(); });

  function app(actor: Express.Request["actor"]) {
    const result = express();
    result.use(express.json());
    result.use((req, _res, next) => { req.actor = actor; next(); });
    result.use("/api", managedApplicationRoutes(db));
    result.use(errorHandler);
    return result;
  }
  function actor(companyId: string, userId = "owner", membershipRole = "operator"): Express.Request["actor"] {
    return { type: "board", source: "session", userId, companyIds: [companyId], memberships: [{ companyId, membershipRole, status: "active" }] };
  }
  async function seed(visibility = "open") {
    const companyId = randomUUID();
    const homeProjectId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "AgentOS test", issuePrefix: `A${companyId.slice(0, 5).toUpperCase()}` });
    await db.insert(projects).values({ id: homeProjectId, companyId, name: "Home", visibility });
    if (visibility === "private") await db.insert(projectAccessMembers).values({ companyId, projectId: homeProjectId, subjectType: "user", subjectId: "owner" });
    const base = `/api/companies/${companyId}/managed-applications`;
    const input = { idempotencyKey: randomUUID(), name: "Product", brief: "Improve the existing application", source: "existing", homeProjectId };
    return { companyId, homeProjectId, base, input };
  }

  it("creates once under concurrent retries, preserves edits on replay, and audits once", async () => {
    const fixture = await seed();
    const api = app(actor(fixture.companyId));
    const results = await Promise.all([request(api).post(fixture.base).send(fixture.input), request(api).post(fixture.base).send(fixture.input)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    const id = results[0].body.id;
    expect(results[0].body.creationHash).toBeUndefined();
    expect((await request(api).patch(`${fixture.base}/${id}`).send({ name: "Renamed", stage: "operating" })).status).toBe(200);
    const replay = await request(api).post(fixture.base).send(fixture.input);
    expect(replay.body.name).toBe("Renamed");
    expect(replay.body.stage).toBe("operating");
    expect((await request(api).post(fixture.base).send({ ...fixture.input, brief: "Different" })).status).toBe(409);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, fixture.companyId), eq(activityLog.action, "managed_application.created")));
    expect(audit).toHaveLength(1);
    expect(audit[0].entityType).toBe("project");
    expect(audit[0].entityId).toBe(fixture.homeProjectId);
  });

  it("inherits private home-project access for list, detail, work, and mutation", async () => {
    const fixture = await seed("private");
    const created = await request(app(actor(fixture.companyId))).post(fixture.base).send(fixture.input);
    expect(created.status).toBe(201);
    const outsider = app(actor(fixture.companyId, "other"));
    expect((await request(outsider).get(fixture.base)).body.applications).toEqual([]);
    expect((await request(outsider).get(`${fixture.base}/${created.body.id}`)).status).toBe(404);
    expect((await request(outsider).get(`${fixture.base}/${created.body.id}/work`)).status).toBe(404);
    expect((await request(outsider).patch(`${fixture.base}/${created.body.id}`).send({ name: "Leak" })).status).toBe(404);
  });

  it("denies unauthenticated, viewer, agent registry mutations, restricted discovery, and foreign project links", async () => {
    const fixture = await seed();
    const foreign = await seed();
    expect((await request(app({ type: "none" })).get(fixture.base)).status).toBe(401);
    expect((await request(app(actor(fixture.companyId, "viewer", "viewer"))).post(fixture.base).send(fixture.input)).status).toBe(403);
    const agent: Express.Request["actor"] = { type: "agent", source: "agent_key", companyId: fixture.companyId, agentId: randomUUID(), keyScope: { kind: "standard" } };
    expect((await request(app(agent)).post(fixture.base).send(fixture.input)).status).toBe(403);
    expect((await request(app({ ...agent, companyId: foreign.companyId })).get(fixture.base)).status).toBe(403);
    expect((await request(app({ ...agent, keyScope: { kind: "skill_test" } as never })).get(fixture.base)).status).toBe(403);
    const api = app(actor(fixture.companyId));
    const created = await request(api).post(fixture.base).send(fixture.input);
    expect((await request(api).post(`${fixture.base}/${created.body.id}/projects`).send({ projectId: foreign.homeProjectId })).status).toBe(404);
    await expect(db.insert(managedApplicationProjects).values({ companyId: fixture.companyId, applicationId: created.body.id, projectId: foreign.homeProjectId })).rejects.toThrow();
  });

  it("lets a standard coordinator link accessible projects idempotently without broadening access", async () => {
    const fixture = await seed();
    const created = await request(app(actor(fixture.companyId))).post(fixture.base).send(fixture.input);
    const agentId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId: fixture.companyId, name: "Coordinator", role: "general", adapterType: "process" });
    const agent: Express.Request["actor"] = { type: "agent", source: "agent_key", companyId: fixture.companyId, agentId, keyScope: { kind: "standard" } };
    const projectId = randomUUID();
    const privateId = randomUUID();
    await db.insert(projects).values([
      { id: projectId, companyId: fixture.companyId, name: "Initiative" },
      { id: privateId, companyId: fixture.companyId, name: "Protected", visibility: "private" },
    ]);
    const endpoint = `${fixture.base}/${created.body.id}/projects`;
    for (let attempt = 0; attempt < 2; attempt++) expect((await request(app(agent)).post(endpoint).send({ projectId })).status).toBe(204);
    expect((await request(app(agent)).post(endpoint).send({ projectId: privateId })).status).toBe(404);
    expect((await request(app({ ...agent, keyScope: { kind: "skill_test" } as never })).post(endpoint).send({ projectId })).status).toBe(403);
    expect((await request(app(agent)).delete(`${endpoint}/${projectId}`)).status).toBe(403);
    const audits = await db.select().from(activityLog).where(and(eq(activityLog.companyId, fixture.companyId), eq(activityLog.action, "managed_application.project_linked")));
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(agentId);
    expect((await request(app(agent)).get(`${fixture.base}/${created.body.id}/work`)).body.projects.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([fixture.homeProjectId, projectId]));
  });

  it("filters private and hidden work before counts, map data, and pagination", async () => {
    const fixture = await seed();
    const owner = app(actor(fixture.companyId));
    const created = await request(owner).post(fixture.base).send(fixture.input);
    const secondProject = randomUUID();
    await db.insert(projects).values({ id: secondProject, companyId: fixture.companyId, name: "Private initiative", visibility: "private" });
    await db.insert(projectAccessMembers).values({ companyId: fixture.companyId, projectId: secondProject, subjectType: "user", subjectId: "owner" });
    expect((await request(owner).post(`${fixture.base}/${created.body.id}/projects`).send({ projectId: secondProject })).status).toBe(204);
    await db.insert(issues).values([
      { companyId: fixture.companyId, projectId: fixture.homeProjectId, title: "Visible one", status: "todo" },
      { companyId: fixture.companyId, projectId: fixture.homeProjectId, title: "Visible two", status: "done" },
      { companyId: fixture.companyId, projectId: fixture.homeProjectId, title: "Private task", visibility: "private", createdByUserId: "owner", status: "blocked" },
      { companyId: fixture.companyId, projectId: fixture.homeProjectId, title: "Hidden task", hiddenAt: new Date(), status: "blocked" },
      { companyId: fixture.companyId, projectId: secondProject, title: "Private project task", status: "blocked" },
    ]);
    const viewer = app(actor(fixture.companyId, "other"));
    const page = await request(viewer).get(`${fixture.base}/${created.body.id}/work?limit=1`);
    expect(page.status).toBe(200);
    expect(page.body.counts).toEqual({ todo: 1, done: 1 });
    expect(page.body.tasks).toHaveLength(1);
    expect(page.body.nextOffset).toBe(1);
    expect(page.body.projects.map((project: { id: string }) => project.id)).toEqual([fixture.homeProjectId]);
    expect((await request(viewer).get(`${fixture.base}/${created.body.id}/work?projectId=${secondProject}`)).status).toBe(404);
    const portfolio = await request(viewer).get(fixture.base);
    expect(portfolio.body.summaries[created.body.id]).toEqual({ projectCount: 1, taskCounts: { todo: 1, done: 1 } });
    const next = await request(viewer).get(`${fixture.base}/${created.body.id}/work?limit=1&offset=1`);
    expect(next.body.nextOffset).toBeNull();
    expect(next.body.tasks[0].id).not.toBe(page.body.tasks[0].id);
    expect((await request(owner).delete(`${fixture.base}/${created.body.id}/projects/${fixture.homeProjectId}`)).status).toBe(409);
  });

  it("rolls back application and project links when the audit cannot persist", async () => {
    const fixture = await seed();
    await db.execute(sql`create function agentos_test_reject_audit() returns trigger language plpgsql as $$ begin
      if NEW.action = 'managed_application.created' then raise exception 'audit unavailable'; end if; return NEW; end $$`);
    await db.execute(sql`create trigger agentos_test_audit before insert on activity_log for each row execute function agentos_test_reject_audit()`);
    try {
      expect((await request(app(actor(fixture.companyId))).post(fixture.base).send(fixture.input)).status).toBe(500);
      expect(await db.select().from(managedApplications).where(eq(managedApplications.companyId, fixture.companyId))).toEqual([]);
      expect(await db.select().from(managedApplicationProjects).where(eq(managedApplicationProjects.companyId, fixture.companyId))).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger agentos_test_audit on activity_log`);
      await db.execute(sql`drop function agentos_test_reject_audit()`);
    }
  });
});
