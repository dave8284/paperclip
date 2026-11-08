import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, authUsers, companies, companyMemberships, createDb, issueAccessGrants, issues, type Db } from "@paperclipai/db";
import * as schema from "@paperclipai/db/schema/index";
import { activityService } from "../services/activity.js";
import { persistActivity, publishActivity } from "../services/activity-log.js";
import { issueReadSqlCondition } from "../services/authorization.js";
import { publishLiveEvent } from "../services/live-events.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("issue access grant activity privacy", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  const previousPrivacy = process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("activity-grant-privacy-");
    db = createDb(temporary.connectionString);
    process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = "enforce";
  }, 120_000);
  afterAll(async () => {
    if (previousPrivacy === undefined) delete process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;
    else process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = previousPrivacy;
    await temporary?.cleanup();
  });

  async function fixture() {
    const companyId = randomUUID(), foreignCompanyId = randomUUID(), owner = randomUUID(), viewer = randomUUID();
    await db.insert(companies).values([companyId, foreignCompanyId].map(id => ({ id, name: "Activity privacy fixture", issuePrefix: `G${id.slice(0, 7)}` })));
    await db.insert(authUsers).values([owner, viewer].map(id => ({ id, name: "Fixture reader", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([owner, viewer].map(principalId => ({ companyId, principalType: "user", principalId, status: "active", membershipRole: "operator" })));
    const privateId = randomUUID(), openId = randomUUID(), foreignId = randomUUID();
    await db.insert(issues).values([
      { id: privateId, companyId, title: "Private task", visibility: "private", privacyRootIssueId: privateId, responsibleUserId: owner },
      { id: openId, companyId, title: "Now open task" },
      { id: foreignId, companyId: foreignCompanyId, title: "Foreign task" },
    ]);
    const grants = await db.insert(issueAccessGrants).values([privateId, openId, foreignId].map(issueId => ({ issueId, subjectType: "user", subjectId: owner, source: "explicit" }))).returning();
    const [privateGrant, openGrant, foreignGrant] = [privateId, openId, foreignId].map(id => grants.find(grant => grant.issueId === id)!);
    const actor = (userId: string) => ({ type: "board" as const, userId, companyIds: [companyId], source: "session" as const, isInstanceAdmin: false });
    const input = (grant: typeof privateGrant, action = "issue_access_grant.created") => ({ companyId, actorType: "user" as const, actorId: owner, action, entityType: "issue_access_grant", entityId: grant.id, details: { issueId: grant.issueId, subjectId: owner, source: "explicit" } });
    return { companyId, foreignCompanyId, owner, viewer, privateId, openId, foreignId, privateGrant, openGrant, foreignGrant, actor, input };
  }

  it.each(["created", "revoked"])("filters %s history by current native task access, including malformed and foreign references", async action => {
    const f = await fixture();
    if (action === "revoked") await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, f.privateGrant.id));
    const privateEvent = await persistActivity(db, f.input(f.privateGrant, `issue_access_grant.${action}`));
    const openEvent = await persistActivity(db, f.input(f.openGrant, `issue_access_grant.${action}`));
    expect(privateEvent.publication.payload.issueId).toBe(f.privateId);
    expect(openEvent.publication.payload.issueId).toBe(f.openId);
    const historical = await db.insert(activityLog).values([
      { ...f.input(f.openGrant), details: null },
      { ...f.input(f.openGrant), details: {} },
    ]).returning({ id: activityLog.id });
    const denied = await db.insert(activityLog).values([
      f.input(f.foreignGrant),
      { ...f.input(f.openGrant), entityId: randomUUID() },
      { ...f.input(f.openGrant), entityId: "malformed-grant-id" },
      { ...f.input(f.openGrant), details: { issueId: f.privateId } },
      { ...f.input(f.privateGrant), details: { issueId: f.openId } },
      { ...f.input(f.openGrant), details: { issueId: null } },
      { ...f.input(f.openGrant), details: { issueId: 42 } },
      { ...f.input(f.openGrant), details: [] as unknown as Record<string, unknown> },
    ]).returning({ id: activityLog.id });
    const list = async (userId: string) => activityService(db).list({ companyId: f.companyId, readCondition: await issueReadSqlCondition(db, f.actor(userId)) });
    const visible = await list(f.viewer);
    expect(visible.map(row => row.id).sort()).toEqual([openEvent.activity.id, ...historical.map(row => row.id)].sort());
    expect(JSON.stringify(visible)).not.toContain(f.privateId);
    expect(JSON.stringify(visible)).not.toContain(f.privateGrant.id);
    const ownerVisible = await list(f.owner);
    expect(ownerVisible.map(row => row.id).sort()).toEqual([privateEvent.activity.id, openEvent.activity.id, ...historical.map(row => row.id)].sort());
    expect(ownerVisible.some(row => denied.some(hidden => hidden.id === row.id))).toBe(false);

    const [readerGrant] = await db.insert(issueAccessGrants).values({ issueId: f.privateId, subjectType: "user", subjectId: f.viewer, source: "explicit" }).returning();
    expect((await list(f.viewer)).map(row => row.id)).toContain(privateEvent.activity.id);
    await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, readerGrant.id));
    expect((await list(f.viewer)).map(row => row.id)).not.toContain(privateEvent.activity.id);
    await db.delete(issueAccessGrants).where(eq(issueAccessGrants.id, f.openGrant.id));
    expect(await list(f.viewer)).toEqual([]);
    expect(await db.select().from(activityLog).where(eq(activityLog.id, openEvent.activity.id))).toHaveLength(1);
    await db.delete(issues).where(eq(issues.id, f.privateId));
    expect(await list(f.owner)).toEqual([]);
    expect(await db.select().from(activityLog).where(eq(activityLog.id, privateEvent.activity.id))).toHaveLength(1);
  });

  it("validates publication hints against the native company-bound grant", async () => {
    const f = await fixture();
    expect((await persistActivity(db, { ...f.input(f.privateGrant), issueId: f.privateId })).publication.payload.issueId).toBe(f.privateId);
    for (const input of [
      { ...f.input(f.privateGrant), issueId: f.openId },
      { ...f.input(f.openGrant), details: { issueId: f.privateId } },
      f.input(f.foreignGrant),
      { ...f.input(f.openGrant), entityId: "invalid" },
      { ...f.input(f.openGrant), entityId: randomUUID() },
    ]) expect((await persistActivity(db, input)).publication.payload.issueId).toBeNull();
  });

  it("reauthorizes created/revoked live events and old publications without exposing private grant IDs", async () => {
    const f = await fixture();
    const reads: string[] = [];
    let failNextGrantRead = false;
    const observedDb = drizzle(db.$client, { schema, logger: { logQuery(query) {
      if (query.startsWith('select "issues"."id" from "issue_access_grants"')) {
        reads.push(query);
        if (failNextGrantRead) { failNextGrantRead = false; throw new Error("fixture grant lookup unavailable"); }
      }
    } } }) as Db;
    const server = createServer();
    const wss = setupLiveEventsWebSocketServer(server, observedDb, { deploymentMode: "authenticated", resolveCloudActor: async () => ({ userId: f.viewer, companyIds: [f.companyId] }) });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/companies/${f.companyId}/events/ws`);
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    socket.on("message", bytes => messages.push(JSON.parse(bytes.toString())));
    try {
      await once(socket, "open");
      async function deliver(payload: Record<string, unknown>, persisted = false) {
        const start = messages.length, barrier = randomUUID();
        if (persisted) publishActivity({ companyId: f.companyId, payload, pluginEvent: null });
        else publishLiveEvent({ companyId: f.companyId, type: "activity.logged", payload });
        publishLiveEvent({ companyId: f.companyId, type: "agent.status", payload: { agentId: barrier, status: "idle" } });
        await expect.poll(() => messages.some(message => message.payload.agentId === barrier)).toBe(true);
        return messages.slice(start).filter(message => message.type === "activity.logged");
      }
      const privatePublication = (await persistActivity(db, f.input(f.privateGrant))).publication;
      expect(await deliver(privatePublication.payload, true)).toEqual([]);
      expect(await deliver(f.input(f.privateGrant))).toEqual([]);
      expect(await deliver(f.input(f.openGrant))).toMatchObject([{ payload: { entityId: f.openGrant.id } }]);
      for (const payload of [f.input(f.foreignGrant), { ...f.input(f.openGrant), entityId: randomUUID() },
        { ...f.input(f.openGrant), entityId: "invalid" }, { ...f.input(f.openGrant), issueId: f.privateId },
        { ...f.input(f.openGrant), details: { issueId: f.privateId } }, { ...f.input(f.openGrant), details: { issueId: null } }]) {
        expect(await deliver(payload)).toEqual([]);
      }
      expect(JSON.stringify(messages)).not.toContain(f.privateId);
      expect(JSON.stringify(messages)).not.toContain(f.privateGrant.id);
      const [readerGrant] = await db.insert(issueAccessGrants).values({ issueId: f.privateId, subjectType: "user", subjectId: f.viewer, source: "explicit" }).returning();
      expect(await deliver(privatePublication.payload, true)).toHaveLength(1);
      await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, f.privateGrant.id));
      expect(await deliver(f.input(f.privateGrant, "issue_access_grant.revoked"))).toHaveLength(1);
      await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, readerGrant.id));
      expect(await deliver(f.input(f.privateGrant, "issue_access_grant.revoked"))).toEqual([]);
      failNextGrantRead = true;
      expect(await deliver(f.input(f.openGrant))).toEqual([]);
      expect(await deliver(f.input(f.openGrant))).toHaveLength(1);
      await db.delete(issueAccessGrants).where(eq(issueAccessGrants.id, f.openGrant.id));
      expect(await deliver(f.input(f.openGrant))).toEqual([]);
      for (const query of reads) {
        expect(query).toMatch(/^select "issues"\."id" from "issue_access_grants"/);
        expect(query).not.toMatch(/description|subject_id|responsible_user_id/);
      }
    } finally {
      socket.terminate();
      await Promise.all([...wss.clients].map(client => { const closed = new Promise<void>(resolve => client.on("close", resolve)); client.terminate(); return closed; }));
      await new Promise<void>((resolve, reject) => (wss as typeof wss & { close(callback: (error?: Error) => void): void }).close(error => error ? reject(error) : resolve()));
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
