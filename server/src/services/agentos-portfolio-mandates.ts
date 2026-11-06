import { and, eq, inArray } from "drizzle-orm";
import { agents, authUsers, companyMemberships, principalPermissionGrants, agentosPortfolios,
  agentosPortfolioCompanies, agentosPortfolioMandates, type Db } from "@paperclipai/db";
import type { PortfolioReadMandate, SavePortfolioReadMandate, PortfolioWorkQuery, PortfolioWorkSummary } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { agentosWorkforceService, refreshWorkforceBoardActor } from "./agentos-workforce.js";
import { fridayAwarenessService } from "./friday-awareness.js";
import { persistActivity, type ActivityPublication, type LogActivityInput } from "./activity-log.js";
import { publishAccountingActivities } from "./accounting-transaction.js";

type Mandate = typeof agentosPortfolioMandates.$inferSelect;
type Grant = typeof principalPermissionGrants.$inferSelect;
type Who = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;
export const PORTFOLIO_READ_PERMISSION = "workforce:portfolio_read" as const;
const sorted = (ids: string[]) => [...ids].sort();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function portfolioMandateGrantScope(row: Pick<Mandate, "id" | "portfolioId" | "revision" | "sourceCompanyId" | "sourceAgentId" | "targetCompanyIds" | "action" | "readScope" | "expiresAt">) {
  return { mandateId: row.id, portfolioId: row.portfolioId, revision: row.revision,
    sourceCompanyId: row.sourceCompanyId, sourceAgentId: row.sourceAgentId, targetCompanyIds: sorted(row.targetCompanyIds),
    action: row.action, readScope: row.readScope, expiresAt: row.expiresAt?.toISOString() ?? null };
}
export function matchesPortfolioMandateGrant(row: Mandate, grant: Grant | undefined) {
  if (!grant || grant.id !== row.grantId || grant.companyId !== row.sourceCompanyId || grant.principalType !== "agent"
    || grant.principalId !== row.sourceAgentId || grant.permissionKey !== PORTFOLIO_READ_PERMISSION || grant.grantedByUserId !== row.ownerUserId) return false;
  const expected = portfolioMandateGrantScope(row);
  // Unknown fields and widened scopes are not silently accepted.
  return grant.scope !== null && same(Object.keys(grant.scope).sort(), Object.keys(expected).sort())
    && Object.entries(expected).every(([key, value]) => same(grant.scope![key], value));
}
export function assertPortfolioMandateActor(row: Mandate, actor: AuthorizationActor, targetCompanyId: string, revision: number, now = new Date()) {
  if (actor.type !== "agent" || actor.agentId !== row.sourceAgentId || actor.companyId !== row.sourceCompanyId
    || (actor.keyScope && actor.keyScope.kind !== "standard") || actor.onBehalfOfUserId !== row.ownerUserId
    || row.revokedAt || (row.expiresAt && row.expiresAt <= now) || row.revision !== revision
    || row.action !== "portfolio_work:read" || row.readScope !== "company_shared_only" || !row.targetCompanyIds.includes(targetCompanyId)) {
    throw forbidden("A current, explicit portfolio read mandate is required for this agent, owner and company");
  }
}
function projection(row: Mandate): PortfolioReadMandate {
  return { id: row.id, portfolioId: row.portfolioId, revision: row.revision, sourceCompanyId: row.sourceCompanyId,
    sourceAgentId: row.sourceAgentId, targetCompanyIds: row.targetCompanyIds, action: "portfolio_work:read", readScope: "company_shared_only",
    expiresAt: row.expiresAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
}
export function portfolioSummary(row: Mandate, targetCompanyId: string, work: Awaited<ReturnType<ReturnType<typeof fridayAwarenessService>["work"]>>): PortfolioWorkSummary {
  return { mandateId: row.id, revision: row.revision, sourceCompanyId: row.sourceCompanyId, targetCompanyId,
    readScope: "company_shared_only", observedAt: work.observedAt, projectCount: work.projectCount, nextProjectOffset: work.nextProjectOffset,
    projects: work.projects.map(({ id, name, status }) => ({ id, name, status })),
    tasks: work.tasks.map(({ id, identifier, title, status, priority, projectId, updatedAt }) => ({ id, identifier, title, status, priority, projectId, updatedAt })),
    counts: work.counts, nextOffset: work.nextOffset };
}

export function agentosPortfolioMandateService(db: Db) {
  const workforce = agentosWorkforceService(db);
  // All checks below run after lock acquisition. Existing membership/grant/account
  // revocations cannot commit halfway through the authorized projection.
  async function lockAuthority(tx: Db, row: Pick<Mandate, "portfolioId" | "sourceAgentId" | "sourceCompanyId" | "ownerUserId">,
    companyIds: string[], authorizingUserId?: string | null) {
    const noWait = { noWait: true } as const;
    const [portfolio] = await tx.select().from(agentosPortfolios).where(eq(agentosPortfolios.id, row.portfolioId)).for("share", noWait);
    if (!portfolio || portfolio.ownerUserId !== row.ownerUserId) throw forbidden("Portfolio owner changed");
    const allCompanyIds = sorted([...new Set([...companyIds, row.sourceCompanyId, portfolio.homeCompanyId])]);
    const links = await tx.select().from(agentosPortfolioCompanies).where(and(eq(agentosPortfolioCompanies.portfolioId, row.portfolioId), inArray(agentosPortfolioCompanies.companyId, allCompanyIds)))
      .orderBy(agentosPortfolioCompanies.id).for("share", noWait);
    if (links.length !== allCompanyIds.length) throw forbidden("All selected companies must currently belong to this portfolio");
    const userIds = sorted([...new Set([row.ownerUserId, ...(authorizingUserId ? [authorizingUserId] : [])])]);
    const users = await tx.select().from(authUsers).where(inArray(authUsers.id, userIds)).orderBy(authUsers.id).for("share", noWait);
    if (users.length !== userIds.length || users.some(user => user.approvalStatus !== "approved")) throw forbidden("A portfolio authority account is unavailable");
    await tx.select().from(companyMemberships).where(and(inArray(companyMemberships.companyId, allCompanyIds),
      inArray(companyMemberships.principalId, [...userIds, row.sourceAgentId]))).orderBy(companyMemberships.id).for("share", noWait);
    await tx.select().from(principalPermissionGrants).where(and(inArray(principalPermissionGrants.companyId, allCompanyIds),
      inArray(principalPermissionGrants.principalId, [...userIds, row.sourceAgentId]))).orderBy(principalPermissionGrants.id).for("share", noWait);
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, row.sourceCompanyId), eq(agents.id, row.sourceAgentId))).for("share", noWait);
    if (!agent || !["active", "idle", "running", "error"].includes(agent.status) || agent.lifecycleState !== "ready") throw forbidden("The delegated agent is unavailable");
    const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, row.sourceCompanyId),
      eq(companyMemberships.principalType, "agent"), eq(companyMemberships.principalId, row.sourceAgentId), eq(companyMemberships.status, "active")));
    if (!member) throw forbidden("The delegated agent must already be an active member of its source company");
    return allCompanyIds;
  }
  async function assertOwnerAuthority(tx: Db, ownerUserId: string, companyIds: string[]) {
    for (const companyId of companyIds) {
      const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, ownerUserId), eq(companyMemberships.status, "active")));
      const decision = await authorizationService(tx).decidePrincipalGrant({ companyId, principalType: "user", principalId: ownerUserId,
        action: "users:manage_permissions", permissionKey: "users:manage_permissions" });
      if (!member || member.membershipRole === "viewer" || !decision.allowed) throw forbidden("The current owner needs native permission-management authority in every selected company");
    }
  }
  async function audit(tx: Db, publications: ActivityPublication[], who: Who, row: Mandate, action: string, details: Record<string, unknown> = {}) {
    const result = await persistActivity(tx, { ...who, companyId: row.sourceCompanyId, action, entityType: "agentos_portfolio_mandate", entityId: row.id,
      details: { portfolioId: row.portfolioId, revision: row.revision, sourceAgentId: row.sourceAgentId, readScope: row.readScope, ...details } });
    publications.push(result.publication);
  }
  async function requireRead(tx: Db, row: Mandate, actor: AuthorizationActor, targetCompanyId: string, revision: number) {
    assertPortfolioMandateActor(row, actor, targetCompanyId, revision);
    const companyIds = await lockAuthority(tx, row, [targetCompanyId], actor.authorizingUserId);
    await assertOwnerAuthority(tx, row.ownerUserId, companyIds);
    const [grant] = await tx.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.id, row.grantId ?? "00000000-0000-0000-0000-000000000000"));
    if (!matchesPortfolioMandateGrant(row, grant)) throw forbidden("The native portfolio read grant was removed or changed");
    // Native source-company trust/key restrictions still apply. No foreign
    // company or synthetic board actor replaces the original runtime actor.
    const current: AuthorizationActor = { ...actor, memberships: undefined, onBehalfOfMemberships: undefined };
    Reflect.deleteProperty(current, "__responsibleUserSnapshotMemo");
    const [source] = await authorizationService(tx).decideReads(current, [{ type: "company", companyId: row.sourceCompanyId }]);
    if (!source?.allowed) throw forbidden("Native source-company read authority is unavailable");
    if (actor.authorizingUserId) {
      // This is a separate ceiling check, not the principal for the read.
      const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, targetCompanyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.authorizingUserId), eq(companyMemberships.status, "active")));
      if (!member) throw forbidden("The external authorizer cannot read this target company");
      const [ceiling] = await authorizationService(tx).decideReads({ type: "board", source: "session", userId: actor.authorizingUserId,
        companyIds: [targetCompanyId], memberships: [member], isInstanceAdmin: false, ignoreInstanceAdmin: true }, [{ type: "company", companyId: targetCompanyId }]);
      if (!ceiling?.allowed) throw forbidden("The external authorizer cannot read this target company");
    }
    assertPortfolioMandateActor(row, actor, targetCompanyId, revision); // expiry after lock wait
    return current;
  }
  function changing(error: unknown): never {
    const value = error as { code?: string; cause?: { code?: string } };
    if ((value.cause?.code ?? value.code) === "55P03") throw conflict("Portfolio authority is changing. Retry the request.", { retryable: true });
    throw error;
  }
  return {
    async list(actor: AuthorizationActor, portfolioId: string): Promise<PortfolioReadMandate[]> {
      const overview = await workforce.read(actor, portfolioId);
      const current = await refreshWorkforceBoardActor(db, actor);
      const rows = await db.select().from(agentosPortfolioMandates).where(eq(agentosPortfolioMandates.portfolioId, portfolioId)).orderBy(agentosPortfolioMandates.createdAt);
      const result: PortfolioReadMandate[] = [];
      for (const row of rows) {
        let sourceAgentName: string | null = null;
        if (overview.companies.some(company => company.id === row.sourceCompanyId)) {
          const allowed = await authorizationService(db).decide({ actor: current, action: "agent:read", resource: { type: "agent", companyId: row.sourceCompanyId, agentId: row.sourceAgentId } });
          if (allowed?.allowed) {
            const [agent] = await db.select({ name: agents.name }).from(agents).where(and(eq(agents.companyId, row.sourceCompanyId), eq(agents.id, row.sourceAgentId)));
            sourceAgentName = agent?.name ?? null;
          }
        }
        result.push({ ...projection(row), sourceAgentName });
      }
      return result;
    },
    async save(actor: AuthorizationActor, who: Who, portfolioId: string, input: SavePortfolioReadMandate) {
      return workforce.mutateCapabilities(actor, portfolioId, input.sourceCompanyId, input.sourceAgentId, async (tx, publications, portfolio) => {
        const [existing] = await tx.select().from(agentosPortfolioMandates).where(eq(agentosPortfolioMandates.id, input.id)).for("update");
        const [delegate] = await tx.select({ id: agentosPortfolioMandates.id }).from(agentosPortfolioMandates).where(eq(agentosPortfolioMandates.sourceAgentId, input.sourceAgentId));
        if (delegate && delegate.id !== input.id) throw conflict("This agent already has a portfolio read mandate. Edit or explicitly grant that mandate again.");
        if (existing && (existing.portfolioId !== portfolioId || existing.sourceCompanyId !== input.sourceCompanyId || existing.sourceAgentId !== input.sourceAgentId)) throw conflict("A mandate's delegate cannot be changed. Revoke it and create a separate mandate.");
        const { expectedRevision: _, ...intent } = input;
        const row = { ...intent, portfolioId, ownerUserId: portfolio.ownerUserId, targetCompanyIds: sorted(input.targetCompanyIds),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, revokedAt: null, revision: input.expectedRevision + 1 };
        const companyIds = await lockAuthority(tx, row, row.targetCompanyIds);
        if (actor.source !== "local_implicit" && companyIds.some(id => !actor.companyIds?.includes(id))) throw forbidden("The current session does not admit every selected company");
        await assertOwnerAuthority(tx, portfolio.ownerUserId, companyIds);
        const [grant] = await tx.select().from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, row.sourceCompanyId),
          eq(principalPermissionGrants.principalType, "agent"), eq(principalPermissionGrants.principalId, row.sourceAgentId), eq(principalPermissionGrants.permissionKey, PORTFOLIO_READ_PERMISSION))).for("update", { noWait: true });
        if (existing && existing.revision === row.revision && !existing.revokedAt && same(portfolioMandateGrantScope(existing), portfolioMandateGrantScope(row)) && matchesPortfolioMandateGrant(existing, grant)) return projection(existing);
        if ((existing?.revision ?? 0) !== input.expectedRevision) throw conflict("Mandate changed. Refresh before saving.");
        if (row.expiresAt && row.expiresAt <= new Date()) throw conflict("Choose an expiry in the future");
        if (grant && (!existing || grant.id !== existing.grantId || (!existing.revokedAt && !matchesPortfolioMandateGrant(existing, grant)))) throw conflict("The native grant was changed separately. Revoke that grant before explicitly granting a new mandate.");
        const [native] = grant ? await tx.update(principalPermissionGrants).set({ scope: portfolioMandateGrantScope(row), grantedByUserId: portfolio.ownerUserId, updatedAt: new Date() }).where(eq(principalPermissionGrants.id, grant.id)).returning()
          : await tx.insert(principalPermissionGrants).values({ companyId: row.sourceCompanyId, principalType: "agent", principalId: row.sourceAgentId,
            permissionKey: PORTFOLIO_READ_PERMISSION, scope: portfolioMandateGrantScope(row), grantedByUserId: portfolio.ownerUserId }).returning();
        const values = { ...row, grantId: native.id, updatedAt: new Date() };
        const [saved] = existing ? await tx.update(agentosPortfolioMandates).set(values).where(eq(agentosPortfolioMandates.id, row.id)).returning()
          : await tx.insert(agentosPortfolioMandates).values(values).returning();
        await audit(tx, publications, who, saved, "agentos.portfolio_mandate_saved", { targetCompanyIds: row.targetCompanyIds, expiresAt: input.expiresAt, action: row.action });
        return projection(saved);
      }).catch(changing);
    },
    async revoke(actor: AuthorizationActor, who: Who, portfolioId: string, mandateId: string, expectedRevision: number) {
      await workforce.read(actor, portfolioId);
      const [known] = await db.select().from(agentosPortfolioMandates).where(and(eq(agentosPortfolioMandates.id, mandateId), eq(agentosPortfolioMandates.portfolioId, portfolioId)));
      if (!known) throw notFound("Mandate not found");
      return workforce.mutateCapabilities(actor, portfolioId, known.sourceCompanyId, known.sourceAgentId, async (tx, publications) => {
        const [row] = await tx.select().from(agentosPortfolioMandates).where(eq(agentosPortfolioMandates.id, known.id)).for("update");
        if (row.revokedAt && row.revision === expectedRevision + 1) return projection(row);
        if (row.revision !== expectedRevision) throw conflict("Mandate changed. Refresh before revoking.");
        const [grant] = await tx.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.id, row.grantId ?? "00000000-0000-0000-0000-000000000000")).for("update", { noWait: true });
        if (matchesPortfolioMandateGrant(row, grant)) await tx.delete(principalPermissionGrants).where(eq(principalPermissionGrants.id, grant!.id));
        const [revoked] = await tx.update(agentosPortfolioMandates).set({ revokedAt: new Date(), revision: row.revision + 1, grantId: null, updatedAt: new Date() }).where(eq(agentosPortfolioMandates.id, row.id)).returning();
        await audit(tx, publications, who, revoked, "agentos.portfolio_mandate_revoked");
        return projection(revoked);
      }).catch(changing);
    },
    async discover(actor: AuthorizationActor, sourceCompanyId: string) {
      if (actor.type !== "agent" || actor.companyId !== sourceCompanyId || !actor.agentId) throw forbidden("Portfolio mandate discovery requires the actual source agent");
      return db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const [row] = await tx.select().from(agentosPortfolioMandates).where(and(eq(agentosPortfolioMandates.sourceCompanyId, sourceCompanyId), eq(agentosPortfolioMandates.sourceAgentId, actor.agentId!))).for("share", { noWait: true });
        if (!row) return [];
        const targets: string[] = [];
        for (const target of row.targetCompanyIds) {
          try { await requireRead(tx, row, actor, target, row.revision); targets.push(target); }
          catch (error) { if ((error as { status?: number }).status !== 403) throw error; }
        }
        return targets.length ? [{ ...projection(row), targetCompanyIds: targets }] : [];
      }).catch(changing);
    },
    async read(actor: AuthorizationActor, who: Who, sourceCompanyId: string, query: PortfolioWorkQuery) {
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db;
        const [row] = await tx.select().from(agentosPortfolioMandates).where(and(eq(agentosPortfolioMandates.id, query.mandateId), eq(agentosPortfolioMandates.sourceCompanyId, sourceCompanyId))).for("share", { noWait: true });
        if (!row) throw notFound("Mandate not found");
        const current = await requireRead(tx, row, actor, query.targetCompanyId, query.revision);
        const work = await fridayAwarenessService(tx).work(query.targetCompanyId, current,
          { offset: query.offset, projectOffset: query.projectOffset, limit: query.limit, status: "all" }, { companySharedSummary: true });
        assertPortfolioMandateActor(row, actor, query.targetCompanyId, query.revision);
        await audit(tx, publications, who, row, "agentos.portfolio_work_read", { targetCompanyId: query.targetCompanyId, offset: query.offset, projectOffset: query.projectOffset });
        return portfolioSummary(row, query.targetCompanyId, work);
      }).catch(changing);
      publishAccountingActivities(sourceCompanyId, publications);
      return result;
    },
  };
}
