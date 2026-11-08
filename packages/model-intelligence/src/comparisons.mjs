import { mapEffects } from "./storage-effects.mjs";
import { createHash } from "node:crypto";

export const COMPARISON_POLICY_VERSION = "paired-holdout-v1";
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = value => createHash("sha256").update(canonical(value)).digest("hex");
function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label}`);
}
function text(value, label) { if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`Invalid ${label}`); }
function sha(value, label) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid ${label} digest`); }
function oneOf(value, choices, label) { if (!choices.includes(value)) throw new Error(`Invalid ${label}`); }
function integer(value, min, max, label) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`); }
const firstPass = arm => arm.attempts[0]?.outcome === "passed" && arm.attempts[0].iterations === 1;
function totalLatency(attempts) {
  if (!attempts.length || attempts.some(attempt => attempt.latencyMs === null)) return null;
  const total = attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
  return Number.isFinite(total) ? total : null;
}
function common(input, keys) { object(input, keys, "input"); text(input.namespace, "namespace"); text(input.id, "id"); }
const variantKeys = ["profileId", "provider", "model", "modelVersion", "reasoningEffort", "method", "harnessFingerprint", "promptFingerprint", "contextFingerprint"];
export function validateComparisonVariant(value) {
  object(value, variantKeys, "variant");
  for (const key of variantKeys.slice(0, 5)) text(value[key], key);
  if (value.method !== "subscription") throw new Error("Comparison profiles must use subscriptions");
  for (const key of ["harnessFingerprint", "promptFingerprint", "contextFingerprint"]) sha(value[key], key);
}
const variant = validateComparisonVariant;
function thresholds(value) {
  object(value, ["minimumHoldoutPairs", "qualityLowerBound", "maximumMedianIterations", "minimumLatencyImprovement"], "thresholds");
  integer(value.minimumHoldoutPairs, 5, 100, "minimumHoldoutPairs");
  integer(value.maximumMedianIterations, 1, 2, "maximumMedianIterations");
  if (!Number.isFinite(value.qualityLowerBound) || value.qualityLowerBound < .7 || value.qualityLowerBound > 1
    || !Number.isFinite(value.minimumLatencyImprovement) || value.minimumLatencyImprovement < .15 || value.minimumLatencyImprovement >= 1) throw new Error("Thresholds cannot weaken the existing quality/resource floors");
}

/** Embedded, operator-owned audit. No provider execution, activation, or HTTP authorization. */
export function createComparisonStore(db, { blocked, lowerBound, median }) {
  // Nested policy work shares its caller's public-operation transaction.
  function* atomic(work) { return (yield* work()); }

  function replay(row, input) {
    if (row.input_hash !== digest(input)) throw new Error("Record ID already exists with different inputs");
    return { ...JSON.parse(row.payload), createdAt: row.created_at };
  }
  function* dataset(namespace, id, version) {
    const row = (yield db.prepare("SELECT * FROM comparison_datasets WHERE namespace=? AND id=? AND version=?").get(namespace, id, version));
    if (!row) throw new Error("Dataset version not found in this namespace");
    return JSON.parse(row.payload);
  }
  function* comparison(namespace, id) {
    const row = (yield db.prepare("SELECT * FROM controlled_comparisons WHERE namespace=? AND id=?").get(namespace, id));
    if (!row) throw new Error("Comparison not found in this namespace");
    return { ...JSON.parse(row.payload), createdAt: row.created_at };
  }
  return {
    *validateComparisonSelection(input) {
      const binding = input.comparisonBinding;
      object(binding, ["comparisonId", "caseId", "arm", "inputDigest", "checkDigest"], "comparison selection binding");
      for (const key of ["comparisonId", "caseId"]) text(binding[key], key);
      oneOf(binding.arm, ["baseline", "candidate"], "arm");
      sha(binding.inputDigest, "input"); sha(binding.checkDigest, "check");
      const run = (yield* comparison(input.namespace, binding.comparisonId)), data = (yield* dataset(input.namespace, run.datasetId, run.datasetVersion));
      const item = (data.cases.find(item => item.id === binding.caseId)), expected = run[binding.arm];
      // A native receipt may use a host-specific candidate ID. The frozen
      // comparison profile's policy still governs initial selection and replay.
      if ((yield* blocked(input.namespace, expected.profileId))) throw new Error("The comparison profile has been blocked");
      const selected = input.candidates[0];
      if (!item || item.inputDigest !== binding.inputDigest || item.checkDigest !== binding.checkDigest || input.contextFingerprint !== binding.inputDigest
        || input.taskType !== data.taskFamily || input.complexity !== data.complexity
        || input.candidates.length !== 1 || input.defaultCandidateId !== selected?.id
        || selected.provider !== expected.provider || selected.model !== expected.model || selected.method !== expected.method) {
        throw new Error("Native selection does not match the preregistered comparison arm and case");
      }
      return { ...binding };
    },
    *comparisonDefinition({ namespace, comparisonId }) {
      text(namespace, "namespace"); text(comparisonId, "comparisonId");
      return (yield* atomic(function*() {
        const run = (yield* comparison(namespace, comparisonId));
        return { comparison: run, dataset: (yield* dataset(namespace, run.datasetId, run.datasetVersion)) };
      }));
    },
    *comparisonCatalog(namespace) {
      text(namespace, "namespace");
      // Discovery is bounded and returns the same immutable owner records used
      // by admission. It neither registers outcomes nor activates a policy.
      return (yield* atomic(function*() { return (yield* mapEffects((yield db.prepare("SELECT id FROM controlled_comparisons WHERE namespace=? ORDER BY created_at DESC,rowid DESC LIMIT 20")
        .all(namespace)), function*({ id }) {
          const run = (yield* comparison(namespace, id));
          return { comparison: run, dataset: (yield* dataset(namespace, run.datasetId, run.datasetVersion)) };
        })); }));
    },
    *registerDataset(input) {
      common(input, ["namespace", "id", "version", "taskFamily", "taskFamilyVersion", "complexity", "provenance", "cases"]);
      for (const key of ["version", "taskFamily", "taskFamilyVersion"]) text(input[key], key);
      oneOf(input.complexity, ["routine", "complex"], "complexity");
      oneOf(input.provenance, ["observed", "synthetic"], "provenance");
      if (!Array.isArray(input.cases) || !input.cases.length || input.cases.length > 100) throw new Error("Supply 1–100 immutable dataset cases");
      const ids = new Set(), inputs = new Set();
      for (const item of input.cases) {
        object(item, ["id", "split", "inputDigest", "checkDigest", "sourceRef"], "case");
        text(item.id, "case id"); text(item.sourceRef, "sourceRef");
        oneOf(item.split, ["training", "holdout"], "split"); sha(item.inputDigest, "input"); sha(item.checkDigest, "check");
        if (ids.has(item.id) || inputs.has(item.inputDigest)) throw new Error("Duplicate case or input digest within dataset version");
        ids.add(item.id); inputs.add(item.inputDigest);
      }
      return (yield* atomic(function*() {
        const old = (yield db.prepare("SELECT * FROM comparison_datasets WHERE namespace=? AND id=? AND version=?").get(input.namespace, input.id, input.version));
        if (old) return replay(old, input);
        const createdAt = new Date().toISOString();
        (yield db.prepare("INSERT INTO comparison_datasets VALUES(?,?,?,?,?,?)").run(input.namespace, input.id, input.version, digest(input), JSON.stringify(input), createdAt));
        const insert = db.prepare("INSERT INTO comparison_cases VALUES(?,?,?,?,?,?,?)");
        for (const item of input.cases) (yield insert.run(input.namespace, input.id, input.version, item.id, item.split, item.inputDigest, item.checkDigest));
        return { ...input, createdAt };
      }));
    },
    *registerComparison(input) {
      common(input, ["namespace", "id", "datasetId", "datasetVersion", "dimension", "baseline", "candidate", "thresholds"]);
      text(input.datasetId, "datasetId"); text(input.datasetVersion, "datasetVersion");
      oneOf(input.dimension, ["model", "prompt", "context"], "dimension");
      variant(input.baseline); variant(input.candidate); thresholds(input.thresholds);
      const changing = input.dimension === "model" ? ["profileId", "model", "modelVersion", "reasoningEffort"] : [`${input.dimension}Fingerprint`];
      const measured = changing.filter(key => key !== "profileId");
      if (variantKeys.some(key => !changing.includes(key) && input.baseline[key] !== input.candidate[key])
        || measured.every(key => input.baseline[key] === input.candidate[key])) throw new Error("Change exactly the declared comparison dimension; provider, funding and harness stay fixed");
      return (yield* atomic(function*() {
        const old = (yield db.prepare("SELECT * FROM controlled_comparisons WHERE namespace=? AND id=?").get(input.namespace, input.id));
        if (old) return replay(old, input);
        (yield* dataset(input.namespace, input.datasetId, input.datasetVersion));
        const createdAt = new Date().toISOString();
        const cutoff = (yield db.prepare("SELECT coalesce(max(rowid),0) AS sequence FROM routing_receipts").get()).sequence;
        (yield db.prepare("INSERT INTO controlled_comparisons VALUES(?,?,?,?,?,?)").run(input.namespace, input.id, digest(input), JSON.stringify(input), createdAt, cutoff));
        return { ...input, createdAt };
      }));
    },
    *recordComparisonOutcome(input) {
      common(input, ["namespace", "id", "comparisonId", "caseId", "arm", "attempt", "receiptId", "inputDigest", "checkDigest", "observedVariant", "provenance", "outcome", "terminal", "iterations", "latencyMs", "source", "evaluator", "evidenceRef"]);
      for (const key of ["comparisonId", "caseId", "receiptId", "evaluator", "evidenceRef"]) text(input[key], key);
      oneOf(input.arm, ["baseline", "candidate"], "arm"); integer(input.attempt, 1, 10, "attempt");
      oneOf(input.provenance, ["observed", "synthetic"], "provenance");
      oneOf(input.outcome, ["passed", "failed", "cancelled", "unknown"], "outcome");
      oneOf(input.source, ["human", "checks"], "source");
      sha(input.inputDigest, "input"); sha(input.checkDigest, "check");
      if (input.observedVariant !== null) variant(input.observedVariant);
      if (input.iterations !== null) integer(input.iterations, 1, 100, "iterations");
      if (input.latencyMs !== null && (!Number.isFinite(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > Number.MAX_SAFE_INTEGER / 10)) throw new Error("Invalid latencyMs");
      if (typeof input.terminal !== "boolean" || (input.outcome === "passed" || input.attempt === 10) && !input.terminal) throw new Error("Successful or final bounded attempts must be terminal");
      return (yield* atomic(function*() {
        const old = (yield db.prepare("SELECT * FROM comparison_outcomes WHERE namespace=? AND id=?").get(input.namespace, input.id));
        if (old) return replay(old, input);
        const run = (yield* comparison(input.namespace, input.comparisonId)), data = (yield* dataset(input.namespace, run.datasetId, run.datasetVersion));
        const item = (data.cases.find(item => item.id === input.caseId)), expected = run[input.arm];
        if (!item || input.inputDigest !== item.inputDigest || input.checkDigest !== item.checkDigest) throw new Error("Outcome does not match the frozen case and acceptance checks");
        if (input.observedVariant !== null && canonical(input.observedVariant) !== canonical(expected)) throw new Error("Observed execution differs from the frozen variant");
        const row = (yield db.prepare("SELECT rowid AS sequence,receipt FROM routing_receipts WHERE namespace=? AND id=?").get(input.namespace, input.receiptId));
        if (!row) throw new Error("Selection receipt not found in this namespace");
        const receipt = JSON.parse(row.receipt);
        const cutoff = (yield db.prepare("SELECT receipt_cutoff FROM controlled_comparisons WHERE namespace=? AND id=?").get(input.namespace, input.comparisonId)).receipt_cutoff;
        const binding = receipt.comparisonBinding;
        const identityMatches = binding
          ? binding.comparisonId === input.comparisonId && binding.caseId === input.caseId && binding.arm === input.arm && receipt.contextFingerprint === item.inputDigest
            && binding.inputDigest === item.inputDigest && binding.checkDigest === item.checkDigest
          : receipt.candidate.id === expected.profileId && receipt.promptFingerprint === expected.promptFingerprint && receipt.contextFingerprint === expected.contextFingerprint;
        // Native task identity remains on the ordinary receipt; the separately
        // frozen comparison binding identifies its strategy/variant contract.
        // Actual dimensions still require the host's observedVariant above.
        if (row.sequence <= cutoff || receipt.taskType !== data.taskFamily || receipt.complexity !== data.complexity || !identityMatches
          || receipt.candidate.provider !== expected.provider || receipt.candidate.model !== expected.model
          || receipt.candidate.method !== expected.method) throw new Error("Selection receipt does not match the registered comparison variant");
        const prior = (yield db.prepare("SELECT payload FROM comparison_outcomes WHERE namespace=? AND comparison_id=? AND case_id=? AND arm=? ORDER BY attempt DESC LIMIT 1").get(input.namespace, input.comparisonId, input.caseId, input.arm));
        const previous = prior && JSON.parse(prior.payload);
        if (previous?.terminal || input.attempt !== (previous?.attempt ?? 0) + 1) throw new Error("Append consecutive attempts; terminal history cannot be rewritten");
        const createdAt = new Date().toISOString();
        (yield db.prepare("INSERT INTO comparison_outcomes VALUES(?,?,?,?,?,?,?,?,?,?)").run(input.namespace, input.id, input.comparisonId, input.caseId, input.arm, input.attempt, input.receiptId, digest(input), JSON.stringify(input), createdAt));
        return { ...input, createdAt };
      }));
    },
    *comparisonReport({ namespace, comparisonId }) {
      text(namespace, "namespace"); text(comparisonId, "comparisonId");
      return (yield* atomic(function*() {
        const run = (yield* comparison(namespace, comparisonId)), data = (yield* dataset(namespace, run.datasetId, run.datasetVersion));
        const outcomes = (yield db.prepare("SELECT payload,created_at FROM comparison_outcomes WHERE namespace=? AND comparison_id=? ORDER BY case_id,arm,attempt").all(namespace, comparisonId))
          .map(row => ({ ...JSON.parse(row.payload), createdAt: row.created_at }));
        const blockers = new Set();
        const cases = (yield* mapEffects(data.cases, function*(item) {
          const arms = Object.fromEntries(["baseline", "candidate"].map(arm => {
            const attempts = outcomes.filter(outcome => outcome.caseId === item.id && outcome.arm === arm);
            return [arm, { attempts, terminal: attempts.at(-1)?.terminal ?? false, outcome: attempts.at(-1)?.outcome ?? "missing",
              latencyMs: totalLatency(attempts),
              iterations: !attempts.length || attempts.some(attempt => attempt.iterations === null)
                ? null : attempts.reduce((sum, attempt) => sum + attempt.iterations, 0) }];
          }));
          const exposedToTraining = !!(yield db.prepare("SELECT 1 FROM comparison_cases WHERE namespace=? AND input_digest=? AND split='training' LIMIT 1").get(namespace, item.inputDigest));
          return { caseId: item.id, split: item.split, exposedToTraining, ...arms };
        }));
        const holdout = cases.filter(item => item.split === "holdout");
        if (holdout.length < run.thresholds.minimumHoldoutPairs) blockers.add("insufficient_holdout_cases");
        if (data.provenance !== "observed") blockers.add("synthetic_dataset");
        if (data.complexity !== "routine") blockers.add("complex_work_requires_separate_qualification");
        if ((yield* blocked(namespace, run.baseline.profileId)) || (yield* blocked(namespace, run.candidate.profileId))) blockers.add("profile_blocked_by_policy");
        for (const item of holdout) {
          if (item.exposedToTraining) blockers.add("holdout_exposed_to_training");
          if (!item.baseline.terminal || !item.candidate.terminal) blockers.add("incomplete_pairs");
          for (const arm of [item.baseline, item.candidate]) {
            if (arm.attempts.some(attempt => attempt.provenance !== "observed")) blockers.add("synthetic_outcomes");
            if (arm.attempts.some(attempt => attempt.observedVariant === null)) blockers.add("unverified_execution_dimensions");
            if (arm.attempts.some(attempt => ["unknown", "cancelled"].includes(attempt.outcome))) blockers.add("unknown_or_cancelled_outcomes");
            if (arm.terminal && arm.latencyMs === null) blockers.add("unmeasured_resources");
            if (arm.attempts.some(attempt => attempt.iterations === null)) blockers.add("unmeasured_resources");
            if (arm.attempts.length && arm.attempts.every(attempt => attempt.latencyMs !== null) && arm.latencyMs === null) blockers.add("unrepresentable_resource_aggregate");
          }
          if (item.baseline.outcome === "passed" && item.candidate.outcome !== "passed") blockers.add("paired_quality_regression");
          if (firstPass(item.baseline) && !firstPass(item.candidate)) blockers.add("paired_first_pass_regression");
        }
        const summary = arm => {
          const passed = holdout.filter(item => item[arm].outcome === "passed");
          return { cases: holdout.length, completed: holdout.filter(item => item[arm].terminal).length, passed: passed.length,
            firstPass: holdout.filter(item => firstPass(item[arm])).length,
            failedAttempts: holdout.reduce((sum, item) => sum + item[arm].attempts.filter(attempt => attempt.outcome === "failed").length, 0),
            lowerBound: lowerBound(passed.length, holdout.length),
            medianIterations: holdout.every(item => item[arm].terminal && item[arm].iterations !== null) ? median(holdout.map(item => item[arm].iterations)) : null,
            medianAcceptedLatencyMs: median(passed.flatMap(item => item[arm].latencyMs === null ? [] : [item[arm].latencyMs])) };
        };
        const baseline = summary("baseline"), candidate = summary("candidate");
        if (baseline.lowerBound < run.thresholds.qualityLowerBound || candidate.lowerBound < run.thresholds.qualityLowerBound) blockers.add("quality_floor_not_met");
        if (candidate.medianIterations === null || candidate.medianIterations > run.thresholds.maximumMedianIterations) blockers.add("iteration_limit_exceeded");
        // Compare resource use on the same accepted cases; all failed repair
        // attempts remain in each case's cost, completeness and failure counts.
        const acceptedPairs = holdout.filter(item => item.baseline.outcome === "passed" && item.candidate.outcome === "passed");
        const baselineLatency = median(acceptedPairs.flatMap(item => item.baseline.latencyMs === null ? [] : [item.baseline.latencyMs]));
        const candidateLatency = median(acceptedPairs.flatMap(item => item.candidate.latencyMs === null ? [] : [item.candidate.latencyMs]));
        const rawImprovement = baselineLatency > 0 && candidateLatency !== null ? 1 - candidateLatency / baselineLatency : null;
        const latencyImprovement = Number.isFinite(rawImprovement) ? rawImprovement : null;
        if (rawImprovement !== null && !Number.isFinite(rawImprovement)) blockers.add("unrepresentable_resource_ratio");
        if (acceptedPairs.length < run.thresholds.minimumHoldoutPairs) blockers.add("insufficient_accepted_pairs");
        if (latencyImprovement === null || latencyImprovement < run.thresholds.minimumLatencyImprovement) blockers.add("latency_target_not_met");
        return { policyVersion: COMPARISON_POLICY_VERSION, comparison: run, dataset: { id: data.id, version: data.version, taskFamily: data.taskFamily, taskFamilyVersion: data.taskFamilyVersion, provenance: data.provenance },
          status: blockers.size ? "not_ready" : "eligible_for_canary", evidenceTrust: "host_attested", productionImprovementProven: false,
          blockers: [...blockers].sort(), baseline, candidate, acceptedPairs: acceptedPairs.length, latencyImprovement, cases,
          limitations: ["Provenance, evaluator independence and execution observations are supplied by the authorized host, not independently verified by this package.",
            "Thresholds describe these frozen cases; they are not universal statistical or production guarantees.",
            "Training exposure checks cover registered input digests only; unseen training overlap and omitted executions cannot be detected here.",
            "This report does not activate routing, override pins or grant provider, company or execution access."] };
      }));
    },
  };
}
