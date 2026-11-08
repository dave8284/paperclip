import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { companyMemberships, type Db } from "@paperclipai/db";
import { describe, expect, it, vi } from "vitest";
import { accessService } from "./access.js";

type Member = { id: string; companyId: string; principalType: string; principalId: string; status: string; membershipRole: string };
const baseMember: Member = { id: "membership", companyId: "company", principalType: "user", principalId: "owner", status: "active", membershipRole: "owner" };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(options: { member?: Member | null; lockWait?: Promise<void>; concurrentMember?: Member; disappear?: boolean } = {}) {
  let member = options.member === undefined ? { ...baseMember } : options.member;
  let transaction = 0;
  const queries: { text: string; params: unknown[]; transaction: number }[] = [];
  const db = drizzle(async (text, params) => {
    queries.push({ text, params, transaction });
    if (text.includes('from "company_memberships"')) {
      if (text.includes("for update") && options.lockWait) await options.lockWait;
      if (!member) return { rows: [] };
      return { rows: [text.startsWith('select "id" from') ? [member.id]
        : Object.keys(getTableColumns(companyMemberships)).map(key => member?.[key as keyof Member] ?? null)] };
    }
    if (text.startsWith('insert into "company_memberships"')) {
      if (!options.disappear) member = options.concurrentMember ?? { ...baseMember, principalType: "agent", principalId: "new-agent", membershipRole: "member" };
      return { rows: [] };
    }
    if (text.includes('from "principal_permission_grants"')) return { rows: [] };
    if (/^(insert into|update|delete from) "principal_permission_grants"/.test(text)) return { rows: [] };
    throw new Error(`Unexpected authority query: ${text}`);
  }) as unknown as Db;
  // This exercises the real SQL writer and a controlled lock wait. PostgreSQL
  // locking semantics remain covered by the separately retained DB suite.
  db.transaction = (async (work: (tx: Db) => Promise<unknown>) => {
    transaction++;
    try { return await work(db); } finally { transaction--; }
  }) as unknown as Db["transaction"];
  return { service: accessService(db), queries, member: () => member };
}

describe("permission writes retain native membership authority", () => {
  it.each([
    { membershipRole: "owner", status: "active" },
    { membershipRole: "admin", status: "suspended" },
    { membershipRole: "viewer", status: "archived" },
  ])("does not change membership when granting permission: %j", async state => {
    const member = { ...baseMember, ...state }, f = fixture({ member });
    await f.service.setPrincipalPermission("company", "user", "owner", "tools:manage_connections", true, "operator");
    expect(f.member()).toEqual(member);
    expect(f.queries[0].text).toContain('from "company_memberships"');
    expect(f.queries[0].text).toContain("for update");
    expect(f.queries.every(query => query.transaction === 1)).toBe(true);
    expect(f.queries.filter(query => query.text.startsWith('insert into "principal_permission_grants"'))).toHaveLength(1);
  });

  it.each(["single", "replace", "clear"] as const)("waits for parent authority before writing %s permissions even when no rules exist", async mode => {
    const gate = deferred(), f = fixture({ lockWait: gate.promise });
    const pending = mode === "single"
      ? f.service.setPrincipalPermission("company", "user", "owner", "tools:manage_connections", true, "operator")
      : f.service.setPrincipalGrants("company", "user", "owner", mode === "clear" ? [] : [{ permissionKey: "tools:manage_connections" }], "operator");
    await vi.waitFor(() => expect(f.queries).toHaveLength(1));
    expect(f.queries[0]).toMatchObject({ transaction: 1, params: ["company", "user", "owner"] });
    expect(f.queries[0].text).toContain("for update");
    expect(f.queries.some(query => /^(insert|update|delete) /i.test(query.text))).toBe(false);
    gate.resolve(); await pending;
    expect(f.queries.some(query => /^(insert|update|delete) /i.test(query.text))).toBe(true);
  });

  it("retains intentional agent membership creation inside the same locked operation", async () => {
    const f = fixture({ member: null });
    await f.service.setPrincipalPermission("company", "agent", "new-agent", "tasks:assign", true, "operator");
    const memberInsert = f.queries.findIndex(query => query.text.startsWith('insert into "company_memberships"'));
    const permissionInsert = f.queries.findIndex(query => query.text.startsWith('insert into "principal_permission_grants"'));
    expect(f.queries[memberInsert].text).toContain("on conflict do nothing");
    expect(f.queries.slice(memberInsert + 1, permissionInsert).some(query => query.text.includes('from "company_memberships"') && query.text.includes("for update"))).toBe(true);
    expect(f.queries.every(query => query.transaction === 1)).toBe(true);
  });

  it("does not overwrite a concurrently created membership", async () => {
    const member = { ...baseMember, status: "suspended" }, f = fixture({ member: null, concurrentMember: member });
    await f.service.setPrincipalPermission("company", "user", "owner", "tools:manage_connections", true, "operator");
    expect(f.member()).toEqual(member);
    expect(f.queries.some(query => query.text.startsWith('update "company_memberships"'))).toBe(false);
  });

  it("rejects a disappearing membership before inserting permission authority", async () => {
    const f = fixture({ member: null, disappear: true });
    await expect(f.service.setPrincipalPermission("company", "user", "owner", "tools:manage_connections", true, "operator")).rejects.toMatchObject({ status: 409 });
    expect(f.queries.some(query => query.text.startsWith('insert into "principal_permission_grants"'))).toBe(false);
  });

  it("can remove a stale permission without recreating a missing membership", async () => {
    const f = fixture({ member: null });
    await f.service.setPrincipalPermission("company", "user", "owner", "tools:manage_connections", false, "operator");
    expect(f.member()).toBeNull();
    expect(f.queries.some(query => query.text.startsWith('insert into "company_memberships"'))).toBe(false);
    expect(f.queries.at(-1)?.text).toContain('delete from "principal_permission_grants"');
  });
});
