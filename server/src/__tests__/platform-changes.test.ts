import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, assets, authUsers, companies, companyMemberships, createDb, documents, heartbeatRuns, instanceUserRoles, issueAttachments, issues, managedApplications, projectWorkspaces, projects } from "@paperclipai/db";
import { fridayRoutes } from "../routes/friday.js";
import { errorHandler } from "../middleware/index.js";
import { documentService } from "../services/documents.js";
import { authorizationService } from "../services/authorization.js";
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
  async function publicationFixture() {
    const f = await fixture();
    const [sourceCompany] = await db.insert(companies).values({ name: "Private business source", issuePrefix: `PB${randomUUID().slice(0, 5)}` }).returning();
    await db.insert(companyMemberships).values({ companyId: sourceCompany.id, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    const [sourceIssue] = await db.insert(issues).values({ companyId: sourceCompany.id, title: "Private generated component", createdByUserId: f.userId, responsibleUserId: f.userId }).returning();
    const privateMarker = `Unselected private material ${randomUUID()}`;
    const originalText = `Reusable component outline\n\n${privateMarker}`;
    const written = await documentService(db).upsertIssueDocument({ issueId: sourceIssue.id, key: "component", format: "markdown", body: originalText, createdByUserId: f.userId });
    const actor: Express.Request["actor"] = { ...f.actor, companyIds: [f.company.id, sourceCompany.id], memberships: [
      { companyId: f.company.id, membershipRole: "owner", status: "active" }, { companyId: sourceCompany.id, membershipRole: "owner", status: "active" },
    ] };
    const { source: _sameCompanySource, ...requestInput } = f.input;
    const publication = { sourceCompanyId: sourceCompany.id,
      source: { kind: "document" as const, issueId: sourceIssue.id, documentId: written.document.id, revisionId: written.document.latestRevisionId! },
      expectedSourceSha256: createHash("sha256").update(originalText).digest("hex"),
      selectedText: "Owner-edited reusable component specification\n\nOnly this text is approved for publication.\n",
    };
    return { ...f, actor, api: app(actor), input: { ...requestInput, publication }, sourceCompany, sourceIssue, privateMarker, originalText };
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
  it("publishes selected text once into a destination-local locked source without leaking private provenance", async () => {
    const f = await publicationFixture();
    // The allowed Unicode scope appears in prose and structured request data;
    // its immutable replay receipt can legitimately exceed 64 KiB.
    f.input.scope = "界".repeat(12_000);
    // Publishing an explicit immutable revision survives a later head edit.
    await documentService(db).upsertIssueDocument({ issueId: f.sourceIssue.id, key: "component", format: "markdown", body: "A later private revision",
      baseRevisionId: f.input.publication.source.revisionId, createdByUserId: f.userId });
    const responses = await Promise.all([request(f.api).post(f.path).send(f.input), request(f.api).post(f.path).send(f.input)]);
    if (responses.some(response => response.status >= 400)) throw new Error(JSON.stringify(responses.map(response => ({ status: response.status, body: response.body }))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const taskId = responses[0].body.task.id;
    expect(responses[1].body.task.id).toBe(taskId);
    expect(responses[1].body.request).toEqual(responses[0].body.request);
    const [task] = await db.select().from(issues).where(eq(issues.id, taskId));
    expect(task).toMatchObject({ companyId: f.company.id, status: "backlog", assigneeAgentId: f.lead.id,
      executionPolicy: { stages: [{ type: "review", participants: [{ type: "agent", agentId: f.reviewer.id }] }] } });
    const local = await documentService(db).getIssueDocumentByKey(taskId, "platform-component-source");
    expect(local).toMatchObject({ body: f.input.publication.selectedText, lockedByUserId: f.userId });
    const ownerRequest = await documentService(db).getIssueDocumentByKey(taskId, "platform-change-request");
    expect(ownerRequest?.lockedByUserId).toBe(f.userId);
    expect(Buffer.byteLength(ownerRequest!.body, "utf8")).toBeGreaterThan(65_536);
    expect(ownerRequest?.body).toContain(local!.id);
    expect(ownerRequest?.body).toContain(local!.latestRevisionId);
    const publishedSha256 = createHash("sha256").update(f.input.publication.selectedText).digest("hex");
    expect(ownerRequest?.body).toContain(publishedSha256);
    const destinationAudit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.entityId, taskId), eq(activityLog.action, "issue.platform_change_requested")));
    expect(destinationAudit).toHaveLength(1);
    expect(destinationAudit[0].details).toMatchObject({ sourceSha256: publishedSha256, releaseAuthorized: false });
    const destinationContents = JSON.stringify({ task, ownerRequest, local, audit: destinationAudit, response: responses[0].body });
    for (const privateValue of [f.privateMarker, f.sourceCompany.id, f.sourceIssue.id, f.input.publication.source.documentId,
      f.input.publication.source.revisionId, f.input.publication.expectedSourceSha256]) expect(destinationContents).not.toContain(privateValue);
    const sourceAudit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.sourceCompany.id), eq(activityLog.action, "issue.platform_component_published")));
    expect(sourceAudit).toHaveLength(1);
    expect(sourceAudit[0].details).toMatchObject({ source: { ...f.input.publication.source, sha256: f.input.publication.expectedSourceSha256 },
      destinationCompanyId: f.company.id, destinationIssueId: taskId, destinationDocumentId: local!.id,
      destinationRevisionId: local!.latestRevisionId, publishedSha256 });
    const reader = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.company.id, agentId: f.lead.id, onBehalfOfUserId: f.userId };
    expect((await authorizationService(db).decide({ actor: reader, action: "issue:read", resource: { type: "issue", companyId: f.company.id, issueId: taskId } })).allowed).toBe(true);
    expect((await authorizationService(db).decide({ actor: reader, action: "issue:read", resource: { type: "issue", companyId: f.sourceCompany.id, issueId: f.sourceIssue.id } })).allowed).toBe(false);
    await request(f.api).post(f.path).send({ ...f.input, publication: { ...f.input.publication, selectedText: "Different selected text" } }).expect(409);
    await documentService(db).deleteIssueDocument(f.sourceIssue.id, "component");
    await request(f.api).post(f.path).send(f.input).expect(404);
    expect((await documentService(db).getIssueDocumentByKey(taskId, "platform-component-source"))?.body).toBe(f.input.publication.selectedText);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.company.id))).toHaveLength(0);
  });
  it("rejects wrong hashes, foreign or deleted sources, and rolls back publication when destination review admission fails", async () => {
    const f = await publicationFixture(), foreign = await fixture();
    const noPublication = async () => {
      expect(await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")))).toHaveLength(0);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.sourceCompany.id), eq(activityLog.action, "issue.platform_component_published")))).toHaveLength(0);
    };
    await request(f.api).post(f.path).send({ ...f.input, publication: { ...f.input.publication, expectedSourceSha256: "0".repeat(64) } }).expect(409);
    await request(f.api).post(f.path).send({ ...f.input, publication: { ...f.input.publication, source: foreign.input.source } }).expect(404);
    await request(f.api).post(f.path).send({ ...f.input, publication: { ...f.input.publication, sourceCompanyId: foreign.company.id, source: foreign.input.source } }).expect(403);
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.reviewer.id));
    await request(f.api).post(f.path).send(f.input).expect(409);
    await noPublication();
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.reviewer.id));
    await documentService(db).deleteIssueDocument(f.sourceIssue.id, "component");
    await request(f.api).post(f.path).send(f.input).expect(404);
    await noPublication();
  });
  it.each(["source", "destination"] as const)("rechecks %s membership after a publication retry waits and preserves only the already published local copy", async side => {
    const f = await publicationFixture();
    const initial = await request(f.api).post(f.path).send(f.input).expect(201);
    let unlock!: () => void, locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; }), release = new Promise<void>(resolve => { unlock = resolve; });
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
      await db.update(companyMemberships).set({ status: "revoked" }).where(and(eq(companyMemberships.companyId, side === "source" ? f.sourceCompany.id : f.company.id), eq(companyMemberships.principalId, f.userId)));
    } finally { unlock(); await barrier; }
    expect((await pending).status).toBe(403);
    await request(f.api).post(f.path).send(f.input).expect(403);
    await request(f.api).post(f.path).send({ ...f.input, requestKey: randomUUID() }).expect(403);
    const tasks = await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")));
    expect(tasks.map(task => task.id)).toEqual([initial.body.task.id]);
    const copied = await documentService(db).getIssueDocumentByKey(initial.body.task.id, "platform-component-source");
    expect(copied?.body).toBe(f.input.publication.selectedText);
  });
  it("rejects ambiguous publication and invalid selected text without creating tasks or provenance receipts", async () => {
    const f = await publicationFixture();
    for (const selectedText of ["", "Invalid\u0000text", "é".repeat(32_769)]) {
      await request(f.api).post(f.path).send({ ...f.input, publication: { ...f.input.publication, selectedText } }).expect(400);
    }
    await request(f.api).post(f.path).send({ ...f.input, source: f.input.publication.source }).expect(400);
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")))).toHaveLength(0);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.sourceCompany.id), eq(activityLog.action, "issue.platform_component_published")))).toHaveLength(0);
  });
  it("previews only the exact authorized revision and rechecks current source owner authority", async () => {
    const f = await publicationFixture(), foreign = await fixture(), source = f.input.publication.source;
    const previewPath = (companyId = f.sourceCompany.id, ref = source) => `/api/companies/${companyId}/friday/platform-component-sources/${ref.issueId}/documents/${ref.documentId}/revisions/${ref.revisionId}`;
    await documentService(db).upsertIssueDocument({ issueId: source.issueId, key: "component", format: "markdown", body: "Private later head must not replace the requested revision",
      baseRevisionId: source.revisionId, createdByUserId: f.userId });
    const preview = await request(f.api).get(previewPath()).expect(200);
    expect(preview.body).toEqual({ text: f.originalText, sha256: f.input.publication.expectedSourceSha256 });
    expect(preview.headers["cache-control"]).toBe("no-store");
    await request(f.api).get(previewPath(f.sourceCompany.id, foreign.input.source)).expect(404);
    await request(f.api).get(previewPath(foreign.company.id, foreign.input.source)).expect(403);
    await request(f.api).get(previewPath(f.sourceCompany.id, { ...source, issueId: f.sourceTask.id })).expect(404);
    await request(app({ type: "agent", source: "agent_jwt", companyId: f.sourceCompany.id, agentId: f.lead.id, onBehalfOfUserId: f.userId })).get(previewPath()).expect(403);
    await db.update(companyMemberships).set({ status: "revoked" }).where(and(eq(companyMemberships.companyId, f.sourceCompany.id), eq(companyMemberships.principalId, f.userId)));
    await request(f.api).get(previewPath()).expect(403);
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, f.sourceCompany.id), eq(companyMemberships.principalId, f.userId)));
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.userId));
    await request(f.api).get(previewPath()).expect(403);
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")))).toHaveLength(0);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.sourceCompany.id), eq(activityLog.action, "issue.platform_component_published")))).toHaveLength(0);
  });
  it("bounds preview by UTF-8 bytes and never substitutes a smaller revision for an oversized source", async () => {
    const f = await publicationFixture(), text = "é".repeat(131_072);
    const bounded = await documentService(db).upsertIssueDocument({ issueId: f.sourceIssue.id, key: "bounded", format: "markdown", body: text, createdByUserId: f.userId });
    const previewPath = (revisionId: string) => `/api/companies/${f.sourceCompany.id}/friday/platform-component-sources/${f.sourceIssue.id}/documents/${bounded.document.id}/revisions/${revisionId}`;
    const oversized = await documentService(db).upsertIssueDocument({ issueId: f.sourceIssue.id, key: "bounded", format: "markdown", body: `${text}é`,
      baseRevisionId: bounded.document.latestRevisionId, createdByUserId: f.userId });
    const preview = await request(f.api).get(previewPath(bounded.document.latestRevisionId!)).expect(200);
    expect(preview.body).toEqual({ text, sha256: createHash("sha256").update(text).digest("hex") });
    const denied = await request(f.api).get(previewPath(oversized.document.latestRevisionId!)).expect(404);
    expect(denied.body).not.toHaveProperty("text");
    await request(f.api).post(f.path).send({ ...f.input, publication: { ...f.input.publication,
      source: { kind: "document", issueId: f.sourceIssue.id, documentId: bounded.document.id, revisionId: oversized.document.latestRevisionId },
      expectedSourceSha256: createHash("sha256").update(`${text}é`).digest("hex"),
    } }).expect(404);
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")))).toHaveLength(0);
  });
  it("publishes selected attachment text against its exact source hash and rejects a changed source on replay", async () => {
    const f = await publicationFixture();
    const [asset] = await db.insert(assets).values({ companyId: f.sourceCompany.id, provider: "local_disk", objectKey: randomUUID(), contentType: "text/html", byteSize: 20, sha256: "b".repeat(64) }).returning();
    const [attachment] = await db.insert(issueAttachments).values({ companyId: f.sourceCompany.id, issueId: f.sourceIssue.id, assetId: asset.id }).returning();
    const selectedText = "é".repeat(32_768);
    const input = { ...f.input, publication: { ...f.input.publication, selectedText, expectedSourceSha256: asset.sha256,
      source: { kind: "attachment", issueId: f.sourceIssue.id, attachmentId: attachment.id },
    } };
    const published = await request(f.api).post(f.path).send(input).expect(201);
    const local = await documentService(db).getIssueDocumentByKey(published.body.task.id, "platform-component-source");
    expect(local?.body).toBe(selectedText);
    const sourceAudit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.sourceCompany.id), eq(activityLog.action, "issue.platform_component_published")));
    expect(sourceAudit).toHaveLength(1);
    expect(sourceAudit[0].details).toMatchObject({ source: { kind: "attachment", issueId: f.sourceIssue.id, attachmentId: attachment.id, sha256: asset.sha256 },
      publishedSha256: createHash("sha256").update(selectedText).digest("hex") });
    await db.update(assets).set({ sha256: "c".repeat(64) }).where(eq(assets.id, asset.id));
    await request(f.api).post(f.path).send(input).expect(409);
    expect((await documentService(db).getIssueDocumentByKey(published.body.task.id, "platform-component-source"))?.body).toBe(selectedText);
  });
  it("rolls back the task, copied text and both audit receipts when retained repository metadata exceeds the request document limit", async () => {
    const f = await publicationFixture();
    const beforeDocuments = await db.select({ id: documents.id }).from(documents).where(eq(documents.companyId, f.company.id));
    await db.update(projectWorkspaces).set({ repoRef: "x".repeat(262_144) }).where(eq(projectWorkspaces.id, f.workspace.id));
    const rejected = await request(f.api).post(f.path).send(f.input).expect(422);
    expect(JSON.stringify(rejected.body)).toContain("platform request document exceeds 256 KiB");
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.company.id), eq(issues.originKind, "platform_change")))).toHaveLength(0);
    expect(await db.select({ id: documents.id }).from(documents).where(eq(documents.companyId, f.company.id))).toEqual(beforeDocuments);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.sourceCompany.id), eq(activityLog.action, "issue.platform_component_published")))).toHaveLength(0);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "issue.platform_change_requested")))).toHaveLength(0);
  });
});
