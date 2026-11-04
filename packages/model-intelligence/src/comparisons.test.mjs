import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelIntelligence, COMPARISON_POLICY_VERSION } from "./index.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const namespace = "company-a";
const defaults = { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 };
const variant = model => ({ profileId: model, provider: "provider", model, modelVersion: "version-1", reasoningEffort: "medium", method: "subscription", harnessFingerprint: sha("harness"), promptFingerprint: sha("prompt"), contextFingerprint: sha("context") });
function dataset(extra = {}) {
  return { namespace, id: "support", version: "v1", taskFamily: "support.triage", taskFamilyVersion: "families-v1", complexity: "routine", provenance: "observed",
    cases: Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, split: "holdout", inputDigest: sha(`input-${i}`), checkDigest: sha(`check-${i}`), sourceRef: `protected:case-${i}` })), ...extra };
}
function comparison(data, extra = {}) {
  return { namespace: data.namespace, id: "comparison", datasetId: data.id, datasetVersion: data.version, dimension: "model", baseline: variant("strong"), candidate: variant("fast"), thresholds: defaults, ...extra };
}
function setup(t, { data = dataset(), run = comparison(data) } = {}) {
  const engine = createModelIntelligence(":memory:"); t.after(() => engine.close());
  engine.registerDataset(data); engine.registerComparison(run);
  return { engine, data, run, report: () => engine.comparisonReport({ namespace: data.namespace, comparisonId: run.id }) };
}
function attempt(engine, data, run, index, arm, extra = {}, selection = {}) {
  const item = data.cases[index], profile = run[arm], number = extra.attempt ?? 1;
  const id = `${run.id}:${item.id}:${arm}:${number}`;
  const receipt = engine.select({ namespace: data.namespace, requestId: id, taskKey: id, taskType: data.taskFamily, complexity: data.complexity, pinTask: false,
    defaultCandidateId: profile.profileId, candidates: [{ id: profile.profileId, provider: profile.provider, model: profile.model, method: "subscription", available: true }],
    promptFingerprint: profile.promptFingerprint, contextFingerprint: profile.contextFingerprint, ...selection });
  const input = { namespace: data.namespace, id, comparisonId: run.id, caseId: item.id, arm, attempt: number, receiptId: receipt.id, inputDigest: item.inputDigest, checkDigest: item.checkDigest,
    observedVariant: profile, provenance: "observed", outcome: "passed", terminal: true, iterations: 1, latencyMs: arm === "baseline" ? 1000 : 500, source: "checks", evaluator: "acceptance-check-v1", evidenceRef: `protected:result:${id}`, ...extra };
  return { input, record: () => engine.recordComparisonOutcome(input) };
}
function complete(engine, data, run, overrides = () => ({})) {
  for (let i = 0; i < data.cases.length; i++) for (const arm of ["baseline", "candidate"]) attempt(engine, data, run, i, arm, overrides(i, arm)).record();
}

test("frozen paired holdout report qualifies only host-attested canary evidence without changing routing", t => {
  const { engine, data, run, report } = setup(t);
  complete(engine, data, run);
  const result = report();
  assert.equal(result.policyVersion, COMPARISON_POLICY_VERSION);
  assert.equal(result.status, "eligible_for_canary"); assert.deepEqual(result.blockers, []);
  assert.equal(result.evidenceTrust, "host_attested"); assert.equal(result.productionImprovementProven, false);
  assert.equal(result.acceptedPairs, 5); assert.equal(result.latencyImprovement, .5);
  assert.equal(result.candidate.firstPass, 5); assert(result.candidate.lowerBound > .7);
  assert.equal(engine.analytics(namespace).counts.evaluations, 0);
  const selected = engine.select({ namespace, requestId: "regular-work", taskKey: "regular-work", taskType: data.taskFamily, complexity: "routine", defaultCandidateId: "strong", candidates: ["strong", "fast"].map(id => ({ id, provider: "provider", model: id, method: "subscription", available: true })) });
  assert.equal(selected.candidate.id, "strong"); assert.equal(engine.analytics(namespace).events.length, 0);
  engine.policy({ namespace, candidateId: "fast", action: "block", reason: "Review invalidated candidate" });
  assert(report().blockers.includes("profile_blocked_by_policy"));
  engine.policy({ namespace, candidateId: "fast", action: "restore", reason: "Restored by operator" });
  assert.equal(report().status, "eligible_for_canary");
});

test("synthetic data or outcomes, training-only runs, and incomplete pairs never qualify", async t => {
  for (const mode of ["synthetic_dataset", "synthetic_outcomes", "training_only", "unpaired"]) await t.test(mode, t => {
    const data = dataset();
    if (mode === "synthetic_dataset") data.provenance = "synthetic";
    if (mode === "training_only") data.cases.forEach(item => { item.split = "training"; });
    const { engine, run, report } = setup(t, { data });
    if (mode === "unpaired") for (let i = 0; i < 5; i++) attempt(engine, data, run, i, "candidate").record();
    else complete(engine, data, run, () => mode === "synthetic_outcomes" ? { provenance: "synthetic" } : {});
    assert.equal(report().status, "not_ready"); assert.equal(report().productionImprovementProven, false);
    assert(report().blockers.includes(mode === "training_only" ? "insufficient_holdout_cases" : mode === "unpaired" ? "incomplete_pairs" : mode));
    if (mode === "unpaired") assert.equal(report().baseline.medianIterations, null);
  });
});

test("failed attempts retain their evidence and costs; retry success cannot hide first-pass regression", t => {
  const { engine, data, run, report } = setup(t);
  for (let i = 0; i < 5; i++) {
    attempt(engine, data, run, i, "baseline").record();
    if (i > 0) attempt(engine, data, run, i, "candidate", i === 1 ? { iterations: 2 } : {}).record();
  }
  const failure = attempt(engine, data, run, 0, "candidate", { outcome: "failed", terminal: false, latencyMs: 600 });
  failure.record();
  assert.throws(() => engine.recordComparisonOutcome({ ...failure.input, outcome: "passed", terminal: true }), /different inputs/);
  assert.throws(() => attempt(engine, data, run, 0, "candidate", { attempt: 3 }).record(), /consecutive/);
  attempt(engine, data, run, 0, "candidate", { attempt: 2, latencyMs: 400 }).record();
  const result = report(), repaired = result.cases[0].candidate;
  assert.equal(repaired.attempts.length, 2); assert.equal(repaired.attempts[0].outcome, "failed");
  assert.equal(repaired.latencyMs, 1000); assert.equal(repaired.iterations, 2);
  assert.equal(result.candidate.failedAttempts, 1); assert.equal(result.candidate.passed, 5); assert.equal(result.candidate.firstPass, 3);
  assert(result.blockers.includes("paired_first_pass_regression"));
  assert.throws(() => attempt(engine, data, run, 0, "candidate", { attempt: 3 }).record(), /terminal history/);
});

test("planned failed cases stay in the quality denominator and cannot be dropped or replaced", t => {
  const { engine, data, run, report } = setup(t);
  complete(engine, data, run, (i, arm) => i === 0 && arm === "candidate" ? { outcome: "failed" } : {});
  const result = report();
  assert.equal(result.candidate.cases, 5); assert.equal(result.candidate.completed, 5); assert.equal(result.candidate.passed, 4);
  assert.equal(result.acceptedPairs, 4); assert(result.blockers.includes("paired_quality_regression")); assert(result.blockers.includes("quality_floor_not_met"));
  assert.throws(() => engine.registerDataset({ ...data, cases: data.cases.slice(1) }), /different inputs/);
  assert.throws(() => engine.registerComparison({ ...run, thresholds: { ...defaults, minimumHoldoutPairs: 4 } }), /minimumHoldoutPairs/);
});

test("all retry costs affect resource qualification, including failed attempts in both arms", t => {
  const { engine, data, run, report } = setup(t);
  for (let i = 0; i < 5; i++) for (const arm of ["baseline", "candidate"]) {
    attempt(engine, data, run, i, arm, { outcome: "failed", terminal: false, latencyMs: arm === "baseline" ? 100 : 900 }).record();
    attempt(engine, data, run, i, arm, { attempt: 2, latencyMs: arm === "baseline" ? 900 : 100 }).record();
  }
  const result = report();
  assert.equal(result.baseline.failedAttempts, 5); assert.equal(result.candidate.failedAttempts, 5);
  assert.equal(result.baseline.firstPass, 0); assert.equal(result.candidate.firstPass, 0);
  assert.equal(result.candidate.medianIterations, 2); assert.equal(result.latencyImprovement, 0);
  assert(result.blockers.includes("latency_target_not_met"));
});

test("unknown observations and missing measurements stay explicit blockers", t => {
  const { engine, data, run, report } = setup(t);
  complete(engine, data, run, (i, arm) => i === 0 && arm === "candidate" ? { outcome: "unknown", observedVariant: null, latencyMs: null } : {});
  const result = report();
  for (const code of ["unverified_execution_dimensions", "unknown_or_cancelled_outcomes", "unmeasured_resources"]) assert(result.blockers.includes(code));
  assert.equal(result.cases[0].candidate.latencyMs, null); assert.equal(result.cases[0].candidate.outcome, "unknown");
});

test("host-supplied extreme durations and unrepresentable resource ratios fail closed", t => {
  const { engine, data, run, report } = setup(t);
  const pending = attempt(engine, data, run, 0, "candidate", { outcome: "failed", terminal: false });
  for (const latencyMs of [1e308, Number.MAX_VALUE, Infinity, NaN, -1]) {
    assert.throws(() => engine.recordComparisonOutcome({ ...pending.input, latencyMs }), /Invalid latencyMs/);
  }
  assert.equal(report().cases[0].candidate.attempts.length, 0);
  // Every input is finite and legal, but division by a tiny measured baseline
  // overflows. This must remain explicit, JSON-safe and ineligible.
  complete(engine, data, run, (_i, arm) => arm === "baseline" ? { latencyMs: Number.MIN_VALUE } : {});
  const result = report();
  assert.equal(result.status, "not_ready"); assert.equal(result.latencyImprovement, null);
  assert(result.blockers.includes("unrepresentable_resource_ratio")); assert(result.blockers.includes("latency_target_not_met"));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("registered training overlap invalidates holdouts across versions but stays namespace scoped", t => {
  const { engine, data, run, report } = setup(t); complete(engine, data, run);
  const exposed = dataset({ version: "training-v2", cases: [{ ...data.cases[0], split: "training" }] });
  engine.registerDataset({ ...exposed, namespace: "company-b" });
  assert.equal(report().status, "eligible_for_canary");
  engine.registerDataset(exposed);
  assert(report().blockers.includes("holdout_exposed_to_training")); assert.equal(report().cases[0].exposedToTraining, true);
  assert.throws(() => engine.registerDataset(dataset({ version: "duplicates", cases: [data.cases[0], { ...data.cases[0], id: "training-clone", split: "training" }] })), /Duplicate case or input/);
});

test("freeze one measurable dimension and reject mixed changes, paid profiles, and weaker policy floors", t => {
  const { engine, data, run } = setup(t);
  assert.throws(() => engine.registerComparison({ ...run, id: "mixed", candidate: { ...run.candidate, contextFingerprint: sha("changed") } }), /exactly the declared/);
  assert.throws(() => engine.registerComparison({ ...run, id: "renamed", candidate: { ...run.baseline, profileId: "renamed" } }), /exactly the declared/);
  assert.throws(() => engine.registerComparison({ ...run, id: "paid", candidate: { ...run.candidate, method: "api_key" } }), /subscriptions/);
  for (const thresholds of [{ ...defaults, qualityLowerBound: .5 }, { ...defaults, minimumLatencyImprovement: .1 }, { ...defaults, maximumMedianIterations: 3 }]) assert.throws(() => engine.registerComparison({ ...run, id: "weaker", thresholds }));
  for (const dimension of ["prompt", "context"]) {
    const varied = comparison(data, { id: dimension, dimension, candidate: { ...run.baseline, [`${dimension}Fingerprint`]: sha(`changed-${dimension}`) } });
    engine.registerComparison(varied); complete(engine, data, varied);
    assert.equal(engine.comparisonReport({ namespace, comparisonId: dimension }).status, "eligible_for_canary");
  }
});

test("outcomes require the frozen case, observations, namespaced receipt and execution fingerprints", t => {
  const { engine, data, run } = setup(t);
  const valid = attempt(engine, data, run, 0, "baseline");
  for (const extra of [{ inputDigest: sha("wrong") }, { checkDigest: sha("wrong") }, { caseId: "unknown" }]) assert.throws(() => engine.recordComparisonOutcome({ ...valid.input, ...extra }), /frozen case/);
  assert.throws(() => engine.recordComparisonOutcome({ ...valid.input, observedVariant: { ...run.baseline, modelVersion: "unknown-version" } }), /Observed execution/);
  assert.throws(() => attempt(engine, data, run, 1, "baseline", {}, { contextFingerprint: sha("wrong") }).record(), /Selection receipt does not match/);
  const foreign = attempt(engine, data, run, 2, "baseline", {}, { namespace: "company-b" });
  assert.throws(() => foreign.record(), /not found in this namespace/);
  valid.record();
  assert.throws(() => engine.recordComparisonOutcome({ ...valid.input, id: "duplicate-outcome" }), /terminal history/);
  assert.throws(() => engine.comparisonReport({ namespace: "company-b", comparisonId: run.id }), /not found in this namespace/);
  assert.throws(() => engine.registerComparison({ ...run, namespace: "company-b" }), /Dataset version not found/);
});

test("a comparison must be frozen before its selection receipts, even within the same clock tick", t => {
  const engine = createModelIntelligence(":memory:"); t.after(() => engine.close());
  const data = dataset(), run = comparison(data); engine.registerDataset(data);
  const old = attempt(engine, data, run, 0, "baseline");
  engine.registerComparison(run);
  assert.throws(() => old.record(), /Selection receipt does not match/);
  attempt(engine, data, run, 1, "baseline").record();
});

test("configured larger sample and complex-work gates remain explicit", async t => {
  for (const mode of ["larger", "complex"]) await t.test(mode, t => {
    const data = dataset(mode === "complex" ? { complexity: "complex" } : {});
    const run = comparison(data, mode === "larger" ? { thresholds: { ...defaults, minimumHoldoutPairs: 10 } } : {});
    const { engine, report } = setup(t, { data, run }); complete(engine, data, run);
    assert(report().blockers.includes(mode === "larger" ? "insufficient_holdout_cases" : "complex_work_requires_separate_qualification"));
  });
});

test("immutable idempotency and complete audit survive SQLite restart and additive v1 upgrade", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentos-comparisons-")), path = join(dir, "audit.sqlite");
  let engine;
  try {
    // Existing v1 tables and legacy records must survive the v2 additive schema.
    engine = createModelIntelligence(path);
    engine.select({ namespace, requestId: "legacy", taskKey: "legacy", taskType: "support.triage", complexity: "routine", defaultCandidateId: "strong", candidates: [{ id: "strong", provider: "provider", model: "strong", method: "subscription", available: true }] });
    engine.close(); engine = null;
    const db = new DatabaseSync(path);
    db.exec("DROP TABLE comparison_outcomes; DROP TABLE controlled_comparisons; DROP TABLE comparison_cases; DROP TABLE comparison_datasets; PRAGMA user_version=1;"); db.close();
    engine = createModelIntelligence(path);
    const data = dataset(), run = comparison(data);
    const registered = engine.registerDataset(data), compared = engine.registerComparison(run);
    const outcome = attempt(engine, data, run, 0, "baseline", { outcome: "failed", terminal: false });
    const recorded = outcome.record();
    assert.deepEqual(engine.registerDataset(Object.fromEntries(Object.entries(data).reverse())), registered);
    assert.deepEqual(engine.registerComparison(Object.fromEntries(Object.entries(run).reverse())), compared);
    assert.deepEqual(engine.recordComparisonOutcome(Object.fromEntries(Object.entries(outcome.input).reverse())), recorded);
    const before = engine.comparisonReport({ namespace, comparisonId: run.id });
    engine.close(); engine = createModelIntelligence(path);
    assert.deepEqual(engine.comparisonReport({ namespace, comparisonId: run.id }), before);
    assert.deepEqual(engine.recordComparisonOutcome(outcome.input), recorded);
    assert.throws(() => engine.registerComparison({ ...run, thresholds: { ...defaults, minimumHoldoutPairs: 6 } }), /different inputs/);
    attempt(engine, data, run, 0, "baseline", { attempt: 2 }).record();
    assert.equal(engine.comparisonReport({ namespace, comparisonId: run.id }).cases[0].baseline.attempts.length, 2);
    assert(engine.analytics(namespace).receipts.some(row => row.id === "legacy"));
    engine.close(); engine = null;
    const future = new DatabaseSync(path); future.exec("PRAGMA user_version=3"); future.close();
    assert.throws(() => createModelIntelligence(path), /newer than this package/);
  } finally { engine?.close(); rmSync(dir, { recursive: true, force: true }); }
});
