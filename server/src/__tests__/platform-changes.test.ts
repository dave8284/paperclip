import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, assets, authUsers, companies, companyMemberships, createDb, heartbeatRuns, instanceUserRoles, issueAttachments, issues, managedApplications, projectWorkspaces, projects } from "@paperclipai/db";
import { fridayRoutes } from "../routes/friday.js";
import { errorHandler } from "../middleware/index.js";
import { documentService } from "../services/documents.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("explicit owner platform change requests", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("agentos-platform-change-"); db = createDb(database.connectionString); }, 60000);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });
  function app(actor: Express.Request["actor"]) {
    const result = express(); result.use(express.json()); result.use((req, _res, next) => { req.actor = actor; next(); });
    result.use("/api", fridayRoutes(db)); result.use(errorHandler); return result;
  }
  async function fixture() {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Platform owner", email: `${userId}@example.test`, approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    const [company] = await db.insert(companies).values({ name: "Platform", issuePrefix: `PC${randomUUID().slice(0, 5)}` }).returning();
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Internal engineering", status: "in_progress" }).returning();
    const [workspace] = await db.insert(projectWorkspaces).values({ companyId: company.id, projectId: project.id, name: "Platform fork", sourceType: "git_repo", repoUrl: "https://example.test/platform.git", repoRef: "main", isPrimary: true }).returning();
    const [application] = await db.insert(managedApplications).values({ companyId: company.id, homeProjectId: project.id, name: "AgentOS", brief: "Internal maintenance", kind: "platform", source: "existing", creationKey: randomUUID(), creationHash: "fixture" }).returning();
    const [lead, reviewer] = await db.insert(agents).values(["Engineering lead", "Independent reviewer"].map(name => ({ companyId: company.id, name, status: "idle", lifecycleState: "ready", adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } }))).returning();
    const [sourceTask] = await db.insert(issues).values({ companyId: company.id, projectId: project.id, title: "Generated component", createdByUserId: userId, responsibleUserId: userId }).returning();
    const written = await documentService(db).upsertIssueDocument({ issueId: sourceTask.id, key: "component", format: "markdown", body: "Frozen reusable component specification", createdByUserId: userId });
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId, isInstanceAdmin: true, companyIds: [company.id], memberships: [{ companyId: company.id, membershipRole: "owner", status: "active" }] };
    const input = { requestKey: randomUUID(), applicationId: application.id, projectWorkspaceId: workspace.id, leadAgentId: lead.id, reviewerAgentId: reviewer.id,
      title: "Reuse this component", scope: "Prepare a reviewed reusable component with migration and recovery evidence.",
      source: { kind: "document" as const, issueId: sourceTask.id, documentId: written.document.id, revisionId: written.document.latestRevisionId! } };
    return { company, project, application, workspace, lead, reviewer, sourceTask, userId, actor, input, api: app(actor), path: `/api/companies/${company.id}/friday/platform-changes` };
  }
  it("creates one native task and frozen owner request under concurrent retries without running or granting release", async () => {
    const f = await fixture();
    const responses = await Promise.all([request(f.api).post(f.path).send(f.input), request(f.api).post(f.path).send(f.input)]);
    if (responses.some(response => response.status >= 400)) throw new Error(JSON.stringify(responses.map(response => ({ status: response.status, body: response.body }))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.task.id).toBe(responses[1].body.task.id);
    const id = responses[0].body.task.id;
    const [task] = await db.select().from(issues).where(eq(issues.id, id));
    expect(task).toMatchObject({ status: "backlog", projectId: f.project.id, assigneeAgentId: f.lead.id, responsibleUserId: f.userId, originKind: "platform_change",
      workspaceSelection: { selection: { kind: "configured_source", projectWorkspaceId: f.workspace.id, mode: "managed_isolated" } },
      executionPolicy: { stages: [{ type: "review", participants: [{ type: "agent", agentId: f.reviewer.id }] }] } });
    const document = await documentService(db).getIssueDocumentByKey(id, "platform-change-request");
    expect(document?.lockedByUserId).toBe(f.userId);
    expect(document?.body).toContain(f.input.source.revisionId);
    expect(document?.body).toContain(createHash("sha256").update("Frozen reusable component specification").digest("hex"));
    expect(document?.body).toContain('"releaseAuthorized": false');
    expect(document?.body).not.toContain("Frozen reusable component specification");
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.company.id))).toHaveLength(0);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, id), eq(activityLog.action, "issue.platform_change_requested")))).toHaveLength(1);
    // A later edit never changes the exact request receipt returned on retry.
    await documentService(db).unlockIssueDocument(id, "platform-change-request");
    await documentService(db).upsertIssueDocument({ issueId: id, key: "platform-change-request", body: "Later annotation", format: "markdown", baseRevisionId: document!.latestRevisionId, createdByUserId: f.userId });
    const replay = await request(f.api).post(f.path).send(f.input).expect(200);
    expect(replay.body.request).toEqual(responses[0].body.request);
    await request(f.api).post(f.path).send({ ...f.input, scope: "A different requested change" }).expect(409);
  });
  it("rejects agent requests, stale administrator claims, suspended owners and self-review", async () => {
    const f = await fixture();
    await request(app({ type: "agent", source: "agent_jwt", companyId: f.company.id, agentId: f.lead.id, onBehalfOfUserId: f.userId })).post(f.path).send(f.input).expect(403);
    await request(f.api).post(f.path).send({ ...f.input, reviewerAgentId: f.lead.id }).expect(400);
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.userId));
    await request(f.api).post(f.path).send(f.input).expect(403);
    await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
    await db.update(authUsers).set({ approvalStatus: "suspended" }).where(eq(authUsers.id, f.userId));
    await request(f.api).post(f.path).send(f.input).expect(403);
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")))).toHaveLength(0);
  });
  it("pins immutable attachment output and denies foreign sources and ordinary application targets", async () => {
    const f = await fixture(), foreign = await fixture();
    await request(f.api).post(f.path).send({ ...f.input, source: foreign.input.source }).expect(404);
    await db.update(managedApplications).set({ kind: "application" }).where(eq(managedApplications.id, f.application.id));
    await request(f.api).post(f.path).send(f.input).expect(404);
    await db.update(managedApplications).set({ kind: "platform" }).where(eq(managedApplications.id, f.application.id));
    const [asset] = await db.insert(assets).values({ companyId: f.company.id, provider: "local_disk", objectKey: randomUUID(), contentType: "text/html", byteSize: 20, sha256: "a".repeat(64) }).returning();
    const [attachment] = await db.insert(issueAttachments).values({ companyId: f.company.id, issueId: f.sourceTask.id, assetId: asset.id }).returning();
    const result = await request(f.api).post(f.path).send({ ...f.input, source: { kind: "attachment", issueId: f.sourceTask.id, attachmentId: attachment.id } }).expect(201);
    const saved = await documentService(db).getIssueDocumentByKey(result.body.task.id, "platform-change-request");
    expect(saved?.body).toContain('"sourceKind": "native_attachment"'); expect(saved?.body).toContain(asset.sha256);
  });
  it("rechecks company membership after waiting for a concurrent request and denies stale replay access", async () => {
    const f = await fixture();
    const initial = await request(f.api).post(f.path).send(f.input).expect(201);
    let unlock!: () => void, locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const barrier = db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-change:${f.company.id}:${f.userId}:${f.input.requestKey}`}, 0))`);
      locked(); await release;
    });
    await ready;
    const pending = request(f.api).post(f.path).send(f.input).then(response => response);
    try {
      await expect.poll(async () => {
        const result = await db.execute(sql`select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted`);
        return Number(result[0]?.count ?? 0);
      }, { timeout: 5000 }).toBe(1);
      await db.update(companyMemberships).set({ status: "revoked" }).where(and(eq(companyMemberships.companyId, f.company.id), eq(companyMemberships.principalId, f.userId)));
    } finally { unlock(); await barrier; }
    expect((await pending).status).toBe(403);
    await request(f.api).post(f.path).send({ ...f.input, requestKey: randomUUID() }).expect(403);
    const tasks = await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")));
    expect(tasks.map(task => task.id)).toEqual([initial.body.task.id]);
  });
});
