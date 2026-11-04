import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import type { Auth } from "better-auth";
import type { Config } from "../config.js";

const fixtures = vi.hoisted(() => ({ provision: vi.fn(), store: { user: [] as any[], account: [] as any[], session: [] as any[], verification: [] as any[] } }));
vi.mock("../services/configured-google-owner.js", () => ({ provisionConfiguredGoogleOwner: fixtures.provision }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(fixtures.store) };
});
import { configuredGoogleOwnerEmail, configuredGoogleOwnerHooks } from "../auth/configured-google-owner.js";
import { createBetterAuthInstance } from "../auth/better-auth.js";

const email = "owner@example.test", subject = "google-subject-1", origin = "http://127.0.0.1:41999";
const profile = { iss: "https://accounts.google.com", sub: subject, email, email_verified: true };
const db = drizzle(async () => ({ rows: [] })) as unknown as Db;
const identity = (patch: Record<string, unknown> = {}) => ({
  user: { email, emailVerified: true }, source: { action: "sign-in", method: "oauth", oauth: { providerId: "google", profile } }, ...patch,
}) as any;
const context = () => ({ request: new Request(`${origin}/api/auth/callback/google`) }) as any;
beforeEach(() => {
  vi.clearAllMocks(); fixtures.provision.mockResolvedValue({ status: "provisioned" });
  for (const values of Object.values(fixtures.store)) values.length = 0;
  vi.stubEnv("BETTER_AUTH_SECRET", "offline-configured-owner-auth-secret-0000");
  vi.stubEnv("PAPERCLIP_GOOGLE_CLIENT_ID", "fixture-google-id");
  vi.stubEnv("PAPERCLIP_GOOGLE_CLIENT_SECRET", "fixture-google-secret");
  vi.stubEnv("PAPERCLIP_AUTH_GOOGLE_OWNER_EMAIL", email);
  vi.stubEnv("PAPERCLIP_AUTH_PASSWORD_ENABLED", "false");
  vi.stubEnv("PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", "false");
  vi.stubEnv("PAPERCLIP_PUBLIC_URL", undefined);
  vi.stubEnv("PAPERCLIP_MANAGED_RUNTIME_PUBLIC_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("configured Google owner auth boundary", () => {
  it("uses only an explicit single operator email, with no built-in owner", () => {
    expect(configuredGoogleOwnerEmail({})).toBeNull();
    expect(configuredGoogleOwnerEmail({ PAPERCLIP_AUTH_GOOGLE_OWNER_EMAIL: " Owner@Example.test " })).toBe(email);
    expect(() => configuredGoogleOwnerEmail({ PAPERCLIP_AUTH_GOOGLE_OWNER_EMAIL: "owner@example.test,other@example.test" })).toThrow("one valid email");
  });
  it("binds verified evidence to one request and consumes it once", async () => {
    const hooks = configuredGoogleOwnerHooks(db), original = context();
    await hooks.validateUserInfo(identity(), original);
    await hooks.beforeSession({ userId: "unrelated-user" } as any, context());
    expect(fixtures.provision).not.toHaveBeenCalled();
    await hooks.beforeSession({ userId: "owner-user" } as any, original);
    expect(fixtures.provision).toHaveBeenCalledExactlyOnceWith(db, "owner-user", { email, subject });
    await hooks.beforeSession({ userId: "owner-user" } as any, original);
    expect(fixtures.provision).toHaveBeenCalledOnce();
  });
  it.each([
    ["password source", { method: "email-password", oauth: { providerId: "google", profile } }],
    ["other provider", { method: "oauth", oauth: { providerId: "github", profile } }],
    ["unverified Google email", { method: "oauth", oauth: { providerId: "google", profile: { ...profile, email_verified: false } } }],
    ["untrusted issuer", { method: "oauth", oauth: { providerId: "google", profile: { ...profile, iss: "https://attacker.test" } } }],
    ["different email", { method: "oauth", oauth: { providerId: "google", profile: { ...profile, email: "other@example.test" } } }],
    ["missing subject", { method: "oauth", oauth: { providerId: "google", profile: { ...profile, sub: "" } } }],
    ["missing profile", { method: "oauth", oauth: { providerId: "google" } }],
  ])("does not grant owner access for %s", async (_name, source) => {
    const hooks = configuredGoogleOwnerHooks(db), ctx = context();
    await hooks.validateUserInfo(identity({ source }), ctx);
    await hooks.beforeSession({ userId: "owner-user" } as any, ctx);
    expect(fixtures.provision).not.toHaveBeenCalled();
  });
  it("rejects mapped user email/verification mismatches and clears earlier proof", async () => {
    for (const user of [{ email: "other@example.test", emailVerified: true }, { email, emailVerified: false }]) {
      const hooks = configuredGoogleOwnerHooks(db), ctx = context();
      await hooks.validateUserInfo(identity(), ctx);
      await hooks.validateUserInfo(identity({ user }), ctx);
      await hooks.beforeSession({ userId: "owner-user" } as any, ctx);
    }
    expect(fixtures.provision).not.toHaveBeenCalled();
  });
  it("leaves ordinary signup untouched when no owner is configured", async () => {
    const hooks = configuredGoogleOwnerHooks(db, {}), ctx = context();
    await hooks.validateUserInfo(identity(), ctx);
    await hooks.beforeSession({ userId: "owner-user" } as any, ctx);
    expect(fixtures.provision).not.toHaveBeenCalled();
  });
  it("does not reuse verified proof after a provisioning failure", async () => {
    const hooks = configuredGoogleOwnerHooks(db), ctx = context();
    await hooks.validateUserInfo(identity(), ctx);
    fixtures.provision.mockRejectedValueOnce(new Error("transaction failed with private-subject-and-token"));
    try { await hooks.beforeSession({ userId: "owner-user" } as any, ctx); expect.fail("expected owner failure"); }
    catch (error) {
      expect(error).toMatchObject({ body: { code: "configured_google_owner_unavailable" } });
      expect(String(error)).not.toContain("private-subject-and-token");
      expect((error as Error).cause).toBeUndefined();
    }
    await hooks.beforeSession({ userId: "owner-user" } as any, ctx);
    expect(fixtures.provision).toHaveBeenCalledOnce();
  });

  // Real Better Auth routes/hooks with a memory adapter and controlled provider
  // verification boundary. No Google request, bearer token, or real DB is used.
  it.each([false, true])("runs the native OAuth lifecycle before session issue (existing pending: %s)", async (existing) => {
    if (existing) {
      fixtures.store.user.push({ id: "pending-owner", email, emailVerified: true, name: "Owner", approvalStatus: "pending", createdAt: new Date(), updatedAt: new Date() });
      fixtures.store.account.push({ id: "google-account", userId: "pending-owner", providerId: "google", issuer: "https://accounts.google.com", accountId: subject, createdAt: new Date(), updatedAt: new Date() });
    }
    const auth = createBetterAuthInstance(db, { deploymentMode: "authenticated", deploymentExposure: "private",
      authBaseUrlMode: "explicit", authPublicBaseUrl: origin, authDisableSignUp: false } as Config, [origin]) as Auth;
    const native = await auth.$context;
    const google = native.socialProviders.find(provider => provider.id === "google")!;
    google.options.verifyIdToken = async () => true;
    google.getUserInfo = async () => ({ user: { name: "Owner", email, emailVerified: true }, data: profile });
    fixtures.provision.mockImplementation(async (_db, userId) => {
      expect(fixtures.store.account.some(account => account.userId === userId && account.accountId === subject)).toBe(true);
      expect(fixtures.store.session).toHaveLength(0);
      return { status: "provisioned" };
    });
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ provider: "google", idToken: { token: "controlled-test-provider-proof" } }),
    }));
    expect(response.status).toBe(200);
    expect(fixtures.provision).toHaveBeenCalledOnce();
    expect(fixtures.provision.mock.calls[0][2]).toEqual({ email, subject });
    expect(fixtures.store.session).toHaveLength(1);
  });
});
