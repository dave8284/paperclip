import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, companies, authUsers, companyMemberships, toolApplications, toolConnections, connectionGrants,
  connectionGrantMembers, companySecrets, toolConnectionInstalls, aiWorkspaceAccounts, aiWorkspaceAccountLinks,
  aiExecutionCapacityBindings, aiExecutionCapacityGroups, heartbeatRuns, agents, activityLog } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { aiWorkspaceAccountService, inheritOwnerAiAccounts, canReconnectWorkspaceAiAccount } from "../services/ai-workspace-accounts.js";
import { aiWorkspaceAccountSetupService } from "../services/ai-workspace-account-setup.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { resolveAiCredentialOwner, aiCredentialOwnerSnapshot } from "../services/ai-account-credential-owner.js";
import { aiExecutionCapacityService } from "../services/ai-execution-capacity.js";

describe("once-connected owner account management", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home: string;
  beforeAll(async () => {
    home = await realpath(await mkdtemp(path.join(os.tmpdir(), "agentos-accounts-home-")));
    vi.stubEnv("PAPERCLIP_HOME", home);
    database = await startEmbeddedPostgresTestDatabase("agentos-accounts-"); db = createDb(database.connectionString);
  }, 60000);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }); });
  async function fixture() {
    const owner = randomUUID(), other = randomUUID();
    await db.insert(authUsers).values([owner, other].map(id => ({ id, name: "Fixture owner", email: `${id}@example.test`,
      approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() })));
    const [source, target, third] = await db.insert(companies).values(["Source", "Target", "Third"].map(name => ({ name, issuePrefix: `A${randomUUID().slice(0, 7)}` }))).returning();
    await db.insert(companyMemberships).values([source, target, third].map(company => ({ companyId: company.id, principalType: "user",
      principalId: owner, membershipRole: "owner", status: "active" })));
    await db.insert(companyMemberships).values([source, target].map(company => ({ companyId: company.id, principalType: "user",
      principalId: other, membershipRole: "admin", status: "active" })));
    const [application] = await db.insert(toolApplications).values({ companyId: source.id, name: "OpenAI", type: "mcp_http" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: source.id, applicationId: application.id,
      name: "Owner subscription", uid: `fixture-${randomUUID()}`, connectionPurpose: "ai", transport: "runtime_auth", authKind: "oauth",
      status: "active", enabled: true, healthStatus: "ok", config: { ai: { provider: "openai", method: "subscription" }, aiIsolatedSubscription: true },
      createdByUserId: "local-board" }).returning();
    // Metadata only: management must never resolve or duplicate credential bytes.
    const [secret] = await db.insert(companySecrets).values({ companyId: source.id, name: `fixture-${randomUUID()}`, key: randomUUID(), provider: "local_encrypted" }).returning();
    const [grant] = await db.insert(connectionGrants).values({ companyId: source.id, connectionId: connection.id, kind: "organization",
      isDefault: true, createdByUserId: "local-board", credentialSecretRefs: [{ configPath: "ai.credential", secretId: secret.id, required: true, versionSelector: "latest" }] }).returning();
    const input = { id: randomUUID(), sourceCompanyId: source.id, sourceConnectionId: connection.id, sourceGrantId: grant.id, autoInstall: true };
    const scope = { userId: owner, companyIds: [source.id, target.id, third.id] }, service = aiWorkspaceAccountService(db);
    return { owner, other, source, target, third, connection, grant, secret, input, scope, service };
  }
  async function installed() {
    const f = await fixture(), account = await f.service.enroll(f.scope, f.input);
    const link = await f.service.install(f.scope, account.id, f.target.id, { expectedRevision: account.revision, expectedLinkRevision: null });
    if (!("id" in link)) throw new Error("Expected target-company installation");
    return { ...f, account, link };
  }
  it("enrolls idempotently and installs native company grants without copying a secret", async () => {
    const f = await installed();
    expect((await f.service.enroll(f.scope, { ...f.input, id: randomUUID() })).id).toBe(f.account.id);
    expect(await f.service.install(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: null })).toEqual(f.link);
    const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, f.link.connectionId));
    const [grant] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, f.link.grantId));
    expect(connection.companyId).toBe(f.target.id); expect(grant.companyId).toBe(f.target.id);
    expect(connection.credentialRefs).toEqual([]); expect(connection.credentialSecretRefs).toEqual([]); expect(grant.credentialSecretRefs).toEqual([]);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.companyId, f.target.id))).toEqual([]);
    expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, connection.id))).toMatchObject([{ companyId: f.target.id, targetType: "company", targetId: f.target.id }]);
    const bindings = await db.select().from(aiExecutionCapacityBindings).where(and(eq(aiExecutionCapacityBindings.companyId, f.source.id), eq(aiExecutionCapacityBindings.grantId, f.grant.id)));
    const [targetBinding] = await db.select().from(aiExecutionCapacityBindings).where(eq(aiExecutionCapacityBindings.grantId, grant.id));
    expect(targetBinding.groupId).toBe(bindings[0].groupId);
    const [group] = await db.select().from(aiExecutionCapacityGroups).where(eq(aiExecutionCapacityGroups.id, targetBinding.groupId));
    expect(group).toMatchObject({ maxConcurrent: 1, interactiveReserved: 0 });
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.target.id), eq(activityLog.action, "ai_account.company_installed")));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(f.secret.id);
  });
  it("refuses stale revisions and durable revocation is not reversed by inheritance", async () => {
    const f = await installed();
    await expect(f.service.revoke(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: 2 })).rejects.toThrow("changed");
    const revoked = await f.service.revoke(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: 1 });
    expect(revoked).toMatchObject({ enabled: false, revision: 2 });
    expect(await inheritOwnerAiAccounts(db, f.target.id, f.owner)).toEqual([]);
    await expect(f.service.install(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: null })).rejects.toThrow("changed");
    const restored = await f.service.install(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: 2 });
    expect(restored).toMatchObject({ id: f.link.id, grantId: f.link.grantId, revision: 3, enabled: true });
    await f.service.update(f.scope, f.account.id, { expectedRevision: 1, autoInstall: false });
    await expect(f.service.update(f.scope, f.account.id, { expectedRevision: 1, enabled: false })).rejects.toThrow("changed");
  });
  it("an instance/company admin cannot enroll an organization account without current ownership or its human audience", async () => {
    const f = await fixture();
    await expect(f.service.enroll({ userId: f.other, companyIds: f.scope.companyIds }, f.input)).rejects.toThrow("account owner");
    await db.insert(connectionGrantMembers).values({ companyId: f.source.id, grantId: f.grant.id, subjectType: "user", subjectId: f.other });
    await expect(f.service.enroll(f.scope, f.input)).rejects.toThrow("account owner");
    expect(await db.select().from(aiWorkspaceAccounts).where(eq(aiWorkspaceAccounts.sourceGrantId, f.grant.id))).toEqual([]);
  });
  it("rechecks current owner and target membership rather than trusting the request snapshot", async () => {
    const f = await fixture(), account = await f.service.enroll(f.scope, f.input);
    await db.update(companyMemberships).set({ membershipRole: "operator" }).where(and(eq(companyMemberships.companyId, f.target.id), eq(companyMemberships.principalId, f.owner)));
    await expect(f.service.install(f.scope, account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: null })).rejects.toThrow("company owner");
    expect(await inheritOwnerAiAccounts(db, f.target.id, f.owner)).toEqual([]);
    await db.update(authUsers).set({ approvalStatus: "pending" }).where(eq(authUsers.id, f.owner));
    await expect(f.service.list(f.scope)).rejects.toThrow("approved");
  });
  it("root or alias work awaiting native settlement blocks removal and every account revision", async () => {
    const f = await installed();
    const [agent] = await db.insert(agents).values({ companyId: f.target.id, name: "Fixture worker" }).returning();
    await db.insert(heartbeatRuns).values({ companyId: f.target.id, agentId: agent.id, status: "running", contextSnapshot: {
      aiConnection: { provider: "openai", method: "subscription", connectionId: f.link.connectionId, grantId: f.link.grantId },
    } });
    await expect(f.service.revoke(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: 1 })).rejects.toThrow("finish");
    await expect(f.service.update(f.scope, f.account.id, { expectedRevision: 1, autoInstall: false })).rejects.toThrow("finish");
    const [account] = await db.select().from(aiWorkspaceAccounts).where(eq(aiWorkspaceAccounts.id, f.account.id));
    const [link] = await db.select().from(aiWorkspaceAccountLinks).where(eq(aiWorkspaceAccountLinks.id, f.link.id));
    expect(account).toMatchObject({ revision: 1, enabled: true, autoInstall: true });
    expect(link).toMatchObject({ revision: 1, enabled: true });
  });
  it("a revoked source blocks new installations without native connection side effects", async () => {
    const f = await fixture(), account = await f.service.enroll(f.scope, f.input);
    await db.update(connectionGrants).set({ status: "revoked" }).where(eq(connectionGrants.id, f.grant.id));
    await expect(f.service.install(f.scope, account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: null })).rejects.toThrow("Reconnect");
    expect(await db.select().from(toolConnections).where(eq(toolConnections.companyId, f.target.id))).toEqual([]);
  });
  it("auto inheritance installs once for the owner and never for ordinary company membership", async () => {
    const f = await fixture(); await f.service.enroll(f.scope, f.input);
    const first = await inheritOwnerAiAccounts(db, f.target.id, f.owner), second = await inheritOwnerAiAccounts(db, f.target.id, f.owner);
    expect(first).toHaveLength(1); expect(second).toEqual(first);
    await db.update(companyMemberships).set({ membershipRole: "operator" }).where(and(eq(companyMemberships.companyId, f.third.id), eq(companyMemberships.principalId, f.owner)));
    expect(await inheritOwnerAiAccounts(db, f.third.id, f.owner)).toEqual([]);
    expect(await db.select().from(aiWorkspaceAccountLinks).where(eq(aiWorkspaceAccountLinks.companyId, f.third.id))).toEqual([]);
  });
  it("the registered current owner can repair or disable a broken login without rewriting its historical creator", async () => {
    const f = await installed();
    await db.update(toolConnections).set({ healthStatus: "error" }).where(eq(toolConnections.id, f.connection.id));
    await db.update(connectionGrants).set({ credentialSecretRefs: [] }).where(eq(connectionGrants.id, f.grant.id));
    expect(await canReconnectWorkspaceAiAccount(db, f.source.id, f.connection.id, f.owner)).toBe(true);
    expect(await canReconnectWorkspaceAiAccount(db, f.source.id, f.connection.id, f.other)).toBe(false);
    expect(await f.service.list(f.scope)).toMatchObject([{ id: f.account.id, available: false }]);
    await f.service.revoke(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: 1 });
    expect(await f.service.update(f.scope, f.account.id, { expectedRevision: 1, enabled: false })).toMatchObject({ enabled: false, revision: 2 });
    await expect(f.service.update(f.scope, f.account.id, { expectedRevision: 2, enabled: true })).rejects.toThrow("Reconnect");
    const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, f.connection.id));
    expect(connection.createdByUserId).toBe("local-board");
  });
  it("a retry does not certify an alias whose native installation was removed", async () => {
    const f = await installed();
    await db.delete(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, f.link.connectionId));
    await expect(f.service.install(f.scope, f.account.id, f.target.id, { expectedRevision: 1, expectedLinkRevision: null })).rejects.toThrow("configuration changed");
  });
  it("post-login setup is idempotent across existing companies and preserves a later explicit revocation", async () => {
    const f = await fixture(), setup = aiWorkspaceAccountSetupService(db);
    const input = { userId: f.owner, companyId: f.source.id, connectionId: f.connection.id, grantId: f.grant.id };
    const first = await setup.finishConnection(input), second = await setup.finishConnection(input);
    expect(first.status).toBe("ready"); expect(second).toEqual(first);
    const installed = await db.select().from(aiWorkspaceAccountLinks).where(eq(aiWorkspaceAccountLinks.accountId, first.accountId!));
    expect(installed).toHaveLength(2);
    const target = installed.find(link => link.companyId === f.target.id)!;
    await f.service.revoke(f.scope, first.accountId!, f.target.id, { expectedRevision: 1, expectedLinkRevision: target.revision });
    expect((await setup.finishConnection(input)).installedCompanyIds).not.toContain(f.target.id);
    expect(await setup.inspectCompany(f.target.id, f.owner)).toMatchObject({ status: "ready", installedCompanyIds: [] });
  });
  it("native target selection keeps company attribution while its locked resolver reads the canonical credential reference", async () => {
    const f = await installed();
    const [agent] = await db.insert(agents).values({ companyId: f.target.id, name: "Alias resolver fixture", adapterType: "codex_local" }).returning();
    const selected = await aiConnectionService(db).select({ companyId: f.target.id, userId: f.owner, agentId: agent.id,
      adapterType: "codex_local", binding: { provider: "openai", method: "subscription", mode: "shared", connectionId: f.link.connectionId, grantId: f.link.grantId } });
    expect(selected.connection.companyId).toBe(f.target.id);
    expect(selected.attribution).toMatchObject({ connectionId: f.link.connectionId, grantId: f.link.grantId, responsibleUserId: f.owner });
    expect(selected.grant.credentialSecretRefs).toEqual([]);
    const canonical = await db.transaction(tx => resolveAiCredentialOwner(tx as unknown as typeof db, selected, { lock: true }));
    expect(aiCredentialOwnerSnapshot(canonical)).toEqual({ companyId: f.source.id, connectionId: f.connection.id, grantId: f.grant.id,
      credential: { secretId: f.secret.id, versionSelector: "latest" },
      binding: { accountId: f.account.id, accountRevision: 1, linkId: f.link.id, linkRevision: 1 } });
    // Native authority is re-read; a prior successful target selection is not
    // permission to use another company's root after its owner loses access.
    await db.update(companyMemberships).set({ membershipRole: "operator" }).where(and(eq(companyMemberships.companyId, f.target.id), eq(companyMemberships.principalId, f.owner)));
    await expect(resolveAiCredentialOwner(db, selected)).rejects.toThrow("unavailable");
  });
  it("two company aliases contend atomically for one canonical subscription seat", async () => {
    const f = await installed();
    const third = await f.service.install(f.scope, f.account.id, f.third.id, { expectedRevision: 1, expectedLinkRevision: null });
    if (!("id" in third)) throw new Error("Expected third-company alias");
    const capacity = aiExecutionCapacityService(db);
    const inputs: Parameters<typeof capacity.tryAcquire>[0][] = [];
    try {
      for (const link of [f.link, third]) {
        const [agent] = await db.insert(agents).values({ companyId: link.companyId, name: "Capacity admission fixture", adapterType: "codex_local" }).returning();
        const attribution = { connectionId: link.connectionId, grantId: link.grantId, provider: "openai", method: "subscription", mode: "shared", responsibleUserId: f.owner } as const;
        // These are inert native admission fixtures, never dispatched jobs.
        const [run] = await db.insert(heartbeatRuns).values({ companyId: link.companyId, agentId: agent.id, status: "running",
          startedAt: new Date(), contextSnapshot: { aiConnection: attribution } }).returning();
        inputs.push({ runId: run.id, companyId: link.companyId, attribution, interactive: false });
      }
      const results = await Promise.all(inputs.map(input => capacity.tryAcquire(input)));
      expect(results.filter(result => result.admitted)).toHaveLength(1);
      expect(results.find(result => result.admitted)).toMatchObject({ governed: true });
      const admitted = inputs[results.findIndex(result => result.admitted)], waiting = inputs[results.findIndex(result => !result.admitted)];
      expect(await capacity.releaseSettled(admitted.runId, admitted.companyId, false)).toBe(false);
      expect((await capacity.tryAcquire(waiting)).admitted).toBe(false);
      await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, admitted.runId));
      expect(await capacity.releaseSettled(admitted.runId, admitted.companyId, true)).toBe(true);
      expect((await capacity.tryAcquire(waiting)).admitted).toBe(true);
    } finally {
      for (const input of inputs) {
        await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, input.runId));
        await capacity.releaseSettled(input.runId, input.companyId, true);
      }
    }
  });
});
