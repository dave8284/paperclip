import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { agents, agentosPortfolios, agentosPortfolioCompanies, authUsers, companyOperatingProfiles,
  companyMemberships, instanceUserRoles, agentosPortfolioMandates, principalPermissionGrants, type Db } from "@paperclipai/db";
import { getTableColumns, getTableName } from "drizzle-orm";
import { savePortfolioReadMandateSchema, portfolioWorkQuerySchema } from "@paperclipai/shared";
import { agentosPortfolioMandateService, assertPortfolioMandateActor, assertPortfolioPrivateDelegate, matchesPortfolioMandateGrant, portfolioMandateGrantScope, portfolioSummary, PortfolioDelegatePausedError } from "../services/agentos-portfolio-mandates.js";
import { refreshWorkforceBoardActor } from "../services/agentos-workforce.js";
import { fridayAwarenessService } from "../services/friday-awareness.js";
import type { AuthorizationActor } from "../services/authorization.js";

const id = (n: number) => `${n.toString().padStart(8, "0")}-0000-4000-8000-000000000000`;
const row: typeof agentosPortfolioMandates.$inferSelect = { id: id(1), portfolioId: id(2), ownerUserId: "owner", sourceCompanyId: id(3), sourceAgentId: id(4),
  grantId: id(5), targetCompanyIds: [id(6)], action: "portfolio_work:read", readScope: "company_shared_only", revision: 3,
  expiresAt: null, revokedAt: null, createdAt: new Date(), updatedAt: new Date() };
const actor: AuthorizationActor = { type: "agent", companyId: row.sourceCompanyId, agentId: row.sourceAgentId, onBehalfOfUserId: "owner", authorizingUserId: "external", source: "agent_jwt" };
const grant: typeof principalPermissionGrants.$inferSelect = { id: row.grantId!, companyId: row.sourceCompanyId, principalType: "agent", principalId: row.sourceAgentId,
  permissionKey: "workforce:portfolio_read", scope: portfolioMandateGrantScope(row), grantedByUserId: "owner", createdAt: new Date(), updatedAt: new Date() };
afterEach(() => vi.unstubAllEnvs());

describe("explicit portfolio read contract", () => {
  it.each(["paused", "terminated", "unready", "revoked"])("retains the precise locked delegate authorization failure (%s)", async condition => {
    const mandate = { ...row, readScope: "owner_accessible_private", revokedAt: condition === "revoked" ? new Date() : null };
    const tables = [agentosPortfolioMandates, agentosPortfolios, agentosPortfolioCompanies, authUsers,
      companyOperatingProfiles, instanceUserRoles, companyMemberships, principalPermissionGrants, agents];
    const records: Record<string, Record<string, unknown>[]> = {
      [getTableName(agentosPortfolioMandates)]: [mandate],
      [getTableName(agentosPortfolios)]: [{ id: row.portfolioId, ownerUserId: row.ownerUserId, homeCompanyId: row.sourceCompanyId }],
      [getTableName(agentosPortfolioCompanies)]: [row.sourceCompanyId, id(6)].map(companyId => ({ id: companyId, companyId, portfolioId: row.portfolioId })),
      [getTableName(authUsers)]: ["owner", "external"].map(id => ({ id, approvalStatus: "approved" })),
      [getTableName(companyOperatingProfiles)]: [{ companyId: row.sourceCompanyId, fridayAgentId: row.sourceAgentId }],
      [getTableName(agents)]: [{ id: row.sourceAgentId, companyId: row.sourceCompanyId,
        status: condition === "unready" ? "idle" : condition, lifecycleState: condition === "unready" ? "pending" : "ready" }],
    };
    const queries: string[] = [];
    const db = drizzle(async query => {
      queries.push(query);
      const table = tables.find(value => query.includes(`from "${getTableName(value)}"`));
      if (!table) throw new Error("Unexpected authority query");
      return { rows: (records[getTableName(table)] ?? []).map(value => Object.keys(getTableColumns(table)).map(key => {
        const cell = value[key]; return cell instanceof Date ? cell.toISOString() : cell ?? null;
      })) };
    }) as unknown as Db;
    const failure = await agentosPortfolioMandateService(db).authorizePrivateRead(db, actor, row.sourceCompanyId,
      { mandateId: row.id, revision: row.revision, targetCompanyId: id(6) }).catch(error => error);
    expect(failure).toMatchObject({ status: 403 });
    if (condition === "paused") {
      expect(failure).toBeInstanceOf(PortfolioDelegatePausedError);
      expect(failure.details).toEqual({ code: "portfolio_delegate_paused" });
    } else expect(failure).not.toBeInstanceOf(PortfolioDelegatePausedError);
    const lockedAgentRead = queries.find(query => query.includes('from "agents"'));
    if (condition === "revoked") expect(lockedAgentRead).toBeUndefined();
    else expect(lockedAgentRead).toMatch(/for share nowait$/);
  });

  it("requires explicit supported scope, action, expiry and bounded query pagination", () => {
    const input = { id: id(1), expectedRevision: 0, sourceCompanyId: id(3), sourceAgentId: id(4), targetCompanyIds: [id(6)],
      action: "portfolio_work:read", readScope: "company_shared_only", expiresAt: null };
    expect(savePortfolioReadMandateSchema.safeParse(input).success).toBe(true);
    expect(savePortfolioReadMandateSchema.safeParse({ ...input, readScope: "owner_accessible_private" }).success).toBe(true);
    for (const key of ["readScope", "action", "expiresAt"]) {
      const missing = { ...input }; delete missing[key as keyof typeof missing];
      expect(savePortfolioReadMandateSchema.safeParse(missing).success).toBe(false);
    }
    expect(savePortfolioReadMandateSchema.safeParse({ ...input, readScope: "all_owner_accessible" }).success).toBe(false);
    expect(savePortfolioReadMandateSchema.safeParse({ ...input, targetCompanyIds: [id(6), id(6)] }).success).toBe(false);
    expect(portfolioWorkQuerySchema.safeParse({ mandateId: id(1), targetCompanyId: id(6), revision: 3, limit: 101 }).success).toBe(false);
  });
  it("never substitutes board, another employee, company or responsible owner", () => {
    expect(() => assertPortfolioMandateActor(row, actor, id(6), 3)).not.toThrow();
    for (const patch of [{ type: "board" as const, userId: "owner" }, { agentId: id(9) }, { companyId: id(9) }, { onBehalfOfUserId: "other" }, { keyScope: { kind: "task" } }]) {
      expect(() => assertPortfolioMandateActor(row, { ...actor, ...patch } as AuthorizationActor, id(6), 3)).toThrow();
    }
    expect(() => assertPortfolioMandateActor(row, actor, id(9), 3)).toThrow();
    expect(() => assertPortfolioMandateActor(row, actor, id(6), 2)).toThrow();
    expect(() => assertPortfolioMandateActor({ ...row, revokedAt: new Date() }, actor, id(6), 3)).toThrow();
    expect(() => assertPortfolioMandateActor({ ...row, expiresAt: new Date(0) }, actor, id(6), 3)).toThrow();
  });
  it("requires the exact native grant, owner, action, revision, target list and expiry", () => {
    expect(matchesPortfolioMandateGrant(row, grant)).toBe(true);
    expect(matchesPortfolioMandateGrant(row, undefined)).toBe(false);
    for (const patch of [{ id: id(8) }, { principalId: id(8) }, { companyId: id(8) }, { principalType: "user" }, { grantedByUserId: "other" },
      { scope: null }, { scope: { ...grant.scope, extra: true } }, { scope: { ...grant.scope, revision: 2 } },
      { scope: { ...grant.scope, targetCompanyIds: [id(6), id(8)] } }, { scope: { ...grant.scope, action: "execute" } }, { scope: { ...grant.scope, expiresAt: new Date().toISOString() } }]) {
      expect(matchesPortfolioMandateGrant(row, { ...grant, ...patch })).toBe(false);
    }
  });
  it("uses strict native privacy and both user ceilings before counts while skipping evidence queries", async () => {
    vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "off");
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const db = drizzle(async (text, params) => { calls.push({ text, params }); return { rows: text.includes('count(*)::int') && !text.includes('group by') ? [[0]] : [] }; }) as unknown as Db;
    const work = await fridayAwarenessService(db).work(id(6), actor, { offset: 0, projectOffset: 0, limit: 25, status: "all" }, { portfolioReadScope: "company_shared_only" });
    expect(calls).toHaveLength(4);
    for (const call of calls.filter(call => call.text.includes('from "issues"'))) {
      expect(call.text).toContain("privacy_ancestors");
      expect(call.text).toContain("where false or false or false");
      expect(call.text).toContain('"issues"."conversation_agent_id" is null');
      expect(call.params).toEqual(expect.arrayContaining([row.sourceAgentId, "owner", "external", id(6)]));
    }
    expect(calls.some(call => /issue_comments|issue_work_products|case_handoffs|adapter_config/.test(call.text))).toBe(false);
    const result = portfolioSummary(row, id(6), { ...work, evidence: [{ id: "secret", title: "private evidence", kind: "comment", agentId: null, taskId: "task", createdAt: new Date() }] });
    expect(result).not.toHaveProperty("evidence"); expect(result).not.toHaveProperty("assignments"); expect(result).not.toHaveProperty("accountability");
    expect(result).toMatchObject({ mandateId: row.id, revision: 3, targetCompanyId: id(6), tasks: [], counts: {} });
  });
  it("requires explicit private scope and the current Friday identity, without upgrading old grants", () => {
    const privateRow = { ...row, readScope: "owner_accessible_private" };
    expect(() => assertPortfolioMandateActor(privateRow, actor, id(6), 3)).not.toThrow();
    expect(matchesPortfolioMandateGrant(privateRow, grant)).toBe(false);
    expect(matchesPortfolioMandateGrant(privateRow, { ...grant, scope: portfolioMandateGrantScope(privateRow) })).toBe(true);
    expect(() => assertPortfolioPrivateDelegate(privateRow, row.sourceAgentId)).not.toThrow();
    expect(() => assertPortfolioPrivateDelegate(privateRow, "replacement-friday")).toThrow("currently designated Friday");
    expect(() => assertPortfolioPrivateDelegate(privateRow, null)).toThrow();
    expect(() => assertPortfolioPrivateDelegate(row, null)).not.toThrow();
    expect(() => assertPortfolioMandateActor({ ...row, readScope: "unknown" }, actor, id(6), 3)).toThrow();
  });
  it("projects private summaries through current owner rights and the external user ceiling before counts", async () => {
    vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "off");
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const db = drizzle(async (text, params) => { calls.push({ text, params }); return { rows: text.includes('count(*)::int') && !text.includes('group by') ? [[0]] : [] }; }) as unknown as Db;
    const work = await fridayAwarenessService(db).work(id(6), actor, { offset: 0, projectOffset: 0, limit: 25, status: "all" }, { portfolioReadScope: "owner_accessible_private" });
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.text).toContain('instance_user_roles');
      expect(call.text).toContain("r.role = 'instance_admin'");
      expect(call.params).toEqual(expect.arrayContaining(["owner", "external", id(6)]));
      expect(call.params).not.toContain(row.sourceAgentId);
    }
    for (const call of calls.filter(call => call.text.includes('from "issues"'))) {
      expect(call.text).toContain("privacy_ancestors");
      expect(call.text).toContain('"issues"."conversation_agent_id" is null');
      expect(call.text).not.toContain("where false or false or false");
    }
    expect(calls.some(call => /issue_comments|issue_work_products|case_handoffs|adapter_config/.test(call.text))).toBe(false);
    expect(portfolioSummary({ ...row, readScope: "owner_accessible_private" }, id(6), work)).toMatchObject({ readScope: "owner_accessible_private" });
  });
});

describe("workforce authority refresh after a wait", () => {
  function database(approvalStatus: string | null, admin: boolean) {
    const calls: string[] = [];
    const db = drizzle(async text => { calls.push(text); return { rows: text.includes('from "user"') ? approvalStatus ? [[approvalStatus]] : [] : admin ? [["role"]] : [] }; }) as unknown as Db;
    return { db, calls };
  }
  it("denies a user suspended after authentication and removes revoked admin elevation", async () => {
    const stale: AuthorizationActor = { type: "board", source: "session", userId: "owner", isInstanceAdmin: true };
    await expect(refreshWorkforceBoardActor(database("suspended", true).db, stale)).rejects.toThrow("approved portfolio owner");
    await expect(refreshWorkforceBoardActor(database(null, true).db, stale)).rejects.toThrow("approved portfolio owner");
    expect(await refreshWorkforceBoardActor(database("approved", false).db, stale)).toMatchObject({ isInstanceAdmin: false, userId: "owner" });
    expect(await refreshWorkforceBoardActor(database("approved", true).db, { ...stale, isInstanceAdmin: false })).toMatchObject({ isInstanceAdmin: true });
  });
  it("preserves attested cloud elevation and local implicit semantics without database role elevation", async () => {
    const { db, calls } = database("approved", false);
    expect(await refreshWorkforceBoardActor(db, { type: "board", source: "cloud_tenant", userId: "owner", isInstanceAdmin: true })).toMatchObject({ isInstanceAdmin: true });
    expect(calls).toHaveLength(1);
    const local: AuthorizationActor = { type: "board", source: "local_implicit" };
    expect(await refreshWorkforceBoardActor(db, local)).toBe(local); expect(calls).toHaveLength(1);
  });
});
