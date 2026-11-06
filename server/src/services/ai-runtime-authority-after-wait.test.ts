import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareManagedAiRuntime } from "./ai-connection-runtime.js";

const mocks = vi.hoisted(() => ({ select: vi.fn(), credential: vi.fn() }));
vi.mock("./ai-connections.js", () => ({ aiConnectionService: () => ({ select: mocks.select, runtimeCredential: mocks.credential }) }));
vi.mock("./subscriptions.js", () => ({ subscriptionService: () => ({ register: async () => "subscription" }) }));
vi.mock("./subscription-refresh.js", () => ({ refreshSubscriptionConnection: async () => undefined }));

describe("managed account authority after capacity waits", () => {
  let cwd: string, epoch: number, version: number, db: Db;
  let runtime: Awaited<ReturnType<typeof prepareManagedAiRuntime>> | undefined;
  const binding = { provider: "openai" as const, method: "subscription" as const, mode: "responsible_user" as const };
  const selection = () => ({
    grant: { id: "grant", subjectUserId: "owner", credentialSecretRefs: [{ configPath: "ai.credential", secretId: "secret", versionSelector: "latest" }] },
    connection: { id: "connection", name: "Owner account", config: { ai: { provider: "openai", method: "subscription" } } },
    attribution: { connectionId: "connection", grantId: "grant", provider: "openai", method: "subscription", mode: "responsible_user", responsibleUserId: "owner" },
  });
  beforeEach(async () => {
    vi.clearAllMocks(); epoch = 1; version = 1;
    cwd = await mkdtemp(path.join(os.tmpdir(), "agentos-capacity-authority-"));
    mocks.select.mockImplementation(async () => selection());
    mocks.credential.mockResolvedValue('{"tokens":{"access_token":"synthetic-only"}}');
    db = drizzle(async query => {
      if (query.includes('from "connection_grants"')) return { rows: [[selection().grant.credentialSecretRefs, "active"]] };
      if (query.includes('from "company_secrets"')) return { rows: [[epoch, version]] };
      throw new Error(`Unexpected query: ${query}`);
    }) as unknown as Db;
    runtime = await prepareManagedAiRuntime(db, { companyId: "company", agentId: "agent", responsibleUserId: "owner", adapterType: "codex_local", binding, config: { cwd, model: "gpt-5.4" } });
  });
  afterEach(async () => { await runtime?.cleanup(); await rm(cwd, { recursive: true, force: true }); runtime = undefined; });
  it("re-enters the native selector with original principal and agent before dispatch", async () => {
    await runtime!.assertCurrent();
    expect(mocks.select).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: "company", agentId: "agent", userId: "owner", adapterType: "codex_local", binding, model: "gpt-5.4" }));
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
  it.each(["The responsible user is not an active company member", "This credential is not shared with the responsible user", "This connection is not permitted for this agent"])("preserves native denial after a wait: %s", async message => {
    mocks.select.mockRejectedValueOnce(new Error(message));
    await expect(runtime!.assertCurrent()).rejects.toThrow(message);
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
  it("rejects a changed default without preparing or copying another credential", async () => {
    const changed = selection(); changed.grant.id = "different-grant"; changed.attribution.grantId = "different-grant";
    mocks.select.mockResolvedValueOnce(changed);
    await expect(runtime!.assertCurrent()).rejects.toThrow("account changed");
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
  it.each(["epoch", "version"])("rejects changed credential %s without paid fallback", async field => {
    if (field === "epoch") epoch++; else version++;
    await expect(runtime!.assertCurrent()).rejects.toThrow("credential changed");
    expect(mocks.credential).toHaveBeenCalledOnce();
  });
});
