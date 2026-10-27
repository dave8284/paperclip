import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, agentosDepartments, agentosDepartmentProjects, cases, caseAccessSources, caseHandoffs, companies, companyMemberships, createDb, issueComments, issues, issueWorkProducts, projects, projectAccessMembers } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { fridayRoutes } from "../routes/friday.js";

describe("Friday native awareness", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("friday-awareness-"); db = createDb(database.connectionString); }, 60000);
  afterAll(async () => { await database?.cleanup(); });
  function app(actor: Express.Request["actor"]) {
    const result = express(); result.use(express.json());
    result.use((req, _res, next) => { req.actor = actor; next(); });
    result.use("/api", fridayRoutes(db)); result.use(errorHandler); return result;
  }
  async function seed() {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Awareness test", issuePrefix: `F${companyId.slice(0, 6)}` });
    await db.insert(companyMemberships).values(["owner", "reader"].map(principalId => ({ companyId, principalId, principalType: "user", membershipRole: "operator", status: "active" })));
    const [lead, worker] = await db.insert(agents).values(["Lead", "Worker"].map(name => ({ companyId, name, role: "general", adapterType: "paperclip_runner" }))).returning();
    const [first, second, empty, secret] = await db.insert(projects).values([
      { companyId, name: "First", leadAgentId: lead.id }, { companyId, name: "Second" },
      { companyId, name: "Lead without tasks", leadAgentId: worker.id }, { companyId, name: "Secret project", visibility: "private" },
    ]).returning();
    await db.insert(projectAccessMembers).values({ companyId, projectId: secret.id, subjectType: "user", subjectId: "owner" });
    const [privateTask] = await db.insert(issues).values({ companyId, projectId: first.id, title: "Secret task", visibility: "private", createdByUserId: "owner", status: "blocked" }).returning();
    const [active, done] = await db.insert(issues).values([
      { companyId, projectId: first.id, title: "Build", status: "in_progress", assigneeAgentId: worker.id, createdByAgentId: lead.id, parentId: privateTask.id },
      { companyId, projectId: second.id, title: "Delivered", status: "done", assigneeAgentId: worker.id },
      { companyId, projectId: secret.id, title: "Secret project task", status: "blocked" },
      { companyId, projectId: first.id, title: "Conversation", conversationAgentId: worker.id, conversationUserId: "reader", conversationState: "active", assigneeAgentId: worker.id },
      { companyId, projectId: first.id, title: "Hidden task", hiddenAt: new Date() },
    ]).returning();
    const [comment] = await db.insert(issueComments).values({ companyId, issueId: active.id, authorAgentId: lead.id, body: "Please build the feature" }).returning();
    await db.insert(issueComments).values([{ companyId, issueId: privateTask.id, body: "Private body" }, { companyId, issueId: active.id, body: "Deleted body", deletedAt: new Date() }]);
    const [output] = await db.insert(issueWorkProducts).values({ companyId, projectId: second.id, issueId: done.id, title: "Release evidence", type: "document", provider: "paperclip", status: "ready_for_review" }).returning();
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId: "reader", companyIds: [companyId], memberships: [{ companyId, membershipRole: "operator", status: "active" }] };
    return { companyId, first, second, empty, secret, privateTask, active, done, worker, lead, comment, output, actor, base: `/api/companies/${companyId}/friday/work` };
  }
  it("restricts company-wide learning receipts to local operators and instance administrators", async () => {
    const f = await seed();
    const restricted = await request(app(f.actor)).get(`/api/companies/${f.companyId}/friday/models`).expect(200);
    expect(restricted.body.learning).toBeNull();
    expect(restricted.body.learningAccess).toBe("restricted");
    const admin = await request(app({ ...f.actor, isInstanceAdmin: true })).get(`/api/companies/${f.companyId}/friday/models`).expect(200);
    expect(admin.body.learningAccess).toBe("admin");
    const other = crypto.randomUUID();
    await request(app(f.actor)).get(`/api/companies/${other}/friday/models`).expect(403);
  });
  it("includes unregistered projects and counts every assigned project before task pagination", async () => {
    const f = await seed(); const api = app(f.actor);
    const page = await request(api).get(f.base).query({ agentId: f.worker.id, limit: 1 }).expect(200);
    expect(page.body.projectCount).toBe(3); // includes the lead-only project
    expect(page.body.counts).toEqual({ in_progress: 1, done: 1 });
    expect(page.body.tasks).toHaveLength(1); expect(page.body.nextOffset).toBe(1);
    expect(page.body.assignments).toHaveLength(2);
    const next = await request(api).get(f.base).query({ agentId: f.worker.id, limit: 1, offset: 1 }).expect(200);
    expect(next.body.tasks[0].id).not.toBe(page.body.tasks[0].id); expect(next.body.nextOffset).toBeNull();
    expect(next.body.projectCount).toBe(3);
    const completed = await request(api).get(f.base).query({ agentId: f.worker.id, status: "completed" }).expect(200);
    expect(completed.body.tasks.map((task: { id: string }) => task.id)).toEqual([f.done.id]);
    expect(completed.body.counts).toEqual({ in_progress: 1, done: 1 });
  });
  it("removes archived projects from portfolio cards while retaining explicit history access", async () => {
    const f = await seed(); const api = app(f.actor);
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, f.first.id));
    const portfolio = await request(api).get(f.base).expect(200);
    expect(portfolio.body.projectCount).toBe(2);
    expect(portfolio.body.projects.some((project: { id: string }) => project.id === f.first.id)).toBe(false);
    const history = await request(api).get(f.base).query({ projectId: f.first.id }).expect(200);
    expect(history.body.projects.map((project: { id: string }) => project.id)).toEqual([f.first.id]);
    expect(history.body.tasks).toHaveLength(1);
  });
  it("filters private projects, tasks, parent links and evidence before returning the graph", async () => {
    const f = await seed(); const api = app(f.actor);
    const result = await request(api).get(f.base).expect(200);
    expect(result.body.projectCount).toBe(3); expect(result.body.tasks).toHaveLength(2);
    expect(result.body.tasks.find((task: { id: string }) => task.id === f.active.id).parentId).toBeNull();
    expect(result.body.evidence.map((item: { id: string }) => item.id).sort()).toEqual([f.comment.id, f.output.id].sort());
    expect(JSON.stringify(result.body)).not.toContain("Secret");
    expect(JSON.stringify(result.body)).not.toContain(f.privateTask.id);
    expect(JSON.stringify(result.body)).not.toContain("Deleted body");
    await request(api).get(f.base).query({ projectId: f.secret.id }).expect(404);
    const own = await request(api).get(f.base).query({ projectId: f.first.id }).expect(200);
    expect(own.body.tasks).toHaveLength(1); expect(own.body.evidence).toHaveLength(1);
  });
  it("exposes only persisted handoffs whose retained case sources are readable", async () => {
    const f = await seed();
    const records = await db.insert(cases).values([1, 2].map(number => ({ companyId: f.companyId, caseNumber: number, identifier: `${f.companyId}-${number}`, caseType: "feature", title: "Handoff" }))).returning();
    await db.insert(caseAccessSources).values({ companyId: f.companyId, caseId: records[1].id, sourceKind: "issue", sourceId: f.privateTask.id });
    const handoffs = await db.insert(caseHandoffs).values(records.map(record => ({ companyId: f.companyId, caseId: record.id, issueId: f.active.id, version: 1, fromAgentId: f.lead.id, toAgentId: f.worker.id, phase: "engineering", instructions: "Build", actorType: "user" as const, actorId: "owner", wakeupRequestId: randomUUID(), idempotencyKey: randomUUID(), inputFingerprint: "test", state: "delivered" as const }))).returning();
    const result = await request(app(f.actor)).get(f.base).expect(200);
    expect(result.body.handoffs.map((item: { id: string }) => item.id)).toEqual([handoffs[0].id]);
    expect(result.body.handoffs[0]).toMatchObject({ fromAgentId: f.lead.id, toAgentId: f.worker.id, taskId: f.active.id });
    expect(JSON.stringify(result.body)).not.toContain(handoffs[1].id);
  });
  it("projects authorized task owners, department heads and reporting chains without private work or configurations", async () => {
    const f = await seed();
    const [head, ceo, hiddenLead] = await db.insert(agents).values([
      { companyId: f.companyId, name: "Engineering head", title: "Engineering manager", adapterConfig: { secret: "NEVER_PROJECT_CONFIG" } },
      { companyId: f.companyId, name: "Company CEO", role: "ceo" },
      { companyId: f.companyId, name: "Unrelated private lead" },
    ]).returning();
    await db.update(agents).set({ reportsTo: f.lead.id }).where(eq(agents.id, f.worker.id));
    await db.update(agents).set({ reportsTo: head.id }).where(eq(agents.id, f.lead.id));
    await db.update(agents).set({ reportsTo: ceo.id }).where(eq(agents.id, head.id));
    await db.update(projects).set({ leadAgentId: hiddenLead.id }).where(eq(projects.id, f.secret.id));
    const [department, hiddenDepartment] = await db.insert(agentosDepartments).values([
      { companyId: f.companyId, name: "Engineering", leadAgentId: head.id },
      { companyId: f.companyId, name: "Hidden department", leadAgentId: hiddenLead.id },
    ]).returning();
    await db.insert(agentosDepartmentProjects).values([
      { companyId: f.companyId, projectId: f.first.id, departmentId: department.id },
      { companyId: f.companyId, projectId: f.secret.id, departmentId: hiddenDepartment.id },
    ]);
    const result = await request(app(f.actor)).get(f.base).query({ projectId: f.first.id }).expect(200);
    expect(result.body.tasks[0].assigneeAgentId).toBe(f.worker.id);
    expect(result.body.accountability.projects).toEqual([{ projectId: f.first.id, leadAgentId: f.lead.id, department: { id: department.id, name: "Engineering", leadAgentId: head.id } }]);
    expect(result.body.accountability.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: f.worker.id, reportsTo: f.lead.id }),
      expect.objectContaining({ id: f.lead.id, reportsTo: head.id }),
      expect.objectContaining({ id: head.id, name: "Engineering head", title: "Engineering manager", reportsTo: ceo.id }),
      expect.objectContaining({ id: ceo.id, role: "ceo", reportsTo: null }),
    ]));
    expect(result.body.accountability.people).toHaveLength(4);
    expect(result.body.accountability.reportingChainTruncated).toBe(false);
    expect(JSON.stringify(result.body)).not.toContain("NEVER_PROJECT_CONFIG");
    const portfolio = await request(app(f.actor)).get(f.base).expect(200);
    for (const hidden of [hiddenLead.id, hiddenDepartment.id, f.secret.id, f.privateTask.id]) expect(JSON.stringify(portfolio.body.accountability)).not.toContain(hidden);
    const nativeAgent = { type: "agent" as const, source: "agent_key" as const, companyId: f.companyId, agentId: f.worker.id, keyScope: { kind: "standard" as const } };
    const agentView = await request(app(nativeAgent)).get(f.base).query({ projectId: f.first.id }).expect(200);
    expect(agentView.body.accountability.projects[0].department.leadAgentId).toBe(head.id);
    expect(JSON.stringify(agentView.body.accountability)).not.toContain(hiddenLead.id);
  });
  it("stops reporting cycles, bounds deep chains and does not expose cross-company managers", async () => {
    const f = await seed();
    await db.update(agents).set({ reportsTo: f.lead.id }).where(eq(agents.id, f.worker.id));
    await db.update(agents).set({ reportsTo: f.worker.id }).where(eq(agents.id, f.lead.id));
    const cycle = await request(app(f.actor)).get(f.base).query({ projectId: f.first.id }).expect(200);
    expect(cycle.body.accountability.people).toHaveLength(2);
    expect(cycle.body.accountability.reportingChainTruncated).toBe(false);
    const foreign = await seed();
    await db.update(agents).set({ reportsTo: foreign.lead.id }).where(eq(agents.id, f.lead.id));
    const isolated = await request(app(f.actor)).get(f.base).query({ projectId: f.first.id }).expect(200);
    expect(isolated.body.accountability.people.find((person: { id: string }) => person.id === f.lead.id).reportsTo).toBeNull();
    expect(JSON.stringify(isolated.body.accountability)).not.toContain(foreign.lead.id);
    const chain = await db.insert(agents).values(Array.from({ length: 9 }, (_, index) => ({ companyId: f.companyId, name: `Manager ${index}` }))).returning();
    for (let index = 0; index < chain.length - 1; index++) await db.update(agents).set({ reportsTo: chain[index + 1].id }).where(eq(agents.id, chain[index].id));
    await db.update(agents).set({ reportsTo: chain[0].id }).where(eq(agents.id, f.lead.id));
    const bounded = await request(app(f.actor)).get(f.base).query({ projectId: f.first.id }).expect(200);
    expect(bounded.body.accountability.reportingChainTruncated).toBe(true);
    expect(bounded.body.accountability.people.length).toBeLessThanOrEqual(9);
    expect(JSON.stringify(bounded.body.accountability)).not.toContain(chain[8].id);
  });
  it("rejects cross-company, restricted-key and malformed discovery requests", async () => {
    const f = await seed(); const foreign = await seed();
    await request(app(f.actor)).get(foreign.base).expect(403);
    await request(app(f.actor)).get(f.base).query({ agentId: foreign.worker.id }).expect(404);
    await request(app(f.actor)).get(f.base).query({ limit: 500 }).expect(400);
    await request(app(f.actor)).get(f.base).query({ projectId: "all" }).expect(400);
    const actor: Express.Request["actor"] = { type: "agent", source: "agent_key", companyId: f.companyId, agentId: f.worker.id, keyScope: { kind: "standard" } };
    await request(app(actor)).get(f.base).expect(200);
    await request(app(actor)).get(foreign.base).expect(403);
    await request(app({ ...actor, keyScope: { kind: "skill_test" } as never })).get(f.base).expect(403);
  });
});
