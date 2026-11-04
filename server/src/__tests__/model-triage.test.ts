import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import type { DecisionAnswer, DecisionRequest } from "@paperclipai/shared";
import { localTriageModelId, type LocalTriageResult } from "../services/local-triage.js";
import { buildModelTriageQuestions, observeModelTriage, readModelTriageObservation, type ModelTriageInput } from "../services/model-triage.js";

const input: ModelTriageInput = {
  context: { companyId: "company", issueId: "task", actor: { type: "agent", companyId: "company", agentId: "agent", runId: "run" } },
  runId: "run", taskId: "task", agentId: "agent", title: "Implement a feature", description: null,
  candidates: [{ id: "baseline", label: "Configured profile" }, { id: "candidate", label: "Candidate profile" }], selectedCandidateId: "baseline",
};
function database(subscriptionOnly = false) {
  const queries: { text: string; params: unknown[] }[] = [];
  const db = drizzle(async (text, params) => { queries.push({ text, params }); return { rows: subscriptionOnly ? [["company"]] : [] }; }) as unknown as Db;
  return { db, queries };
}
function answers(request: DecisionRequest, choices: Record<string, string> = {}) {
  return Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type !== "choice") throw new Error("Unexpected question type");
    const choice = choices[id] ?? ({ task_family: "engineering.building", any_fit: "yes", profile: "candidate_1", complexity: "routine" } as Record<string, string>)[id];
    return [id, { type: "choice", choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map(option => [option, option === choice ? 1 : 0])), confidence: 1 }];
  })) as Record<string, DecisionAnswer>;
}
const success = (request: DecisionRequest): LocalTriageResult => ({ status: "succeeded", requestId: "local-request", reason: "local_observation", answers: answers(request), elapsedMs: 12, inputTokens: 230, outputTokens: 0 });

describe("bounded local triage shadow", () => {
  it("runs the local lane for subscription-only companies without paid authority or a model change", async () => {
    const { db, queries } = database(true); const decide = vi.fn(async (request: DecisionRequest) => success(request));
    const receipt = await observeModelTriage(db, input, { local: { decide } });
    expect(receipt.decision).toMatchObject({ status: "observed", provider: "local_laya", computationKind: "local_encoder", funding: "local_compute", invocationId: null, localRequestId: "local-request", costCents: null, costStatus: "unpriced", elapsedMs: 12, requestedModel: localTriageModelId, resolvedModel: localTriageModelId });
    expect(receipt).toMatchObject({ computationKind: "deterministic_classification", taskType: "engineering.building", selectedCandidateId: "baseline", routeChangedByTriage: false, reviewEvidence: "not_established_by_triage" });
    expect(decide).toHaveBeenCalledOnce(); expect(queries).toHaveLength(0);
    expect(JSON.stringify(receipt)).not.toContain(input.title);
  });
  it.each(["local_disabled", "local_setup_required", "local_warming_up", "local_busy"])("retains the baseline on %s with no invented inference", async reason => {
    const { db } = database(); const decide = vi.fn(async (): Promise<LocalTriageResult> => ({ status: "not_run", reason }));
    const result = await observeModelTriage(db, input, { local: { decide } });
    expect(result.decision).toMatchObject({ status: "not_run", reason, invocationId: null, localRequestId: null, resolvedModel: null, costCents: null, elapsedMs: null, computationKind: "not_run" });
    expect(result.selectedCandidateId).toBe("baseline"); expect(result.decision.funding).toBe("local_compute");
  });
  it("does not let a routine decision remove the deterministic complex review recommendation", async () => {
    const { db } = database(); const decide = vi.fn(async (request: DecisionRequest) => success(request));
    const receipt = await observeModelTriage(db, { ...input, title: "Critical security migration" }, { local: { decide } });
    expect(receipt.complexity).toBe("complex"); expect(receipt.contextStrategy).toBe("context_rich_author_and_independent_review");
    expect(receipt.reviewEvidence).toBe("not_established_by_triage"); expect(receipt.routeChangedByTriage).toBe(false);
  });
  it("retains local timeouts as abstention without remote fallback or invented cost", async () => {
    const { db } = database(); const decide = vi.fn(async (): Promise<LocalTriageResult> => ({ status: "abstained", requestId: "failed-call", reason: "cancelled_or_deadline", elapsedMs: 2000 }));
    expect((await observeModelTriage(db, input, { local: { decide } })).decision).toMatchObject({ status: "abstained", reason: "cancelled_or_deadline", localRequestId: "failed-call", invocationId: null, costCents: null, costStatus: "unpriced" });
  });
  it("does not accept an observation after cancellation", async () => {
    const { db } = database(); const controller = new AbortController();
    const decide = vi.fn(async (request: DecisionRequest) => { controller.abort(); return success(request); });
    const receipt = await observeModelTriage(db, input, { local: { decide }, signal: controller.signal });
    expect(receipt.decision).toMatchObject({ status: "abstained", reason: "cancelled_or_deadline", proposedCandidateId: null });
  });
  it.each([
    { context: { ...input.context, companyId: "other" } }, { context: { ...input.context, issueId: "other-task" } },
    { context: { ...input.context, actor: { type: "system" as const } } }, { selectedCandidateId: "outside-candidates" },
  ])("rejects unbound or synthetic authority before reading or calling", async change => {
    const { db, queries } = database(); const decide = vi.fn();
    await expect(observeModelTriage(db, { ...input, ...change }, { local: { decide } })).rejects.toThrow("Invalid triage binding");
    expect(queries).toHaveLength(0); expect(decide).not.toHaveBeenCalled();
  });
  it("bounds state and candidate lists before local inference", async () => {
    const { db } = database(); const decide = vi.fn();
    const receipt = await observeModelTriage(db, { ...input, description: "x".repeat(8_001) }, { local: { decide } });
    expect(receipt.decision.reason).toBe("triage_input_out_of_bounds"); expect(decide).not.toHaveBeenCalled();
    expect(() => buildModelTriageQuestions({ ...input, candidates: Array.from({ length: 10 }, (_, index) => ({ id: String(index), label: "Profile" })) })).toThrow();
  });
});

describe("typed observation validation", () => {
  const request = buildModelTriageQuestions(input);
  it("keeps every pinned local question below the unsupported 11-choice calibration bucket", () => {
    const largest = buildModelTriageQuestions({ ...input, candidates: Array.from({ length: 9 }, (_, index) => ({ id: String(index), label: `Profile ${index}` })) });
    for (const question of Object.values(largest.questions)) expect(Object.keys(question.criteria ?? {}).length).toBeLessThanOrEqual(10);
  });
  it("records all-unknown answers as abstention even at high reported confidence", () => {
    expect(readModelTriageObservation(request, input.candidates, answers(request, { task_family: "unknown", any_fit: "unknown", profile: "unknown", complexity: "unknown" }))).toEqual({ reason: "insufficient_evidence" });
  });
  it("retains independent task-family evidence while abstaining from an unsupported profile recommendation", () => {
    expect(readModelTriageObservation(request, input.candidates, answers(request, { any_fit: "unknown", profile: "unknown" })))
      .toEqual({ reason: "insufficient_evidence", proposedTaskType: "engineering.building" });
  });
  it("accepts the SDK's bounded four-decimal probability rounding", () => {
    const candidates = Array.from({ length: 6 }, (_, index) => ({ id: `candidate-${index}`, label: `Profile ${index}` }));
    const roundedRequest = buildModelTriageQuestions({ ...input, candidates });
    const rows = answers(roundedRequest);
    rows.profile = { type: "choice", choice: "candidate_1", probabilities: Object.fromEntries(Object.keys((roundedRequest.questions.profile as { criteria: Record<string, string> }).criteria).map(option => [option, .1429])) };
    expect(readModelTriageObservation(roundedRequest, candidates, rows)).toMatchObject({ proposedCandidateId: "candidate-1" });
  });
  it("rejects contradictory fit and selection", () => {
    expect(readModelTriageObservation(request, input.candidates, answers(request, { any_fit: "no" }))).toEqual({ reason: "contradictory_answers" });
  });
  it.each(["missing_question", "extra_question", "outside_option", "missing_probability", "nan", "bad_sum"])("rejects %s", mutation => {
    const rows = answers(request);
    if (mutation === "missing_question") delete rows.complexity;
    if (mutation === "extra_question") rows.extra = rows.complexity;
    if (mutation === "outside_option") rows.profile = { type: "choice", choice: "outside-profile", probabilities: { "outside-profile": 1 } };
    if (mutation === "missing_probability") delete (rows.profile as { probabilities?: unknown }).probabilities;
    if (mutation === "nan") (rows.profile as { probabilities: Record<string, number> }).probabilities.candidate_1 = NaN;
    if (mutation === "bad_sum") (rows.profile as { probabilities: Record<string, number> }).probabilities.candidate_1 = .4;
    expect(readModelTriageObservation(request, input.candidates, rows).reason).toMatch(/^invalid_/);
  });
});
