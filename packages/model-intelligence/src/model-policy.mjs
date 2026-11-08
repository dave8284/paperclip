import { mapEffects } from "./storage-effects.mjs";
import { createHash, randomUUID } from "node:crypto";

import { taskFamilyCatalog } from "./task-families.mjs";
import { createComparisonStore, validateComparisonVariant } from "./comparisons.mjs";
import { createRolloutStore, ROLLOUT_POLICY_VERSION } from "./rollouts.mjs";
export { ROLLOUT_POLICY_VERSION } from "./rollouts.mjs";
export { COMPARISON_POLICY_VERSION } from "./comparisons.mjs";
export { classifyWork } from "./task-families.mjs";
export { taskFamilyCatalog } from "./task-families.mjs";

export const POLICY_VERSION = ROLLOUT_POLICY_VERSION;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const median = values => { const sorted = values.slice().sort((a,b) => a-b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
function lowerBound(passes, total) {
  if (!total) return 0;
  const z = 1.28, p = passes / total, denominator = 1 + z*z/total;
  return (p + z*z/(2*total) - z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)) / denominator;
}
function text(value, field) { if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`Invalid ${field}`); return value; }
function validate(input) {
  for (const key of ["namespace", "requestId", "taskKey", "taskType", "defaultCandidateId"]) text(input[key], key);
  if (!["routine", "complex"].includes(input.complexity)) throw new Error("Invalid complexity");
  if (!Array.isArray(input.candidates) || !input.candidates.length || input.candidates.length > 100) throw new Error("Supply 1–100 host-authorized candidates");
  const ids = new Set();
  for (const candidate of input.candidates) {
    text(candidate.id, "candidate ID"); text(candidate.model, "model"); text(candidate.provider, "provider");
    if (candidate.method !== "subscription" || candidate.available !== true) throw new Error("Candidate is not an available subscription profile");
    if (candidate.variant !== undefined) {
      validateComparisonVariant(candidate.variant);
      if (candidate.variant.model !== candidate.model || candidate.variant.provider !== candidate.provider || candidate.variant.method !== candidate.method) throw new Error("Candidate differs from its full execution variant");
    }
    if (ids.has(candidate.id)) throw new Error("Duplicate candidate"); ids.add(candidate.id);
  }
  if (!ids.has(input.defaultCandidateId)) throw new Error("Default profile is not eligible");
}

/** Host supplies authorized profiles; the product never acquires credentials,
 * executes tasks, infers quality from process exit, or uploads task content. */
export function createModelPolicy(db) {
  function* blocked(namespace, id) { const row = (yield db.prepare("SELECT action FROM policy_events WHERE namespace=? AND candidate_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(namespace,id)); return row?.action === "block"; }
  function* evidence(namespace, taskType, candidateId) {
    const rows = (yield db.prepare("SELECT payload FROM evaluations WHERE namespace=? AND task_type=? AND candidate_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30").all(namespace,taskType,candidateId)).map(row => JSON.parse(row.payload));
    const passed = rows.filter(row => row.passed).length;
    return { evaluations: rows.length, passed, lowerBound: lowerBound(passed,rows.length), medianLatencyMs: median(rows.filter(row => row.passed).map(row => row.latencyMs)), medianIterations: median(rows.map(row => row.iterations)), recentFailures: rows.slice(0,5).filter(row => !row.passed).length };
  }
  const { validateComparisonSelection, ...comparisons } = createComparisonStore(db, { blocked, lowerBound, median });
  const { selectRollout, considerRoutingComparison, ...rollouts } = createRolloutStore(db, { blocked, lowerBound, median, ...comparisons });
  function* routingChanged() { yield { kind: "routingChanged" }; }
  function* considerRecent(namespace, taskType) {
    // Reconcile on persisted evidence/policy changes, never by polling. Native
    // producers may re-deliver a committed observation after either store's ack.
    for (const entry of (yield* comparisons.comparisonCatalog(namespace))) {
      if (!taskType || entry.dataset.taskFamily === taskType) (yield* considerRoutingComparison({ namespace, comparisonId: entry.comparison.id }));
    }
  }
  return {
    ...comparisons,
    ...rollouts,
    *configureRoutingPolicy(input) {
      const result = (yield* rollouts.configureRoutingPolicy(input));
      if (result.mode === "automatic") (yield* considerRecent(input.namespace, input.taskType));
      (yield* routingChanged());
      return result;
    },
    *recordComparisonOutcome(input) {
      const result = (yield* comparisons.recordComparisonOutcome(input));
      (yield* considerRoutingComparison({ namespace: input.namespace, comparisonId: input.comparisonId }));
      (yield* routingChanged());
      return result;
    },
    *recordRoutingOutcome(input) {
      const result = (yield* rollouts.recordRoutingOutcome(input));
      (yield* considerRecent(input.namespace));
      (yield* routingChanged());
      return result;
    },
    *rollbackRoutingRelease(input) { const result = (yield* rollouts.rollbackRoutingRelease(input)); (yield* routingChanged()); return result; },
    *selectionReceipt({ namespace, receiptId }) {
      text(namespace, "namespace"); text(receiptId, "receiptId");
      const row = (yield db.prepare("SELECT receipt FROM routing_receipts WHERE namespace=? AND id=?").get(namespace, receiptId));
      return row ? JSON.parse(row.receipt) : null;
    },
    *select(input) {
      validate(input);
      const requestHash = hash(input);
      try {
        const comparisonBinding = input.comparisonBinding == null ? undefined : (yield* validateComparisonSelection(input));
        const existing = (yield db.prepare("SELECT * FROM routing_receipts WHERE namespace=? AND id=?").get(input.namespace,input.requestId));
        if (existing) {
          if (existing.request_hash !== requestHash) throw new Error("Selection request ID was already used with different inputs");
          return JSON.parse(existing.receipt);
        }
        const previous = input.pinTask !== false ? (yield db.prepare("SELECT receipt FROM routing_receipts WHERE namespace=? AND task_key=? ORDER BY created_at,rowid LIMIT 1").get(input.namespace,input.taskKey)) : null;
        const pin = previous && JSON.parse(previous.receipt);
        const candidates = (yield* mapEffects(input.candidates, function*(candidate) { return { ...candidate, evidence: (yield* evidence(input.namespace,input.taskType,candidate.id)), blocked: (yield* blocked(input.namespace,candidate.id)) }; }));
        const baseline = (candidates.find(row => row.id === input.defaultCandidateId));
        if (baseline.blocked) throw new Error("The baseline profile has been blocked. Configure an approved replacement.");
        let selected = baseline, reason = "Configured baseline; no enrolled, qualified routing release.", rollout;
        if (pin) {
          selected = (candidates.find(candidate => candidate.id === pin.candidate.id));
          if (!selected || selected.blocked) throw new Error("Pinned profile is unavailable. Review and reset this task before changing its model.");
          reason = "Task-pinned profile; preserve the active execution contract.";
          rollout = pin.rollout;
        } else if (input.complexity === "complex") reason = "Complex work retains the configured baseline pending a dedicated qualification.";
        else {
          const decision = (yield* selectRollout(input));
          if (decision) { selected = (candidates.find(row => row.id === decision.candidateId)); reason = decision.reason; rollout = decision.rollout; }
        }
        const receipt = { id: input.requestId, namespace: input.namespace, taskKey: input.taskKey, taskType: input.taskType, complexity: input.complexity, candidate: { id: selected.id, provider: selected.provider, model: selected.model, method: selected.method,
          ...(selected.variant ? { variant: selected.variant } : {}) }, policyVersion: POLICY_VERSION, reason, evidence: selected.evidence, contextFingerprint: input.contextFingerprint ?? null, promptFingerprint: input.promptFingerprint ?? null,
          ...(comparisonBinding ? { comparisonBinding } : {}), ...(rollout ? { rollout } : {}), createdAt: new Date().toISOString() };
        (yield db.prepare("INSERT INTO routing_receipts VALUES(?,?,?,?,?,?,?,?)").run(input.namespace,input.requestId,input.taskKey,input.taskType,selected.id,requestHash,JSON.stringify(receipt),receipt.createdAt));
        if (rollout?.assignmentId === receipt.id) (yield* routingChanged()); return receipt;
      } catch(error) { throw error; }
    },
    *evaluate(input) {
      for (const key of ["namespace", "id", "receiptId", "evidenceRef", "evaluator"]) text(input[key],key);
      if (typeof input.passed !== "boolean" || !Number.isInteger(input.iterations) || input.iterations < 1 || input.iterations > 100 || !Number.isFinite(input.latencyMs) || input.latencyMs < 0 || !["human", "checks"].includes(input.source)) throw new Error("Invalid evaluation");
      try {
        const existing = (yield db.prepare("SELECT payload FROM evaluations WHERE namespace=? AND id=?").get(input.namespace,input.id));
        if (existing) { if (existing.payload !== JSON.stringify(input)) throw new Error("Evaluation ID already exists with different results"); return input; }
        const row = (yield db.prepare("SELECT receipt FROM routing_receipts WHERE namespace=? AND id=?").get(input.namespace,input.receiptId));
        if (!row) throw new Error("Selection receipt not found in this namespace");
        const receipt = JSON.parse(row.receipt);
        if (receipt.comparisonBinding) throw new Error("Controlled comparison outcomes cannot train observational routing policy");
        (yield db.prepare("INSERT INTO evaluations VALUES(?,?,?,?,?,?,?)").run(input.namespace,input.id,input.receiptId,receipt.candidate.id,receipt.taskType,JSON.stringify(input),new Date().toISOString()));
        return input;
      } catch(error) { throw error; }
    },
    *policy(input) {
      for (const key of ["namespace", "candidateId", "reason"]) text(input[key],key);
      if (!["block", "restore"].includes(input.action)) throw new Error("Invalid policy action");
      const event = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      (yield db.prepare("INSERT INTO policy_events VALUES(?,?,?,?,?,?)").run(input.namespace,event.id,input.candidateId,input.action,input.reason,event.createdAt)); return event;
    },
    *analytics(namespace) {
      if (namespace) text(namespace,"namespace");
      const where = namespace ? " WHERE namespace=?" : "", args = namespace ? [namespace] : [];
      const receipts = (yield db.prepare(`SELECT receipt FROM routing_receipts${where} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...args)).map(row => JSON.parse(row.receipt));
      const evaluations = (yield db.prepare(`SELECT payload,created_at FROM evaluations${where} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...args)).map(row => ({ ...JSON.parse(row.payload), createdAt: row.created_at }));
      const events = (yield db.prepare(`SELECT namespace,id,candidate_id AS candidateId,action,reason,created_at AS createdAt FROM policy_events${where} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...args));
      const counts = { selections: (yield db.prepare(`SELECT count(*) AS n FROM routing_receipts${where}`).get(...args)).n, evaluations: (yield db.prepare(`SELECT count(*) AS n FROM evaluations${where}`).get(...args)).n, policyEvents: (yield db.prepare(`SELECT count(*) AS n FROM policy_events${where}`).get(...args)).n };
      // Aggregate the complete selection library, independently of the bounded
      // recent receipts list. Evidence uses the same rolling window as routing.
      const groups = (yield db.prepare(`SELECT namespace,task_type,candidate_id,count(*) AS selections FROM routing_receipts${where} GROUP BY namespace,task_type,candidate_id ORDER BY namespace,task_type,candidate_id`).all(...args));
      const profiles = (yield* mapEffects(groups, function*(group) {
        const latest = (yield db.prepare("SELECT receipt FROM routing_receipts WHERE namespace=? AND task_type=? AND candidate_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(group.namespace,group.task_type,group.candidate_id));
        const receipt = JSON.parse(latest.receipt), stats = (yield* evidence(group.namespace,group.task_type,group.candidate_id)), isBlocked = (yield* blocked(group.namespace,group.candidate_id));
        const gaps = [];
        if (isBlocked) gaps.push("Blocked by operator");
        if (stats.evaluations < 5) gaps.push(`${5-stats.evaluations} more reviewed outcomes needed`);
        if (stats.lowerBound < .7) gaps.push("Quality confidence below 70%");
        if (stats.recentFailures >= 2) gaps.push("At least two recent failures");
        if (stats.medianIterations === null || stats.medianIterations > 2) gaps.push("Median iterations must be two or fewer");
        return { namespace: group.namespace, taskType: group.task_type, candidate: receipt.candidate, selections: group.selections, evidence: stats, blocked: isBlocked, qualityQualified: !gaps.length, gaps, promptFingerprint: receipt.promptFingerprint, lastSelectedAt: receipt.createdAt };
      }));
      return { policyVersion: POLICY_VERSION, counts, receipts, evaluations, events, profiles, taskFamilies: taskFamilyCatalog(), qualification: { minimumReviews: 5, qualityConfidence: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15, evidenceWindow: 30, classifier: "task-families-v1 (ordered rules)" } };

    },
  };
}
