import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  agentosAdminEvents, agentosPortfolios, agentosUserInvitations, authAccounts, authSessions,
  authUsers, boardApiKeys, companyMemberships, instanceUserRoles, type Db,
} from "@paperclipai/db";
import { adminPeopleQuerySchema, type AdminUserUpdate } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { accessService } from "./access.js";
import { getHiddenSettings } from "./settings-visibility.js";

export type AdminPrincipal = { userId: string; local: boolean };

export async function assertAdministration(db: Pick<Db, "select">, actor: AdminPrincipal) {
  if (getHiddenSettings().has("instance.access")) throw forbidden("User administration is managed by the hosting operator.", { code: "settings_operator_managed" });
  if (actor.local) return;
  const [admin] = await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles)
    .innerJoin(authUsers, eq(authUsers.id, instanceUserRoles.userId))
    .where(and(eq(instanceUserRoles.userId, actor.userId), eq(instanceUserRoles.role, "instance_admin"), eq(authUsers.approvalStatus, "approved"))).limit(1);
  if (!admin) throw forbidden("Instance administrator access is required.");
}

export function administrationService(db: Db) {
  const audit = (tx: Db, actor: AdminPrincipal, action: string, targetUserId: string | null, details: Record<string, unknown> = {}) =>
    tx.insert(agentosAdminEvents).values({ actorUserId: actor.userId, targetUserId, action, details });

  async function overview(actor: AdminPrincipal) {
    await assertAdministration(db, actor);
    const [counts] = await db.select({
      users: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${authUsers.approvalStatus} = 'pending')::int`,
      approved: sql<number>`count(*) filter (where ${authUsers.approvalStatus} = 'approved')::int`,
      suspended: sql<number>`count(*) filter (where ${authUsers.approvalStatus} = 'suspended')::int`,
    }).from(authUsers);
    const [admins] = await db.select({ count: sql<number>`count(*)::int` }).from(instanceUserRoles).where(eq(instanceUserRoles.role, "instance_admin"));
    return { ...counts!, admins: admins?.count ?? 0 };
  }

  async function people(actor: AdminPrincipal, query: unknown) {
    await assertAdministration(db, actor);
    const { query: needle, status, limit, offset } = adminPeopleQuerySchema.parse(query);
    const search = needle.trim().toLowerCase();
    const where = and(status ? eq(authUsers.approvalStatus, status) : undefined,
      search ? or(sql`strpos(lower(${authUsers.email}), ${search}) > 0`, sql`strpos(lower(${authUsers.name}), ${search}) > 0`) : undefined);
    const rows = await db.select().from(authUsers).where(where).orderBy(desc(authUsers.createdAt), authUsers.id).limit(limit).offset(offset);
    const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(authUsers).where(where);
    const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(authUsers).where(eq(authUsers.approvalStatus, "pending"));
    const ids = rows.map(r => r.id);
    const [roles, memberships, providers, sessions] = ids.length ? await Promise.all([
      db.select({ userId: instanceUserRoles.userId }).from(instanceUserRoles).where(and(inArray(instanceUserRoles.userId, ids), eq(instanceUserRoles.role, "instance_admin"))),
      db.select({ userId: companyMemberships.principalId, count: sql<number>`count(*)::int` }).from(companyMemberships)
        .where(and(inArray(companyMemberships.principalId, ids), eq(companyMemberships.principalType, "user"), eq(companyMemberships.status, "active"))).groupBy(companyMemberships.principalId),
      db.select({ userId: authAccounts.userId, provider: authAccounts.providerId }).from(authAccounts).where(inArray(authAccounts.userId, ids)),
      db.select({ userId: authSessions.userId, at: sql<string | null>`max(${authSessions.updatedAt})::text` }).from(authSessions).where(inArray(authSessions.userId, ids)).groupBy(authSessions.userId),
    ]) : [[], [], [], []];
    return { people: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: undefined,
      isInstanceAdmin: roles.some(r => r.userId === row.id),
      activeCompanyMembershipCount: memberships.find(r => r.userId === row.id)?.count ?? 0,
      providers: [...new Set(providers.filter(r => r.userId === row.id).map(r => r.provider))],
      lastActiveAt: sessions.find(r => r.userId === row.id)?.at ?? null,
    })), total: total?.count ?? 0, pending: pending?.count ?? 0, offset, limit };
  }

  async function lockUser(tx: Db, actor: AdminPrincipal, userId: string, revision: number) {
    // Serialise role and account-status changes, including the bootstrap owner.
    await tx.execute(sql`lock table ${instanceUserRoles} in share row exclusive mode`);
    await assertAdministration(tx, actor);
    const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, userId)).for("update");
    if (!user) throw notFound("User not found.");
    if (user.approvalRevision !== revision) throw conflict("This account changed. Refresh before applying this action.");
    return user;
  }

  async function protectAdministrator(tx: Db, actor: AdminPrincipal, userId: string) {
    if (userId === actor.userId) throw conflict("You cannot remove or suspend your own administrator access.");
    const admins = await tx.select({ userId: instanceUserRoles.userId }).from(instanceUserRoles)
      .innerJoin(authUsers, eq(authUsers.id, instanceUserRoles.userId))
      .where(and(eq(instanceUserRoles.role, "instance_admin"), eq(authUsers.approvalStatus, "approved")));
    if (admins.some(r => r.userId === userId) && admins.length <= 1) throw conflict("Keep at least one approved administrator.");
  }

  async function revokeSessions(tx: Db, userId: string) {
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx.update(boardApiKeys).set({ revokedAt: new Date() }).where(eq(boardApiKeys.userId, userId));
  }

  async function updatePerson(actor: AdminPrincipal, userId: string, input: AdminUserUpdate) {
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      const user = await lockUser(tx, actor, userId, input.expectedRevision);
      const disabling = ["suspend", "reject", "demote"].includes(input.action);
      if (disabling) await protectAdministrator(tx, actor, userId);
      const approvalStatus = input.action === "approve" ? "approved" : input.action === "suspend" ? "suspended" : input.action === "reject" ? "rejected" : user.approvalStatus;
      if (input.action === "promote" && user.approvalStatus !== "approved") throw conflict("Approve this user before granting administrator access.");
      if (input.action === "rename" && !input.name) throw conflict("Enter a name.");
      let roleGrant: typeof instanceUserRoles.$inferSelect | undefined;
      if (input.action === "promote") roleGrant = await accessService(tx).promoteInstanceAdmin(userId);
      if (input.action === "demote") {
        const removed = await accessService(tx).demoteInstanceAdmin(userId);
        if (!removed) throw notFound("Instance admin role not found");
        roleGrant = removed;
      }
      if (["suspend", "reject", "revoke_sessions"].includes(input.action)) await revokeSessions(tx, userId);
      const [updated] = await tx.update(authUsers).set({
        approvalStatus, approvalRevision: user.approvalRevision + 1, updatedAt: new Date(),
        ...(input.action === "rename" ? { name: input.name! } : {}),
      }).where(eq(authUsers.id, userId)).returning({ id: authUsers.id, approvalRevision: authUsers.approvalRevision });
      await audit(tx, actor, `user.${input.action}`, userId, { from: user.approvalStatus, to: approvalStatus, revision: updated!.approvalRevision, reason: input.reason });
      return { ...updated!, roleGrant };
    });
  }

  async function deletePerson(actor: AdminPrincipal, userId: string, input: { expectedRevision: number; confirmEmail: string }) {
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      const user = await lockUser(tx, actor, userId, input.expectedRevision);
      await protectAdministrator(tx, actor, userId);
      if (input.confirmEmail.toLowerCase() !== user.email.toLowerCase()) throw conflict("The confirmation email does not match this account.");
      const [portfolio] = await tx.select({ id: agentosPortfolios.id }).from(agentosPortfolios).where(eq(agentosPortfolios.ownerUserId, userId)).limit(1);
      if (portfolio) throw conflict("Transfer this user's portfolio ownership before deleting their account.");
      // Native membership removal protects company owners/admins and revokes
      // personal access through its existing cleanup path.
      await tx.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, userId));
      await accessService(tx).setUserCompanyAccess(userId, [], { actorUserId: actor.userId });
      await revokeSessions(tx, userId);
      await tx.delete(agentosUserInvitations).where(eq(agentosUserInvitations.email, user.email.toLowerCase()));
      await tx.delete(authUsers).where(eq(authUsers.id, userId));
      await audit(tx, actor, "user.deleted", userId, { preservedBusinessHistory: true });
      return { deleted: true };
    });
  }

  async function invitations(actor: AdminPrincipal) {
    await assertAdministration(db, actor);
    return db.select().from(agentosUserInvitations).orderBy(desc(agentosUserInvitations.createdAt)).limit(100);
  }

  async function setCompanyAccess(actor: AdminPrincipal, userId: string, companyIds: string[]) {
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await tx.execute(sql`lock table ${instanceUserRoles} in share row exclusive mode`);
      await assertAdministration(tx, actor);
      const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, userId)).for("update");
      if (!user) throw notFound("User not found.");
      if (companyIds.length && user.approvalStatus !== "approved") throw conflict("Approve this account before assigning company access.");
      await accessService(tx).setUserCompanyAccess(userId, companyIds, { actorUserId: actor.userId });
      await tx.update(authUsers).set({ approvalRevision: user.approvalRevision + 1, updatedAt: new Date() }).where(eq(authUsers.id, userId));
      await audit(tx, actor, "user.company_access_changed", userId, { companyIds });
    });
  }

  async function invite(actor: AdminPrincipal, input: { email: string; name: string }) {
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await tx.execute(sql`lock table ${instanceUserRoles} in share row exclusive mode`);
      await assertAdministration(tx, actor);
      const [existing] = await tx.select({ id: authUsers.id }).from(authUsers).where(sql`lower(${authUsers.email}) = ${input.email}`).limit(1);
      if (existing) throw conflict("This person already has an account. Manage their approval in Users.");
      const [row] = await tx.insert(agentosUserInvitations).values({ ...input, createdByUserId: actor.userId, expiresAt: new Date(Date.now() + 7 * 86400000) })
        .onConflictDoUpdate({ target: agentosUserInvitations.email, set: { name: input.name, createdByUserId: actor.userId, expiresAt: new Date(Date.now() + 7 * 86400000), revokedAt: null, createdAt: new Date() } }).returning();
      await audit(tx, actor, "user.preapproved", null, { invitationId: row!.id });
      return row;
    });
  }

  async function revokeInvitation(actor: AdminPrincipal, id: string) {
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await tx.execute(sql`lock table ${instanceUserRoles} in share row exclusive mode`);
      await assertAdministration(tx, actor);
      const [row] = await tx.update(agentosUserInvitations).set({ revokedAt: new Date() }).where(eq(agentosUserInvitations.id, id)).returning();
      if (!row) throw notFound("Invitation not found.");
      await audit(tx, actor, "user.preapproval_revoked", null, { invitationId: id });
      return row;
    });
  }

  async function events(actor: AdminPrincipal) {
    await assertAdministration(db, actor);
    return db.select().from(agentosAdminEvents).orderBy(desc(agentosAdminEvents.createdAt)).limit(100);
  }
  return { overview, people, updatePerson, deletePerson, setCompanyAccess, invitations, invite, revokeInvitation, events };
}
