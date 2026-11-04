import { IncomingMessage } from "node:http";
import express from "express";
import { inject } from "light-my-request";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { publicAuthOptionsSchema } from "@paperclipai/shared";
import type { BetterAuthOptions } from "better-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { createBetterAuthInstance } from "../auth/better-auth.js";
import { passwordAuthenticationEnabled } from "../auth/agentos-registration.js";
import { agentosAdministrationRoutes } from "../routes/agentos-administration.js";

const origin = "http://127.0.0.1:41999";
const config = {
  deploymentMode: "authenticated", deploymentExposure: "private", authBaseUrlMode: "explicit",
  authPublicBaseUrl: origin, authDisableSignUp: false, allowedHostnames: ["127.0.0.1"], port: 41999,
} as Config;
beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "offline-password-auth-policy-test-secret-0000");
  vi.stubEnv("PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", "false");
  vi.stubEnv("PAPERCLIP_AUTH_PASSWORD_ENABLED", undefined);
  vi.stubEnv("PAPERCLIP_GOOGLE_CLIENT_ID", "offline-google-client-id");
  vi.stubEnv("PAPERCLIP_GOOGLE_CLIENT_SECRET", "offline-google-client-secret");
  vi.stubEnv("PAPERCLIP_PUBLIC_URL", undefined);
  vi.stubEnv("PAPERCLIP_MANAGED_RUNTIME_PUBLIC_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());

function recordingDatabase() {
  const query = vi.fn(async () => ({ rows: [] }));
  return { db: drizzle(query) as unknown as Db, query };
}
function request(path: string, body?: Record<string, unknown>) {
  return new Request(`${origin}/api/auth${path}`, {
    method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("password authentication deployment policy", () => {
  it("preserves existing password installations unless explicitly disabled", () => {
    expect(passwordAuthenticationEnabled({})).toBe(true);
    expect(passwordAuthenticationEnabled({ PAPERCLIP_AUTH_PASSWORD_ENABLED: "true" })).toBe(true);
    expect(passwordAuthenticationEnabled({ PAPERCLIP_AUTH_PASSWORD_ENABLED: " false " })).toBe(false);
    expect(passwordAuthenticationEnabled({ PAPERCLIP_AUTH_PASSWORD_ENABLED: "FALSE" })).toBe(false);
  });

  it.each([
    ["/sign-in/email", "EMAIL_PASSWORD_DISABLED"],
    ["/sign-up/email", "EMAIL_PASSWORD_SIGN_UP_DISABLED"],
  ])("rejects the actual %s handler before credential reads, writes or session creation", async (path, code) => {
    vi.stubEnv("PAPERCLIP_AUTH_PASSWORD_ENABLED", "false");
    const { db, query } = recordingDatabase();
    const auth = createBetterAuthInstance(db, config, [origin]);
    const response = await auth.handler(request(path, { email: "owner@example.test", password: "test-password-1234", name: "Owner" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["/request-password-reset", "/reset-password", "/change-password", "/verify-password"])(
    "disables the password-only %s HTTP endpoint", async (path) => {
      vi.stubEnv("PAPERCLIP_AUTH_PASSWORD_ENABLED", "false");
      const { db, query } = recordingDatabase();
      const auth = createBetterAuthInstance(db, config, [origin]);
      const response = await auth.handler(request(path, { email: "owner@example.test", token: "old-reset-token", password: "test-password-1234", newPassword: "new-test-password-1234", currentPassword: "test-password-1234" }));
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("preserves default password sign-in behavior and its credential lookup", async () => {
    const { db, query } = recordingDatabase();
    const auth = createBetterAuthInstance(db, config, [origin]);
    const response = await auth.handler(request("/sign-in/email", { email: "unknown@example.test", password: "test-password-1234" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(query).toHaveBeenCalled();
  });

  it.each([false, true])("keeps Google registration policy independent (signup disabled: %s)", async (authDisableSignUp) => {
    vi.stubEnv("PAPERCLIP_AUTH_PASSWORD_ENABLED", "false");
    const { db, query } = recordingDatabase();
    const auth = createBetterAuthInstance(db, { ...config, authDisableSignUp }, [origin]);
    const options = (auth as unknown as { options: BetterAuthOptions }).options;
    expect(options.emailAndPassword?.enabled).toBe(false);
    expect(options.socialProviders?.google).toMatchObject({ clientId: "offline-google-client-id", disableSignUp: authDisableSignUp });
    expect(options.user?.additionalFields?.approvalStatus).toMatchObject({ defaultValue: "pending", input: false });
    const hook = options.databaseHooks!.user!.create!.before!;
    const result = await hook({ id: "new-user", email: "owner@example.test", emailVerified: true, name: "Owner", createdAt: new Date(), updatedAt: new Date() }, null);
    expect(result).toMatchObject({ data: { approvalStatus: "pending" } });
    expect(query).toHaveBeenCalledOnce();
    // Session inspection remains available; disabling passwords does not revoke
    // existing Google/owner sessions or alter their authority.
    const session = await auth.handler(request("/get-session"));
    expect(session.status).toBe(200);
    expect(await session.json()).toBeNull();
  });
});

describe("public registration authentication options", () => {
  async function options(input: { deploymentMode: "authenticated" | "local_trusted"; authDisableSignUp?: boolean }) {
    const { db, query } = recordingDatabase();
    const app = express();
    // Preserve Express shared prototypes when dispatching without a listener.
    for (const target of [app.request, app.response]) {
      const parent = Object.getPrototypeOf(target);
      Object.setPrototypeOf(target, Object.create(Object.getPrototypeOf(parent), Object.getOwnPropertyDescriptors(parent)));
    }
    app.use("/api", agentosAdministrationRoutes(db, input));
    const response = await inject(app, { method: "GET", url: "/api/registration/options", Request: IncomingMessage });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(query).not.toHaveBeenCalled();
    return publicAuthOptionsSchema.parse(response.json());
  }

  it("advertises Google without either password option when disabled", async () => {
    vi.stubEnv("PAPERCLIP_AUTH_PASSWORD_ENABLED", "false");
    expect(await options({ deploymentMode: "authenticated" })).toEqual({ googleEnabled: true, passwordSignInEnabled: false, passwordSignUpEnabled: false, approvalRequired: true });
  });

  it("keeps sign-in separate from the existing signup restriction", async () => {
    expect(await options({ deploymentMode: "authenticated", authDisableSignUp: true })).toEqual({ googleEnabled: true, passwordSignInEnabled: true, passwordSignUpEnabled: false, approvalRequired: true });
    expect(await options({ deploymentMode: "authenticated", authDisableSignUp: false })).toMatchObject({ passwordSignInEnabled: true, passwordSignUpEnabled: true });
  });

  it("does not advertise authentication in local trusted mode", async () => {
    expect(await options({ deploymentMode: "local_trusted" })).toEqual({ googleEnabled: false, passwordSignInEnabled: false, passwordSignUpEnabled: false, approvalRequired: false });
  });

  it("keeps older public-option responses compatible without changing an explicit false", () => {
    const legacy = { googleEnabled: true, passwordSignUpEnabled: false, approvalRequired: true };
    expect(publicAuthOptionsSchema.parse(legacy).passwordSignInEnabled).toBe(true);
    expect(publicAuthOptionsSchema.parse({ ...legacy, passwordSignInEnabled: false }).passwordSignInEnabled).toBe(false);
  });
});
