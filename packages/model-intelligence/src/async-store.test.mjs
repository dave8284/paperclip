import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createModelIntelligence } from "./index.mjs";
import { openSqliteStore } from "./sqlite-schema.mjs";
import { createAsyncPolicyStore } from "./async-store.mjs";
import { normalizeStorageRows } from "./storage-effects.mjs";
import { postgresQuery } from "./postgres-query.mjs";

const sha = text => createHash("sha256").update(text).digest("hex");
const namespace = "company-a", taskType = "support.triage";
const selection = (id, extra = {}) => ({ namespace, requestId: id, taskKey: id, taskType, complexity: "routine", defaultCandidateId: "baseline",
  candidates: [{ id: "baseline", model: "baseline", provider: "test", method: "subscription", available: true }], ...extra });
const variant = model => ({ profileId: model, model, provider: "test", modelVersion: "v1", reasoningEffort: "medium", method: "subscription",
  harnessFingerprint: sha("harness"), promptFingerprint: sha("prompt"), contextFingerprint: sha("context") });
const limits = { canaryPercent: 5, maximumPending: 2, minimumObservations: 5, observationTimeoutMs: 60_000,
  qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 };

// A real SQLite transaction behind an asynchronous boundary exercises the shared
// policy, suspension and rollback. It is deliberately not a PostgreSQL emulator.
function fixture(t, hooks = {}) {
  const db = openSqliteStore(":memory:");
  let tail = Promise.resolve();
  const store = createAsyncPolicyStore((operation, work) => {
    const pending = tail.then(async () => {
      await hooks.beforeTransaction?.(operation);
      db.exec(operation.readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
      try {
        const result = await work(async effect => {
          await hooks.beforeQuery?.(effect);
          // Exercise every query emitted by this journey through the dialect
          // compiler, without treating its output as SQL compatibility proof.
          const sql = postgresQuery(effect.sql);
          assert.doesNotMatch(sql, /\?|json_extract|INSERT INTO [a-z_]+ VALUES/);
          const statement = db.prepare(effect.sql);
          if (effect.method === "run") return statement.run(...effect.parameters);
          statement.setReadBigInts(true);
          const rows = normalizeStorageRows(statement.all(...effect.parameters));
          return effect.method === "get" ? rows[0] : rows;
        });
        await hooks.beforeCommit?.(operation);
        db.exec("COMMIT"); return result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    });
    tail = pending.catch(() => {}); return pending;
  });
  t.after(async () => { await store.close(); db.close(); });
  return { store, db };
}
function scrubEvents(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "events" ? item.map(({ id, ...event }) => event) : item));
}

test("suspended storage shares selection, comparison, adoption and rollback policy with the embedded API", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const embedded = createModelIntelligence(":memory:"); t.after(() => embedded.close());
  const { store } = fixture(t);
  async function both(method, input) {
    const expected = embedded[method](input), actual = await store[method](input);
    assert.deepEqual(scrubEvents(actual), scrubEvents(expected)); return actual;
  }
  const data = { namespace, id: "data", version: "1", taskFamily: taskType, taskFamilyVersion: "1", complexity: "routine", provenance: "observed",
    cases: Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, split: "holdout", inputDigest: sha(`input-${i}`), checkDigest: sha(`checks-${i}`), sourceRef: `fixture:${i}` })) };
  const comparison = { namespace, id: "comparison", datasetId: "data", datasetVersion: "1", dimension: "model", baseline: variant("baseline"), candidate: variant("fast"),
    thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } };
  await both("registerDataset", data); await both("registerComparison", comparison);
  await both("comparisonCatalog", namespace); await both("comparisonDefinition", { namespace, comparisonId: comparison.id });
  for (const item of data.cases) for (const arm of ["baseline", "candidate"]) {
    const profile = comparison[arm], id = `${item.id}:${arm}`;
    await both("select", selection(id, { defaultCandidateId: profile.profileId,
      candidates: [{ id: profile.profileId, model: profile.model, provider: profile.provider, method: "subscription", available: true }],
      promptFingerprint: profile.promptFingerprint, contextFingerprint: profile.contextFingerprint }));
    await both("recordComparisonOutcome", { namespace, id, comparisonId: comparison.id, caseId: item.id, arm, attempt: 1, receiptId: id,
      inputDigest: item.inputDigest, checkDigest: item.checkDigest, observedVariant: profile, provenance: "observed", outcome: "passed", terminal: true,
      iterations: 1, latencyMs: arm === "baseline" ? 1000 : 400, source: "checks", evaluator: "fixture-reviewer", evidenceRef: `fixture:${id}` });
  }
  assert.equal((await both("comparisonReport", { namespace, comparisonId: comparison.id })).status, "eligible_for_canary");
  await both("configureRoutingPolicy", { namespace, id: "enroll", taskType, expectedRevision: 0, mode: "automatic", pinnedReleaseId: null, limits, reason: "Fixture enrollment" });
  const release = (await both("routingRollouts", { namespace, taskType })).releases[0];
  await both("routingPolicy", { namespace, taskType }); await both("hasRoutingRelease", { namespace, taskType });
  let serial = 0;
  for (let i = 0; i < 5; i++) for (const arm of ["baseline", "candidate"]) {
    let id, bucket;
    do { id = `production-${serial++}`; bucket = parseInt(sha(JSON.stringify([release.id, id])).slice(0, 8), 16) % 100; }
    while (arm === "candidate" ? bucket >= 5 : bucket < 5 || bucket >= 10);
    const input = selection(id, { candidates: [comparison.baseline, comparison.candidate].map(profile => ({ id: profile.profileId, model: profile.model, provider: profile.provider, method: "subscription", available: true, variant: profile })), contextFingerprint: sha(id) });
    const receipt = await both("select", input);
    await both("select", input); await both("selectionReceipt", { namespace, receiptId: id });
    await both("nextRoutingDeadline");
    await both("recordRoutingOutcome", { namespace, id, receiptId: id, outcome: "passed", iterations: 1, latencyMs: arm === "baseline" ? 1000 : 400,
      observedVariant: receipt.candidate.variant, source: "checks", evaluator: "fixture-reviewer", evidenceRef: `fixture:${id}` });
  }
  assert.equal((await both("routingRollouts", { namespace, taskType })).releases[0].state, "adopted");
  await both("rollbackRoutingRelease", { namespace, releaseId: release.id, reason: "Fixture rollback" });
  await both("reconcileRoutingDeadlines"); await both("analytics", namespace);
  assert.equal((await both("analytics", "company-b")).counts.selections, 0);
  await assert.rejects(store.select(selection("case-0:baseline", { taskKey: "changed" })), /different inputs/);
});

test("a failed commit rolls back evidence and derived routing changes without a notification", async t => {
  let fail = true, notifications = 0;
  const { store, db } = fixture(t, { beforeCommit(operation) { if (fail && operation.name === "configureRoutingPolicy") throw new Error("Commit fixture failure"); } });
  store.subscribeRoutingWork(() => { notifications++; assert.equal(db.isTransaction, false); });
  const input = { namespace, id: "policy", taskType, expectedRevision: 0, mode: "off", pinnedReleaseId: null, limits, reason: "Fixture" };
  await assert.rejects(store.configureRoutingPolicy(input), /Commit fixture/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM routing_rollout_policies").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM routing_rollout_events").get().n, 0);
  assert.equal(notifications, 0);
  fail = false; await store.configureRoutingPolicy(input); assert.equal(notifications, 1);
});

test("queued input mutation cannot alter a request; closing drains admitted work and rejects new work", async t => {
  let release, enter;
  const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
  const { store, db } = fixture(t, { async beforeTransaction() { enter(); await gate; } });
  const input = selection("frozen"), pending = store.select(input);
  await entered; input.namespace = "company-b"; input.candidates[0].model = "changed";
  let closed = false; const closing = store.close().then(() => { closed = true; });
  await assert.rejects(store.select(selection("after-close")), /closed/); assert.equal(closed, false);
  release(); const result = await pending; await closing;
  assert.equal(result.namespace, namespace); assert.equal(result.candidate.model, "baseline");
  assert.equal(db.prepare("SELECT count(*) AS n FROM routing_receipts").get().n, 1);
});

test("suspended storage preserves receipt cutoffs beyond JavaScript's safe integer range", async t => {
  const { store, db } = fixture(t);
  await store.select(selection("old"));
  db.exec("UPDATE routing_receipts SET rowid=9007199254740993");
  const data = { namespace, id: "data", version: "1", taskFamily: taskType, taskFamilyVersion: "1", complexity: "routine", provenance: "observed",
    cases: [{ id: "case", split: "holdout", inputDigest: sha("case"), checkDigest: sha("check"), sourceRef: "fixture:case" }] };
  await store.registerDataset(data);
  await store.registerComparison({ namespace, id: "comparison", datasetId: "data", datasetVersion: "1", dimension: "model", baseline: variant("baseline"), candidate: variant("fast"),
    thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } });
  const statement = db.prepare("SELECT receipt_cutoff FROM controlled_comparisons"); statement.setReadBigInts(true);
  assert.equal(statement.get().receipt_cutoff, 9007199254740993n);
  await store.select(selection("new"));
  assert.equal((await store.analytics(namespace)).counts.selections, 2);
  assert.throws(() => normalizeStorageRows([{ sequence: 9007199254740992 }]), /exceeds/);
});
