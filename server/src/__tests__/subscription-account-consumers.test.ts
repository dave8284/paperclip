import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { aiSubscriptions, aiSubscriptionPrices, aiSubscriptionConnections, companySecrets, connectionGrants, toolConnections, type Db } from "@paperclipai/db";
import { aiCredentialOwnerSnapshot, type AiCredentialOwner, type AiCredentialSelection } from "../services/ai-account-credential-owner.js";
import { subscriptionService, subscriptionSession, type SubscriptionConnection } from "../services/subscriptions.js";
import { subscriptionCredentialIdentity, type SubscriptionIdentity } from "../services/subscription-identity.js";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../services/ai-account-credential-owner.js", async original => ({
  ...await original<typeof import("../services/ai-account-credential-owner.js")>(), resolveAiCredentialOwner: mocks.resolve,
}));
vi.mock("../services/activity-log.js", () => ({ logActivity: async () => undefined }));
vi.mock("../services/accounting-transaction.js", () => ({ publishAccountingActivities: () => undefined }));

// Execute the reporting service against controlled persistence. Credential
// authority is the resolver boundary; no provider, secret bytes or listener is used.
function fixture() {
  type Row = Record<string, any>;
  const selections = new Map<string, AiCredentialSelection>();
  const owners = new Map<string, AiCredentialOwner>();
  const rows = new Map<object, Row[]>([
    [aiSubscriptions, []], [aiSubscriptionPrices, []], [aiSubscriptionConnections, []],
    [companySecrets, [{ id: "source-secret", companyId: "source", epoch: 0, status: "active", deletedAt: null }]],
  ]);
  const reads: { table: object; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  let serial = 0;
  const source = selection("source", false);
  owners.set(source.grant.id, { ...source, binding: { accountId: "account", accountRevision: 1, linkId: null, linkRevision: null } });
  function selection(companyId: string, alias: boolean): AiCredentialSelection {
    const value = {
      connection: { id: `${companyId}-connection`, companyId, name: `${companyId} subscription`,
        enabled: true, status: "active", connectionPurpose: "ai", config: { ai: { provider: "openai", method: "subscription" } } },
      grant: { id: `${companyId}-grant`, companyId, connectionId: `${companyId}-connection`, kind: "organization",
        subjectUserId: null, status: "active", credentialSecretRefs: alias ? [] : [{ configPath: "ai.credential", secretId: "source-secret" }] },
    } as unknown as AiCredentialSelection;
    selections.set(value.grant.id, value);
    return value;
  }
  function matching(table: object, where: SQL | undefined, row: Row) {
    if (!where) return true;
    const query = dialect.sqlToQuery(where);
    const columns = getTableColumns(table as Parameters<typeof getTableColumns>[0]);
    return [...query.sql.matchAll(/"([^"]+)"\."([^"]+)" = \$(\d+)/g)].every(([, relation, name, index]) => {
      if (relation !== getTableName(table as Parameters<typeof getTableName>[0])) return true;
      const field = Object.entries(columns).find(([, column]) => column.name === name)?.[0];
      return field !== undefined && row[field] === query.params[Number(index) - 1];
    });
  }
  const db = {
    transaction: async (work: (tx: Db) => unknown) => work(db as unknown as Db),
    execute: async () => undefined,
    select: () => {
      let table: object, condition: SQL | undefined;
      const query = {
        from(value: object) { table = value; return query; },
        innerJoin() { return query; },
        where(value: SQL) { condition = value; return query; },
        for() { return query; },
        then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
          reads.push({ table, params: condition ? dialect.sqlToQuery(condition).params : [] });
          const result = table === connectionGrants
            ? [...selections.values()].filter(value => matching(table, condition, value.grant) && matching(toolConnections, condition, value.connection))
            : (rows.get(table) ?? []).filter(row => matching(table, condition, row));
          return Promise.resolve(structuredClone(result)).then(resolve, reject);
        },
      };
      return query;
    },
    insert: (table: object) => ({ values: (value: Row) => {
      let inserted: Row | undefined;
      const save = () => {
        if (inserted) return inserted;
        inserted = { id: `row-${++serial}`, revision: 0, ownerUserIds: [], shared: false, mergedIntoId: null,
          status: "active", amountCents: null, currency: "USD", cadence: "month", ...structuredClone(value) };
        rows.get(table)!.push(inserted); return inserted;
      };
      return {
        returning: async () => [structuredClone(save())],
        onConflictDoUpdate: async ({ set }: { set: Row }) => {
          const existing = rows.get(table)!.find(row => row.companyId === value.companyId && row.grantId === value.grantId);
          if (existing) Object.assign(existing, set); else save();
        },
        then: (resolve: (value: void) => unknown) => Promise.resolve().then(() => { save(); }).then(resolve),
      };
    } }),
    update: (table: object) => ({ set: (value: Row) => ({ where: (condition: SQL) => {
      const updated = (rows.get(table) ?? []).filter(row => matching(table, condition, row));
      const save = () => { for (const row of updated) Object.assign(row, structuredClone(value)); return structuredClone(updated); };
      return { returning: async () => save(), then: (resolve: (value: Row[]) => unknown) => Promise.resolve().then(save).then(resolve) };
    } }) }),
  } as unknown as Db;
  mocks.resolve.mockImplementation(async (_db: Db, selected: AiCredentialSelection) => structuredClone(owners.get(selected.grant.id)));
  async function input(companyId: string): Promise<SubscriptionConnection> {
    const selected = selections.get(`${companyId}-grant`) ?? selection(companyId, true);
    if (!owners.has(selected.grant.id)) owners.set(selected.grant.id, { ...source,
      binding: { accountId: "account", accountRevision: 1, linkId: `${companyId}-link`, linkRevision: 1 } });
    return { companyId, connectionId: selected.connection.id, grantId: selected.grant.id, provider: "openai",
      name: selected.connection.name, ownerUserId: null, credential: "fixture-credential", session: await subscriptionSession(db, selected) };
  }
  function observed(input: SubscriptionConnection, plan = "plus"): SubscriptionIdentity {
    return { ...subscriptionCredentialIdentity(input.companyId, input.provider, input.credential),
      accountKey: `${input.companyId}-seat`, verified: true, plan };
  }
  return { db, rows, reads, selections, owners, input, observed, service: subscriptionService(db) };
}

beforeEach(() => vi.clearAllMocks());

describe("company-local reporting for a shared account", () => {
  it("reads the canonical secret generation while retaining the alias company identity", async () => {
    const f = fixture(), input = await f.input("alias");
    expect(f.selections.get(input.grantId)?.grant.credentialSecretRefs).toEqual([]);
    expect(input.session).toMatchObject({ secretId: "source-secret", epoch: 0,
      credentialOwner: { companyId: "source", binding: { linkId: "alias-link", linkRevision: 1 } } });
    expect(f.reads.filter(read => read.table === companySecrets).map(read => read.params)).toEqual([["source", "source-secret"]]);
    await f.service.register(input, f.observed(input));
    expect(f.rows.get(aiSubscriptions)).toMatchObject([{ companyId: "alias", ownerUserIds: [], shared: true }]);
    expect(f.rows.get(aiSubscriptionConnections)).toMatchObject([{ companyId: "alias", grantId: "alias-grant", connectionId: "alias-connection" }]);
  });

  it("charges only the source seat automatically across two independently attributed aliases", async () => {
    const f = fixture();
    for (const companyId of ["source", "first", "second"]) {
      const input = await f.input(companyId), id = await f.service.register(input, f.observed(input));
      expect(await f.service.register(input)).toBe(id);
    }
    expect(f.rows.get(aiSubscriptions)).toHaveLength(3);
    const prices = f.rows.get(aiSubscriptionPrices)!;
    expect(prices.filter(price => price.status === "active")).toMatchObject([
      { companyId: "source", amountCents: "2000.0000000", source: "catalog" },
    ]);
    expect(prices.filter(price => price.companyId !== "source")).toMatchObject([
      { companyId: "first", amountCents: null, source: "unknown", status: "excluded" },
      { companyId: "second", amountCents: null, source: "unknown", status: "excluded" },
    ]);
    const first = await f.input("first");
    await f.service.register(first, f.observed(first, "go"));
    expect(prices.at(-1)).toMatchObject({ companyId: "first", amountCents: null, status: "excluded", plan: "go" });
  });

  it("preserves an explicit company price and its history through shared-account observations", async () => {
    const f = fixture(), input = await f.input("alias"), id = await f.service.register(input, f.observed(input));
    await f.service.updatePrice("alias", id, { expectedRevision: 0, plan: "Owner allocation", amountCents: "750",
      currency: "USD", cadence: "month", status: "active" }, { userId: "owner", canManage: true });
    const previous = structuredClone(f.rows.get(aiSubscriptionPrices));
    await f.service.register(input, f.observed(input, "go"));
    expect(f.rows.get(aiSubscriptionPrices)).toEqual(previous);
    expect(f.rows.get(aiSubscriptions)?.[0]).toMatchObject({ revision: 1, detectedPlan: "go" });
  });

  it.each([false, true])("rejects a stale epoch even for cached or verified registration (verified: %s)", async verified => {
    const f = fixture(), input = await f.input("alias");
    await f.service.register(input, f.observed(input));
    f.rows.get(companySecrets)![0].epoch++;
    await expect(f.service.register(input, verified ? f.observed(input, "go") : undefined)).rejects.toMatchObject({ status: 409 });
    expect(f.rows.get(aiSubscriptions)?.[0].detectedPlan).toBe("plus");
    expect(f.rows.get(aiSubscriptionPrices)).toHaveLength(1);
  });

  it.each(["accountRevision", "linkRevision"] as const)("rejects an earlier %s without writing a new observation", async revision => {
    const f = fixture(), input = await f.input("alias");
    await f.service.register(input, f.observed(input));
    f.owners.get(input.grantId)!.binding![revision]!++;
    await expect(f.service.register(input, f.observed(input, "go"))).rejects.toMatchObject({ status: 409 });
    expect(f.rows.get(aiSubscriptions)?.[0].detectedPlan).toBe("plus");
  });

  it("rechecks registered roots and stops before reading secrets when reuse authority is revoked", async () => {
    const f = fixture(), input = await f.input("source");
    expect(input.session?.credentialOwner).toEqual(aiCredentialOwnerSnapshot(f.owners.get(input.grantId)!));
    await f.service.register(input, f.observed(input));
    const before = f.reads.filter(read => read.table === companySecrets).length;
    mocks.resolve.mockRejectedValue(new Error("account unavailable"));
    await expect(f.service.register(input)).rejects.toThrow("account unavailable");
    expect(f.reads.filter(read => read.table === companySecrets)).toHaveLength(before);
  });
});
