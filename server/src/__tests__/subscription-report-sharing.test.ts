import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { aiSubscriptions, aiSubscriptionPrices, type Db } from "@paperclipai/db";
import { describe, expect, it } from "vitest";
import { subscriptionCostReport } from "../services/subscription-report.js";

type Query = { text: string; params: unknown[] };
function fixture(options: { source?: boolean; alias?: boolean; manual?: boolean; visible?: boolean } = {}) {
  const queries: Query[] = [], companyId = "local-company", subscriptionId = "local-subscription";
  const now = new Date().toISOString();
  const account = { id: subscriptionId, companyId, provider: "openai", accountKey: "local-digest", identityVerified: true,
    name: "Connected subscription", ownerUserIds: [], shared: true, revision: 0, createdAt: now };
  const price = { id: "price", companyId, subscriptionId, revision: 0, plan: "ChatGPT Plus", amountCents: options.alias && !options.manual ? null : "2000.0000000",
    currency: "USD", cadence: "month", status: options.alias && !options.manual ? "excluded" : "active",
    source: options.manual ? "user" : options.alias ? "unknown" : "catalog", effectiveAt: now };
  const db = drizzle(async (text, params) => {
    queries.push({ text, params });
    if (text.includes('from "companies"')) return { rows: [[companyId]] };
    if (text.includes('from "cost_events"') || text.includes('from "user"') || text.includes('from "auth_user"')) return { rows: [] };
    if (text.includes('from "ai_subscriptions"')) {
      if (text.startsWith('select "id", "merged_into_id"')) return { rows: [[subscriptionId, null]] };
      if (options.visible === false) return { rows: [] };
      if (text.includes('inner join "ai_subscription_prices"')) return {
        rows: [Object.keys(getTableColumns(aiSubscriptionPrices)).map(key => price[key as keyof typeof price] ?? null)],
      };
      if (text.startsWith('select "ai_subscription_connections"."subscription_id", exists')) return {
        rows: [[subscriptionId, options.alias ?? false, options.source ?? false]],
      };
      return { rows: [Object.keys(getTableColumns(aiSubscriptions)).map(key => account[key as keyof typeof account] ?? null)] };
    }
    throw new Error(`Unexpected report query: ${text}`);
  }) as unknown as Db;
  // SQL contract and DTO tests; this callback does not simulate PostgreSQL
  // isolation or substitute for the separately retained integration suite.
  db.transaction = ((work: (tx: Db) => Promise<unknown>) => work(db)) as unknown as Db["transaction"];
  return { queries, read: () => subscriptionCostReport(db, companyId, { userId: "local-reader", canManage: false }) };
}

describe("shared subscription report projection", () => {
  it("explains alias fees using only local visible-account metadata", async () => {
    const f = fixture({ alias: true }), report = await f.read();
    expect(report.accounts[0].workspaceAccount).toEqual({ role: "company_link" });
    expect(report.accounts[0].price).toMatchObject({ source: "unknown", amountCents: null, status: "excluded" });
    expect(report.monthlyTotals).toEqual([]);
    const query = f.queries.find(row => row.text.startsWith('select "ai_subscription_connections"."subscription_id", exists'))!;
    expect(query.params).toContain("local-reader");
    expect(query.params.filter(param => param === "local-company").length).toBeGreaterThanOrEqual(4);
    expect(query.text).toContain('"ai_workspace_account_links"."company_id" =');
    expect(query.text).toContain('"ai_workspace_account_links"."connection_id" = "ai_subscription_connections"."connection_id"');
    expect(query.text).toContain('"ai_workspace_account_links"."grant_id" = "ai_subscription_connections"."grant_id"');
    expect(query.text).not.toContain('"enabled"'); // A revoked link still explains its retained price.
    expect(JSON.stringify(report.accounts[0].workspaceAccount)).not.toMatch(/companyId|accountId|owner|name|price|usage|credential/);
  });

  it("retains the original automatic source fee", async () => {
    const f = fixture({ source: true }), report = await f.read();
    expect(report.accounts[0].workspaceAccount).toEqual({ role: "source" });
    expect(report.monthlyTotals).toEqual([{ currency: "USD", amountCents: "2000.0000000", estimatedCount: 1 }]);
  });

  it("preserves explicit company prices alongside the reuse explanation", async () => {
    const f = fixture({ alias: true, manual: true }), report = await f.read();
    expect(report.accounts[0].workspaceAccount).toEqual({ role: "company_link" });
    expect(report.accounts[0].price).toMatchObject({ source: "user", revision: 0, amountCents: "2000.0000000", status: "active" });
    expect(report.monthlyTotals).toEqual([{ currency: "USD", amountCents: "2000.0000000", estimatedCount: 0 }]);
    expect(f.queries.some(query => /^(insert|update|delete) /i.test(query.text))).toBe(false);
  });

  it("does not expose a hidden subscription's sharing metadata", async () => {
    const report = await fixture({ alias: true, visible: false }).read();
    expect(report.accounts).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("company_link");
  });

  it("keeps ordinary company subscriptions distinct from workspace accounts", async () => {
    const report = await fixture().read();
    expect(report.accounts[0].workspaceAccount).toBeNull();
  });
});
