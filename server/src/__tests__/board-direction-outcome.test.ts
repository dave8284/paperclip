import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { describe, expect, it } from "vitest";
import { readBoardDirectionOutcome } from "../services/board-direction-outcome.js";

function fixture() {
  const company = randomUUID(), issue = randomUUID(), run = randomUUID(), agent = randomUUID(), review = randomUUID(), decision = randomUUID();
  const finished = new Date("2026-01-01T00:01:00Z"), resolved = new Date("2026-01-01T00:02:00Z");
  const runRow = [run, company, agent, issue, "succeeded", new Date("2026-01-01T00:00:00Z"), finished, true];
  const reviewRow: unknown[] = [review, company, issue, run, "request_confirmation", "accepted",
    { target: { type: "custom", key: "native_completion_review", revisionId: decision } }, `native-review:${decision}`, resolved, null, "independent-owner", null];
  const decisionRow = [decision, company, issue, run, "applied", "in_review"];
  return { company, issue, run, agent, review, decision, finished, resolved, runRow, reviewRow, decisionRow };
}
function controlled(rows: unknown[][][]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (!rows.length) throw new Error("Unexpected outcome dependency");
    return { rows: rows.shift()! };
  }) as unknown as Db;
  return { db, queries };
}
describe("bounded native board outcome evidence", () => {
  it("returns unknown execution when no native implementation run exists", async () => {
    const f = fixture(), { db, queries } = controlled([[]]);
    expect(await readBoardDirectionOutcome(db, f.company, f.issue)).toBeNull(); expect(queries).toHaveLength(1);
  });
  it.each(["queued", "running", "failed", "cancelled", "timed_out"])("keeps %s separate from independent acceptance", async status => {
    const f = fixture(); f.runRow[4] = status;
    const { db, queries } = controlled([[f.runRow]]);
    expect(await readBoardDirectionOutcome(db, f.company, f.issue)).toMatchObject({ runId: f.run, status, independentReview: null });
    expect(queries).toHaveLength(1);
  });
  it("does not equate a successful process with reviewed delivery", async () => {
    const f = fixture(), { db } = controlled([[f.runRow], []]);
    expect(await readBoardDirectionOutcome(db, f.company, f.issue)).toMatchObject({ status: "succeeded", independentReview: null });
  });
  it("reports exact human review as historical evidence with an explicit current-scope mismatch", async () => {
    const f = fixture(); f.runRow[7] = false;
    const { db, queries } = controlled([[f.runRow], [f.reviewRow], [f.decisionRow]]);
    const result = await readBoardDirectionOutcome(db, f.company, f.issue);
    expect(result).toMatchObject({ scopeMatchesCurrentTask: false, independentReview: { reviewId: f.review, verdict: "accepted", evaluator: "user:independent-owner", resolvedAt: f.resolved.toISOString() } });
    expect(result).not.toHaveProperty("businessOutcome");
    const statements = queries.map(query => query.sql).join("\n");
    expect(statements).toContain('"issues"."title"'); expect(statements).toContain('"issues"."description"');
    expect(statements).toContain("nativeReviewInteractionId"); expect(statements).toContain("executionPurpose");
    expect(statements).not.toMatch(/stdout_excerpt|stderr_excerpt|result_json|log_ref|usage_json|credential_bindings/);
    expect(queries[0].params).toContain(f.company); expect(queries[0].params).toContain(f.issue);
    expect(queries[0].params.at(-1)).toBe(1); expect(queries[1].params.at(-1)).toBe(2);
  });
  it("retains rejection independently of process success", async () => {
    const f = fixture(); f.reviewRow[5] = "rejected";
    const { db } = controlled([[f.runRow], [f.reviewRow], [f.decisionRow]]);
    expect(await readBoardDirectionOutcome(db, f.company, f.issue)).toMatchObject({ status: "succeeded", independentReview: { verdict: "rejected" } });
  });
  it("does not choose one of several ambiguous review records", async () => {
    const f = fixture(), { db, queries } = controlled([[f.runRow], [f.reviewRow, f.reviewRow]]);
    expect(await readBoardDirectionOutcome(db, f.company, f.issue)).toMatchObject({ independentReview: null }); expect(queries).toHaveLength(2);
  });
  it.each(["-".repeat(36), "f".repeat(36), "not-a-decision-id"])("keeps malformed review reference %s unverified without a UUID database error", async revisionId => {
    const f = fixture();
    f.reviewRow[6] = { target: { type: "custom", key: "native_completion_review", revisionId } };
    const { db, queries } = controlled([[f.runRow], [f.reviewRow]]);
    expect(await readBoardDirectionOutcome(db, f.company, f.issue)).toMatchObject({ independentReview: null });
    expect(queries).toHaveLength(2);
  });
  it.each(["foreign company", "other execution", "unapplied decision", "self review"])("rejects %s as acceptance", async condition => {
    const f = fixture();
    if (condition === "foreign company") f.reviewRow[1] = randomUUID();
    if (condition === "other execution") f.decisionRow[3] = randomUUID();
    if (condition === "unapplied decision") f.decisionRow[4] = "proposed";
    if (condition === "self review") { f.reviewRow[9] = f.agent; f.reviewRow[10] = null; }
    const { db } = controlled([[f.runRow], [f.reviewRow], [f.decisionRow]]);
    expect(await readBoardDirectionOutcome(db, f.company, f.issue)).toMatchObject({ independentReview: null });
  });
  it.each(["succeeded", "failed"])("requires the independent reviewer execution to succeed (%s)", async status => {
    const f = fixture(), reviewerRun = randomUUID(), reviewer = randomUUID();
    f.reviewRow[9] = reviewer; f.reviewRow[10] = null; f.reviewRow[11] = reviewerRun;
    const reviewerRow = [reviewerRun, f.company, reviewer, f.issue, status,
      { nativeReviewInteractionId: f.review, nativeReviewDecisionId: f.decision },
      { nativeReviewContextReceipt: { schema: "agentos.native-review-context-receipt.v1", companyId: f.company, issueId: f.issue,
        reviewerRunId: reviewerRun, references: { sourceRunId: f.run, sourceDecisionId: f.decision, reviewInteractionId: f.review } } }];
    const { db } = controlled([[f.runRow], [f.reviewRow], [f.decisionRow], [reviewerRow]]);
    const result = await readBoardDirectionOutcome(db, f.company, f.issue);
    if (status === "succeeded") expect(result?.independentReview).toMatchObject({ verdict: "accepted", evaluator: `agent:${reviewer}` });
    else expect(result?.independentReview).toBeNull();
  });
});
