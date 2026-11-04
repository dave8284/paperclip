import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { provisionConfiguredGoogleOwner, type VerifiedGoogleOwnerIdentity } from "../services/configured-google-owner.js";
import { HttpError } from "../errors.js";

export function configuredGoogleOwnerEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.PAPERCLIP_AUTH_GOOGLE_OWNER_EMAIL?.trim().toLowerCase();
  if (!value) return null;
  if (!z.email().safeParse(value).success) throw new Error("PAPERCLIP_AUTH_GOOGLE_OWNER_EMAIL must contain one valid email address.");
  return value;
}

type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;
type BeforeSession = NonNullable<NonNullable<NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>["create"]>["before"]>;

/** Better Auth supplies this profile only after its Google OAuth/ID-token
 * verification. Keep that proof request-local and consume it once, after the
 * provider account exists but before a session can be issued. */
export function configuredGoogleOwnerHooks(db: Db, env: NodeJS.ProcessEnv = process.env) {
  const email = configuredGoogleOwnerEmail(env);
  const verified = new WeakMap<Request, VerifiedGoogleOwnerIdentity>();
  const validateUserInfo: ValidateUserInfo = (data, context) => {
    const request = context.request;
    if (!request || !email) return;
    verified.delete(request);
    const profile = data.source.oauth?.profile;
    if (data.source.method !== "oauth" || data.source.oauth?.providerId !== "google"
      || !profile || !["https://accounts.google.com", "accounts.google.com"].includes(String(profile.iss))
      || profile.email_verified !== true || data.user.emailVerified !== true
      || typeof profile.sub !== "string" || !profile.sub.trim()
      || typeof profile.email !== "string" || profile.email.trim().toLowerCase() !== email
      || typeof data.user.email !== "string" || data.user.email.trim().toLowerCase() !== email) return;
    verified.set(request, { email, subject: profile.sub });
  };
  const beforeSession: BeforeSession = async (session, context) => {
    const request = context?.request;
    if (!request) return;
    const identity = verified.get(request);
    verified.delete(request);
    if (identity) {
      try { await provisionConfiguredGoogleOwner(db, session.userId, identity); }
      catch (error) {
        // SQL adapter failures may carry bound identity claims. Keep those out
        // of Better Auth's error logging/redirects; retain only our safe errors.
        if (error instanceof HttpError && [403, 409].includes(error.status)) {
          throw new APIError(error.status === 409 ? "CONFLICT" : "FORBIDDEN", {
            code: "configured_google_owner_conflict", message: error.message,
          });
        }
        throw new APIError("INTERNAL_SERVER_ERROR", {
          code: "configured_google_owner_unavailable", message: "Owner setup could not be completed. Try Google sign-in again after the instance is ready.",
        });
      }
    }
  };
  return { validateUserInfo, beforeSession };
}
