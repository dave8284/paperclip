import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import { agentosPortfolios, instanceUserRoles, type Db } from "@paperclipai/db";

const hooks = vi.hoisted(() => ({ grants: vi.fn(), routine: vi.fn(), persist: vi.fn(), publish: vi.fn() }));
vi.mock("../services/principal-access-compatibility.js", () => ({ ensureHumanRoleDefaultGrants: hooks.grants }));
vi.mock("../services/routines.js", () => ({ routineService: () => ({ claimLocalBoardResponsibility: hooks.routine }) }));
vi.mock("../services/activity-log.js", () => ({ persistActivity: hooks.persist, publishActivity: hooks.publish }));
import { provisionConfiguredGoogleOwner } from "../services/configured-google-owner.js";
import { getBoardClaimWarningUrl, initializeBoardClaimChallenge, inspectBoardClaimChallenge } from "../board-claim.js";

const userId = "google-owner", identity = { email: "owner@example.test", subject: "google-subject-1" };
type State = { status: string; revision: number; verified: boolean; email: string; account: boolean; admins: string[]; events: string[];
  nativeClaimActor: string; memberships: Array<{ companyId: string; userId: string; status: string; role: string }>; collision: boolean; busyMembership: "claimant" | "local-board" | null };
// Real Drizzle SQL plus a controlled transaction executor and result rows. This
// checks the service's boundary/order/error propagation, not PostgreSQL locking.
function database(input: Partial<State> = {}, failAudit = false) {
  let state: State = { status: "pending", revision: 1, verified: true, email: identity.email, account: true, admins: [], events: [],
    nativeClaimActor: userId, memberships: [], collision: false, busyMembership: null, ...input };
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const role = () => Object.keys(getTableColumns(instanceUserRoles)).map(key => ({ id: "role-1", userId, role: "instance_admin", createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" }[key] ?? null));
  const db = drizzle(async (text, params) => {
    statements.push({ text, params });
    if (text.startsWith("lock table")) return { rows: [] };
    if (text.includes('from "user"')) return { rows: text.includes('"email"') ? [[userId, state.email, state.verified, state.status, state.revision]] : state.status === "approved" ? [[userId]] : [] };
    if (text.includes('from "account"')) return { rows: state.account && params.slice(0, 4).join("|") === [userId, "google", "https://accounts.google.com", identity.subject].join("|") ? [["account-1"]] : [] };
    if (text.includes('from "agentos_admin_events"')) {
      const action = params.find(value => typeof value === "string" && value.startsWith("user.")) as string;
      const selfClaim = action !== "user.local_board_claimed" || state.nativeClaimActor === userId;
      return { rows: state.events.includes(action) && selfClaim ? [["event-1"]] : [] };
    }
    if (text.startsWith("select ") && text.includes('from "instance_user_roles"')) {
      if (params.includes(userId)) return { rows: state.admins.includes(userId) ? [text.includes('"created_at"') ? role() : ["role-1"]] : [] };
      return { rows: state.admins.map(id => [id]) };
    }
    if (text.startsWith('insert into "instance_user_roles"')) { state.admins.push(userId); return { rows: [role()] }; }
    if (text.startsWith('delete from "instance_user_roles"')) { state.admins = state.admins.filter(id => id !== "local-board"); return { rows: [] }; }
    if (text.startsWith('update "user"')) { state.status = "approved"; state.revision++; return { rows: [] }; }
    if (text.startsWith('insert into "agentos_admin_events"')) {
      const action = params.find(value => typeof value === "string" && value.startsWith("user.")) as string;
      if (failAudit && action === "user.google_owner_provisioned") throw new Error("audit unavailable");
      state.events.push(action); return { rows: [] };
    }
    if (text.includes('from "companies"')) return { rows: [["company-1"]] };
    if (text.includes('from "company_memberships"')) {
      if (text.includes("for update nowait") && ((state.busyMembership === "claimant" && params.includes(userId))
        || (state.busyMembership === "local-board" && params.includes("local-board")))) throw { code: "55P03" };
      return { rows: text.includes('select "company_id"')
        ? state.memberships.filter(row => row.userId === userId && row.status === "active" && row.role === "owner").map(row => [row.companyId]) : [] };
    }
    if (text.startsWith('update "agentos_portfolios"')) return { rows: [Object.keys(getTableColumns(agentosPortfolios)).map(key => ({ id: "portfolio-1", homeCompanyId: "company-1", ownerUserId: userId, name: "Retained", revision: 2, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" }[key] ?? null))] };
    if (text.startsWith('update "issues" set "conversation_user_id"') && state.collision) throw { code: "23505", constraint: "issues_conversation_identity_idx" };
    if (/^(update "(companies|company_memberships|issues)"|insert into "company_memberships")/.test(text)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  }) as unknown as Db;
  const transaction = vi.fn(async (callback: (tx: Db) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    try { return await callback(db); } catch (error) { state = snapshot; throw error; }
  });
  Object.defineProperty(db, "transaction", { value: transaction });
  return { db, statements, transaction, state: () => structuredClone(state) };
}
beforeEach(() => {
  vi.clearAllMocks(); hooks.grants.mockResolvedValue(1); hooks.routine.mockResolvedValue(undefined);
  hooks.persist.mockResolvedValue({ publication: { id: "publication-1" } });
});

describe("configured Google owner native provisioning", () => {
  it("approves and grants a pending verified owner atomically and audits exactly once", async () => {
    const fixture = database();
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toEqual({ status: "provisioned", transferredLocalBoard: false });
    expect(fixture.state()).toMatchObject({ status: "approved", revision: 2, admins: [userId], events: ["user.google_owner_provisioned"] });
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toEqual({ status: "already_provisioned" });
    expect(fixture.state().events).toHaveLength(1);
    expect(fixture.statements[0].text).toContain('lock table "instance_user_roles"');
    expect(fixture.statements[1].text).toContain("for update");
    expect(fixture.statements[2].text).toContain("for update");
  });
  it.each([
    ["unverified email", { verified: false }], ["wrong email", { email: "other@example.test" }], ["missing Google binding", { account: false }],
  ])("rejects %s without role or audit mutations", async (_name, input) => {
    const fixture = database(input);
    await expect(provisionConfiguredGoogleOwner(fixture.db, userId, identity)).rejects.toThrow("does not match");
    expect(fixture.state().admins).toEqual([]); expect(fixture.state().events).toEqual([]);
    expect(fixture.statements.some(row => /^(update|insert|delete)/.test(row.text))).toBe(false);
  });
  it.each(["suspended", "rejected"])("preserves later %s account restrictions", async (status) => {
    const fixture = database({ status });
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toEqual({ status: "restricted" });
    expect(fixture.state()).toMatchObject({ status, admins: [], events: [] });
  });
  it("does not restore a deliberately demoted owner on another Google sign-in", async () => {
    const fixture = database({ status: "approved", events: ["user.google_owner_provisioned"] });
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toEqual({ status: "already_provisioned" });
    expect(fixture.state().admins).toEqual([]);
  });
  it("reuses native local-board transfer and marks the claim only after all grants/audit commit", async () => {
    const fixture = database({ admins: ["local-board"] });
    await initializeBoardClaimChallenge(fixture.db, { deploymentMode: "authenticated" });
    const claim = new URL(getBoardClaimWarningUrl("127.0.0.1", 3100)!);
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toEqual({ status: "provisioned", transferredLocalBoard: true });
    expect(fixture.state()).toMatchObject({ admins: [userId], events: ["user.local_board_claimed", "user.google_owner_provisioned"] });
    expect(hooks.routine).toHaveBeenCalledExactlyOnceWith(fixture.db, "company-1", userId);
    expect(hooks.grants).toHaveBeenCalledExactlyOnceWith(fixture.db, expect.objectContaining({ companyId: "company-1", principalId: userId, membershipRole: "owner" }));
    expect(hooks.publish).toHaveBeenCalledOnce();
    expect(inspectBoardClaimChallenge(claim.pathname.split("/").pop()!, claim.searchParams.get("code")!)).toMatchObject({ status: "claimed", claimedByUserId: userId });
    const conversations = fixture.statements.find(row => row.text.startsWith('update "issues" set "conversation_user_id"'))!;
    expect(conversations.params).toEqual([userId, "local-board", "company-1"]);
  });
  it.each(["grants", "audit"])("propagates a %s failure without committing owner/claim or publishing activity", async (failure) => {
    const fixture = database({ admins: ["local-board"] }, failure === "audit");
    if (failure === "grants") hooks.grants.mockRejectedValueOnce(new Error("grants unavailable"));
    await initializeBoardClaimChallenge(fixture.db, { deploymentMode: "authenticated" });
    const claim = new URL(getBoardClaimWarningUrl("127.0.0.1", 3100)!);
    const attempt = provisionConfiguredGoogleOwner(fixture.db, userId, identity);
    if (failure === "audit") await expect(attempt).rejects.toMatchObject({ cause: { message: "audit unavailable" } });
    else await expect(attempt).rejects.toThrow("grants unavailable");
    expect(fixture.state()).toMatchObject({ status: "pending", admins: ["local-board"], events: [] });
    expect(hooks.publish).not.toHaveBeenCalled();
    expect(inspectBoardClaimChallenge(claim.pathname.split("/").pop()!, claim.searchParams.get("code")!)).toMatchObject({ status: "available", claimedByUserId: null });
  });
  it("completes a proved older native claim only inside locked current owner companies, without restoring access", async () => {
    const fixture = database({ status: "approved", admins: [userId], events: ["user.local_board_claimed"], memberships: [
      { companyId: "owned-company", userId, status: "active", role: "owner" },
      { companyId: "revoked-company", userId, status: "archived", role: "owner" },
      { companyId: "member-company", userId, status: "active", role: "member" },
      { companyId: "another-owner-company", userId: "another-user", status: "active", role: "owner" },
    ] });
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toMatchObject({ status: "provisioned", completedLegacyClaim: true, transferredLocalBoard: false });
    const membershipRead = fixture.statements.find(row => row.text.includes('select "company_id" from "company_memberships"'))!;
    expect(membershipRead.text).toContain('"principal_type" = $1');
    expect(membershipRead.text).toContain('"principal_id" = $2');
    expect(membershipRead.text).toContain('"status" = $3');
    expect(membershipRead.text).toContain('"membership_role" = $4');
    expect(membershipRead.text).toContain('order by "company_memberships"."company_id", "company_memberships"."id" for update nowait');
    expect(membershipRead.params).toEqual(["user", userId, "active", "owner"]);
    const bootstrapLock = fixture.statements.find(row => row.text.includes('from "company_memberships"') && row.params.includes("local-board"))!;
    expect(bootstrapLock.text).toContain("for update nowait");
    expect(bootstrapLock.params).toEqual(["owned-company", "user", "local-board", "active"]);
    const transferWrites = fixture.statements.filter(row => /^update "(companies|company_memberships|issues)"/.test(row.text));
    expect(transferWrites).toHaveLength(4);
    for (const row of transferWrites) {
      expect(row.params).toContain("local-board"); expect(row.params).toContain("owned-company");
      expect(row.params).not.toContain("revoked-company"); expect(row.params).not.toContain("member-company");
      expect(row.params).not.toContain("another-owner-company");
      expect(row.text).toMatch(/"(company_id|id)" in/);
    }
    expect(hooks.routine).toHaveBeenCalledExactlyOnceWith(fixture.db, "owned-company", userId);
    expect(hooks.grants).not.toHaveBeenCalled(); expect(hooks.persist).not.toHaveBeenCalled(); expect(hooks.publish).not.toHaveBeenCalled();
    expect(fixture.statements.some(row => /^(insert|update|delete).*"(instance_user_roles|agentos_portfolios)"/.test(row.text))).toBe(false);
    expect(fixture.statements.some(row => row.text.startsWith('insert into "company_memberships"'))).toBe(false);
    const audit = fixture.statements.find(row => row.text.startsWith('insert into "agentos_admin_events"'))!;
    expect(audit.params).toContain(JSON.stringify({ policy: "configured_google_owner", provider: "google", source: "legacy_native_claim", nativeClaimEventId: "event-1", companyIds: ["owned-company"], transferredLocalBoard: false }));
    const before = fixture.statements.length;
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toEqual({ status: "already_provisioned" });
    expect(fixture.statements.slice(before).some(row => /^(insert|update|delete)/.test(row.text))).toBe(false);
  });
  it.each(["missing", "another-actor"])("does not complete history with %s native self-claim proof", async (proof) => {
    const fixture = database({ status: "approved", admins: [userId], events: proof === "missing" ? [] : ["user.local_board_claimed"], nativeClaimActor: "another-user" });
    await provisionConfiguredGoogleOwner(fixture.db, userId, identity);
    expect(fixture.statements.some(row => /^update "(companies|company_memberships|issues|agentos_portfolios)"/.test(row.text))).toBe(false);
    expect(hooks.routine).not.toHaveBeenCalled();
  });
  it.each(["demoted", "pending"])("does not restore a native claimant who is now %s", async (state) => {
    const fixture = database({ status: state === "pending" ? "pending" : "approved", admins: state === "demoted" ? [] : [userId], events: ["user.local_board_claimed"] });
    expect(await provisionConfiguredGoogleOwner(fixture.db, userId, identity)).toEqual({ status: "restricted" });
    expect(fixture.statements.some(row => /^(insert|update|delete)/.test(row.text))).toBe(false);
  });
  it("does not touch local history when the proved claimant has no current owner company", async () => {
    const fixture = database({ status: "approved", admins: [userId], events: ["user.local_board_claimed"] });
    await provisionConfiguredGoogleOwner(fixture.db, userId, identity);
    expect(fixture.statements.some(row => /^update "(companies|company_memberships|issues|agentos_portfolios)"/.test(row.text))).toBe(false);
    expect(hooks.routine).not.toHaveBeenCalled(); expect(hooks.grants).not.toHaveBeenCalled();
  });
  it.each(["collision", "audit"])("propagates a legacy %s failure through the transaction without completion audit", async (failure) => {
    const fixture = database({ status: "approved", admins: [userId], events: ["user.local_board_claimed"], collision: failure === "collision",
      memberships: [{ companyId: "owned-company", userId, status: "active", role: "owner" }],
    }, failure === "audit");
    const attempt = provisionConfiguredGoogleOwner(fixture.db, userId, identity);
    if (failure === "collision") await expect(attempt).rejects.toThrow("Both conversations have been preserved");
    else await expect(attempt).rejects.toMatchObject({ cause: { message: "audit unavailable" } });
    expect(fixture.state()).toMatchObject({ status: "approved", admins: [userId], events: ["user.local_board_claimed"] });
    expect(hooks.publish).not.toHaveBeenCalled(); expect(hooks.grants).not.toHaveBeenCalled();
  });
  it.each(["claimant", "local-board"] as const)("defers legacy repair when %s membership is busy before any transfer write", async (busyMembership) => {
    const fixture = database({ status: "approved", admins: [userId], events: ["user.local_board_claimed"], busyMembership,
      memberships: [{ companyId: "owned-company", userId, status: "active", role: "owner" }],
    });
    await expect(provisionConfiguredGoogleOwner(fixture.db, userId, identity)).rejects.toThrow("Company access is changing");
    expect(fixture.statements.some(row => /^(insert|update|delete)/.test(row.text))).toBe(false);
    expect(hooks.routine).not.toHaveBeenCalled(); expect(hooks.publish).not.toHaveBeenCalled();
  });
});
