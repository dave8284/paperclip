import type { Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiWorkspaceAccountService } from "./ai-workspace-accounts.js";
const lock = vi.hoisted(() => vi.fn());
vi.mock("@paperclipai/adapter-codex-local/server", async importOriginal => ({
  ...await importOriginal<typeof import("@paperclipai/adapter-codex-local/server")>(), withAccountHomeSecretMutationLock: lock,
}));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decidePrincipalGrant: async () => ({ allowed: true }) }) }));
const source = "11111111-1111-4111-8111-111111111111", target = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333", connectionId = "44444444-4444-4444-8444-444444444444", grantId = "55555555-5555-4555-8555-555555555555";
const scope = { userId: "owner", companyIds: [source, target] };
const account = { id: accountId, ownerUserId: "owner", sourceCompanyId: source, sourceConnectionId: connectionId, sourceGrantId: grantId, revision: 1, enabled: true, autoInstall: true };
const selected = { connection: { id: connectionId, companyId: source, enabled: true, status: "active", healthStatus: "ok",
  config: { ai: { provider: "openai", method: "subscription" }, aiIsolatedSubscription: true } },
grant: { kind: "organization", status: "active", subjectUserId: null, credentialSecretRefs: [{ configPath: "ai.credential", secretId: "secret" }] } };
function fixture(enrollment: boolean) {
  const rows = [[{ approvalStatus: "approved" }], ...enrollment ? [] : [[account]], [{ status: "active" }],
    [{ status: "active", membershipRole: "owner" }], [selected], [], [], ...enrollment ? [[{ status: "active", scope: "company" }]] : []];
  const transaction = vi.fn().mockRejectedValue(new Error("transaction boundary"));
  const db = { transaction, select: () => {
    if (!rows.length) throw new Error("Unexpected pre-lock query");
    const result = rows.shift();
    const query: Record<string, unknown> = { then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve) };
    for (const name of ["from", "innerJoin", "where", "orderBy", "limit"]) query[name] = () => query;
    return query;
  } } as unknown as Db;
  return { db, transaction };
}
beforeEach(() => vi.clearAllMocks());
describe("account mutations wait for canonical probe refresh cleanup before SQL locks", () => {
  it.each(["enroll", "install", "revoke", "update"] as const)("%s holds no transaction while waiting for the source company file lock", async operation => {
    const f = fixture(operation === "enroll"), service = aiWorkspaceAccountService(f.db);
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const probeFinished = new Promise<void>(resolve => { release = resolve; });
    lock.mockImplementation(async (_env: unknown, _companyId: string, work: () => Promise<unknown>) => {
      entered(); await probeFinished; return work();
    });
    const pending = operation === "enroll" ? service.enroll(scope, { id: accountId, sourceCompanyId: source, sourceConnectionId: connectionId, sourceGrantId: grantId, autoInstall: true })
      : operation === "install" ? service.install(scope, accountId, target, { expectedRevision: 1, expectedLinkRevision: null })
        : operation === "revoke" ? service.revoke(scope, accountId, target, { expectedRevision: 1, expectedLinkRevision: 1 })
          : service.update(scope, accountId, { expectedRevision: 1, enabled: false });
    const settled = expect(pending).rejects.toThrow("transaction boundary");
    await waiting;
    expect(lock).toHaveBeenCalledWith(undefined, source, expect.any(Function));
    expect(f.transaction).not.toHaveBeenCalled();
    release(); await settled;
    expect(f.transaction).toHaveBeenCalledOnce();
  });
});
