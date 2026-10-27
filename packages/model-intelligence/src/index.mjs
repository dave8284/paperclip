import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

export const POLICY_VERSION = "evidence-v1";
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
    if (ids.has(candidate.id)) throw new Error("Duplicate candidate"); ids.add(candidate.id);
  }
  if (!ids.has(input.defaultCandidateId)) throw new Error("Default profile is not eligible");
}

/** Host supplies authorized profiles; the product never acquires credentials,
 * executes tasks, infers quality from process exit, or uploads task content. */
export function createModelIntelligence(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=20;
    CREATE TABLE IF NOT EXISTS routing_receipts (namespace TEXT NOT NULL, id TEXT NOT NULL, task_key TEXT NOT NULL, task_type TEXT NOT NULL, candidate_id TEXT NOT NULL, request_hash TEXT NOT NULL, receipt TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id));
    CREATE INDEX IF NOT EXISTS routing_tasks ON routing_receipts(namespace,task_key,created_at);
    CREATE TABLE IF NOT EXISTS evaluations (namespace TEXT NOT NULL, id TEXT NOT NULL, receipt_id TEXT NOT NULL, candidate_id TEXT NOT NULL, task_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id), UNIQUE(namespace,receipt_id));
    CREATE INDEX IF NOT EXISTS evaluation_profiles ON evaluations(namespace,task_type,candidate_id,created_at);
    CREATE TABLE IF NOT EXISTS policy_events (namespace TEXT NOT NULL, id TEXT NOT NULL, candidate_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id));
    PRAGMA user_version=1;`);
  function blocked(namespace, id) { const row = db.prepare("SELECT action FROM policy_events WHERE namespace=? AND candidate_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(namespace,id); return row?.action === "block"; }
  function evidence(namespace, taskType, candidateId) {
    const rows = db.prepare("SELECT payload FROM evaluations WHERE namespace=? AND task_type=? AND candidate_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30").all(namespace,taskType,candidateId).map(row => JSON.parse(row.payload));
    const passed = rows.filter(row => row.passed).length;
    return { evaluations: rows.length, passed, lowerBound: lowerBound(passed,rows.length), medianLatencyMs: median(rows.filter(row => row.passed).map(row => row.latencyMs)), medianIterations: median(rows.map(row => row.iterations)), recentFailures: rows.slice(0,5).filter(row => !row.passed).length };
  }
  return {
    select(input) {
      validate(input);
      const requestHash = hash(input);
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db.prepare("SELECT * FROM routing_receipts WHERE namespace=? AND id=?").get(input.namespace,input.requestId);
        if (existing) {
          if (existing.request_hash !== requestHash) throw new Error("Selection request ID was already used with different inputs");
          db.exec("COMMIT"); return JSON.parse(existing.receipt);
        }
        const previous = input.pinTask !== false ? db.prepare("SELECT receipt FROM routing_receipts WHERE namespace=? AND task_key=? ORDER BY created_at,rowid LIMIT 1").get(input.namespace,input.taskKey) : null;
        const pin = previous && JSON.parse(previous.receipt);
        const candidates = input.candidates.map(candidate => ({ ...candidate, evidence: evidence(input.namespace,input.taskType,candidate.id), blocked: blocked(input.namespace,candidate.id) }));
        const baseline = candidates.find(row => row.id === input.defaultCandidateId);
        if (baseline.blocked) throw new Error("The baseline profile has been blocked. Configure an approved replacement.");
        let selected = baseline, reason = "Configured baseline; no qualified improvement demonstrated.";
        if (pin) {
          selected = candidates.find(candidate => candidate.id === pin.candidate.id);
          if (!selected || selected.blocked) throw new Error("Pinned profile is unavailable. Review and reset this task before changing its model.");
          reason = "Task-pinned profile; preserve the active execution contract.";
        } else if (input.complexity === "complex") reason = "Complex work retains the configured baseline pending a dedicated qualification.";
        else {
          const qualified = candidates.filter(row => !row.blocked && row.evidence.evaluations >= 5 && row.evidence.lowerBound >= .7 && row.evidence.recentFailures < 2 && row.evidence.medianIterations <= 2);
          // Lower measured latency only wins when answer quality is qualified.
          const faster = qualified.filter(row => row.id !== baseline.id && baseline.evidence.evaluations >= 5 && row.evidence.lowerBound >= baseline.evidence.lowerBound - .03 && row.evidence.medianLatencyMs < baseline.evidence.medianLatencyMs * .85).sort((a,b) => a.evidence.medianLatencyMs-b.evidence.medianLatencyMs);
          if (faster[0]) { selected = faster[0]; reason = "Qualified task outcomes and at least 15% lower measured median latency than the baseline."; }
        }
        const receipt = { id: input.requestId, namespace: input.namespace, taskKey: input.taskKey, taskType: input.taskType, complexity: input.complexity, candidate: { id: selected.id, provider: selected.provider, model: selected.model, method: selected.method }, policyVersion: POLICY_VERSION, reason, evidence: selected.evidence, contextFingerprint: input.contextFingerprint ?? null, promptFingerprint: input.promptFingerprint ?? null, createdAt: new Date().toISOString() };
        db.prepare("INSERT INTO routing_receipts VALUES(?,?,?,?,?,?,?,?)").run(input.namespace,input.requestId,input.taskKey,input.taskType,selected.id,requestHash,JSON.stringify(receipt),receipt.createdAt);
        if (selected.id !== baseline.id && !pin) db.prepare("INSERT INTO policy_events VALUES(?,?,?,?,?,?)").run(input.namespace,randomUUID(),selected.id,"promotion",reason,receipt.createdAt);
        db.exec("COMMIT"); return receipt;
      } catch(error) { db.exec("ROLLBACK"); throw error; }
    },
    evaluate(input) {
      for (const key of ["namespace", "id", "receiptId", "evidenceRef", "evaluator"]) text(input[key],key);
      if (typeof input.passed !== "boolean" || !Number.isInteger(input.iterations) || input.iterations < 1 || input.iterations > 100 || !Number.isFinite(input.latencyMs) || input.latencyMs < 0 || !["human", "checks"].includes(input.source)) throw new Error("Invalid evaluation");
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db.prepare("SELECT payload FROM evaluations WHERE namespace=? AND id=?").get(input.namespace,input.id);
        if (existing) { if (existing.payload !== JSON.stringify(input)) throw new Error("Evaluation ID already exists with different results"); db.exec("COMMIT"); return input; }
        const row = db.prepare("SELECT receipt FROM routing_receipts WHERE namespace=? AND id=?").get(input.namespace,input.receiptId);
        if (!row) throw new Error("Selection receipt not found in this namespace");
        const receipt = JSON.parse(row.receipt);
        db.prepare("INSERT INTO evaluations VALUES(?,?,?,?,?,?,?)").run(input.namespace,input.id,input.receiptId,receipt.candidate.id,receipt.taskType,JSON.stringify(input),new Date().toISOString());
        db.exec("COMMIT"); return input;
      } catch(error) { db.exec("ROLLBACK"); throw error; }
    },
    policy(input) {
      for (const key of ["namespace", "candidateId", "reason"]) text(input[key],key);
      if (!["block", "restore"].includes(input.action)) throw new Error("Invalid policy action");
      const event = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      db.prepare("INSERT INTO policy_events VALUES(?,?,?,?,?,?)").run(input.namespace,event.id,input.candidateId,input.action,input.reason,event.createdAt); return event;
    },
    analytics(namespace) {
      if (namespace) text(namespace,"namespace");
      const where = namespace ? " WHERE namespace=?" : "", args = namespace ? [namespace] : [];
      const receipts = db.prepare(`SELECT receipt FROM routing_receipts${where} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...args).map(row => JSON.parse(row.receipt));
      const evaluations = db.prepare(`SELECT payload,created_at FROM evaluations${where} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...args).map(row => ({ ...JSON.parse(row.payload), createdAt: row.created_at }));
      const events = db.prepare(`SELECT namespace,id,candidate_id AS candidateId,action,reason,created_at AS createdAt FROM policy_events${where} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...args);
      const counts = { selections: db.prepare(`SELECT count(*) AS n FROM routing_receipts${where}`).get(...args).n, evaluations: db.prepare(`SELECT count(*) AS n FROM evaluations${where}`).get(...args).n, policyEvents: db.prepare(`SELECT count(*) AS n FROM policy_events${where}`).get(...args).n };
      return { policyVersion: POLICY_VERSION, counts, receipts, evaluations, events };
    },
    close() { db.close(); },
  };
}
