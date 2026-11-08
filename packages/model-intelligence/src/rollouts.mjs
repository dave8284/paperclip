import { mapEffects, findEffects } from "./storage-effects.mjs";
import { createHash, randomUUID } from "node:crypto";

export const ROLLOUT_POLICY_VERSION = "controlled-rollout-v1";
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const digest = value => createHash("sha256").update(canonical(value)).digest("hex");
function text(value, field) { if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`Invalid ${field}`); }
function fields(input, allowed) { if (!input || typeof input !== "object" || Array.isArray(input)
  || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid rollout input"); }
function integer(value, low, high, field) { if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error(`Invalid ${field}`); }
function identity(input) { for (const key of ["namespace", "id"]) text(input[key], key); }
const same = (left, right) => canonical(left) === canonical(right);
const fitsPolicy = (item, limits) => limits.qualityLowerBound <= item.limits.qualityLowerBound
  && limits.minimumObservations <= item.limits.minimumObservations && limits.maximumMedianIterations >= item.limits.maximumMedianIterations
  && limits.minimumLatencyImprovement <= item.limits.minimumLatencyImprovement && limits.maximumPending >= item.limits.maximumPending
  && limits.observationTimeoutMs >= item.limits.observationTimeoutMs && limits.canaryPercent >= item.limits.canaryPercent;

/** Independent policy owner. Hosts still authorize companies/accounts, supply
 * observed outcomes, and execute native work. No timers, credentials or calls
 * to a model are introduced here. The store adapter owns each public transaction. */
export function createRolloutStore(db, { blocked, comparisonDefinition, comparisonReport, lowerBound, median }) {
  // Nested policy work shares its caller's public-operation transaction.
  function* atomic(work) { return (yield* work()); }
  const parse = row => row ? JSON.parse(row.payload) : null;
  const policy = function*(namespace, taskType) { return parse((yield db.prepare("SELECT payload FROM routing_rollout_policies WHERE namespace=? AND task_type=? ORDER BY revision DESC LIMIT 1").get(namespace, taskType))); };
  function* release(namespace, id) {
    const row = (yield db.prepare("SELECT payload,state FROM routing_releases WHERE namespace=? AND id=?").get(namespace, id));
    if (!row) throw new Error("Routing release not found in this namespace");
    return { ...parse(row), state: row.state };
  }
  function* current(namespace, taskType) {
    const row = (yield db.prepare("SELECT id FROM routing_releases WHERE namespace=? AND task_type=? AND state IN ('canary','adopted') ORDER BY version DESC LIMIT 1").get(namespace, taskType));
    return row ? (yield* release(namespace, row.id)) : null;
  }
  function* event(namespace, taskType, releaseId, action, reason) {
    (yield db.prepare("INSERT INTO routing_rollout_events VALUES(?,?,?,?,?,?,?)").run(namespace, randomUUID(), taskType, releaseId, action, reason, new Date().toISOString()));
  }
  function* transition(item, state, reason) {
    (yield db.prepare("UPDATE routing_releases SET state=? WHERE namespace=? AND id=? AND state IN ('canary','adopted')").run(state, item.namespace, item.id));
    (yield* event(item.namespace, item.taskType, item.id, state, reason));
    if (state === "rolled_back") (yield db.prepare("UPDATE routing_rollout_assignments SET settled=2 WHERE namespace=? AND release_id=? AND settled=0").run(item.namespace, item.id));
    item.state = state;
  }
  function* observations(item) {
    // A canary is bounded to 100 samples per arm. Adopted releases use their
    // most recent 30 samples per arm; no growing history scan during routing.
    return Object.fromEntries((yield* mapEffects(["baseline", "candidate"], function*(arm) { return [arm,
      (yield db.prepare(`SELECT o.payload FROM routing_rollout_outcomes o JOIN routing_rollout_assignments a
        ON a.namespace=o.namespace AND a.receipt_id=o.receipt_id
        WHERE o.namespace=? AND o.release_id=? AND a.arm=? ORDER BY o.rowid DESC LIMIT ?`)
        .all(item.namespace, item.id, arm, item.state === "canary" ? 100 : Math.max(30, item.limits.minimumObservations))).map(parse),
    ]; })));
  }
  function* pending(item) {
    return (yield db.prepare(`SELECT created_at FROM routing_rollout_assignments
      WHERE namespace=? AND release_id=? AND settled=0 ORDER BY created_at LIMIT 101`)
      .all(item.namespace, item.id));
  }
  function* reconcile(item, now = Date.now()) {
    if (!["canary", "adopted"].includes(item.state)) return item;
    const currentPolicy = (yield* policy(item.namespace, item.taskType));
    const pendingRows = (yield* pending(item));
    const report = (yield* comparisonReport({ namespace: item.namespace, comparisonId: item.comparisonId }));
    let reason = null;
    if (item.parentReleaseId && (yield* release(item.namespace, item.parentReleaseId)).state !== "adopted") reason = "The prerequisite adopted baseline was withdrawn.";
    if (report.status !== "eligible_for_canary") reason = "The prerequisite comparison no longer meets its evidence gates.";
    if ((yield* blocked(item.namespace, item.baseline.profileId)) || (yield* blocked(item.namespace, item.candidate.profileId))) reason = "A release profile was blocked.";
    if (pendingRows.some(row => now - Date.parse(row.created_at) > item.limits.observationTimeoutMs)) reason = "An admitted observation expired without complete outcome evidence.";
    const arms = (yield* observations(item));
    if (arms.candidate.some(row => row.outcome !== "passed" || row.iterations === null || row.iterations > item.limits.maximumMedianIterations
      || row.latencyMs === null || !same(row.observedVariant, item.candidate))) reason = "Candidate quality, iterations or execution evidence regressed.";
    if (arms.baseline.some(row => ["unknown", "cancelled"].includes(row.outcome) || row.iterations === null || row.latencyMs === null || !same(row.observedVariant, item.baseline))) reason = "Control evidence is incomplete.";
    const enough = arms.baseline.length >= item.limits.minimumObservations && arms.candidate.length >= item.limits.minimumObservations;
    if (enough) {
      const score = arm => lowerBound(arms[arm].filter(row => row.outcome === "passed").length, arms[arm].length);
      const baselineLatency = median(arms.baseline.filter(row => row.outcome === "passed").map(row => row.latencyMs));
      const candidateLatency = median(arms.candidate.map(row => row.latencyMs));
      if (score("candidate") < item.limits.qualityLowerBound || score("baseline") < item.limits.qualityLowerBound || score("candidate") < score("baseline") - .03
        || !(baselineLatency > 0) || candidateLatency > baselineLatency * (1 - item.limits.minimumLatencyImprovement)) {
        reason = "Observed quality or latency no longer meets the release target.";
      }
    }
    if (reason) (yield* transition(item, "rolled_back", reason));
    else if (item.state === "canary" && currentPolicy?.mode === "automatic" && currentPolicy.revision === item.expectedPolicyRevision
      && enough && !pendingRows.length) (yield* transition(item, "adopted", "Complete canary and control observations meet the versioned quality/resource gates."));
    return item;
  }
  function replay(row, input) {
    if (row.input_hash !== digest(input)) throw new Error("Rollout record ID already exists with different inputs");
    return parse(row);
  }
  const api = {
    *configureRoutingPolicy(input) {
      fields(input, ["namespace", "id", "taskType", "expectedRevision", "mode", "pinnedReleaseId", "limits", "reason"]); identity(input);
      text(input.taskType, "taskType"); text(input.reason, "reason"); integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, "expectedRevision");
      if (!["automatic", "pinned", "off"].includes(input.mode)) throw new Error("Invalid routing policy mode");
      const limits = input.limits;
      fields(limits, ["canaryPercent", "maximumPending", "minimumObservations", "observationTimeoutMs", "qualityLowerBound", "maximumMedianIterations", "minimumLatencyImprovement"]);
      integer(limits.canaryPercent, 1, 10, "canaryPercent"); integer(limits.maximumPending, 1, 100, "maximumPending");
      integer(limits.minimumObservations, 5, 100, "minimumObservations"); integer(limits.observationTimeoutMs, 60_000, 7 * 86_400_000, "observationTimeoutMs");
      integer(limits.maximumMedianIterations, 1, 2, "maximumMedianIterations");
      if (!Number.isFinite(limits.qualityLowerBound) || limits.qualityLowerBound < .7 || limits.qualityLowerBound > 1
        || !Number.isFinite(limits.minimumLatencyImprovement) || limits.minimumLatencyImprovement < .15 || limits.minimumLatencyImprovement >= 1) throw new Error("Routing policy cannot weaken quality/resource floors");
      if (input.mode === "pinned") text(input.pinnedReleaseId, "pinnedReleaseId");
      else if (input.pinnedReleaseId !== null) throw new Error("Only a pinned policy can name a release");
      return (yield* atomic(function*() {
        const old = (yield db.prepare("SELECT * FROM routing_rollout_policies WHERE namespace=? AND id=?").get(input.namespace, input.id));
        if (old) return replay(old, input);
        const previous = (yield* policy(input.namespace, input.taskType));
        if ((previous?.revision ?? 0) !== input.expectedRevision) throw new Error("Routing policy changed; reload its current revision");
        if (input.mode === "pinned") {
          const target = (yield* release(input.namespace, input.pinnedReleaseId));
          if (target.taskType !== input.taskType || target.state !== "adopted") throw new Error("Only an adopted release of this task family can be pinned");
          if (!fitsPolicy(target, limits)) throw new Error("A pinned release cannot exceed the new policy limits");
        }
        const result = { ...input, revision: input.expectedRevision + 1, createdAt: new Date().toISOString() };
        const active = (yield* current(input.namespace, input.taskType));
        if (active?.state === "canary") (yield* transition(active, "rolled_back", "Company policy changed during the canary; its original enrollment no longer applies."));
        if (active?.state === "adopted" && !fitsPolicy(active, limits)) {
          if (input.mode === "pinned") throw new Error("A pinned release cannot exceed the new policy limits");
          (yield* transition(active, "rolled_back", "Company policy now requires stricter observation limits; a new release is required."));
        }
        (yield db.prepare("INSERT INTO routing_rollout_policies VALUES(?,?,?,?,?,?)").run(input.namespace, input.taskType, result.revision, input.id, digest(input), JSON.stringify(result)));
        (yield* event(input.namespace, input.taskType, input.pinnedReleaseId, "policy_configured", input.reason));
        return result;
      }));
    },
    *publishRoutingRelease(input) {
      fields(input, ["namespace", "id", "comparisonId", "expectedPolicyRevision", "reason"]); identity(input);
      text(input.comparisonId, "comparisonId"); text(input.reason, "reason"); integer(input.expectedPolicyRevision, 1, Number.MAX_SAFE_INTEGER, "expectedPolicyRevision");
      return (yield* atomic(function*() {
        const old = (yield db.prepare("SELECT * FROM routing_releases WHERE namespace=? AND id=?").get(input.namespace, input.id));
        if (old) { replay(old, input); return (yield* release(input.namespace, input.id)); }
        if ((yield db.prepare("SELECT 1 FROM routing_releases WHERE namespace=? AND json_extract(payload,'$.comparisonId')=? LIMIT 1").get(input.namespace, input.comparisonId))) throw new Error("This comparison already has a release; a new trial requires fresh evidence");
        const report = (yield* comparisonReport({ namespace: input.namespace, comparisonId: input.comparisonId }));
        const definition = (yield* comparisonDefinition({ namespace: input.namespace, comparisonId: input.comparisonId }));
        if (report.status !== "eligible_for_canary" || definition.dataset.complexity !== "routine") throw new Error("Complete observed holdout evidence is required before a canary");
        const taskType = definition.dataset.taskFamily, currentPolicy = (yield* policy(input.namespace, taskType));
        if (!currentPolicy || currentPolicy.mode !== "automatic" || currentPolicy.revision !== input.expectedPolicyRevision) throw new Error("The company has not enrolled this task family at the requested policy revision");
        const parent = (yield* current(input.namespace, taskType));
        if (parent?.state === "canary") throw new Error("Finish or roll back the current canary before publishing another");
        if (parent && !same(parent.candidate, definition.comparison.baseline)) throw new Error("The new comparison must use the adopted release as its baseline");
        const { baseline, candidate, thresholds } = definition.comparison;
        const limits = { ...currentPolicy.limits, minimumObservations: Math.max(currentPolicy.limits.minimumObservations, thresholds.minimumHoldoutPairs),
          qualityLowerBound: Math.max(currentPolicy.limits.qualityLowerBound, thresholds.qualityLowerBound),
          maximumMedianIterations: Math.min(currentPolicy.limits.maximumMedianIterations, thresholds.maximumMedianIterations),
          minimumLatencyImprovement: Math.max(currentPolicy.limits.minimumLatencyImprovement, thresholds.minimumLatencyImprovement) };
        const version = (yield db.prepare("SELECT coalesce(max(version),0)+1 AS next FROM routing_releases WHERE namespace=? AND task_type=?").get(input.namespace, taskType)).next;
        const result = { ...input, policyVersion: ROLLOUT_POLICY_VERSION, taskType, taskFamilyVersion: definition.dataset.taskFamilyVersion,
          version, parentReleaseId: parent?.id ?? null, rootBaseline: parent?.rootBaseline ?? baseline, baseline, candidate, limits,
          excludedInputs: definition.dataset.cases.map(item => item.inputDigest), comparisonEvidenceSha256: digest(report), state: "canary", createdAt: new Date().toISOString() };
        (yield db.prepare("INSERT INTO routing_releases VALUES(?,?,?,?,?,?,?)").run(input.namespace, input.id, taskType, version, result.state, digest(input), JSON.stringify(result)));
        (yield* event(input.namespace, taskType, input.id, "published", input.reason));
        return result;
      }));
    },
    *rollbackRoutingRelease(input) {
      fields(input, ["namespace", "releaseId", "reason"]);
      for (const field of ["namespace", "releaseId", "reason"]) text(input[field], field);
      return (yield* atomic(function*() {
        const item = (yield* release(input.namespace, input.releaseId));
        if (item.state !== "rolled_back") (yield* transition(item, "rolled_back", input.reason));
        return item;
      }));
    },
    *recordRoutingOutcome(input) {
      fields(input, ["namespace", "id", "receiptId", "outcome", "iterations", "latencyMs", "observedVariant", "evidenceRef", "evaluator", "source"]); identity(input);
      for (const field of ["receiptId", "evidenceRef", "evaluator"]) text(input[field], field);
      if (!["passed", "failed", "cancelled", "unknown"].includes(input.outcome) || !["human", "checks"].includes(input.source)) throw new Error("Invalid observed routing outcome");
      if (input.iterations !== null) integer(input.iterations, 1, 100, "iterations");
      if (input.latencyMs !== null && (!Number.isFinite(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > Number.MAX_SAFE_INTEGER / 10)) throw new Error("Invalid latencyMs");
      return (yield* atomic(function*() {
        const old = (yield db.prepare("SELECT * FROM routing_rollout_outcomes WHERE namespace=? AND id=?").get(input.namespace, input.id));
        if (old) return replay(old, input);
        const assignment = (yield db.prepare("SELECT * FROM routing_rollout_assignments WHERE namespace=? AND receipt_id=?").get(input.namespace, input.receiptId));
        const receipt = parse((yield db.prepare("SELECT receipt AS payload FROM routing_receipts WHERE namespace=? AND id=?").get(input.namespace, input.receiptId)));
        if (!assignment || receipt?.rollout?.assignmentId !== input.receiptId || receipt.rollout.releaseId !== assignment.release_id) throw new Error("An exact same-namespace rollout selection is required");
        const item = (yield* release(input.namespace, assignment.release_id));
        if (input.observedVariant !== null && !same(input.observedVariant, item[assignment.arm])) throw new Error("Observed execution differs from its assigned release variant");
        const createdAt = new Date().toISOString();
        (yield db.prepare("INSERT INTO routing_rollout_outcomes VALUES(?,?,?,?,?,?,?)").run(input.namespace, input.id, input.receiptId, item.id, digest(input), JSON.stringify(input), createdAt));
        (yield db.prepare("UPDATE routing_rollout_assignments SET settled=1 WHERE namespace=? AND receipt_id=?").run(input.namespace, input.receiptId));
        (yield* reconcile(item));
        return input;
      }));
    },
    *routingRollouts({ namespace, taskType }) {
      text(namespace, "namespace"); text(taskType, "taskType");
      return (yield* atomic(function*() { return { policy: (yield* policy(namespace, taskType)),
        releases: (yield* mapEffects((yield db.prepare("SELECT id FROM routing_releases WHERE namespace=? AND task_type=? ORDER BY version DESC LIMIT 20").all(namespace, taskType)), function*(row) { return (yield* release(namespace, row.id)); })),
        events: (yield db.prepare("SELECT id,release_id AS releaseId,action,reason,created_at AS createdAt FROM routing_rollout_events WHERE namespace=? AND task_type=? ORDER BY rowid DESC LIMIT 100").all(namespace, taskType)),
      }; }));
    },
    *hasRoutingRelease({ namespace, taskType }) {
      text(namespace, "namespace"); text(taskType, "taskType");
      const enrolled = (yield* policy(namespace, taskType));
      return !!enrolled && enrolled.mode !== "off" && (enrolled.mode === "pinned"
        ? (yield* release(namespace, enrolled.pinnedReleaseId)).state === "adopted" : (yield* current(namespace, taskType)) !== null);
    },
    *routingPolicy({ namespace, taskType }) {
      text(namespace, "namespace"); text(taskType, "taskType");
      return (yield* policy(namespace, taskType));
    },
    *nextRoutingDeadline() {
      const row = (yield db.prepare(`SELECT a.deadline_at FROM routing_rollout_assignments a JOIN routing_releases r
        ON r.namespace=a.namespace AND r.id=a.release_id WHERE a.settled=0 AND r.state IN ('canary','adopted') ORDER BY a.deadline_at LIMIT 1`).get());
      return row?.deadline_at ?? null;
    },
    *reconcileRoutingDeadlines() {
      return (yield* atomic(function*() {
        const rows = (yield db.prepare(`SELECT DISTINCT a.namespace,a.release_id FROM routing_rollout_assignments a JOIN routing_releases r
          ON r.namespace=a.namespace AND r.id=a.release_id WHERE a.settled=0 AND a.deadline_at<=? AND r.state IN ('canary','adopted') LIMIT 100`).all(Date.now()));
        for (const row of rows) (yield* transition((yield* release(row.namespace, row.release_id)), "rolled_back", "An admitted observation expired without complete outcome evidence."));
        return rows.length;
      }));
    },
    *considerRoutingComparison({ namespace, comparisonId }) {
      return (yield* atomic(function*() {
        const definition = (yield* comparisonDefinition({ namespace, comparisonId }));
        const enrolled = (yield* policy(namespace, definition.dataset.taskFamily));
        if (!enrolled || enrolled.mode !== "automatic" || definition.dataset.complexity !== "routine") return null;
        if ((yield db.prepare("SELECT 1 FROM routing_releases WHERE namespace=? AND json_extract(payload,'$.comparisonId')=? LIMIT 1").get(namespace, comparisonId))) return null;
        const parent = (yield* current(namespace, definition.dataset.taskFamily));
        if (parent?.state === "canary" || parent && !same(parent.candidate, definition.comparison.baseline)) return null;
        if ((yield* comparisonReport({ namespace, comparisonId })).status !== "eligible_for_canary") return null;
        return (yield* api.publishRoutingRelease({ namespace, id: `auto:${digest([namespace, comparisonId])}`, comparisonId,
          expectedPolicyRevision: enrolled.revision, reason: "Automatic publication under the enrolled company policy after complete held-out evidence." }));
      }));
    },
    // Called only inside the selection transaction. A profile's complete
    // native variant must match; legacy observational scores cannot activate it.
    *selectRollout(input) {
      const currentPolicy = (yield* policy(input.namespace, input.taskType));
      if (!currentPolicy || currentPolicy.mode === "off" || input.complexity !== "routine" || input.comparisonBinding) return null;
      let item = currentPolicy.mode === "pinned" ? (yield* release(input.namespace, currentPolicy.pinnedReleaseId)) : (yield* current(input.namespace, input.taskType));
      if (!item || item.state === "rolled_back") return null;
      // Each failed release is retired once. Bound restoration work even after
      // a long adoption history; an unresolved chain retains the default.
      for (let depth = 0; depth < 20 && item; depth++) {
        if (!fitsPolicy(item, currentPolicy.limits)) (yield* transition(item, "rolled_back", "The release exceeds the company's current policy limits."));
        else (yield* reconcile(item));
        if (item.state !== "rolled_back") break;
        item = currentPolicy.mode === "pinned" ? null : (yield* current(input.namespace, input.taskType));
        if (depth === 19) return null;
      }
      if (!item || item.state === "rolled_back") return null;
      const configured = (input.candidates.find(row => row.id === input.defaultCandidateId));
      if (!same(configured?.variant, item.rootBaseline) || !/^[a-f0-9]{64}$/.test(input.contextFingerprint ?? "")
        || (yield db.prepare("SELECT 1 FROM comparison_cases WHERE namespace=? AND input_digest=? LIMIT 1").get(input.namespace, input.contextFingerprint))) return null;
      const find = function*(variant) { return (yield* findEffects(input.candidates, function*(row) { return same(row.variant, variant) && !(yield* blocked(input.namespace, row.id)); })); };
      const baseline = (yield* find(item.baseline)), candidate = (yield* find(item.candidate));
      if (!baseline || !candidate) return null;
      const bucket = Number.parseInt(digest([item.id, input.taskKey]).slice(0, 8), 16) % 100;
      const arm = item.state === "adopted" ? bucket < item.limits.canaryPercent ? "baseline" : "candidate"
        : bucket < item.limits.canaryPercent ? "candidate" : "baseline";
      const sampled = item.state === "adopted" || bucket < item.limits.canaryPercent * 2;
      const waiting = (yield* pending(item));
      const metadata = { releaseId: item.id, releaseVersion: item.version, policyRevision: currentPolicy.revision, phase: item.state, arm, assignmentId: null };
      if ((yield db.prepare("SELECT 1 FROM routing_rollout_assignments WHERE namespace=? AND release_id=? AND (task_key=? OR input_digest=?) LIMIT 1")
        .get(input.namespace, item.id, input.taskKey, input.contextFingerprint))) return { candidateId: baseline.id,
        reason: "Release baseline; this task or input already contributed an observation.", rollout: { ...metadata, arm: "baseline" } };
      if (!sampled || waiting.length >= item.limits.maximumPending) return { candidateId: baseline.id,
        reason: "Release baseline; canary sampling or outstanding observation limit.", rollout: { ...metadata, arm: "baseline" } };
      const counts = (yield* observations(item));
      if (item.state === "canary" && counts[arm].length >= 100) return { candidateId: baseline.id,
        reason: "Release baseline; bounded canary observation limit.", rollout: { ...metadata, arm: "baseline" } };
      const now = Date.now();
      (yield db.prepare("INSERT INTO routing_rollout_assignments VALUES(?,?,?,?,?,?,?,?,?,?)").run(input.namespace, input.requestId, item.id, input.taskKey, input.contextFingerprint, arm, item.state,
        new Date(now).toISOString(), now + item.limits.observationTimeoutMs + 1, 0));
      return { candidateId: arm === "candidate" ? candidate.id : baseline.id,
        reason: item.state === "canary" ? "Versioned low-risk canary with required outcome observation." : "Adopted release with continuing quality/resource observation.",
        rollout: { ...metadata, assignmentId: input.requestId } };
    },
  };
  return api;
}
