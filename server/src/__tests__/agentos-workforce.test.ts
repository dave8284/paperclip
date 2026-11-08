import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, assets, issueAttachments, cases, caseAttachments, caseAccessSources, agentApiKeys, authUsers, companies, companyMemberships, companyOperatingProfiles, principalPermissionGrants, activityLog, agentosAssignments, agentosEmployees,
  companySkills, companySkillVersions, companySkillTestRuns, companySkillPolicies, issues, issueComments, documents, issueDocuments, projects, projectAccessMembers, instanceUserRoles, agentosCapabilityDecisions, agentosPortfolioMandates, agentosDepartments, agentosDepartmentProjects, createDb } from "@paperclipai/db";
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { capabilitySelectionHash } from "../services/agentos-capabilities.js";
import { companySkillService } from "../services/company-skills.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentosWorkforceRoutes } from "../routes/agentos-workforce.js";
import { fridayRoutes } from "../routes/friday.js";
import { deleteCompany } from "../services/company-deletion.js";
import { deleteAgentDependencies } from "../services/agent-deletion.js";
import { accessService } from "../services/access.js";
import { agentosPortfolioMandateService } from "../services/agentos-portfolio-mandates.js";
import { instanceSettingsService } from "../services/instance-settings.js";

describe("Agent OS shared workforce", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("agentos-workforce-"); db = createDb(database.connectionString); }, 60000);
  afterAll(async () => { await database?.cleanup(); });
  function app(actor: Express.Request["actor"]) {
    const result = express(); result.use(express.json());
    result.use((req, _res, next) => { req.actor = actor; next(); });
    result.use("/api", agentosWorkforceRoutes(db)); result.use("/api", fridayRoutes(db)); result.use(errorHandler); return result;
  }
  async function seed() {
    const owner = randomUUID();
    await db.insert(authUsers).values({ id: owner, name: "Portfolio owner", email: `${owner}@example.test`, createdAt: new Date(), updatedAt: new Date() });
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
    const f = await seed();
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
  async function capabilityFixture(f: Awaited<ReturnType<typeof seed>>, expectedLatestRevision = 0) {
    await db.insert(principalPermissionGrants).values([f.one, f.two].map(company => ({ companyId: company.id,
      principalType: "user", principalId: f.owner, permissionKey: "agents:configure" }))).onConflictDoNothing();
    const markdown = `---\nname: reviewed-method\ndescription: Reviewed release method\n---\n\nExact method ${expectedLatestRevision + 1}\n`;
    const [skill] = await db.insert(companySkills).values({ companyId: f.one.id, key: `company/${f.one.id}/${randomUUID()}`,
      slug: `review-${randomUUID()}`, name: "Reviewed method", markdown, sourceType: "generated" }).returning();
    const [version] = await db.insert(companySkillVersions).values({ companyId: f.one.id, companySkillId: skill.id,
      revisionNumber: 1, fileInventory: [{ path: "SKILL.md", kind: "skill", content: markdown }] }).returning();
    const [issue] = await db.insert(issues).values({ companyId: f.one.id, title: "Private capability test", description: "Private source context", status: "done" }).returning();
    const [test] = await db.insert(companySkillTestRuns).values({ companyId: f.one.id, skillId: skill.id, skillVersionId: version.id,
      agentId: f.first.id, issueId: issue.id, inputSnapshot: "Private evaluation task", outputSnapshot: "Private test evidence", status: "succeeded" }).returning();
    const intent = { id: randomUUID(), employeeId: f.employeeInput.id, capabilityKey: "review", name: "Reviewed method",
      expectedLatestRevision, sourceCompanyId: f.one.id, sourceSkillId: skill.id, sourceVersionId: version.id, sourceTestRunId: test.id,
      evaluationSummary: "The owner accepted the exact method for release review", reviewedAndSanitized: true };
    return { skill, version, test, issue, markdown, intent };
  }
  async function decisionIntent(f: Awaited<ReturnType<typeof seed>>, assignmentIndex: number, releaseId: string, action = "adopt") {
    const assignment = f.assignments[assignmentIndex];
    const [row] = await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, assignment.id));
    const [agent] = await db.select().from(agents).where(eq(agents.id, assignment.agentId));
    return { id: randomUUID(), releaseId, action, reason: "Reviewed company decision", expectedAssignmentRevision: row.revision,
      expectedSelectionHash: capabilitySelectionHash(agent.adapterConfig) };
  }
  async function mandateFixture() {
    const f = await seed();
    await db.insert(companyMemberships).values({ companyId: f.one.id, principalType: "agent", principalId: f.first.id, status: "active", membershipRole: "member" });
    const intent = { id: randomUUID(), expectedRevision: 0, sourceCompanyId: f.one.id, sourceAgentId: f.first.id,
      targetCompanyIds: [f.two.id], action: "portfolio_work:read", readScope: "company_shared_only", expiresAt: null };
    await request(f.api).post(`${f.base}/read-mandates`).send(intent).expect(200);
    // Authentication supplies this source-company snapshot; the mandate owner
    // must still recheck current account, membership and grant rows per read.
    const runtimeActor: Express.Request["actor"] = { type: "agent", source: "agent_jwt", companyId: f.one.id, agentId: f.first.id, onBehalfOfUserId: f.owner,
      onBehalfOfMemberships: [{ companyId: f.one.id, membershipRole: "owner", status: "active" }] };
    const query = { mandateId: intent.id, revision: 1, targetCompanyId: f.two.id };
    return { ...f, intent, runtimeActor, runtime: app(runtimeActor), query, path: `/api/companies/${f.one.id}/friday/portfolio-work` };
  }
  it("delegates only shared summaries with the unchanged source actor and excludes private ancestry even when the owner can read it", async () => {
    const f = await mandateFixture();
    const [open, privateProject] = await db.insert(projects).values([
      { companyId: f.two.id, name: "Shared project", visibility: "open" }, { companyId: f.two.id, name: "Private project", visibility: "private" },
    ]).returning();
    const [shared, parent] = await db.insert(issues).values([
      { companyId: f.two.id, title: "Shared task", projectId: open.id },
      { companyId: f.two.id, title: "Private parent", visibility: "private", responsibleUserId: f.owner },
      { companyId: f.two.id, title: "Private project task", projectId: privateProject.id },
    ]).returning();
    await db.insert(issues).values({ companyId: f.two.id, title: "Private descendant", visibility: "open", privacyParentIssueId: parent.id });
    const response = await request(f.runtime).get(f.path).query(f.query).expect(200);
    expect(response.body.projects.map((row: { id: string }) => row.id)).toEqual([open.id]);
    expect(response.body.tasks.map((row: { id: string }) => row.id)).toEqual([shared.id]);
    expect(response.body).not.toHaveProperty("evidence"); expect(response.body).not.toHaveProperty("assignments");
    await request(f.runtime).get(`/api/companies/${f.two.id}/friday/work`).expect(403);
    const [receipt] = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.intent.id), eq(activityLog.action, "agentos.portfolio_work_read")));
    expect(receipt.actorId).toBe(f.first.id); expect(receipt.companyId).toBe(f.one.id);
  });
  it("revalidates native grant, owner approval and external authorizer for each portfolio read", async () => {
    const f = await mandateFixture();
    await request(app({ ...f.runtimeActor, authorizingUserId: randomUUID() })).get(f.path).query(f.query).expect(403);
    await db.update(authUsers).set({ approvalStatus: "suspended" }).where(eq(authUsers.id, f.owner));
    await request(f.runtime).get(f.path).query(f.query).expect(403);
    await db.update(authUsers).set({ approvalStatus: "approved" }).where(eq(authUsers.id, f.owner));
    await accessService(db).setPrincipalPermission(f.one.id, "agent", f.first.id, "workforce:portfolio_read", false, f.owner);
    await request(f.runtime).get(f.path).query(f.query).expect(403);
  });
  it("grants private summaries only to current Friday and intersects the owner's task and project rights", async () => {
    const f = await mandateFixture();
    const intent = { ...f.intent, expectedRevision: 1, readScope: "owner_accessible_private" };
    await request(f.api).post(`${f.base}/read-mandates`).send(intent).expect(403);
    await db.insert(companyOperatingProfiles).values({ companyId: f.one.id, fridayAgentId: f.first.id });
    await request(f.api).post(`${f.base}/read-mandates`).send(intent).expect(200);
    const [visibleProject, hiddenProject] = await db.insert(projects).values([
      { companyId: f.two.id, name: "Owner's private project", visibility: "private" },
      { companyId: f.two.id, name: "Someone else's private project", visibility: "private" },
    ]).returning();
    await db.insert(projectAccessMembers).values({ companyId: f.two.id, projectId: visibleProject.id, subjectType: "user", subjectId: f.owner });
    const [parent, projectTask, hidden] = await db.insert(issues).values([
      { companyId: f.two.id, title: "Owner's private task", visibility: "private", responsibleUserId: f.owner },
      { companyId: f.two.id, title: "Authorized project task", projectId: visibleProject.id },
      { companyId: f.two.id, title: "Unrelated private task", visibility: "private", projectId: hiddenProject.id },
    ]).returning();
    const [child] = await db.insert(issues).values({ companyId: f.two.id, title: "Private descendant", privacyParentIssueId: parent.id }).returning();
    const query = { ...f.query, revision: 2 };
    const response = await request(f.runtime).get(f.path).query(query).expect(200);
    expect(response.body.readScope).toBe("owner_accessible_private");
    expect(response.body.tasks.map((row: { id: string }) => row.id).sort()).toEqual([parent.id, projectTask.id, child.id].sort());
    expect(response.body.projects.map((row: { id: string }) => row.id)).toEqual([visibleProject.id]);
    expect(JSON.stringify(response.body)).not.toContain(hidden.id);
    await request(f.runtime).get(`/api/companies/${f.two.id}/friday/work`).expect(403);
    await db.update(companyOperatingProfiles).set({ fridayAgentId: null }).where(eq(companyOperatingProfiles.companyId, f.one.id));
    await request(f.runtime).get(f.path).query(query).expect(403);
  });
  it("rechecks owner admin revocation and retains the private external-authorizer ceiling", async () => {
    const f = await mandateFixture();
    await db.insert(companyOperatingProfiles).values({ companyId: f.one.id, fridayAgentId: f.first.id });
    await request(f.api).post(`${f.base}/read-mandates`).send({ ...f.intent, expectedRevision: 1, readScope: "owner_accessible_private" }).expect(200);
    const [hidden] = await db.insert(issues).values({ companyId: f.two.id, title: "Admin-readable private task", visibility: "private" }).returning();
    const [role] = await db.insert(instanceUserRoles).values({ userId: f.owner, role: "instance_admin" }).returning();
    const query = { ...f.query, revision: 2 };
    expect((await request(f.runtime).get(f.path).query(query).expect(200)).body.tasks.map((row: { id: string }) => row.id)).toContain(hidden.id);
    const external = randomUUID();
    await db.insert(authUsers).values({ id: external, name: "External authorizer", email: `${external}@example.test`, approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values([f.one, f.two].map(company => ({ companyId: company.id, principalType: "user", principalId: external, membershipRole: "member", status: "active" })));
    const bounded = await request(app({ ...f.runtimeActor, authorizingUserId: external })).get(f.path).query(query).expect(200);
    expect(JSON.stringify(bounded.body)).not.toContain(hidden.id);
    await db.delete(instanceUserRoles).where(eq(instanceUserRoles.id, role.id));
    const revoked = await request(f.runtime).get(f.path).query(query).expect(200);
    expect(JSON.stringify(revoked.body)).not.toContain(hidden.id);
    expect(Object.values(revoked.body.counts).reduce((sum: number, count) => sum + Number(count), 0)).toBe(0);
  });
  it("reads private content through current owner scope, versioned Unicode pages and redacted audit while retaining shared-only denial", async () => {
    const f = await mandateFixture();
    const contentPath = `/api/companies/${f.one.id}/friday/portfolio-content`;
    const recordsPath = `/api/companies/${f.one.id}/friday/portfolio-records`;
    const [task, hidden, chat, otherChat] = await db.insert(issues).values([
      { companyId: f.two.id, title: "Owner work", description: "Private description", visibility: "private", responsibleUserId: f.owner },
      { companyId: f.two.id, title: "Other work", description: "Hidden body", visibility: "private" },
      { companyId: f.two.id, title: "Owner chat", conversationAgentId: f.second.id, conversationUserId: f.owner },
      { companyId: f.two.id, title: "Other chat", conversationAgentId: f.second.id, conversationUserId: "other-user" },
    ]).returning();
    const [comment, deleted] = await db.insert(issueComments).values([
      { companyId: f.two.id, issueId: task.id, body: "Readable comment", authorUserId: f.owner, metadata: { privateCredential: "not-a-response-field" } as never },
      { companyId: f.two.id, issueId: task.id, body: "Deleted body", deletedAt: new Date() },
    ]).returning();
    const [document, internal] = await db.insert(documents).values([
      { companyId: f.two.id, title: "Work product", latestBody: "😀α\nprivate" },
      { companyId: f.two.id, title: "Internal", latestBody: "Internal context" },
    ]).returning();
    await db.insert(issueDocuments).values([
      { companyId: f.two.id, issueId: task.id, documentId: document.id, key: "result" },
      { companyId: f.two.id, issueId: task.id, documentId: internal.id, key: "continuation-summary" },
    ]);
    await request(f.runtime).get(contentPath).query({ ...f.query, kind: "task", resourceId: task.id }).expect(403);
    await db.insert(companyOperatingProfiles).values({ companyId: f.one.id, fridayAgentId: f.first.id });
    await request(f.api).post(`${f.base}/read-mandates`).send({ ...f.intent, expectedRevision: 1, readScope: "owner_accessible_private" }).expect(200);
    const query = { ...f.query, revision: 2 };
    const read = await request(f.runtime).get(contentPath).query({ ...query, kind: "document", resourceId: document.id, limit: 2 }).expect(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    expect(read.body).toMatchObject({ body: "😀α", nextOffset: 2, contentTrust: "untrusted_reference", readScope: "owner_accessible_private" });
    const rest = await request(f.runtime).get(contentPath).query({ ...query, kind: "document", resourceId: document.id,
      offset: 2, bodySha256: read.body.bodySha256 }).expect(200);
    expect(rest.body.body).toBe("\nprivate");
    await db.update(documents).set({ latestBody: "Changed" }).where(eq(documents.id, document.id));
    await request(f.runtime).get(contentPath).query({ ...query, kind: "document", resourceId: document.id,
      offset: 2, bodySha256: read.body.bodySha256 }).expect(404);
    const refs = await request(f.runtime).get(recordsPath).query({ ...query, kind: "documents", taskId: task.id }).expect(200);
    expect(refs.body.records.map((record: { id: string }) => record.id)).toEqual([document.id]);
    const comments = await request(f.runtime).get(recordsPath).query({ ...query, kind: "comments", taskId: task.id }).expect(200);
    expect(comments.body.records.map((record: { id: string }) => record.id)).toEqual([comment.id]);
    const chats = await request(f.runtime).get(recordsPath).query({ ...query, kind: "conversations" }).expect(200);
    expect(chats.body.records.map((record: { id: string }) => record.id)).toEqual([chat.id]);
    for (const [kind, resourceId] of [["task", hidden.id], ["task", otherChat.id], ["comment", deleted.id], ["document", internal.id]]) {
      await request(f.runtime).get(contentPath).query({ ...query, kind, resourceId }).expect(404);
    }
    const body = await request(f.runtime).get(contentPath).query({ ...query, kind: "comment", resourceId: comment.id }).expect(200);
    expect(body.body.body).toBe("Readable comment");
    expect(body.body.comment).toMatchObject({ authorUserId: f.owner, authorAgentId: null });
    expect(JSON.stringify(body.body)).not.toContain("not-a-response-field");
    const receipts = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.intent.id), eq(activityLog.action, "agentos.portfolio_content_read")));
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every(receipt => receipt.actorId === f.first.id && receipt.companyId === f.one.id)).toBe(true);
    expect(JSON.stringify(receipts)).not.toMatch(/Readable comment|Internal context|Private description|privateCredential/);
    await db.update(issues).set({ responsibleUserId: null }).where(eq(issues.id, task.id));
    await request(f.runtime).get(contentPath).query({ ...query, kind: "comment", resourceId: comment.id }).expect(404);
    await request(f.runtime).get(`/api/companies/${f.two.id}/friday/work`).expect(403);
    await request(f.api).post(`${f.base}/read-mandates/${f.intent.id}/revoke`).send({ expectedRevision: 2 }).expect(200);
    await request(f.runtime).get(recordsPath).query({ ...query, kind: "conversations" }).expect(403);
  });
  it("reads only authorized task files and discards stored bytes after resource revocation", async () => {
    const f = await mandateFixture();
    await db.insert(companyOperatingProfiles).values({ companyId: f.one.id, fridayAgentId: f.first.id });
    await request(f.api).post(`${f.base}/read-mandates`).send({ ...f.intent, expectedRevision: 1, readScope: "owner_accessible_private" }).expect(200);
    const [owned, hidden] = await db.insert(issues).values([
      { companyId: f.two.id, title: "Owner file", visibility: "private", responsibleUserId: f.owner },
      { companyId: f.two.id, title: "Other private origin", visibility: "private" },
    ]).returning();
    const body = Buffer.from("private attachment evidence"), sha256 = createHash("sha256").update(body).digest("hex");
    const stored = await db.insert(assets).values([`issues/${owned.id}`, `issues/${hidden.id}`, "runner-api"].map(namespace => ({
      companyId: f.two.id, provider: "local_disk", objectKey: `${f.two.id}/${namespace}/${randomUUID()}.bin`,
      contentType: "application/octet-stream", byteSize: body.length, sha256, originalFilename: "Evidence.bin",
    }))).returning();
    const attachments = await db.insert(issueAttachments).values(stored.map(asset => ({ companyId: f.two.id, issueId: owned.id, assetId: asset.id }))).returning();
    const query = { ...f.query, revision: 2, taskId: owned.id };
    const list = await request(f.runtime).get(`/api/companies/${f.one.id}/friday/portfolio-records`).query({ ...query, kind: "attachments" }).expect(200);
    expect(list.body.records.map((record: { id: string }) => record.id)).toEqual([attachments[0].id]);
    let revoke = false, reads = 0;
    const service = agentosPortfolioMandateService(db, { storage: { provider: "local_disk", getObject: async () => {
      reads++;
      if (revoke) await db.update(issues).set({ responsibleUserId: null }).where(eq(issues.id, owned.id));
      return { stream: Readable.from([body]), contentLength: body.length };
    } } });
    const read = (attachmentId = attachments[0].id) => service.attachment(f.runtimeActor,
      { actorType: "agent", actorId: f.first.id, agentId: f.first.id }, f.one.id, { ...query, attachmentId, sha256, offset: 0, limit: 65536 });
    await expect(read(attachments[1].id)).rejects.toMatchObject({ status: 404 }); expect(reads).toBe(0);
    expect(await read()).toMatchObject({ fullFileVerified: true, body: body.toString("base64"), sha256 });
    revoke = true;
    await expect(read()).rejects.toMatchObject({ status: 404 });
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.intent.id), eq(activityLog.action, "agentos.portfolio_attachment_read")));
    expect(audit).toHaveLength(1); expect(audit[0].companyId).toBe(f.one.id);
    expect(JSON.stringify(audit)).not.toContain(body.toString()); expect(JSON.stringify(audit)).not.toContain(stored[0].objectKey);
  });
  it("retains every case-file source boundary and discards bytes when a retained source changes", async () => {
    const f = await mandateFixture(), settings = instanceSettingsService(db);
    const previouslyEnabled = (await settings.getExperimental()).enableCases;
    await settings.updateExperimental({ enableCases: true });
    try {
      await db.insert(companyOperatingProfiles).values({ companyId: f.one.id, fridayAgentId: f.first.id });
      await request(f.api).post(`${f.base}/read-mandates`).send({ ...f.intent, expectedRevision: 1, readScope: "owner_accessible_private" }).expect(200);
      const [owned, hidden] = await db.insert(issues).values([
        { companyId: f.two.id, title: "Case source", visibility: "private", responsibleUserId: f.owner },
        { companyId: f.two.id, title: "Unavailable retained source", visibility: "private" },
      ]).returning();
      const [allowed, denied] = await db.insert(cases).values(["Allowed", "Denied"].map((title, index) => ({
        companyId: f.two.id, title, caseNumber: index + 1, identifier: `CASE-${randomUUID()}`, caseType: "work",
      }))).returning();
      await db.insert(caseAccessSources).values([
        { companyId: f.two.id, caseId: allowed.id, sourceKind: "issue", sourceId: owned.id },
        { companyId: f.two.id, caseId: denied.id, sourceKind: "issue", sourceId: owned.id },
        { companyId: f.two.id, caseId: denied.id, sourceKind: "issue", sourceId: hidden.id },
      ]);
      const body = Buffer.from("case evidence"), sha256 = createHash("sha256").update(body).digest("hex");
      const stored = await db.insert(assets).values([allowed, denied].map(record => ({
        companyId: f.two.id, provider: "local_disk", objectKey: `${f.two.id}/assets/cases/${record.id}/${randomUUID()}.bin`,
        contentType: "application/octet-stream", byteSize: body.length, sha256, originalFilename: "Case evidence.bin",
      }))).returning();
      const attachments = await db.insert(caseAttachments).values(stored.map(asset => ({
        companyId: f.two.id, caseId: allowed.id, assetId: asset.id,
      }))).returning(); // A relink cannot widen the original denied case's file ownership.
      const query = { ...f.query, revision: 2 }, path = `/api/companies/${f.one.id}/friday/portfolio-records`;
      const discovered = await request(f.runtime).get(path).query({ ...query, kind: "cases" }).expect(200);
      expect(discovered.body.records.map((record: { id: string }) => record.id)).toEqual([allowed.id]);
      const files = await request(f.runtime).get(path).query({ ...query, kind: "case_attachments", caseId: allowed.id }).expect(200);
      expect(files.body.records.map((record: { id: string }) => record.id)).toEqual([attachments[0].id]);
      let revoke = false, reads = 0;
      const service = agentosPortfolioMandateService(db, { storage: { provider: "local_disk", getObject: async () => {
        reads++;
        if (revoke) await db.insert(caseAccessSources).values({ companyId: f.two.id, caseId: allowed.id, sourceKind: "issue", sourceId: hidden.id });
        return { stream: Readable.from([body]), contentLength: body.length };
      } } });
      const read = (attachmentId = attachments[0].id) => service.attachment(f.runtimeActor,
        { actorType: "agent", actorId: f.first.id, agentId: f.first.id }, f.one.id,
        { ...query, caseId: allowed.id, attachmentId, sha256, offset: 0, limit: 65536 });
      await expect(read(attachments[1].id)).rejects.toMatchObject({ status: 404 }); expect(reads).toBe(0);
      expect(await read()).toMatchObject({ taskId: null, caseId: allowed.id, fullFileVerified: true, body: body.toString("base64") });
      revoke = true;
      await expect(read()).rejects.toMatchObject({ status: 404 });
      const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.intent.id), eq(activityLog.action, "agentos.portfolio_attachment_read")));
      expect(audit).toHaveLength(1); expect(audit[0].details).toMatchObject({ caseId: allowed.id, taskId: null });
      expect(JSON.stringify(audit)).not.toContain(body.toString());
      await settings.updateExperimental({ enableCases: false });
      await request(f.runtime).get(path).query({ ...query, kind: "cases" }).expect(403);
    } finally { await settings.updateExperimental({ enableCases: previouslyEnabled }); }
  });
  it("discovers real target-company executives without widening read grants or disclosing private project leadership", async () => {
    const f = await mandateFixture();
    const path = `/api/companies/${f.one.id}/friday/portfolio-records`;
    const [ceo, head, spoof, targetFriday] = await db.insert(agents).values([
      { companyId: f.two.id, name: "Actual CEO", role: "ceo", adapterConfig: { credential: "never-expose-executive-config" } },
      { companyId: f.two.id, name: "Actual head", role: "engineer" },
      { companyId: f.two.id, name: "CEO", title: "Department Head", role: "engineer" },
      { companyId: f.two.id, name: "Company coordinator", role: "ceo" },
    ]).returning();
    const [project] = await db.insert(projects).values({ companyId: f.two.id, name: "Private department", visibility: "private" }).returning();
    await db.insert(projectAccessMembers).values({ companyId: f.two.id, projectId: project.id, subjectType: "user", subjectId: f.owner });
    const [department] = await db.insert(agentosDepartments).values({ companyId: f.two.id, name: "Delivery", leadAgentId: head.id }).returning();
    await db.insert(agentosDepartmentProjects).values({ companyId: f.two.id, projectId: project.id, departmentId: department.id });
    await request(f.runtime).get(path).query({ ...f.query, kind: "executives" }).expect(403);
    await db.insert(companyOperatingProfiles).values([
      { companyId: f.one.id, fridayAgentId: f.first.id }, { companyId: f.two.id, fridayAgentId: targetFriday.id },
    ]);
    await request(f.api).post(`${f.base}/read-mandates`).send({ ...f.intent, expectedRevision: 1, readScope: "owner_accessible_private" }).expect(200);
    const query = { ...f.query, revision: 2, kind: "executives", projectId: project.id };
    const result = await request(f.runtime).get(path).query(query).expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.records.map((row: { id: string }) => row.id).sort()).toEqual([ceo.id, head.id].sort());
    expect(JSON.stringify(result.body)).not.toMatch(/never-expose-executive-config|adapterConfig/);
    expect(JSON.stringify(result.body)).not.toContain(spoof.id);
    expect(JSON.stringify(result.body)).not.toContain(f.first.id);
    const authorizer = randomUUID();
    await db.insert(authUsers).values({ id: authorizer, name: "External reviewer", email: `${authorizer}@example.test`,
      approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values([f.one, f.two].map(company => ({ companyId: company.id,
      principalType: "user", principalId: authorizer, membershipRole: "member", status: "active" })));
    const externallyAuthorized = app({ ...f.runtimeActor, authorizingUserId: authorizer });
    expect((await request(externallyAuthorized).get(path).query(query).expect(200)).body.records).toEqual([]);
    await db.insert(projectAccessMembers).values({ companyId: f.two.id, projectId: project.id, subjectType: "user", subjectId: authorizer });
    expect((await request(externallyAuthorized).get(path).query(query).expect(200)).body.records).toHaveLength(2);
    await db.update(agentosDepartments).set({ leadAgentId: null }).where(eq(agentosDepartments.id, department.id));
    expect((await request(f.runtime).get(path).query(query).expect(200)).body.records.map((row: { id: string }) => row.id)).toEqual([ceo.id]);
    await db.delete(projectAccessMembers).where(eq(projectAccessMembers.projectId, project.id));
    expect((await request(f.runtime).get(path).query(query).expect(200)).body.records).toEqual([]);
    await db.update(companyOperatingProfiles).set({ fridayAgentId: null }).where(eq(companyOperatingProfiles.companyId, f.one.id));
    await request(f.runtime).get(path).query(query).expect(403);
  });

  it("serializes duplicate mandate intent, fences stale revisions and revokes both records", async () => {
    const f = await mandateFixture();
    const edit = { ...f.intent, expectedRevision: 1, targetCompanyIds: [f.one.id, f.two.id] };
    const results = await Promise.all([request(f.api).post(`${f.base}/read-mandates`).send(edit), request(f.api).post(`${f.base}/read-mandates`).send(edit)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    await request(f.runtime).get(f.path).query(f.query).expect(403);
    await request(f.api).post(`${f.base}/read-mandates/${f.intent.id}/revoke`).send({ expectedRevision: 2 }).expect(200);
    await request(f.runtime).get(f.path).query({ ...f.query, revision: 3 }).expect(403);
    const [row] = await db.select().from(agentosPortfolioMandates).where(eq(agentosPortfolioMandates.id, f.intent.id));
    expect(row.grantId).toBeNull(); expect(row.revokedAt).not.toBeNull();
    expect(await db.select().from(principalPermissionGrants).where(and(eq(principalPermissionGrants.principalId, f.first.id), eq(principalPermissionGrants.permissionKey, "workforce:portfolio_read")))).toHaveLength(0);
  });
  it("retains published skill/test evidence with clear conflicts and cascades target decisions before native company skill deletion", async () => {
    const f = await seed(), evidence = await capabilityFixture(f);
    const published = await request(f.api).post(`${f.base}/capabilities`).send(evidence.intent).expect(201);
    const skills = companySkillService(db, { actor: f.actor });
    await expect(skills.deleteSkill(f.one.id, evidence.skill.id)).rejects.toMatchObject({ status: 409, details: { code: "capability_skill_history_retained" } });
    await expect(skills.deleteTestRun(f.one.id, evidence.skill.id, evidence.test.id, { hideHarnessIssue: async () => { throw new Error("Retained evidence must not be hidden"); } }))
      .rejects.toMatchObject({ status: 409, details: { code: "capability_test_evidence_retained" } });
    await request(f.api).post(`${f.base}/assignments/${f.assignments[1].id}/capabilities`).send(await decisionIntent(f, 1, published.body.id)).expect(200);
    const [adoption] = await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.companyId, f.two.id));
    await expect(skills.deleteSkill(f.two.id, adoption.importedSkillId!)).rejects.toMatchObject({ status: 409 });
    await expect(deleteCompany(db, f.two.id)).rejects.toThrow("Complete termination before deleting the agent");
    expect(await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.companyId, f.two.id))).toHaveLength(1);
    // No runner host is attached to this fixture. Model the native worker's
    // confirmed terminal state before testing permanent-delete dependencies.
    await db.update(agents).set({ lifecycleState: "terminated", status: "terminated", lifecycleOperation: null }).where(eq(agents.id, f.second.id));
    await deleteCompany(db, f.two.id);
    expect(await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.companyId, f.two.id))).toHaveLength(0);
    expect(await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, evidence.version.id))).toHaveLength(1);
    expect(await db.select().from(companySkillTestRuns).where(eq(companySkillTestRuns.id, evidence.test.id))).toHaveLength(1);
  });
  it("publishes exact reviewed bytes and independently adopts, refuses and rolls back company pins", async () => {
    const f = await seed(), first = await capabilityFixture(f);
    const publish = await request(f.api).post(`${f.base}/capabilities`).send(first.intent).expect(201);
    expect(publish.body.markdown).toBe(first.markdown);
    expect(JSON.stringify(publish.body)).not.toContain(first.issue.id);
    expect(JSON.stringify(publish.body)).not.toContain("Private");
    const companyOne = `${f.base}/assignments/${f.assignments[0].id}/capabilities`;
    const companyTwo = `${f.base}/assignments/${f.assignments[1].id}/capabilities`;
    const adoptOne = await decisionIntent(f, 0, first.intent.id);
    await request(f.api).post(companyOne).send(adoptOne).expect(200);
    await request(f.api).post(companyTwo).send(await decisionIntent(f, 1, first.intent.id)).expect(200);
    const [original] = await db.select().from(agents).where(eq(agents.id, f.first.id));
    const previous = readPaperclipSkillSyncPreference(original.adapterConfig).desiredSkillEntries;
    const second = await capabilityFixture(f, 1);
    await request(f.api).post(`${f.base}/capabilities`).send(second.intent).expect(201);
    await request(f.api).post(companyOne).send(await decisionIntent(f, 0, second.intent.id)).expect(200);
    const [otherBefore] = await db.select().from(agents).where(eq(agents.id, f.second.id));
    await request(f.api).post(companyTwo).send(await decisionIntent(f, 1, second.intent.id, "refuse")).expect(200);
    expect((await db.select().from(agents).where(eq(agents.id, f.second.id)))[0].adapterConfig).toEqual(otherBefore.adapterConfig);
    await request(f.api).post(companyOne).send(await decisionIntent(f, 0, first.intent.id, "rollback")).expect(200);
    const [rolledBack] = await db.select().from(agents).where(eq(agents.id, f.first.id));
    expect(readPaperclipSkillSyncPreference(rolledBack.adapterConfig).desiredSkillEntries).toEqual(previous);
    const [version] = await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, previous[0].versionId!));
    expect(version.fileInventory[0].content).toBe(first.markdown);
    const view = await request(f.api).get(`${f.base}/employees/${f.employeeInput.id}/capabilities`).expect(200);
    expect(view.body.assignments.every((assignment: { selected: Array<{ releaseId: string }> }) => assignment.selected[0]?.releaseId === first.intent.id)).toBe(true);
    expect(view.body.latestRevisions.review).toBe(2);
  });
  it("deduplicates concurrent capability decisions and rejects stale or changed intent", async () => {
    const f = await seed(), source = await capabilityFixture(f);
    await request(f.api).post(`${f.base}/capabilities`).send(source.intent).expect(201);
    const path = `${f.base}/assignments/${f.assignments[0].id}/capabilities`, intent = await decisionIntent(f, 0, source.intent.id);
    const both = await Promise.all([request(f.api).post(path).send(intent), request(f.api).post(path).send(intent)]);
    expect(both.map(result => result.status)).toEqual([200, 200]);
    expect(await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.id, intent.id))).toHaveLength(1);
    await request(f.api).post(path).send({ ...intent, reason: "Changed intent" }).expect(409);
    await request(f.api).post(path).send({ ...intent, id: randomUUID() }).expect(409);
  });
  it("denies revoked company authority, missing exact evidence and company skill policy refusal", async () => {
    const f = await seed(), source = await capabilityFixture(f);
    await request(f.api).post(`${f.base}/capabilities`).send({ ...source.intent, sourceVersionId: randomUUID() }).expect(404);
    await request(f.api).post(`${f.base}/capabilities`).send({ ...source.intent, reviewedAndSanitized: false }).expect(400);
    await request(f.api).post(`${f.base}/capabilities`).send(source.intent).expect(201);
    const path = `${f.base}/assignments/${f.assignments[1].id}/capabilities`, intent = await decisionIntent(f, 1, source.intent.id);
    await db.insert(companySkillPolicies).values({ companyId: f.two.id, schemaVersion: 1, revision: 1, defaultEffect: "deny", rules: [] });
    await request(f.api).post(path).send(intent).expect(403);
    await db.delete(companySkillPolicies).where(eq(companySkillPolicies.companyId, f.two.id));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, f.two.id), eq(companyMemberships.principalId, f.owner)));
    await request(f.api).post(path).send(intent).expect(404);
    await request(app({ type: "agent", source: "agent_key", companyId: f.one.id, agentId: f.first.id })).post(path).send(intent).expect(403);
    expect(await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.id, intent.id))).toHaveLength(0);
  });
  it("rolls imported capability bytes, selection, revision and decision back when durable audit fails", async () => {
    const f = await seed(), source = await capabilityFixture(f);
    await request(f.api).post(`${f.base}/capabilities`).send(source.intent).expect(201);
    const path = `${f.base}/assignments/${f.assignments[0].id}/capabilities`, intent = await decisionIntent(f, 0, source.intent.id);
    const [before] = await db.select().from(agents).where(eq(agents.id, f.first.id));
    await db.execute(sql`CREATE FUNCTION fail_capability_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'agentos.capability_adopt' THEN RAISE EXCEPTION 'capability audit failed'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER fail_capability_audit BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION fail_capability_audit()`);
    try { await request(f.api).post(path).send(intent).expect(500); }
    finally { await db.execute(sql`DROP TRIGGER fail_capability_audit ON activity_log`); await db.execute(sql`DROP FUNCTION fail_capability_audit()`); }
    expect((await db.select().from(agents).where(eq(agents.id, f.first.id)))[0].adapterConfig).toEqual(before.adapterConfig);
    expect((await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.assignments[0].id)))[0].revision).toBe(1);
    expect(await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.id, intent.id))).toHaveLength(0);
    expect((await db.select().from(companySkills).where(eq(companySkills.companyId, f.one.id))).map(row => row.id)).toEqual([source.skill.id]);
  });
  it("does not use create permission to bypass an existing capability skill's update/edit policy", async () => {
    const f = await seed(), first = await capabilityFixture(f);
    await request(f.api).post(`${f.base}/capabilities`).send(first.intent).expect(201);
    const path = `${f.base}/assignments/${f.assignments[0].id}/capabilities`;
    await request(f.api).post(path).send(await decisionIntent(f, 0, first.intent.id)).expect(200);
    const [previous] = await db.select().from(agents).where(eq(agents.id, f.first.id));
    const [adoption] = await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.releaseId, first.intent.id));
    const second = await capabilityFixture(f, 1);
    await request(f.api).post(`${f.base}/capabilities`).send(second.intent).expect(201);
    await db.insert(companySkillPolicies).values({ companyId: f.one.id, schemaVersion: 1, revision: 1, defaultEffect: "allow",
      rules: [{ id: "protect-existing-capability", priority: 1, effect: "deny", subject: { type: "roles", roles: ["board"] },
        actions: ["skills.update", "skills.edit"], resources: { skillIds: [adoption.importedSkillId!] } }] });
    await request(f.api).post(path).send(await decisionIntent(f, 0, second.intent.id)).expect(403);
    expect((await db.select().from(agents).where(eq(agents.id, f.first.id)))[0].adapterConfig).toEqual(previous.adapterConfig);
    expect(await db.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.releaseId, second.intent.id))).toHaveLength(0);
  });
  async function grantRetirement(f: Awaited<ReturnType<typeof delegatedSeed>>, targetAgentId = f.second.id) {
    for (const principal of [{ type: "agent" as const, id: f.manager.id }, { type: "user" as const, id: f.owner }]) {
      await accessService(db).setPrincipalPermission(f.two.id, principal.type, principal.id, "workforce:retire", true, f.owner, { agentIds: [targetAgentId] });
    }
  }
  it.each([false, true])("allows explicitly granted company retirement by the CEO/department head (%s)", async departmentHead => {
    const f = await delegatedSeed(), access = accessService(db);
    if (departmentHead) {
      await db.update(agents).set({ role: "general" }).where(eq(agents.id, f.manager.id));
      await db.insert(agentosDepartments).values({ companyId: f.two.id, name: "Delivery", leadAgentId: f.manager.id });
    }
    const path = `${f.companyPath}/assignments/${f.assignments[1].id}/retire`;
    const intent = { expectedRevision: 1, reason: "Company trial completed" };
    const [employeeBefore] = await db.select().from(agentosEmployees).where(eq(agentosEmployees.id, f.employeeInput.id));
    await db.insert(agentApiKeys).values([f.first, f.second].map(agent => ({ agentId: agent.id, companyId: agent.companyId, name: "test", keyHash: randomUUID() })));
    // Hiring/configuration grants and the CEO title never imply retirement.
    await request(f.delegated).post(path).send(intent).expect(403);
    await access.setPrincipalPermission(f.two.id, "user", f.owner, "workforce:retire", true, f.owner, { agentIds: [f.second.id] });
    await request(f.delegated).post(path).send(intent).expect(403);
    await access.setPrincipalPermission(f.two.id, "agent", f.manager.id, "workforce:retire", true, f.owner, { agentIds: [f.target.id] });
    await request(f.delegated).post(path).send(intent).expect(403);
    await grantRetirement(f);
    const responses = await Promise.all([request(f.delegated).post(path).send(intent), request(f.delegated).post(path).send(intent)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const [retired] = await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.assignments[1].id));
    expect(retired).toMatchObject({ status: "retired", revision: 2, retirementReason: intent.reason });
    const [localAgent] = await db.select().from(agents).where(eq(agents.id, f.second.id));
    const [foreignAgent] = await db.select().from(agents).where(eq(agents.id, f.first.id));
    expect(localAgent.lifecycleState).toBe("terminating"); expect(foreignAgent.lifecycleState).toBe("ready");
    const keys = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, f.second.id));
    expect(keys[0].revokedAt).not.toBeNull();
    expect((await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, f.first.id)))[0].revokedAt).toBeNull();
    expect((await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.assignments[0].id)))[0].status).toBe("active");
    expect((await db.select().from(agentosEmployees).where(eq(agentosEmployees.id, f.employeeInput.id)))[0]).toEqual(employeeBefore);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, retired.id), eq(activityLog.action, "agentos.assignment_retired")));
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actorType: "agent", actorId: f.manager.id, companyId: f.two.id });
    await request(f.delegated).post(path).send({ ...intent, reason: "Different intent" }).expect(409);
    await request(f.delegated).post(`${f.companyPath}/assignments`).send({ id: randomUUID(), employeeId: f.employeeInput.id, agentId: f.target.id }).expect(409);
    // A successful prior request is not authority after a role/binding change.
    if (departmentHead) await db.update(agentosDepartments).set({ leadAgentId: null }).where(eq(agentosDepartments.companyId, f.two.id));
    else await db.update(agents).set({ role: "general" }).where(eq(agents.id, f.manager.id));
    await request(f.delegated).post(path).send(intent).expect(403);
  });
  it("enforces the responsible owner's retirement grant even under legacy shadow mode", async () => {
    const previousMode = process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE;
    process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE = "shadow";
    try {
      const f = await delegatedSeed(), access = accessService(db);
      const path = `${f.companyPath}/assignments/${f.assignments[1].id}/retire`, intent = { expectedRevision: 1, reason: "Reviewed retirement" };
      await access.setPrincipalPermission(f.two.id, "agent", f.manager.id, "workforce:retire", true, f.owner, { agentIds: [f.second.id] });
      await request(f.delegated).post(path).send(intent).expect(403);
      await access.setPrincipalPermission(f.two.id, "user", f.owner, "workforce:retire", true, f.owner, { agentIds: [f.target.id] });
      await request(f.delegated).post(path).send(intent).expect(403);
      expect((await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.assignments[1].id)))[0].status).toBe("active");
      await grantRetirement(f);
      await request(f.delegated).post(path).send(intent).expect(200);
    } finally {
      if (previousMode === undefined) delete process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE;
      else process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE = previousMode;
    }
  });
  it("also requires current authorizing-user membership and target retirement authority", async () => {
    const f = await delegatedSeed(), access = accessService(db), authorizer = randomUUID(), now = new Date();
    await grantRetirement(f);
    await db.insert(authUsers).values({ id: authorizer, name: "Authorizing user", email: `${authorizer}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.two.id, principalId: authorizer, principalType: "user", membershipRole: "member", status: "active" });
    await db.insert(principalPermissionGrants).values((["applications:manage", "agents:create"] as const).map(permissionKey => ({ companyId: f.two.id, principalId: authorizer, principalType: "user", permissionKey })));
    const api = app({ ...f.delegate, authorizingUserId: authorizer });
    const path = `${f.companyPath}/assignments/${f.assignments[1].id}/retire`, intent = { expectedRevision: 1, reason: "Reviewed retirement" };
    await request(api).post(path).send(intent).expect(403);
    await access.setPrincipalPermission(f.two.id, "user", authorizer, "workforce:retire", true, f.owner, { agentIds: [f.target.id] });
    await request(api).post(path).send(intent).expect(403);
    await access.setPrincipalPermission(f.two.id, "user", authorizer, "workforce:retire", true, f.owner, { agentIds: [f.second.id] });
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.two.id), eq(companyMemberships.principalId, authorizer)));
    await request(api).post(path).send(intent).expect(403);
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, f.two.id), eq(companyMemberships.principalId, authorizer)));
    await request(api).post(path).send(intent).expect(200);
  });
  it("intersects retirement with target grants, home administration, company boundaries and report reassignment", async () => {
    const f = await delegatedSeed(), access = accessService(db);
    const path = `${f.companyPath}/assignments/${f.assignments[1].id}/retire`, intent = { expectedRevision: 1, reason: "Replace assignment" };
    await grantRetirement(f);
    await access.setPrincipalPermission(f.two.id, "agent", f.manager.id, "workforce:retire", true, f.owner);
    await access.setPrincipalPermission(f.two.id, "user", f.owner, "workforce:retire", true, f.owner, { agentIds: [f.target.id] });
    await request(f.delegated).post(path).send(intent).expect(403);
    await grantRetirement(f);
    await access.setPrincipalPermission(f.one.id, "user", f.owner, "users:manage_permissions", false, f.owner);
    await request(f.delegated).post(path).send(intent).expect(404);
    await access.setPrincipalPermission(f.one.id, "user", f.owner, "users:manage_permissions", true, f.owner);
    await request(f.delegated).post(`${f.companyPath}/assignments/${f.assignments[0].id}/retire`).send(intent).expect(404);
    await request(f.delegated).post(`/api/companies/${f.one.id}/workforce/assignments/${f.assignments[0].id}/retire`).send(intent).expect(403);
    await request(f.delegated).post(path).send({ ...intent, companyId: f.one.id }).expect(400);
    await request(app({ ...f.delegate, keyScope: { kind: "skill_test", issueId: randomUUID() } })).post(path).send(intent).expect(403);
    await request(app({ ...f.delegate, onBehalfOfUserId: null })).post(path).send(intent).expect(403);
    await db.update(authUsers).set({ approvalStatus: "suspended" }).where(eq(authUsers.id, f.owner));
    await request(f.delegated).post(path).send(intent).expect(403);
    await db.update(authUsers).set({ approvalStatus: "approved" }).where(eq(authUsers.id, f.owner));
    const [report] = await db.insert(agents).values({ companyId: f.two.id, name: "Reassign first", reportsTo: f.second.id }).returning();
    await request(f.delegated).post(path).send(intent).expect(409);
    await db.update(agents).set({ reportsTo: f.manager.id }).where(eq(agents.id, report.id));
    await request(f.delegated).post(path).send(intent).expect(200);
  });
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
  it("lets current Friday inspect workforce while executive mutations remain denied", async () => {
    const f = await delegatedSeed(true);
    await request(f.delegated).get(f.companyPath).expect(200);
    await grantRetirement(f);
    await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(403);
    await request(f.delegated).post(`${f.companyPath}/assignments/${f.assignments[1].id}/retire`)
      .send({ expectedRevision: 1, reason: "Should go through the company executive" }).expect(403);
    expect((await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.assignments[1].id)))[0].status).toBe("active");
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
  it.each([false, true])("rejects authority revoked while a workforce mutation waits on the target agent (retirement=%s)", async retiring => {
    const f = await delegatedSeed();
    if (retiring) {
      await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(201);
      await grantRetirement(f, f.target.id);
    }
    const path = retiring ? `${f.companyPath}/assignments/${f.binding.id}/retire` : `${f.companyPath}/assignments`;
    const intent = retiring ? { expectedRevision: 1, reason: "Retire after review" } : f.binding;
    let release!: () => void, locked!: (pid: number) => void;
    const releaseLock = new Promise<void>(resolve => { release = resolve; });
    const targetLocked = new Promise<number>(resolve => { locked = resolve; });
    const holder = db.transaction(async tx => {
      await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, f.target.id)).for("update");
      const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked(row.pid);
      await releaseLock;
      // Native grant invalidation also locks company agents. Revoke from the
      // transaction already holding the target, so the grant deletion commits
      // before the waiting mutation can acquire that target and reauthorize.
      await accessService(tx as unknown as typeof db).setPrincipalPermission(f.two.id, "agent", f.manager.id,
        retiring ? "workforce:retire" : "applications:manage", false, f.owner);
    });
    const holderPid = await targetLocked;
    const binding = request(f.delegated).post(path).send(intent).then(response => response);
    try {
      await expect.poll(async () => {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_stat_activity waiter
          where waiter.datname=current_database() and ${holderPid}=any(pg_blocking_pids(waiter.pid))) as waiting`);
        return row.waiting;
      }, { timeout: 5000, interval: 25 }).toBe(true);
      release(); await holder;
      expect((await binding).status).toBe(403);
      const assignments = await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.binding.id));
      if (retiring) expect(assignments).toMatchObject([{ status: "active", revision: 1 }]);
      else expect(assignments).toHaveLength(0);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.binding.id),
        eq(activityLog.action, retiring ? "agentos.assignment_retired" : "agentos.assignment_created")))).toHaveLength(0);
    } finally { release(); await holder; await binding; }
  });
  it.each([false, true])("holds native authority through workforce mutation and durable audit commit (retirement=%s)", async retiring => {
    const f = await delegatedSeed();
    if (retiring) {
      await request(f.delegated).post(`${f.companyPath}/assignments`).send(f.binding).expect(201);
      await grantRetirement(f, f.target.id);
    }
    const path = retiring ? `${f.companyPath}/assignments/${f.binding.id}/retire` : `${f.companyPath}/assignments`;
    const intent = retiring ? { expectedRevision: 1, reason: "Retire after review" } : f.binding;
    // Hold the actual SQL audit boundary after authorization and assignment
    // insertion, then observe native grant revocation waiting on the binder.
    await db.execute(sql`create function agentos_test_binding_barrier() returns trigger language plpgsql as $$ begin if NEW.action in ('agentos.assignment_created', 'agentos.assignment_retired') then perform pg_advisory_xact_lock(830811031); end if; return NEW; end $$`);
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
    const binding = request(f.delegated).post(path).send(intent).then(response => response);
    let revocation: Promise<void> | undefined;
    try {
      let binderPid: number | undefined;
      await expect.poll(async () => {
        const [row] = await db.execute<{ pid: number }>(sql`select waiter.pid from pg_stat_activity waiter
          where waiter.datname=current_database() and ${holderPid}=any(pg_blocking_pids(waiter.pid))`);
        binderPid = row?.pid; return !!binderPid;
      }, { timeout: 5000, interval: 25 }).toBe(true);
      revocation = accessService(db).setPrincipalPermission(f.two.id, retiring ? "user" : "agent", retiring ? f.owner : f.manager.id,
        retiring ? "workforce:retire" : "applications:manage", false, f.owner);
      await expect.poll(async () => {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_stat_activity waiter
          where waiter.datname=current_database() and ${binderPid!}=any(pg_blocking_pids(waiter.pid))) as waiting`);
        return row.waiting;
      }, { timeout: 5000, interval: 25 }).toBe(true);
      release(); await holder;
      expect((await binding).status).toBe(retiring ? 200 : 201); await revocation;
      if (retiring) await request(f.delegated).post(path).send(intent).expect(403);
      else await request(f.delegated).get(f.companyPath).expect(403);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.binding.id),
        eq(activityLog.action, retiring ? "agentos.assignment_retired" : "agentos.assignment_created")))).toHaveLength(1);
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
  it("reads an employee's persisted work only across currently authorized assignments", async () => {
    const f = await seed(), readerId = randomUUID();
    await db.insert(authUsers).values({ id: readerId, name: "Employee reader", email: `${readerId}@example.test`,
      approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values([f.one, f.two].map(company => ({ companyId: company.id,
      principalType: "user" as const, principalId: readerId, membershipRole: "operator", status: "active" })));
    const [firstProject, secondProject, privateProject] = await db.insert(projects).values([
      { companyId: f.one.id, name: "First assignment project", visibility: "open" },
      { companyId: f.two.id, name: "Second assignment project", visibility: "open" },
      { companyId: f.two.id, name: "Unshared private project", visibility: "private" },
    ]).returning();
    const [firstTask, secondTask, privateTask] = await db.insert(issues).values([
      { companyId: f.one.id, projectId: firstProject.id, title: "First assignment work", status: "in_progress", assigneeAgentId: f.first.id },
      { companyId: f.two.id, projectId: secondProject.id, title: "Second assignment work", status: "in_progress", assigneeAgentId: f.second.id },
      { companyId: f.two.id, projectId: privateProject.id, title: "Unshared private work", assigneeAgentId: f.second.id, responsibleUserId: f.owner },
    ]).returning();
    const reader: Express.Request["actor"] = { type: "board", source: "session", userId: readerId,
      companyIds: [f.one.id, f.two.id], memberships: [f.one, f.two].map(company => ({ companyId: company.id, membershipRole: "operator", status: "active" })) };
    const api = app(reader), path = `/api/companies/${f.one.id}/friday/agents/${f.first.id}/awareness`;
    const initial = await request(api).get(path).expect(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(initial.body.scope).toBe("authorized_companies");
    expect(initial.body.assignments.map((row: { company: { id: string } }) => row.company.id)).toEqual([f.one.id, f.two.id]);
    expect(initial.body.assignments.flatMap((row: { work: { tasks: Array<{ id: string }> } }) => row.work.tasks.map(task => task.id)).sort())
      .toEqual([firstTask.id, secondTask.id].sort());
    expect(JSON.stringify(initial.body)).not.toContain(privateProject.id);
    expect(JSON.stringify(initial.body)).not.toContain(privateTask.id);
    expect(JSON.stringify(initial.body)).not.toContain("never-in-the-portfolio");
    await db.update(issues).set({ title: "Updated assignment work", status: "done" }).where(eq(issues.id, firstTask.id));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.principalId, readerId), eq(companyMemberships.companyId, f.two.id)));
    const refreshed = await request(api).get(path).query({ limit: 1 }).expect(200);
    expect(refreshed.body.nextOffset).toBeNull();
    expect(refreshed.body.assignments).toHaveLength(1);
    expect(refreshed.body.assignments[0].work.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: firstTask.id, title: "Updated assignment work", status: "done" })]));
    expect(JSON.stringify(refreshed.body)).not.toContain(f.two.id);
    expect(JSON.stringify(refreshed.body)).not.toContain("Second assignment");
  });
  it("keeps employee awareness on the runtime agent's own company despite an owner's wider membership", async () => {
    const f = await seed();
    await db.insert(companyMemberships).values({ companyId: f.one.id, principalType: "agent", principalId: f.first.id, membershipRole: "member", status: "active" });
    const actor: Express.Request["actor"] = { type: "agent", source: "agent_jwt", agentId: f.first.id,
      companyId: f.one.id, onBehalfOfUserId: f.owner, keyScope: { kind: "standard" },
      onBehalfOfMemberships: [{ companyId: f.one.id, membershipRole: "owner", status: "active" }] };
    const api = app(actor), path = `/api/companies/${f.one.id}/friday/agents/${f.first.id}/awareness`;
    const response = await request(api).get(path).expect(200);
    expect(response.body.scope).toBe("current_company");
    expect(response.body.assignments.map((row: { company: { id: string } }) => row.company.id)).toEqual([f.one.id]);
    expect(response.body.nextOffset).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain(f.two.id);
    await request(api).get(`/api/companies/${f.two.id}/friday/agents/${f.second.id}/awareness`).expect(403);
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.principalId, f.owner), eq(companyMemberships.companyId, f.one.id)));
    // Even a previously admitted actor snapshot cannot retain route access
    // after the responsible user's current membership is revoked.
    const denied = await request(api).get(path).expect(403);
    expect(denied.body).not.toHaveProperty("assignments");
    expect(JSON.stringify(denied.body)).not.toContain(f.employeeInput.id);
    expect(JSON.stringify(denied.body)).not.toContain(f.first.id);
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
  it.each([false, true])("rolls back retirement, keys and lifecycle on durable audit failure (delegated=%s)", async delegated => {
    const f = await delegatedSeed();
    if (delegated) await grantRetirement(f);
    await db.insert(agentApiKeys).values({ agentId: f.second.id, companyId: f.two.id, name: "test", keyHash: randomUUID() });
    // Fault at the actual database boundary after the lifecycle writes.
    await db.execute(sql`create function agentos_test_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action = 'agentos.assignment_retired' then raise exception 'simulated audit unavailable'; end if; return NEW; end $$`);
    await db.execute(sql`create trigger agentos_test_audit_failure before insert on activity_log for each row execute function agentos_test_audit_failure()`);
    try {
      await request(delegated ? f.delegated : f.api).post(`${delegated ? f.companyPath : f.base}/assignments/${f.assignments[1].id}/retire`).send({ expectedRevision: 1, reason: "Trial" }).expect(500);
      const [agent] = await db.select().from(agents).where(eq(agents.id, f.second.id));
      const [assignment] = await db.select().from(agentosAssignments).where(eq(agentosAssignments.id, f.assignments[1].id));
      const [key] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, f.second.id));
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
