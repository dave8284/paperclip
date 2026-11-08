import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createModelIntelligence } from "./index.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const namespace = "company-a", taskType = "support.triage";
const RELEASE_1 = `auto:${sha(JSON.stringify([namespace, "comparison-1"]))}`, RELEASE_2 = `auto:${sha(JSON.stringify([namespace, "comparison-2"]))}`;
const limits = { canaryPercent: 5, maximumPending: 2, minimumObservations: 5, observationTimeoutMs: 60_000,
  qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 };
const variant = model => ({ profileId: model, provider: "provider", model, modelVersion: "v1", reasoningEffort: "medium", method: "subscription",
  harnessFingerprint: sha("harness"), promptFingerprint: sha("prompt"), contextFingerprint: sha("context") });
function qualify(engine, id = "comparison-1", baseline = variant("strong"), candidate = variant("fast"), complete = true) {
  const data = { namespace, id: `dataset-${id}`, version: "1", taskFamily: taskType, taskFamilyVersion: "1", complexity: "routine", provenance: "observed",
    cases: Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, split: "holdout", inputDigest: sha(`${id}:input:${i}`), checkDigest: sha(`${id}:check:${i}`), sourceRef: `private:${id}:${i}` })) };
  const comparison = { namespace, id, datasetId: data.id, datasetVersion: data.version, dimension: "model", baseline, candidate,
    thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } };
  engine.registerDataset(data); engine.registerComparison(comparison);
  if (complete) for (const item of data.cases) for (const arm of ["baseline", "candidate"]) {
    const profile = comparison[arm], receiptId = `${id}:${item.id}:${arm}`;
    engine.select({ namespace, requestId: receiptId, taskKey: receiptId, taskType, complexity: "routine", defaultCandidateId: profile.profileId,
      candidates: [{ id: profile.profileId, provider: profile.provider, model: profile.model, method: "subscription", available: true }],
      promptFingerprint: profile.promptFingerprint, contextFingerprint: profile.contextFingerprint });
    engine.recordComparisonOutcome({ namespace, id: receiptId, comparisonId: id, caseId: item.id, arm, attempt: 1, receiptId,
      inputDigest: item.inputDigest, checkDigest: item.checkDigest, observedVariant: profile, provenance: "observed", outcome: "passed", terminal: true,
      iterations: 1, latencyMs: arm === "baseline" ? 1000 : 400, source: "checks", evaluator: "fixture-reviewer", evidenceRef: `result:${receiptId}` });
  }
  return { data, comparison };
}
const configure = (engine, extra = {}) => engine.configureRoutingPolicy({ namespace, id: "policy-1", taskType, expectedRevision: 0,
  mode: "automatic", pinnedReleaseId: null, limits, reason: "Enroll under the bounded low-risk policy", ...extra });
const publish = (engine, extra = {}) => engine.publishRoutingRelease({ namespace, id: RELEASE_1, comparisonId: "comparison-1", expectedPolicyRevision: 1, reason: "Automatic publication under the enrolled company policy after complete held-out evidence.", ...extra });
const request = (id, extra = {}) => ({ namespace, requestId: id, taskKey: id, taskType, complexity: "routine", defaultCandidateId: "host-strong",
  candidates: ["strong", "fast", "faster"].map(model => ({ id: `host-${model}`, model, provider: "provider", method: "subscription", available: true, variant: variant(model) })),
  contextFingerprint: sha(`production:${id}`), promptFingerprint: sha("prompt"), ...extra });
const state = engine => engine.routingRollouts({ namespace, taskType });
let serial = 0;
function sampledRequest(arm, releaseId = RELEASE_1, phase = "canary") {
  for (let i = 0; i < 10000; i++) {
    const id = `task-${serial++}`;
    const bucket = Number.parseInt(sha(JSON.stringify([releaseId, id])).slice(0, 8), 16) % 100;
    if (phase === "canary" ? arm === "candidate" ? bucket < 5 : bucket >= 5 && bucket < 10 : arm === "candidate" ? bucket >= 5 : bucket < 5) return request(id);
  }
  throw new Error("No deterministic fixture bucket");
}
function outcome(engine, receipt, extra = {}) {
  return engine.recordRoutingOutcome({ namespace, id: `outcome:${receipt.id}`, receiptId: receipt.id, outcome: "passed", iterations: 1,
    latencyMs: receipt.rollout.arm === "baseline" ? 1000 : 400, observedVariant: receipt.candidate.variant,
    source: "checks", evaluator: "independent-fixture-review", evidenceRef: `review:${receipt.id}`, ...extra });
}
function adopt(engine, releaseId = RELEASE_1) {
  for (let i = 0; i < 5; i++) for (const arm of ["baseline", "candidate"]) outcome(engine, engine.select(sampledRequest(arm, releaseId)));
  assert.equal(state(engine).releases.find(item => item.id === releaseId).state, "adopted");
}
function fixture(t, extra = {}) {
  const engine = createModelIntelligence(":memory:"); t.after(() => engine.close());
  const registered = qualify(engine, ...extra.qualify ?? []);
  return { engine, ...registered };
}

test("only current company enrollment and complete held-out evidence can publish a release", t => {
  const { engine } = fixture(t, { qualify: ["comparison-1", undefined, undefined, false] });
  configure(engine);
  assert.throws(() => publish(engine), /Complete observed/);
  qualify(engine, "comparison-2");
  assert.throws(() => publish(engine, { id: RELEASE_2, comparisonId: "comparison-2", expectedPolicyRevision: 2 }), /different inputs/);
  assert.throws(() => publish(engine, { namespace: "company-b", comparisonId: "comparison-2" }), /not found/);
  const release = publish(engine, { id: RELEASE_2, comparisonId: "comparison-2" });
  assert.equal(release.state, "canary");
  assert.deepEqual(publish(engine, { id: RELEASE_2, comparisonId: "comparison-2" }), release);
  assert.throws(() => publish(engine, { id: RELEASE_2, comparisonId: "comparison-2", reason: "changed" }), /different inputs/);
  assert.throws(() => publish(engine, { id: "second", comparisonId: "comparison-2" }), /already has a release/);
});

test("policy revisions are immutable, stale updates fail, and floors cannot be weakened", t => {
  const { engine } = fixture(t);
  assert.equal(engine.select(sampledRequest("candidate")).candidate.model, "strong");
  const policy = configure(engine);
  assert.deepEqual(configure(engine), policy);
  assert.throws(() => configure(engine, { id: "stale" }), /current revision/);
  assert.throws(() => configure(engine, { limits: { ...limits, canaryPercent: 11 } }), /canaryPercent/);
  assert.throws(() => configure(engine, { limits: { ...limits, qualityLowerBound: .6 } }), /floors/);
  publish(engine);
  configure(engine, { id: "off", expectedRevision: 1, mode: "off" });
  assert.equal(state(engine).releases[0].state, "rolled_back");
  assert.equal(engine.select(sampledRequest("candidate")).candidate.model, "strong");
  assert.equal(engine.routingRollouts({ namespace: "company-b", taskType }).policy, null);
});

test("canary assignments are bounded, exact, idempotent, and distinct from ordinary selection", t => {
  const { engine, data } = fixture(t); configure(engine, { limits: { ...limits, maximumPending: 1 } }); publish(engine);
  const first = sampledRequest("candidate"), selected = engine.select(first);
  assert.equal(selected.candidate.model, "fast"); assert.equal(selected.rollout.assignmentId, first.requestId);
  assert.deepEqual(engine.select(first), selected);
  const held = engine.select(sampledRequest("candidate"));
  assert.equal(held.candidate.model, "strong"); assert.equal(held.rollout.assignmentId, null);
  assert.throws(() => outcome(engine, held), /exact same-namespace/);
  assert.equal(engine.select({ ...sampledRequest("candidate"), namespace: "company-b" }).candidate.model, "strong");
  assert.equal(engine.select({ ...sampledRequest("candidate"), complexity: "complex" }).candidate.model, "strong");
  outcome(engine, selected);
  const repeated = engine.select({ ...sampledRequest("candidate"), contextFingerprint: first.contextFingerprint });
  assert.equal(repeated.rollout.assignmentId, null);
  assert.equal(engine.select({ ...sampledRequest("candidate"), contextFingerprint: data.cases[0].inputDigest }).rollout, undefined);
  const changed = sampledRequest("candidate"); changed.candidates[1].variant.contextFingerprint = sha("changed actual context");
  assert.equal(engine.select(changed).candidate.model, "strong");
});

test("complete independent production observations adopt automatically and remain observable", t => {
  const { engine } = fixture(t); configure(engine); publish(engine); adopt(engine);
  const selected = engine.select(sampledRequest("candidate", RELEASE_1, "adopted"));
  assert.equal(selected.candidate.model, "fast"); assert.equal(selected.rollout.phase, "adopted");
  const recorded = outcome(engine, selected);
  assert.deepEqual(outcome(engine, selected), recorded);
  assert.throws(() => outcome(engine, selected, { outcome: "failed" }), /different inputs/);
  assert.equal(state(engine).events.filter(event => event.action === "adopted").length, 1);
  assert.equal(engine.analytics(namespace).counts.evaluations, 0);
});

for (const fault of ["failed", "unknown", "context", "iterations", "latency", "expired"]) test(`${fault} evidence prevents adoption and rolls back new work while preserving an active pin`, t => {
  const { engine } = fixture(t); configure(engine); publish(engine);
  const selected = engine.select(sampledRequest("candidate"));
  if (fault === "expired") {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); t.mock.timers.tick(60_001);
  } else outcome(engine, selected, fault === "context" ? { observedVariant: null }
    : fault === "iterations" ? { iterations: null } : fault === "latency" ? { latencyMs: null } : { outcome: fault });
  assert.equal(engine.select(sampledRequest("candidate")).candidate.model, "strong");
  assert.equal(state(engine).releases[0].state, "rolled_back");
  const continuation = engine.select(request(`continue:${selected.id}`, { taskKey: selected.taskKey }));
  assert.equal(continuation.candidate.model, "fast"); assert.deepEqual(continuation.rollout, selected.rollout);
  engine.policy({ namespace, candidateId: "host-fast", action: "block", reason: "Execution qualification revoked" });
  assert.throws(() => engine.select(request(`blocked:${selected.id}`, { taskKey: selected.taskKey })), /Pinned profile/);
});

test("registered training contamination revokes a comparison's live release", t => {
  const { engine, data } = fixture(t); configure(engine); publish(engine);
  engine.registerDataset({ ...data, id: "training", cases: [{ ...data.cases[0], split: "training" }] });
  assert.equal(engine.select(sampledRequest("candidate")).candidate.model, "strong");
  assert.equal(state(engine).releases[0].state, "rolled_back");
});

test("new release rollback restores the prior adopted version; a company can pin or opt out", t => {
  const { engine } = fixture(t); configure(engine); publish(engine); adopt(engine);
  qualify(engine, "comparison-2", variant("fast"), variant("faster"));
  const next = publish(engine, { id: RELEASE_2, comparisonId: "comparison-2" });
  assert.equal(next.parentReleaseId, RELEASE_1); assert.equal(next.version, 2);
  const trial = engine.select(sampledRequest("candidate", RELEASE_2));
  assert.equal(trial.candidate.model, "faster"); outcome(engine, trial, { outcome: "failed" });
  const restored = engine.select(sampledRequest("candidate", RELEASE_1, "adopted"));
  assert.equal(restored.candidate.model, "fast"); assert.equal(restored.rollout.releaseVersion, 1); outcome(engine, restored);
  configure(engine, { id: "pin", expectedRevision: 1, mode: "pinned", pinnedReleaseId: RELEASE_1 });
  assert.throws(() => publish(engine, { id: "blocked", comparisonId: "comparison-2", expectedPolicyRevision: 2 }), /already has a release/);
  configure(engine, { id: "off", expectedRevision: 2, mode: "off" });
  assert.equal(engine.select(sampledRequest("candidate", RELEASE_1, "adopted")).candidate.model, "strong");
});

test("namespace binding, persisted receipts and admission limits survive independent store handles", t => {
  const directory = mkdtempSync(join(tmpdir(), "model-rollout-")), path = join(directory, "learning.sqlite");
  let engine = createModelIntelligence(path), other;
  t.after(() => { engine.close(); other?.close(); rmSync(directory, { recursive: true }); });
  qualify(engine); configure(engine, { limits: { ...limits, maximumPending: 1 } }); publish(engine);
  const input = sampledRequest("candidate"), selected = engine.select(input);
  engine.close(); engine = createModelIntelligence(path); other = createModelIntelligence(path);
  assert.deepEqual(other.select(input), selected);
  assert.equal(other.select(sampledRequest("candidate")).candidate.model, "strong");
  assert.throws(() => outcome(other, selected, { namespace: "company-b" }), /same-namespace/);
  assert.throws(() => outcome(other, selected, { observedVariant: variant("faster") }), /differs/);
  outcome(other, selected); assert.equal(engine.select(sampledRequest("candidate")).candidate.model, "fast");
  const locked = new DatabaseSync(path); locked.exec("BEGIN IMMEDIATE");
  try { assert.throws(() => other.select(request("contended")), /locked/); }
  finally { locked.exec("ROLLBACK"); locked.close(); }
  assert.equal(other.selectionReceipt({ namespace, receiptId: "contended" }), null);
});

test("observation changes notify once, deadlines expire without new selections, and completed work leaves no deadline", t => {
  const { engine } = fixture(t); configure(engine); publish(engine);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let wakes = 0;
  const unsubscribe = engine.subscribeRoutingWork(() => wakes++);
  assert.equal(engine.nextRoutingDeadline(), null);
  const input = sampledRequest("candidate"), selected = engine.select(input);
  const deadline = engine.nextRoutingDeadline();
  assert.equal(deadline, Date.now() + limits.observationTimeoutMs + 1); assert.equal(wakes, 1);
  engine.select(input); assert.equal(wakes, 1);
  outcome(engine, selected); assert.equal(wakes, 2); assert.equal(engine.nextRoutingDeadline(), null);
  engine.select(sampledRequest("candidate"));
  t.mock.timers.tick(limits.observationTimeoutMs + 1);
  assert.equal(engine.reconcileRoutingDeadlines(), 1); assert.equal(engine.nextRoutingDeadline(), null);
  assert.equal(engine.reconcileRoutingDeadlines(), 0);
  assert.equal(state(engine).releases[0].state, "rolled_back");
  unsubscribe(); const before = wakes; configure(engine, { id: "off", expectedRevision: 1, mode: "off" }); assert.equal(wakes, before);
});

test("schema v4 upgrade preserves a pending selection and reconstructs its indexed observation deadline", t => {
  const directory = mkdtempSync(join(tmpdir(), "model-rollout-upgrade-")), path = join(directory, "learning.sqlite");
  let engine = createModelIntelligence(path);
  t.after(() => { engine.close(); rmSync(directory, { recursive: true }); });
  qualify(engine); configure(engine); const selected = engine.select(sampledRequest("candidate")), deadline = engine.nextRoutingDeadline();
  engine.close();
  const old = new DatabaseSync(path);
  old.exec("DROP INDEX routing_rollout_pending_deadline; DROP INDEX routing_rollout_pending_release; ALTER TABLE routing_rollout_assignments DROP COLUMN deadline_at; ALTER TABLE routing_rollout_assignments DROP COLUMN settled; PRAGMA user_version=4;");
  old.close(); engine = createModelIntelligence(path);
  assert.deepEqual(engine.selectionReceipt({ namespace, receiptId: selected.id }), selected);
  assert.equal(engine.nextRoutingDeadline(), deadline);
  outcome(engine, selected); assert.equal(engine.nextRoutingDeadline(), null);
  const current = new DatabaseSync(path, { readOnly: true });
  assert.equal(current.prepare("PRAGMA user_version").get().user_version, 5); current.close();
});
