import { randomUUID } from "node:crypto";
import { withAccountHomeSecretMutationLock } from "@paperclipai/adapter-codex-local/server";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  aiWorkspaceAccounts as accounts, aiWorkspaceAccountLinks as links, authUsers,
  companies, companyMemberships, companySecrets, connectionGrants, connectionGrantMembers,
  toolApplications, toolConnections, toolConnectionInstalls, principalPermissionGrants, type Db,
} from "@paperclipai/db";
import {
  AI_CONNECTION_CAPABILITIES, aiConnectionCatalogSlug, aiConnectionMetadataSchema,
  aiSubscriptionNeedsIsolatedLogin, enrollAiWorkspaceAccountSchema, installAiWorkspaceAccountSchema,
  updateAiWorkspaceAccountSchema, type AiWorkspaceAccountSummary, type EnrollAiWorkspaceAccount,
  type InstallAiWorkspaceAccount, type UpdateAiWorkspaceAccount,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { authorizationService } from "./authorization.js";
import { persistActivity, type ActivityPublication } from "./activity-log.js";
import { publishAccountingActivities } from "./accounting-transaction.js";
import { assertAiCapacityBindingsSettled, ensureAiWorkspaceAccountCapacity } from "./ai-execution-capacity.js";

export type AiWorkspaceAccountScope = { userId: string; companyIds: readonly string[] };
type Account = typeof accounts.$inferSelect;
type Link = typeof links.$inferSelect;
type SourceIdentity = Pick<Account, "sourceCompanyId" | "sourceConnectionId" | "sourceGrantId">;
const capacityFence = sql`hashtext('ai_execution_capacity_configuration')`;
const noWait = { noWait: true } as const;
const sourceBinding = (account: SourceIdentity) => ({ companyId: account.sourceCompanyId,
  connectionId: account.sourceConnectionId, grantId: account.sourceGrantId });
const linkSummary = ({ id, companyId, connectionId, grantId, revision, enabled }: Link) =>
  ({ id, companyId, connectionId, grantId, revision, enabled });

/** Shared company credentials belong to the company; a historical creator is
 * not private ownership. Personal credentials always retain their exact owner. */
export function canEnrollAiWorkspaceCredential(input: {
  userId: string; membershipRole: string | null; grantKind: string; subjectUserId: string | null;
  audience: readonly { subjectType: string; subjectId: string }[];
}) {
  if (input.grantKind === "user") return input.subjectUserId === input.userId;
  return input.grantKind === "organization" && input.membershipRole === "owner"
    && (input.audience.length === 0 || input.audience.some(row => row.subjectType === "user" && row.subjectId === input.userId));
}

/** Called only on owner actions/company creation. Bounded database work, no
 * provider calls, credential reads, background polling or copied token values. */
export function aiWorkspaceAccountService(db: Db) {
  async function transact<T>(operation: (tx: Db, publications: ActivityPublication[]) => Promise<T>) {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(tx => operation(tx as unknown as Db, publications)).catch(error => {
      if ((error?.cause?.code ?? error?.code) === "55P03") throw conflict("Account access is changing. Reload and retry.");
      if ((error?.cause?.code ?? error?.code) === "23505") throw conflict("This account changed concurrently. Reload before retrying.");
      throw error;
    });
    for (const publication of publications) publishAccountingActivities(publication.companyId, [publication]);
    return result;
  }
  async function approvedUser(tx: Db, scope: AiWorkspaceAccountScope, lock: boolean) {
    const query = tx.select().from(authUsers).where(eq(authUsers.id, scope.userId));
    const [user] = await (lock ? query.for("share", noWait) : query);
    if (!user || user.approvalStatus !== "approved") throw forbidden("An approved account owner is required");
  }
  async function companyAuthority(tx: Db, scope: AiWorkspaceAccountScope, companyId: string,
    options: { lock: boolean; requireOwner?: boolean; requireActive?: boolean }) {
    if (!scope.companyIds.includes(companyId)) throw forbidden("Company access is required");
    const companyQuery = tx.select().from(companies).where(eq(companies.id, companyId));
    const [company] = await (options.lock ? companyQuery.for("share", noWait) : companyQuery);
    if (!company || (options.requireActive && company.status !== "active")) throw forbidden("An active company is required");
    const memberQuery = tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, scope.userId)));
    const [member] = await (options.lock ? memberQuery.for("share", noWait) : memberQuery);
    if (!member || member.status !== "active" || member.membershipRole === "viewer"
      || (options.requireOwner && member.membershipRole !== "owner")) throw forbidden("The current company owner must authorize account reuse");
    if (options.lock) await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants)
      .where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "user"),
        eq(principalPermissionGrants.principalId, scope.userId))).orderBy(asc(principalPermissionGrants.id)).for("share", noWait);
    const permission = await authorizationService(tx).decidePrincipalGrant({ companyId, principalType: "user", principalId: scope.userId,
      action: "tools:manage_connections", permissionKey: "tools:manage_connections" });
    if (!permission.allowed) throw forbidden("Manage connections permission is required");
    return { ...member, companyStatus: company.status };
  }
  async function source(tx: Db, scope: AiWorkspaceAccountScope, identity: SourceIdentity,
    options: { lock: boolean; requireAvailable: boolean; requireCredential?: boolean }) {
    const member = await companyAuthority(tx, scope, identity.sourceCompanyId, {
      lock: options.lock, requireActive: options.requireAvailable,
    });
    const query = tx.select({ connection: toolConnections, grant: connectionGrants }).from(toolConnections)
      .innerJoin(connectionGrants, and(eq(connectionGrants.companyId, toolConnections.companyId), eq(connectionGrants.connectionId, toolConnections.id)))
      .where(and(eq(toolConnections.companyId, identity.sourceCompanyId), eq(toolConnections.id, identity.sourceConnectionId),
        eq(connectionGrants.id, identity.sourceGrantId), eq(toolConnections.connectionPurpose, "ai")));
    const [selected] = await (options.lock ? query.for("share", noWait) : query);
    if (!selected) throw notFound("Connected account not found");
    const metadata = aiConnectionMetadataSchema.safeParse(selected.connection.config.ai);
    if (!metadata.success || metadata.data.method !== "subscription" || metadata.data.routing
      || !AI_CONNECTION_CAPABILITIES[metadata.data.provider].methods.subscription) throw unprocessable("Choose a connected subscription account");
    const [alias] = await tx.select({ id: links.id }).from(links).where(eq(links.connectionId, selected.connection.id));
    if (alias || selected.connection.config.aiWorkspaceAccount === true) throw unprocessable("Use the original connected account");
    const audienceQuery = tx.select().from(connectionGrantMembers).where(and(eq(connectionGrantMembers.companyId, identity.sourceCompanyId),
      eq(connectionGrantMembers.grantId, identity.sourceGrantId)));
    const audience = await (options.lock ? audienceQuery.for("share", noWait) : audienceQuery);
    if (!canEnrollAiWorkspaceCredential({ userId: scope.userId, membershipRole: member.membershipRole,
      grantKind: selected.grant.kind, subjectUserId: selected.grant.subjectUserId, audience })) throw forbidden("Only the account owner may reuse this subscription");
    if (options.requireAvailable && (selected.grant.status !== "active" || !selected.connection.enabled
      || selected.connection.status !== "active" || selected.connection.healthStatus !== "ok"
      || aiSubscriptionNeedsIsolatedLogin(selected.connection.config))) throw unprocessable("Reconnect the original account before reusing it");
    if (options.requireCredential === false) return { ...selected, metadata: metadata.data, companyStatus: member.companyStatus };
    const ref = selected.grant.credentialSecretRefs.find(value => value.configPath === "ai.credential");
    if (!ref) throw unprocessable("The original account credential is unavailable");
    const secretQuery = tx.select().from(companySecrets).where(and(eq(companySecrets.companyId, identity.sourceCompanyId), eq(companySecrets.id, ref.secretId)));
    const [secret] = await (options.lock ? secretQuery.for("share", noWait) : secretQuery);
    if (!secret || (options.requireAvailable && secret.status !== "active")
      || (selected.grant.kind === "user" ? secret.scope !== "user" || secret.ownerUserId !== scope.userId : secret.scope !== "company")) {
      throw forbidden("The original credential ownership changed");
    }
    return { ...selected, metadata: metadata.data, companyStatus: member.companyStatus };
  }
  async function owned(tx: Db, scope: AiWorkspaceAccountScope, id: string, lock: boolean) {
    await approvedUser(tx, scope, lock);
    const query = tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.ownerUserId, scope.userId)));
    const [account] = await (lock ? query.for("update", noWait) : query);
    if (!account) throw notFound("Account not found");
    return account;
  }
  async function mutateAccount<T>(scope: AiWorkspaceAccountScope, accountId: string,
    operation: (tx: Db, publications: ActivityPublication[]) => Promise<T>) {
    // Manual connection probes hold this same canonical file lock through
    // credential refresh cleanup but have no heartbeat to fence. Resolve only
    // ownership here; never wait for the file lock while holding SQL locks.
    const account = await owned(db, scope, accountId, false);
    await source(db, scope, account, { lock: false, requireAvailable: false, requireCredential: false });
    return withAccountHomeSecretMutationLock(undefined, account.sourceCompanyId, () => transact(operation));
  }
  async function currentAlias(tx: Db, link: Link, provider: string, requireAvailable: boolean) {
    const [installation] = await tx.select({ id: toolConnectionInstalls.id }).from(toolConnectionInstalls)
      .where(and(eq(toolConnectionInstalls.companyId, link.companyId), eq(toolConnectionInstalls.connectionId, link.connectionId),
        eq(toolConnectionInstalls.targetType, "company"), eq(toolConnectionInstalls.targetId, link.companyId))).for("share", noWait);
    const [selected] = await tx.select({ connection: toolConnections, grant: connectionGrants }).from(toolConnections)
      .innerJoin(connectionGrants, and(eq(connectionGrants.companyId, toolConnections.companyId), eq(connectionGrants.connectionId, toolConnections.id)))
      .where(and(eq(toolConnections.companyId, link.companyId), eq(toolConnections.id, link.connectionId), eq(connectionGrants.id, link.grantId)))
      .for("share", noWait);
    const metadata = aiConnectionMetadataSchema.safeParse(selected?.connection.config.ai);
    if (!installation || !selected || selected.connection.connectionPurpose !== "ai" || selected.connection.config.aiWorkspaceAccount !== true
      || !metadata.success || metadata.data.provider !== provider || metadata.data.method !== "subscription" || metadata.data.routing
      || selected.grant.kind !== "organization" || selected.grant.credentialSecretRefs.length !== 0
      || selected.connection.credentialSecretRefs.length !== 0 || selected.connection.credentialRefs.length !== 0
      || selected.grant.externalCredential || selected.connection.externalCredential
      || (requireAvailable && (selected.grant.status !== "active" || !selected.connection.enabled
        || selected.connection.status !== "active" || selected.connection.healthStatus !== "ok"))) {
      throw conflict("Company account configuration changed. Review its connection before installing");
    }
  }
  async function audit(tx: Db, publications: ActivityPublication[], scope: AiWorkspaceAccountScope,
    companyId: string, accountId: string, action: string, details: Record<string, unknown> = {}) {
    const result = await persistActivity(tx, { companyId, actorType: "user", actorId: scope.userId,
      action, entityType: "ai_workspace_account", entityId: accountId, details });
    publications.push(result.publication);
  }
  async function present(tx: Db, scope: AiWorkspaceAccountScope, account: Account): Promise<AiWorkspaceAccountSummary> {
    const selected = await source(tx, scope, account, { lock: false, requireAvailable: false, requireCredential: false });
    const installed = await tx.select().from(links).where(eq(links.accountId, account.id)).orderBy(asc(links.companyId)).limit(101);
    if (installed.length > 100) throw unprocessable("This account has too many company installations to inspect safely");
    const ref = selected.grant.credentialSecretRefs.find(value => value.configPath === "ai.credential");
    const [secret] = ref ? await tx.select().from(companySecrets).where(and(eq(companySecrets.companyId, account.sourceCompanyId), eq(companySecrets.id, ref.secretId))) : [];
    const available = account.enabled && selected.companyStatus === "active" && selected.grant.status === "active"
      && selected.connection.enabled && selected.connection.status === "active" && selected.connection.healthStatus === "ok"
      && !aiSubscriptionNeedsIsolatedLogin(selected.connection.config) && !!secret && secret.status === "active"
      && (selected.grant.kind === "user" ? secret.scope === "user" && secret.ownerUserId === scope.userId : secret.scope === "company");
    return { id: account.id, ownerUserId: account.ownerUserId, revision: account.revision, enabled: account.enabled,
      autoInstall: account.autoInstall, ...sourceIdentity(account), name: selected.connection.name, provider: selected.metadata.provider,
      method: "subscription", available, links: installed.filter(link => scope.companyIds.includes(link.companyId)).map(linkSummary) };
  }
  async function list(scope: AiWorkspaceAccountScope) {
    await approvedUser(db, scope, false);
    const rows = await db.select().from(accounts).where(eq(accounts.ownerUserId, scope.userId)).orderBy(asc(accounts.id)).limit(101);
    if (rows.length > 100) throw unprocessable("Too many accounts to inspect safely");
    const result: AiWorkspaceAccountSummary[] = [];
    for (const account of rows) {
      if (!scope.companyIds.includes(account.sourceCompanyId)) continue;
      try { result.push(await present(db, scope, account)); }
      catch (error) { if (![403, 404].includes(Number((error as { status?: number }).status))) throw error; }
    }
    return result;
  }
  async function enroll(scope: AiWorkspaceAccountScope, raw: EnrollAiWorkspaceAccount) {
    const input = enrollAiWorkspaceAccountSchema.parse(raw);
    await approvedUser(db, scope, false);
    await source(db, scope, input, { lock: false, requireAvailable: true });
    return withAccountHomeSecretMutationLock(undefined, input.sourceCompanyId, () => transact(async (tx, publications) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${capacityFence})`);
      await approvedUser(tx, scope, true);
      await source(tx, scope, input, { lock: true, requireAvailable: true });
      const existing = await tx.select().from(accounts).where(or(eq(accounts.id, input.id), eq(accounts.sourceGrantId, input.sourceGrantId))).for("update", noWait);
      if (existing.length) {
        if (existing.length !== 1 || existing[0].ownerUserId !== scope.userId ||
          JSON.stringify(sourceIdentity(existing[0])) !== JSON.stringify(sourceIdentity(input))) throw conflict("This connected account is already registered differently");
        return present(tx, scope, existing[0]);
      }
      await ensureAiWorkspaceAccountCapacity(tx, { ownerUserId: scope.userId, source: sourceBinding(input) });
      const [account] = await tx.insert(accounts).values({ ...input, ownerUserId: scope.userId }).returning();
      await audit(tx, publications, scope, input.sourceCompanyId, account.id, "ai_account.enrolled", { autoInstall: account.autoInstall });
      return present(tx, scope, account);
    }));
  }
  async function install(scope: AiWorkspaceAccountScope, accountId: string, companyId: string, raw: InstallAiWorkspaceAccount) {
    const input = installAiWorkspaceAccountSchema.parse(raw);
    return mutateAccount(scope, accountId, async (tx, publications) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${capacityFence})`);
      const account = await owned(tx, scope, accountId, true);
      if (!account.enabled || account.revision !== input.expectedRevision) throw conflict("Account settings changed. Reload before installing");
      const selected = await source(tx, scope, account, { lock: true, requireAvailable: true });
      await companyAuthority(tx, scope, companyId, { lock: true, requireOwner: true, requireActive: true });
      if (companyId === account.sourceCompanyId) return { source: true as const, ...sourceBinding(account) };
      const [prior] = await tx.select().from(links).where(and(eq(links.accountId, accountId), eq(links.companyId, companyId))).for("update", noWait);
      if (prior) {
        await currentAlias(tx, prior, selected.metadata.provider, prior.enabled);
        if (prior.enabled && (input.expectedLinkRevision === null || input.expectedLinkRevision === prior.revision)) {
          await ensureAiWorkspaceAccountCapacity(tx, { ownerUserId: scope.userId, source: sourceBinding(account), target: prior });
          return linkSummary(prior);
        }
        if (input.expectedLinkRevision !== prior.revision) throw conflict("Company account access changed. Reload before installing");
        // Revoked aliases are restored explicitly, retaining the same native identities.
        await assertAiCapacityBindingsSettled(tx, [prior]);
        await tx.update(connectionGrants).set({ status: "active", revokedAt: null, revokedByUserId: null, updatedAt: new Date() }).where(eq(connectionGrants.id, prior.grantId));
        await tx.update(toolConnections).set({ status: "active", enabled: true, healthStatus: "ok", updatedAt: new Date() }).where(eq(toolConnections.id, prior.connectionId));
        const [saved] = await tx.update(links).set({ enabled: true, revision: prior.revision + 1, updatedAt: new Date() }).where(eq(links.id, prior.id)).returning();
        await ensureAiWorkspaceAccountCapacity(tx, { ownerUserId: scope.userId, source: sourceBinding(account), target: saved });
        await audit(tx, publications, scope, companyId, accountId, "ai_account.company_enabled", { linkId: saved.id, revision: saved.revision });
        return linkSummary(saved);
      }
      if (input.expectedLinkRevision !== null) throw conflict("Company account installation was removed");
      const count = await tx.select({ id: links.id }).from(links).where(eq(links.accountId, accountId)).limit(100);
      if (count.length >= 100) throw unprocessable("An account can be installed in at most 100 companies");
      const provider = selected.metadata.provider, slug = aiConnectionCatalogSlug(provider), applicationKey = `app-gallery:${slug}`;
      const name = AI_CONNECTION_CAPABILITIES[provider].name;
      await tx.insert(toolApplications).values({ companyId, applicationKey, name, type: "mcp_http",
        metadata: { sourceTemplateKey: slug }, ownerUserId: scope.userId }).onConflictDoNothing();
      const [application] = await tx.select().from(toolApplications).where(and(eq(toolApplications.companyId, companyId),
        or(eq(toolApplications.applicationKey, applicationKey), eq(toolApplications.name, name)))).orderBy(asc(toolApplications.id));
      if (!application || application.status !== "active") throw unprocessable("The provider application is unavailable");
      const connectionId = randomUUID(), grantId = randomUUID(), linkId = randomUUID();
      await tx.insert(toolConnections).values({ id: connectionId, companyId, applicationId: application.id,
        name: selected.connection.name, uid: `ai-account-${account.id}`, connectionPurpose: "ai", transport: "runtime_auth", authKind: "oauth",
        credentialPolicy: "shared", status: "active", enabled: true, healthStatus: "ok", createdByUserId: scope.userId,
        config: { sourceTemplateKey: slug, ai: { provider, method: "subscription" }, aiIsolatedSubscription: provider !== "anthropic", aiWorkspaceAccount: true } });
      await tx.insert(connectionGrants).values({ id: grantId, companyId, connectionId, kind: "organization",
        isDefault: true, credentialSecretRefs: [], createdByUserId: scope.userId });
      await tx.insert(toolConnectionInstalls).values({ companyId, connectionId, targetType: "company", targetId: companyId, createdByUserId: scope.userId });
      const [link] = await tx.insert(links).values({ id: linkId, accountId, companyId, connectionId, grantId }).returning();
      await ensureAiWorkspaceAccountCapacity(tx, { ownerUserId: scope.userId, source: sourceBinding(account), target: link });
      await audit(tx, publications, scope, companyId, accountId, "ai_account.company_installed", { linkId, connectionId, grantId });
      return linkSummary(link);
    });
  }
  async function revoke(scope: AiWorkspaceAccountScope, accountId: string, companyId: string, raw: InstallAiWorkspaceAccount) {
    const input = installAiWorkspaceAccountSchema.parse(raw);
    return mutateAccount(scope, accountId, async (tx, publications) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${capacityFence})`);
      const account = await owned(tx, scope, accountId, true);
      if (account.revision !== input.expectedRevision) throw conflict("Account settings changed. Reload before removing access");
      await source(tx, scope, account, { lock: true, requireAvailable: false, requireCredential: false });
      await companyAuthority(tx, scope, companyId, { lock: true, requireOwner: true });
      if (companyId === account.sourceCompanyId) throw unprocessable("Disable the account to stop its original connection");
      const [link] = await tx.select().from(links).where(and(eq(links.accountId, accountId), eq(links.companyId, companyId))).for("update", noWait);
      if (!link) throw notFound("Company account installation not found");
      if (link.revision !== input.expectedLinkRevision) throw conflict("Company account access changed. Reload before removing it");
      if (!link.enabled) return linkSummary(link);
      await assertAiCapacityBindingsSettled(tx, [link]);
      const [saved] = await tx.update(links).set({ enabled: false, revision: link.revision + 1, updatedAt: new Date() }).where(eq(links.id, link.id)).returning();
      await tx.update(connectionGrants).set({ status: "revoked", revokedAt: new Date(), revokedByUserId: scope.userId, updatedAt: new Date() }).where(eq(connectionGrants.id, link.grantId));
      await tx.update(toolConnections).set({ enabled: false, updatedAt: new Date() }).where(eq(toolConnections.id, link.connectionId));
      await audit(tx, publications, scope, companyId, accountId, "ai_account.company_revoked", { linkId: link.id, revision: saved.revision });
      return linkSummary(saved);
    });
  }
  async function update(scope: AiWorkspaceAccountScope, accountId: string, raw: UpdateAiWorkspaceAccount) {
    const input = updateAiWorkspaceAccountSchema.parse(raw);
    return mutateAccount(scope, accountId, async (tx, publications) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${capacityFence})`);
      const account = await owned(tx, scope, accountId, true);
      if (account.revision !== input.expectedRevision) throw conflict("Account settings changed. Reload before saving");
      await source(tx, scope, account, { lock: true, requireAvailable: input.enabled === true, requireCredential: input.enabled === true });
      const installed = await tx.select().from(links).where(eq(links.accountId, accountId)).limit(101);
      if (installed.length > 100) throw unprocessable("Too many account installations to update safely");
      if ((input.enabled === undefined || input.enabled === account.enabled)
        && (input.autoInstall === undefined || input.autoInstall === account.autoInstall)) return present(tx, scope, account);
      // Every account revision is pinned by prepared execution/writeback. Even
      // an inheritance preference change waits for those snapshots to settle.
      await assertAiCapacityBindingsSettled(tx, [sourceBinding(account), ...installed]);
      const [saved] = await tx.update(accounts).set({ ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.autoInstall !== undefined ? { autoInstall: input.autoInstall } : {}), revision: account.revision + 1, updatedAt: new Date() })
        .where(eq(accounts.id, account.id)).returning();
      await audit(tx, publications, scope, account.sourceCompanyId, accountId, "ai_account.updated", {
        revision: saved.revision, enabled: saved.enabled, autoInstall: saved.autoInstall,
      });
      return present(tx, scope, saved);
    });
  }
  async function canReconnect(companyId: string, connectionId: string, userId: string) {
    const scope = { userId, companyIds: [companyId] };
    try {
      return await transact(async tx => {
        await approvedUser(tx, scope, true);
        const [account] = await tx.select().from(accounts).where(and(eq(accounts.ownerUserId, userId),
          eq(accounts.sourceCompanyId, companyId), eq(accounts.sourceConnectionId, connectionId))).for("share", noWait);
        if (!account) return false;
        await source(tx, scope, account, { lock: true, requireAvailable: false, requireCredential: false });
        return true;
      });
    } catch (error) {
      if ([403, 404].includes(Number((error as { status?: number }).status))) return false;
      throw error;
    }
  }
  return { list, enroll, install, revoke, update, canReconnect };
}

function sourceIdentity(value: SourceIdentity): SourceIdentity {
  return { sourceCompanyId: value.sourceCompanyId, sourceConnectionId: value.sourceConnectionId, sourceGrantId: value.sourceGrantId };
}

/** A company creator can inherit only their explicitly enrolled auto-install
 * accounts. Ordinary membership never silently shares an owner's subscription. */
export async function inheritOwnerAiAccounts(db: Db, companyId: string, userId: string) {
  const memberships = await db.select().from(companyMemberships).where(and(eq(companyMemberships.principalType, "user"),
    eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active")));
  if (!memberships.some(row => row.companyId === companyId && row.membershipRole === "owner")) return [];
  const scope = { userId, companyIds: memberships.map(row => row.companyId) };
  const rows = await db.select().from(accounts).where(and(eq(accounts.ownerUserId, userId), eq(accounts.enabled, true), eq(accounts.autoInstall, true)))
    .orderBy(asc(accounts.id)).limit(21);
  if (rows.length > 20) throw unprocessable("Choose which accounts this company should inherit");
  if (!rows.length) return [];
  const installed = await db.select().from(links).where(and(eq(links.companyId, companyId), inArray(links.accountId, rows.map(row => row.id))));
  const result = [];
  for (const account of rows) {
    if (account.sourceCompanyId === companyId) continue;
    const prior = installed.find(row => row.accountId === account.id);
    // An explicit company revocation is durable; inheritance never reverses it.
    if (prior && !prior.enabled) continue;
    result.push(await aiWorkspaceAccountService(db).install(scope, account.id, companyId, {
      expectedRevision: account.revision, expectedLinkRevision: prior?.revision ?? null,
    }));
  }
  return result;
}

/** Registered company-owned accounts can outlive their historical creator
 * identity. Only their current registered owner can repair the canonical login. */
export function canReconnectWorkspaceAiAccount(db: Db, companyId: string, connectionId: string, userId: string) {
  return aiWorkspaceAccountService(db).canReconnect(companyId, connectionId, userId);
}
