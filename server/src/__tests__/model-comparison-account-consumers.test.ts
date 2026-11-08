import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { aiSubscriptionConnections, companySecrets, type Db } from "@paperclipai/db";
import { readModelComparisonAccount } from "../services/model-comparisons.js";
import { managedAiSessionIdentity } from "../services/ai-connection-session.js";
import { modelAccountFingerprint } from "../services/model-profile-binding.js";

const mocks = vi.hoisted(() => ({ select: vi.fn(), owner: vi.fn() }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ select: mocks.select }) }));
vi.mock("../services/ai-account-credential-owner.js", () => ({ resolveAiCredentialOwner: mocks.owner }));

beforeEach(() => vi.clearAllMocks());

function fixture() {
  const source = { companyId: randomUUID(), grantId: randomUUID(), secretId: randomUUID(), connectionId: randomUUID() };
  const target = { companyId: randomUUID(), grantId: randomUUID(), subscriptionId: randomUUID(), connectionId: randomUUID() };
  const responsibleUserId = randomUUID(), agentId = randomUUID();
  const binding = { mode: "delegated", provider: "openai", method: "subscription", grantId: target.grantId, connectionId: target.connectionId };
  const selected = { connection: { id: target.connectionId, companyId: target.companyId },
    grant: { id: target.grantId, companyId: target.companyId, credentialSecretRefs: [] } };
  const owner = { connection: { id: source.connectionId, companyId: source.companyId },
    grant: { id: source.grantId, companyId: source.companyId, credentialSecretRefs: [{ configPath: "ai.credential", secretId: source.secretId }] },
    binding: { accountId: randomUUID(), accountRevision: 1, linkId: randomUUID(), linkRevision: 1 } };
  mocks.select.mockResolvedValue(selected); mocks.owner.mockResolvedValue(owner);
  const metadata = { epoch: 3, deleted: null, status: "active" }, reads: { table: unknown; params: unknown[] }[] = [];
  let subscriptionAvailable = true;
  const db = { select: () => ({ from: (table: unknown) => ({ where: (where: SQL) => ({ for: async () => {
    const { params } = new PgDialect().sqlToQuery(where); reads.push({ table, params });
    if (table === companySecrets && params[0] === source.companyId && params[1] === source.secretId) return [metadata];
    if (table === aiSubscriptionConnections && params[0] === target.companyId && params[1] === target.grantId && subscriptionAvailable) return [{ id: target.subscriptionId }];
    return [];
  } }) }) }) } as unknown as Db;
  const agent = { id: agentId, companyId: target.companyId, adapterType: "paperclip_runner", runtimeConfig: { aiConnection: binding } } as Parameters<typeof readModelComparisonAccount>[1];
  const task = { responsibleUserId } as Parameters<typeof readModelComparisonAccount>[2];
  const read = () => readModelComparisonAccount(db, agent, task, { provider: "codex", model: "gpt-6.1-sol", homeMode: "isolated" });
  return { source, target, responsibleUserId, metadata, reads, read, db, selected, removeSubscription: () => { subscriptionAvailable = false; } };
}

describe("company-local model comparison account evidence", () => {
  it("reads the canonical credential but fingerprints the target subscription, grant and responsible user", async () => {
    const f = fixture(), account = await f.read();
    const sessionIdentity = managedAiSessionIdentity(f.target.grantId, f.responsibleUserId, { secretId: f.source.secretId, epoch: 3 });
    expect(account).toEqual({ sessionIdentity,
      accountFingerprint: modelAccountFingerprint(f.target.companyId, { provider: "openai", subscriptionId: f.target.subscriptionId, sessionIdentity }) });
    expect(account.sessionIdentity).not.toBe(managedAiSessionIdentity(f.source.grantId, f.responsibleUserId, { secretId: f.source.secretId, epoch: 3 }));
    expect(f.reads).toEqual([
      { table: companySecrets, params: [f.source.companyId, f.source.secretId] },
      { table: aiSubscriptionConnections, params: [f.target.companyId, f.target.grantId] },
    ]);
    expect(mocks.owner).toHaveBeenCalledWith(f.db, f.selected, { lock: true });
    f.metadata.epoch++;
    const after = await f.read();
    expect(after.sessionIdentity).not.toBe(account.sessionIdentity);
    expect(after.accountFingerprint).not.toBe(account.accountFingerprint);
  });

  it("does not borrow source attribution when the target subscription record is absent", async () => {
    const f = fixture(); f.removeSubscription();
    await expect(f.read()).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an inactive canonical secret and revoked account authority", async () => {
    const f = fixture(); f.metadata.status = "revoked";
    await expect(f.read()).rejects.toMatchObject({ status: 409 });
    mocks.owner.mockRejectedValue(new Error("account unavailable"));
    f.reads.length = 0;
    await expect(f.read()).rejects.toThrow("account unavailable");
    expect(f.reads).toEqual([]);
  });
});
