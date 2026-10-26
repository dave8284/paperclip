import { and, eq, gt, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { agentosUserInvitations, authUsers, invites, type Db } from "@paperclipai/db";
import type { RequestHandler } from "express";
import { forbidden } from "../errors.js";

export function googleSignInConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const clientId = env.PAPERCLIP_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.PAPERCLIP_GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function initialRegistrationStatus(db: Db, email: string, emailVerified: boolean) {
  if (!emailVerified) return "pending" as const;
  const [invitation] = await db.select({ id: agentosUserInvitations.id }).from(agentosUserInvitations)
    .where(and(eq(agentosUserInvitations.email, email.trim().toLowerCase()),
      isNull(agentosUserInvitations.revokedAt), gt(agentosUserInvitations.expiresAt, new Date()))).limit(1);
  return invitation ? "approved" as const : "pending" as const;
}

export async function readUserApproval(db: Pick<Db, "select">, userId: string) {
  const [user] = await db.select({ status: authUsers.approvalStatus }).from(authUsers).where(eq(authUsers.id, userId)).limit(1);
  return user?.status ?? null;
}

// Public authentication only establishes an identity. No pending account can
// create companies, claim ordinary invites or obtain tool/CLI authority.
export function userApprovalGuard(db: Db): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (req.actor.type !== "board" || req.actor.source === "local_implicit") return next();
      // Installed on the native API router, including its internal MCP dispatch.
      const path = req.path.replace(/^\/api(?=\/)/, "");
      const allowed = path === "/registration" || path === "/registration/options"
        || path === "/health" || path === "/bootstrap/claim"
        || /^\/board-claim\/[^/]+(?:\/claim)?\/?$/.test(path);
      if (allowed) return next();
      const status = req.actor.userId ? await readUserApproval(db, req.actor.userId) : null;
      // The CLI's first-owner invite is also an explicit approval ceremony.
      // Ordinary company invitations never bypass account review.
      const invitation = /^\/invites\/([^/]+)(?:\/accept)?\/?$/.exec(path);
      if (status === "pending" && invitation && ["GET", "POST"].includes(req.method)) {
        const [bootstrap] = await db.select({ id: invites.id }).from(invites).where(and(
          eq(invites.tokenHash, createHash("sha256").update(invitation[1]).digest("hex")),
          eq(invites.inviteType, "bootstrap_ceo"), isNull(invites.revokedAt), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date()),
        )).limit(1);
        if (bootstrap) return next();
      }
      if (status !== "approved") throw forbidden(status === "pending" ? "Your account is awaiting administrator approval." : "Your account does not have active access.", {
        code: "agentos_account_not_approved", status: status ?? "unavailable",
      });
      next();
    } catch (error) { next(error); }
  };
}
