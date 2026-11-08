import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { issueService } from "../services/issues.js";
import type { ImportIssueRow } from "../services/import-write-types.js";

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({ getExperimental: async () => ({ enableIsolatedWorkspaces: false }) }),
}));

// These guards exercise the real service entry points and SQL predicates, not
// persistence or locking. The companion PostgreSQL cases cover those boundaries.
function guardDb(reads: unknown[][]) {
  const predicates: SQL[] = [];
  const locks: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const db = {
    select: vi.fn(() => ({ from: () => ({ where: (predicate: SQL) => {
      predicates.push(predicate);
      if (reads.length === 0) throw new Error("Unexpected read after parent admission");
      const result = Promise.resolve(reads.shift()!);
      return Object.assign(result, { for: (lock: string) => { locks.push(lock); return result; }, orderBy: () => result });
    } }) })),
    execute: vi.fn(async () => []),
    insert: vi.fn(() => ({ values: async (rows: Record<string, unknown>[]) => { inserted.push(...rows); } })),
    update: vi.fn(() => ({ set: () => ({ where: async () => [] }) })),
    transaction: vi.fn(async (fn: (tx: Db) => Promise<unknown>) => fn(db as unknown as Db)),
  };
  return { db, predicates, locks, inserted };
}

function importRow(id: string, parentId: string | null): ImportIssueRow {
  return { id, ref: id, parentId, title: "Imported task", description: null, projectId: null,
    projectWorkspaceId: null, assigneeAgentId: null, status: "backlog", priority: "medium",
    billingCode: null, assigneeAdapterOverrides: null, executionWorkspaceSettings: null,
    labelIds: [], monitorNotes: null, monitorScheduledBy: null };
}

describe("company-owned task parent guards", () => {
  it("rejects an unavailable parent even when workspace inheritance is disabled", async () => {
    const companyId = randomUUID();
    const parentId = randomUUID();
    const { db, predicates, locks } = guardDb([[]]);
    await expect(issueService(db as unknown as Db).create(companyId, {
      title: "Company-local work", parentId, skipExecutionWorkspaceInheritance: true,
    })).rejects.toMatchObject({ status: 404, message: "Parent task not found" });
    const query = new PgDialect().sqlToQuery(predicates[0]!);
    expect(query.sql).toContain('"issues"."company_id"');
    expect(query.params).toEqual([parentId, companyId]);
    expect(locks).toEqual(["share"]);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects reparenting before any write when the parent is outside the company", async () => {
    const companyId = randomUUID();
    const id = randomUUID();
    const parentId = randomUUID();
    const { db, predicates } = guardDb([[{ id, companyId, parentId: null }], []]);
    await expect(issueService(db as unknown as Db).update(id, { parentId }))
      .rejects.toMatchObject({ status: 404, message: "Parent task not found" });
    expect(new PgDialect().sqlToQuery(predicates[1]!).params).toEqual([parentId, companyId]);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rechecks parent ownership after waiting for the update transaction", async () => {
    const current = { id: randomUUID(), companyId: randomUUID(), parentId: null, status: "backlog",
      assigneeAgentId: null, assigneeUserId: null, projectId: null, conversationAgentId: null };
    const parentId = randomUUID();
    const { db, predicates, locks } = guardDb([[current], [{ conversationAgentId: null }], [current], []]);
    await expect(issueService(db as unknown as Db).update(current.id, { parentId }))
      .rejects.toMatchObject({ status: 404, message: "Parent task not found" });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(new PgDialect().sqlToQuery(predicates.at(-1)!).params).toEqual([parentId, current.companyId]);
    expect(locks).toEqual(["update", "share"]);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("retains the ban on conversation subtasks in the same company", async () => {
    const { db } = guardDb([[{ conversationAgentId: randomUUID() }]]);
    await expect(issueService(db as unknown as Db).create(randomUUID(), {
      title: "Invalid chat child", parentId: randomUUID(), skipExecutionWorkspaceInheritance: true,
    })).rejects.toMatchObject({ status: 422 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("keeps pending parents in the same import batch company-owned", async () => {
    const companyId = randomUUID();
    const parentId = randomUUID();
    const childId = randomUUID();
    const { db, inserted } = guardDb([[{ maxNum: 0 }], [{ issueCounter: 0, issuePrefix: "LOCAL" }], [], [], []]);
    await issueService(db as unknown as Db).importIssues(companyId, [importRow(parentId, null), importRow(childId, parentId)]);
    expect(inserted).toEqual([
      expect.objectContaining({ id: parentId, companyId, parentId: null }),
      expect.objectContaining({ id: childId, companyId, parentId }),
    ]);
  });

  it("rejects an import parent outside the batch and target company before inserting tasks", async () => {
    const companyId = randomUUID();
    const parentId = randomUUID();
    const { db, predicates } = guardDb([[{ maxNum: 0 }], [{ issueCounter: 0, issuePrefix: "LOCAL" }], [], [], [], []]);
    await expect(issueService(db as unknown as Db).importIssues(companyId, [importRow(randomUUID(), parentId)]))
      .rejects.toMatchObject({ status: 404, message: "Parent task not found" });
    expect(new PgDialect().sqlToQuery(predicates.at(-1)!).params).toEqual([parentId, companyId]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
