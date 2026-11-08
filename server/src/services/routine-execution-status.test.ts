import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { issues, routineRuns, type Db } from "@paperclipai/db";
import { describe, expect, it, vi } from "vitest";
import { syncRoutineRunStatusForIssue } from "./routine-execution-status.js";

function fixture() {
  const issue = { id: randomUUID(), companyId: randomUUID(), originKind: "routine_execution",
    originId: randomUUID(), originRunId: randomUUID(), status: "done" };
  let run = { id: issue.originRunId, status: "issue_created", failureReason: null as string | null,
    triggerPayload: { input: "retained" } as Record<string, unknown>, completedAt: null as Date | null };
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let rowVisible = true;
  const dialect = new PgDialect();
  const update = vi.fn(() => {
    let patch: Partial<typeof run>;
    const builder = { set(value: Partial<typeof run>) { patch = value; return builder; },
      where(value: Parameters<PgDialect["sqlToQuery"]>[0]) { statements.push(dialect.sqlToQuery(value)); return builder; },
      returning: async () => { run = { ...run, ...patch }; return [run]; } };
    return builder;
  });
  const db = { update, select: () => {
    let table: unknown;
    const builder = { from(value: unknown) { table = value; return builder; }, innerJoin() { return builder; },
      where(value: Parameters<PgDialect["sqlToQuery"]>[0]) { statements.push(dialect.sqlToQuery(value)); return builder; },
      for: vi.fn(() => builder), then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(table === issues ? [issue] : rowVisible ? [run] : []).then(resolve);
      } };
    return builder;
  } } as unknown as Db;
  return { issue, db, update, statements, read: () => run, hide: () => { rowVisible = false; },
    setRun: (patch: Partial<typeof run>) => { run = { ...run, ...patch }; },
    sync: () => syncRoutineRunStatusForIssue(db, issue.id) };
}

describe("native routine task settlement", () => {
  it("records completion once and preserves request input and the original completion time on replay", async () => {
    const f = fixture();
    const first = await f.sync();
    expect(first).toMatchObject({ status: "completed", triggerPayload: { input: "retained" }, failureReason: null });
    expect(first?.completedAt).toBeInstanceOf(Date);
    expect(await f.sync()).toBeNull();
    expect(f.read().completedAt).toBe(first?.completedAt);
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.update).toHaveBeenCalledWith(routineRuns);
    const predicate = f.statements.find(statement => statement.params.includes("issue_created"))!;
    expect(predicate.params).toEqual([f.issue.originRunId, f.issue.companyId, f.issue.originId, f.issue.id, "issue_created"]);
    expect(predicate.sql).toContain('"routine_runs"."linked_issue_id" =');
  });

  it.each(["blocked", "cancelled"])("retains %s evidence through resume and eventual completion", async status => {
    const f = fixture(); f.issue.status = status;
    expect(await f.sync()).toMatchObject({ status: "failed", triggerPayload: { input: "retained", transientFailure: { status } } });
    expect(await f.sync()).toBeNull();
    f.issue.status = "in_progress";
    expect(await f.sync()).toMatchObject({ status: "issue_created", completedAt: null,
      triggerPayload: { transientFailure: { status, clearedAt: expect.any(String) } } });
    f.issue.status = "done";
    expect(await f.sync()).toMatchObject({ status: "completed", triggerPayload: { input: "retained",
      transientFailure: { status, clearedAt: expect.any(String) } } });
  });

  it.each(["received", "coalesced", "skipped", "failed"])("does not overwrite independent %s dispatch outcomes", async status => {
    const f = fixture(); f.setRun({ status, failureReason: "actual dispatch failure" });
    expect(await f.sync()).toBeNull(); expect(f.update).not.toHaveBeenCalled();
  });

  it("requires the exact company/routine/task binding and ignores non-routine tasks", async () => {
    const f = fixture(); f.hide();
    expect(await f.sync()).toBeNull(); expect(f.update).not.toHaveBeenCalled();
    expect(f.statements.at(-1)!.params).toEqual([f.issue.originRunId, f.issue.companyId, f.issue.originId, f.issue.id]);
    f.issue.originKind = "manual"; f.statements.length = 0;
    expect(await f.sync()).toBeNull(); expect(f.statements).toHaveLength(1);
  });

  it("propagates persistence failure so the caller's task transaction cannot acknowledge success", async () => {
    const f = fixture(); f.update.mockImplementationOnce(() => { throw new Error("cycle write failed"); });
    await expect(f.sync()).rejects.toThrow("cycle write failed");
    expect(f.read().status).toBe("issue_created");
  });
});
