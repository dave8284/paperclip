import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { aiWorkspaceAccounts, companies, companyMemberships, connectionGrants, connectionGrantMembers, toolConnections, type Db } from "@paperclipai/db";
import { aiConnectionMetadataSchema, type AiWorkspaceAccountSetupResult, type AiWorkspaceAccountSetupRetry,
  type FinishAiWorkspaceAccountSetup } from "@paperclipai/shared";
import { forbidden, notFound, unprocessable } from "../errors.js";
import { aiWorkspaceAccountService, type AiWorkspaceAccountScope } from "./ai-workspace-accounts.js";
import { authorizationService } from "./authorization.js";

type SetupInput = FinishAiWorkspaceAccountSetup & { userId: string };
const empty = (accountId: string | null = null): AiWorkspaceAccountSetupResult => ({
  status: "not_applicable", accountId, installedCompanyIds: [], pending: [], retry: null,
});
function pending(companyId: string | null, error: unknown): AiWorkspaceAccountSetupResult["pending"][number] {
  const status = Number((error as { status?: number } | null)?.status);
  if (status === 409) return { companyId, reason: "busy", message: "Current account work or settings changed. Retry account setup when the account is ready." };
  if (status === 403 || status === 404) return { companyId, reason: "access_changed", message: "Your account or company access changed. Review account permissions before retrying." };
  if (status === 422) return { companyId, reason: "unavailable", message: "Reconnect the original account or review its settings, then retry account setup." };
  // Never return database/provider exceptions: they may contain credential refs.
  return { companyId, reason: "setup_failed", message: "The saved account could not finish company setup. Retry account setup." };
}
function failed(companyId: string | null, error: unknown, retry: AiWorkspaceAccountSetupRetry, accountId: string | null = null): AiWorkspaceAccountSetupResult {
  return { ...empty(accountId), status: "pending", pending: [pending(companyId, error)], retry };
}
async function currentScope(db: Db, userId: string, ceiling?: readonly string[]): Promise<AiWorkspaceAccountScope> {
  const rows = await db.select({ companyId: companyMemberships.companyId }).from(companyMemberships)
    .where(and(eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"))).limit(101);
  if (rows.length > 100) throw unprocessable("Choose which companies should use this account");
  return { userId, companyIds: rows.map(row => row.companyId).filter(id => ceiling === undefined || ceiling.includes(id)) };
}
async function ownedCompanies(db: Db, scope: AiWorkspaceAccountScope) {
  const rows = await db.select({ id: companies.id }).from(companyMemberships).innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(and(eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, scope.userId),
      eq(companyMemberships.status, "active"), eq(companyMemberships.membershipRole, "owner"), eq(companies.status, "active")))
    .orderBy(asc(companies.id)).limit(101);
  if (rows.length > 100) throw unprocessable("Choose which companies should use this account");
  return rows.filter(row => scope.companyIds.includes(row.id));
}
async function sourceEligible(db: Db, input: SetupInput, registered: boolean) {
  const [row] = await db.select({ connection: toolConnections, grant: connectionGrants }).from(toolConnections)
    .innerJoin(connectionGrants, and(eq(connectionGrants.companyId, toolConnections.companyId), eq(connectionGrants.connectionId, toolConnections.id)))
    .where(and(eq(toolConnections.companyId, input.companyId), eq(toolConnections.id, input.connectionId), eq(connectionGrants.id, input.grantId)));
  if (!row) throw notFound("Connected account not found");
  const metadata = aiConnectionMetadataSchema.safeParse(row.connection.config.ai);
  return row.connection.connectionPurpose === "ai" && row.connection.config.aiWorkspaceAccount !== true
    && metadata.success && metadata.data.method === "subscription" && !metadata.data.routing
    // A Just-me login never silently becomes a company-wide account.
    && (row.grant.kind === "organization" || (registered && row.grant.kind === "user" && row.grant.subjectUserId === input.userId));
}
async function registeredAccount(db: Db, input: SetupInput) {
  const [account] = await db.select().from(aiWorkspaceAccounts).where(and(eq(aiWorkspaceAccounts.ownerUserId, input.userId),
    eq(aiWorkspaceAccounts.sourceCompanyId, input.companyId), eq(aiWorkspaceAccounts.sourceConnectionId, input.connectionId),
    eq(aiWorkspaceAccounts.sourceGrantId, input.grantId)));
  return account;
}
async function pendingOwnerConnections(db: Db, scope: AiWorkspaceAccountScope) {
  const owned = await ownedCompanies(db, scope);
  if (!owned.length) return [];
  const rows = await db.select({ companyId: toolConnections.companyId, connectionId: toolConnections.id, grantId: connectionGrants.id })
    .from(toolConnections).innerJoin(connectionGrants, and(eq(connectionGrants.companyId, toolConnections.companyId), eq(connectionGrants.connectionId, toolConnections.id)))
    .leftJoin(aiWorkspaceAccounts, eq(aiWorkspaceAccounts.sourceGrantId, connectionGrants.id))
    .where(and(inArray(toolConnections.companyId, owned.map(company => company.id)), eq(toolConnections.connectionPurpose, "ai"),
      eq(connectionGrants.kind, "organization"), eq(connectionGrants.status, "active"), eq(toolConnections.enabled, true),
      eq(toolConnections.status, "active"), eq(toolConnections.healthStatus, "ok"), isNull(aiWorkspaceAccounts.id),
      sql`${toolConnections.config}->'ai'->>'method' = 'subscription'`,
      sql`coalesce(${toolConnections.config}->>'aiWorkspaceAccount', 'false') <> 'true'`,
      sql`(not exists (select 1 from ${connectionGrantMembers} gm where gm.company_id = ${connectionGrants.companyId} and gm.grant_id = ${connectionGrants.id})
        or exists (select 1 from ${connectionGrantMembers} gm where gm.company_id = ${connectionGrants.companyId} and gm.grant_id = ${connectionGrants.id}
          and gm.subject_type = 'user' and gm.subject_id = ${scope.userId}))`)).orderBy(asc(toolConnections.id)).limit(21);
  if (rows.length > 20) throw unprocessable("Choose which connected accounts to reuse");
  const accessible = [];
  for (const row of rows) {
    const decision = await authorizationService(db).decidePrincipalGrant({ companyId: row.companyId, principalType: "user",
      principalId: scope.userId, action: "tools:manage_connections", permissionKey: "tools:manage_connections" });
    if (decision.allowed) accessible.push(row);
  }
  return accessible;
}

/** One bounded reconciliation per explicit owner action. The registry and
 * native links are durable truth; retries do not repeat login or company creation. */
export function aiWorkspaceAccountSetupService(db: Db) {
  const service = aiWorkspaceAccountService(db);
  async function reconcile(scope: AiWorkspaceAccountScope, accountId: string): Promise<AiWorkspaceAccountSetupResult> {
    const retry = { kind: "account", accountId } as const;
    let sourceCompanyId: string | null = null;
    try {
      const account = (await service.list(scope)).find(row => row.id === accountId);
      if (!account) throw notFound("Account not found");
      sourceCompanyId = account.sourceCompanyId;
      if (!account.enabled || !account.autoInstall) return empty(account.id);
      const result: AiWorkspaceAccountSetupResult = { ...empty(account.id), status: "ready" };
      for (const company of await ownedCompanies(db, scope)) {
        if (company.id === account.sourceCompanyId) continue;
        const prior = account.links.find(link => link.companyId === company.id);
        if (prior && !prior.enabled) continue;
        try {
          await service.install(scope, account.id, company.id, { expectedRevision: account.revision, expectedLinkRevision: prior?.revision ?? null });
          result.installedCompanyIds.push(company.id);
        } catch (error) { result.pending.push(pending(company.id, error)); }
      }
      if (result.pending.length) { result.status = "pending"; result.retry = retry; }
      return result;
    } catch (error) { return failed(sourceCompanyId, error, retry, accountId); }
  }
  async function finishConnection(input: SetupInput, ceiling?: readonly string[]): Promise<AiWorkspaceAccountSetupResult> {
    const retry = { kind: "connection", companyId: input.companyId, connectionId: input.connectionId, grantId: input.grantId } as const;
    try {
      const registered = await registeredAccount(db, input);
      if (!(await sourceEligible(db, input, !!registered))) return empty();
      const scope = await currentScope(db, input.userId, ceiling);
      if (registered) return await reconcile(scope, registered.id);
      // Explicit owner enrollment is required for a shared account. An ordinary
      // manager's successful company login remains a company-only connection.
      if (!(await ownedCompanies(db, scope)).some(company => company.id === input.companyId)) return empty();
      const account = await service.enroll(scope, { id: randomUUID(), sourceCompanyId: input.companyId,
        sourceConnectionId: input.connectionId, sourceGrantId: input.grantId, autoInstall: true });
      return await reconcile(scope, account.id);
    } catch (error) { return failed(input.companyId, error, retry); }
  }
  async function inherit(companyId: string, userId: string | null,
    options: { inspect?: boolean; ceiling?: readonly string[] } = {}): Promise<AiWorkspaceAccountSetupResult> {
    if (!userId) return empty();
    const retry = { kind: "company", companyId } as const;
    try {
      const scope = await currentScope(db, userId, options.ceiling);
      if (!(await ownedCompanies(db, scope)).some(company => company.id === companyId)) {
        if (options.inspect) return empty();
        throw forbidden("Company owner required");
      }
      const accounts = (await service.list(scope)).filter(account => account.enabled && account.autoInstall);
      if (accounts.length > 20) throw unprocessable("Choose which accounts this company should inherit");
      const result: AiWorkspaceAccountSetupResult = { ...empty(), status: "ready" };
      for (const account of accounts) {
        if (account.sourceCompanyId === companyId) continue;
        const prior = account.links.find(link => link.companyId === companyId);
        if (prior && !prior.enabled) continue;
        try {
          if (options.inspect) {
            if (!prior) throw new Error("Company installation pending");
            if (!account.available) throw unprocessable("Account unavailable");
          } else await service.install(scope, account.id, companyId, { expectedRevision: account.revision, expectedLinkRevision: prior?.revision ?? null });
          if (!result.installedCompanyIds.includes(companyId)) result.installedCompanyIds.push(companyId);
        } catch (error) { result.pending.push(pending(companyId, error)); }
      }
      if (result.pending.length) { result.status = "pending"; result.retry = retry; }
      // A login may have committed before enrollment failed. Its native grant
      // is the durable recovery record; inspection never creates an account.
      const unfinished = await pendingOwnerConnections(db, scope);
      if (unfinished.length) {
        result.status = "pending";
        result.pending.push(...unfinished.map(connection => pending(connection.companyId, new Error("Enrollment pending"))));
        result.retry = { kind: "connection", ...unfinished[0] };
      }
      return result;
    } catch (error) { return failed(companyId, error, retry); }
  }
  async function inspectConnection(input: SetupInput): Promise<AiWorkspaceAccountSetupResult> {
    const retry = { kind: "connection", companyId: input.companyId, connectionId: input.connectionId, grantId: input.grantId } as const;
    try {
      const registered = await registeredAccount(db, input);
      if (!(await sourceEligible(db, input, !!registered))) return empty();
      const scope = await currentScope(db, input.userId), owned = await ownedCompanies(db, scope);
      if (!registered && !owned.some(company => company.id === input.companyId)) return empty();
      const account = (await service.list(scope)).find(row => row.sourceCompanyId === input.companyId
        && row.sourceConnectionId === input.connectionId && row.sourceGrantId === input.grantId);
      if (!account) return failed(input.companyId, new Error("Enrollment pending"), retry);
      if (!account.enabled || !account.autoInstall) return empty(account.id);
      const result: AiWorkspaceAccountSetupResult = { ...empty(account.id), status: "ready" };
      for (const company of owned) {
        if (company.id === account.sourceCompanyId) continue;
        const prior = account.links.find(link => link.companyId === company.id);
        if (prior && !prior.enabled) continue;
        if (prior && account.available) result.installedCompanyIds.push(company.id);
        else result.pending.push(pending(company.id, account.available ? new Error("Installation pending") : unprocessable("Account unavailable")));
      }
      if (result.pending.length) { result.status = "pending"; result.retry = { kind: "account", accountId: account.id }; }
      return result;
    } catch (error) { return failed(input.companyId, error, retry); }
  }
  const inspectCompany = (companyId: string, userId: string, ceiling?: readonly string[]) => inherit(companyId, userId, { inspect: true, ceiling });
  return { finishConnection, reconcile, inherit, inspectConnection, inspectCompany };
}

export const finishOwnerAiAccountConnection = (db: Db, input: SetupInput) => aiWorkspaceAccountSetupService(db).finishConnection(input);
export const inspectOwnerAiAccountSetup = (db: Db, input: SetupInput) => aiWorkspaceAccountSetupService(db).inspectConnection(input);
export const inheritOwnerAiAccountsWithStatus = (db: Db, companyId: string, userId: string | null) => aiWorkspaceAccountSetupService(db).inherit(companyId, userId);
