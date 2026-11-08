import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { heartbeatRuns, issueThreadInteractions, statusDecisionEffects, statusDecisions, type Db } from "@paperclipai/db";
import { describe, expect, it } from "vitest";
import { nativeIndependentReviewVerdict, readNativeIndependentReview } from "./native-independent-review.js";
import { arbitrateNativeStatus } from "./native-runtime/status-arbiter.js";
import { nativeReviewCreationEffect, nativeReviewInteractionKey } from "./native-runtime/native-review-identity.js";

function fixture(requestKey: string | undefined = "attention-0") {
  const companyId = randomUUID(), issueId = randomUUID(), sourceId = randomUUID(), authorId = randomUUID(), decisionId = randomUUID(), reviewId = randomUUID(), reviewerId = randomUUID(), reviewerRunId = randomUUID();
  const run = { id: sourceId, companyId, issueId, agentId: authorId, finishedAt: new Date("2026-01-01T00:00:00Z") };
  const creation = { kind: "bind_reviewer", ...(requestKey === undefined ? {} : { requestKey }), prompt: "Review the completed packet", ownerUserId: null, ownerAgentId: reviewerId };
  const decision = { id: decisionId, companyId, issueId, runId: sourceId, applicationState: "applied", toStatus: "in_review",
    decisionJson: { statusAction: "in_review", toStatus: "in_review", reasonCode: "actionable_attention_pending", effects: [creation] } };
  const review = { id: reviewId, companyId, issueId, sourceRunId: sourceId, kind: "request_confirmation", status: "accepted",
    idempotencyKey: nativeReviewInteractionKey(decisionId, requestKey),
    payload: { target: { type: "custom", key: "native_completion_review", revisionId: decisionId } },
    addresseeAgentId: reviewerId, addresseeUserId: null, resolvedByAgentId: reviewerId, resolvedByUserId: null, resolvedByRunId: reviewerRunId,
    resolvedAt: new Date("2026-01-01T00:00:01Z") };
  const materialized = { companyId, issueId, decisionId, ordinal: 1, effectKind: "bind_reviewer", targetType: "issue_thread_interaction", targetId: reviewId,
    idempotencyKey: `native-status:${decisionId}:1`, deliveryState: "delivered",
    payload: { interactionId: reviewId, interactionKind: "request_confirmation", ownerUserId: null, ownerAgentId: reviewerId } };
  const reviewer = { id: reviewerRunId, companyId, agentId: reviewerId, nativeIssueId: issueId, status: "succeeded",
    contextSnapshot: { nativeReviewInteractionId: reviewId, nativeReviewDecisionId: decisionId },
    runnerProfileJson: { nativeReviewContextReceipt: { schema: "agentos.native-review-context-receipt.v1", companyId, issueId, reviewerRunId,
      references: { sourceRunId: sourceId, sourceDecisionId: decisionId, reviewInteractionId: reviewId } } } };
  const verdict = () => nativeIndependentReviewVerdict(run, review, decision, reviewer, materialized);
  return { run, review, decision, reviewer, materialized, creation, verdict };
}

/** SQL transport exercises the real bounded reader/projection, not PG locking. */
function database(f: ReturnType<typeof fixture>, options: { duplicateReviews?: boolean; duplicateEffects?: boolean; omitEffect?: boolean } = {}) {
  const tables = [heartbeatRuns, issueThreadInteractions, statusDecisionEffects, statusDecisions];
  const data: Record<string, Record<string, unknown>[]> = {
    heartbeat_runs: [f.reviewer], issue_thread_interactions: options.duplicateReviews ? [f.review, { ...f.review, id: randomUUID() }] : [f.review],
    status_decisions: [f.decision], status_decision_effects: options.omitEffect ? [] : options.duplicateEffects ? [f.materialized, { ...f.materialized, ordinal: 2 }] : [f.materialized],
  };
  const statements: string[] = [];
  const db = drizzle(async query => {
    statements.push(query);
    const name = query.match(/ from "([^"]+)"/)?.[1], table = tables.find(table => getTableName(table) === name);
    if (!name || !table || !query.startsWith("select ")) throw new Error(`Unexpected query: ${query}`);
    const columns = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]));
    const projections = query.slice(7, query.indexOf(" from ")).split(/,(?![^()]*\))/);
    const keys = projections.map(expression => columns[expression.match(/"([^"]+)"/)![1]]);
    return { rows: data[name].map(row => keys.map(key => row[key] instanceof Date ? (row[key] as Date).toISOString() : row[key] ?? null)) };
  }) as unknown as Db;
  return { db, statements };
}

describe("native review creation identity", () => {
  it("recognizes the actual attention-0 creation shape and completed independent reviewer", () => {
    const f = fixture();
    expect(f.review.idempotencyKey).toBe(`native-review:${f.decision.id}:attention-0`);
    expect(f.verdict()).toMatchObject({ outcome: "passed", evaluator: `agent:${f.reviewer.agentId}`, reviewId: f.review.id });
    f.review.status = "rejected";
    expect(f.verdict()?.outcome).toBe("failed");
  });
  it("recognizes a decision emitted by the native arbiter for an explicit review request", () => {
    const f = fixture();
    const emitted = arbitrateNativeStatus({ terminalState: "succeeded", workspaceFinalizeStatus: "succeeded", agentId: f.run.agentId,
      priorIssueStatus: "in_progress", assessment: {
        objectiveClaimSatisfied: true, objectiveSatisfied: true, allCriteriaSatisfied: true, verificationPassed: true,
        hasFailedVerification: false, hasBlockingRemainingWork: false, reportedDisposition: "done", summary: "Packet prepared",
        contractRevisionMatches: true, criterionAssessments: [], verificationAssessments: [], verificationCaveats: [],
        acceptedEvidenceRefs: ["event:2"], missingRequirements: [], rejectedEvidence: [], unverifiableEvidence: [], blocker: null,
        continuation: null, ignoredAttentionRequests: [], attentionRequests: [{ kind: "review", summary: "Review the packet",
          ownerClass: "agent", targetAgentId: f.reviewer.agentId, sourceIndex: 0, sourceKind: "review", legacy: false }],
      } });
    expect(emitted).toMatchObject({ statusAction: "in_review", toStatus: "in_review", effects: [{ kind: "bind_reviewer", requestKey: "attention-0" }] });
    const decision = { ...f.decision, toStatus: emitted.toStatus, decisionJson: { ...emitted } };
    expect(nativeIndependentReviewVerdict(f.run, f.review, decision, f.reviewer, f.materialized)?.outcome).toBe("passed");
  });
  it("preserves the canonical default key only with its persisted creation/effect evidence", () => {
    const f = fixture();
    delete (f.creation as { requestKey?: string }).requestKey;
    f.review.idempotencyKey = nativeReviewInteractionKey(f.decision.id);
    expect(f.verdict()?.outcome).toBe("passed");
    expect(nativeIndependentReviewVerdict(f.run, f.review, f.decision, f.reviewer, null)).toBeNull();
  });
  it.each(["attention-1", "attention-00", "attention-0:extra", "arbitrary", ""])("rejects an uncreated key suffix %s", suffix => {
    const f = fixture(); f.review.idempotencyKey = nativeReviewInteractionKey(f.decision.id, suffix);
    expect(f.verdict()).toBeNull();
  });
  it("preserves the one-based ordinal when the reviewer effect is not first", () => {
    const f = fixture();
    f.decision.decisionJson.effects = [{ kind: "release_checkout" } as typeof f.creation, f.creation];
    f.materialized.ordinal = 2; f.materialized.idempotencyKey = `native-status:${f.decision.id}:2`;
    expect(f.verdict()?.outcome).toBe("passed");
  });
  it.each(["missing effects", "duplicate identity", "malformed request key", "wrong effect kind"])("rejects %s", kind => {
    const f = fixture();
    if (kind === "missing effects") f.decision.decisionJson.effects = [];
    if (kind === "duplicate identity") f.decision.decisionJson.effects = [f.creation, { ...f.creation }];
    if (kind === "malformed request key") Object.assign(f.creation, { requestKey: 0 });
    if (kind === "wrong effect kind") f.creation.kind = "create_interaction";
    expect(f.verdict()).toBeNull();
  });
  it.each(["company", "decision", "interaction", "ordinal", "effect key", "delivery", "payload target", "payload owner", "addressee"])("rejects mismatched materialized %s", kind => {
    const f = fixture();
    if (kind === "company") f.materialized.companyId = randomUUID();
    if (kind === "decision") f.materialized.decisionId = randomUUID();
    if (kind === "interaction") f.materialized.targetId = randomUUID();
    if (kind === "ordinal") f.materialized.ordinal = 2;
    if (kind === "effect key") f.materialized.idempotencyKey = "forged";
    if (kind === "delivery") f.materialized.deliveryState = "pending";
    if (kind === "payload target") f.materialized.payload.interactionId = randomUUID();
    if (kind === "payload owner") f.materialized.payload.ownerAgentId = randomUUID();
    if (kind === "addressee") f.review.addresseeAgentId = randomUUID();
    expect(f.verdict()).toBeNull();
  });
  it.each(["source run", "unapplied", "wrong status", "resolving run", "unfinished reviewer", "receipt source"])("preserves exact %s authority", kind => {
    const f = fixture();
    if (kind === "source run") f.review.sourceRunId = randomUUID();
    if (kind === "unapplied") f.decision.applicationState = "proposed";
    if (kind === "wrong status") f.decision.toStatus = "done";
    if (kind === "resolving run") f.review.resolvedByRunId = randomUUID();
    if (kind === "unfinished reviewer") f.reviewer.status = "running";
    if (kind === "receipt source") f.reviewer.runnerProfileJson.nativeReviewContextReceipt.references.sourceRunId = randomUUID();
    expect(f.verdict()).toBeNull();
  });
  it("does not make the shared identity helper accept ambiguous default aliases", () => {
    expect(nativeReviewCreationEffect("decision", { effects: [{ kind: "bind_reviewer" }, { kind: "bind_reviewer", requestKey: "" }] }, "native-review:decision")).toBeNull();
  });
});

describe("native independent review reader", () => {
  it("reads the exact stored effect before reporting an attention review", async () => {
    const f = fixture(), transport = database(f);
    expect(await readNativeIndependentReview(transport.db, f.run)).toMatchObject({ outcome: "passed", reviewId: f.review.id });
    expect(transport.statements).toHaveLength(4);
    expect(transport.statements[2]).toContain('from "status_decision_effects"');
    expect(transport.statements.every(statement => statement.startsWith("select "))).toBe(true);
  });
  it.each(["duplicateReviews", "duplicateEffects", "omitEffect"] as const)("keeps %s unknown", async kind => {
    const f = fixture(), transport = database(f, { [kind]: true });
    expect(await readNativeIndependentReview(transport.db, f.run)).toBeNull();
    expect(transport.statements.some(statement => statement.includes('from "heartbeat_runs"'))).toBe(false);
  });
});
