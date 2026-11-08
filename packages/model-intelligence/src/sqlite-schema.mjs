import { DatabaseSync } from "node:sqlite";

export function openSqliteStore(path) {
  const db = new DatabaseSync(path);
  try {
    if (db.prepare("PRAGMA user_version").get().user_version > 5) { throw new Error("Model Intelligence database schema is newer than this package"); }
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=20;
      CREATE TABLE IF NOT EXISTS routing_receipts (namespace TEXT NOT NULL, id TEXT NOT NULL, task_key TEXT NOT NULL, task_type TEXT NOT NULL, candidate_id TEXT NOT NULL, request_hash TEXT NOT NULL, receipt TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id));
      CREATE INDEX IF NOT EXISTS routing_tasks ON routing_receipts(namespace,task_key,created_at);
      CREATE TABLE IF NOT EXISTS evaluations (namespace TEXT NOT NULL, id TEXT NOT NULL, receipt_id TEXT NOT NULL, candidate_id TEXT NOT NULL, task_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id), UNIQUE(namespace,receipt_id));
      CREATE INDEX IF NOT EXISTS evaluation_profiles ON evaluations(namespace,task_type,candidate_id,created_at);
      CREATE TABLE IF NOT EXISTS policy_events (namespace TEXT NOT NULL, id TEXT NOT NULL, candidate_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id));
      `);
    initializeComparisons(db);
    initializeRollouts(db);
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close(); throw error;
  }
}
function initializeComparisons(db) {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS comparison_datasets (namespace TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id,version));
    CREATE TABLE IF NOT EXISTS comparison_cases (namespace TEXT NOT NULL, dataset_id TEXT NOT NULL, dataset_version TEXT NOT NULL, case_id TEXT NOT NULL, split TEXT NOT NULL, input_digest TEXT NOT NULL, check_digest TEXT NOT NULL, PRIMARY KEY(namespace,dataset_id,dataset_version,case_id));
    CREATE INDEX IF NOT EXISTS comparison_training_inputs ON comparison_cases(namespace,input_digest,split);
    CREATE TABLE IF NOT EXISTS controlled_comparisons (namespace TEXT NOT NULL, id TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, receipt_cutoff INTEGER NOT NULL, PRIMARY KEY(namespace,id));
    CREATE TABLE IF NOT EXISTS comparison_outcomes (namespace TEXT NOT NULL, id TEXT NOT NULL, comparison_id TEXT NOT NULL, case_id TEXT NOT NULL, arm TEXT NOT NULL, attempt INTEGER NOT NULL, receipt_id TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id), UNIQUE(namespace,comparison_id,case_id,arm,attempt), UNIQUE(namespace,receipt_id));
    PRAGMA user_version=${Math.max(3, db.prepare("PRAGMA user_version").get().user_version)};
    COMMIT;
  `);
}
function initializeRollouts(db) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS routing_rollout_policies (namespace TEXT NOT NULL, task_type TEXT NOT NULL, revision INTEGER NOT NULL, id TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace,task_type,revision), UNIQUE(namespace,id));
    CREATE TABLE IF NOT EXISTS routing_releases (namespace TEXT NOT NULL, id TEXT NOT NULL, task_type TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace,id), UNIQUE(namespace,task_type,version));
    CREATE INDEX IF NOT EXISTS routing_release_current ON routing_releases(namespace,task_type,state,version);
    CREATE UNIQUE INDEX IF NOT EXISTS routing_release_comparison ON routing_releases(namespace,json_extract(payload,'$.comparisonId'));
    CREATE TABLE IF NOT EXISTS routing_rollout_assignments (namespace TEXT NOT NULL, receipt_id TEXT NOT NULL, release_id TEXT NOT NULL, task_key TEXT NOT NULL, input_digest TEXT NOT NULL, arm TEXT NOT NULL, phase TEXT NOT NULL, created_at TEXT NOT NULL, deadline_at INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(namespace,receipt_id), UNIQUE(namespace,release_id,task_key), UNIQUE(namespace,release_id,input_digest));
    CREATE INDEX IF NOT EXISTS routing_rollout_release_assignments ON routing_rollout_assignments(namespace,release_id,created_at);
    CREATE TABLE IF NOT EXISTS routing_rollout_outcomes (namespace TEXT NOT NULL, id TEXT NOT NULL, receipt_id TEXT NOT NULL, release_id TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id), UNIQUE(namespace,receipt_id));
    CREATE INDEX IF NOT EXISTS routing_rollout_release_outcomes ON routing_rollout_outcomes(namespace,release_id,created_at);
    CREATE TABLE IF NOT EXISTS routing_rollout_events (namespace TEXT NOT NULL, id TEXT NOT NULL, task_type TEXT NOT NULL, release_id TEXT, action TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(namespace,id));
    `);
  const columns = new Set(db.prepare("PRAGMA table_info(routing_rollout_assignments)").all().map(row => row.name));
  if (!columns.has("deadline_at")) {
    db.exec(`ALTER TABLE routing_rollout_assignments ADD COLUMN deadline_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE routing_rollout_assignments ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;
      UPDATE routing_rollout_assignments SET deadline_at=cast(round((julianday(created_at)-2440587.5)*86400000) AS INTEGER)+
        (SELECT json_extract(r.payload,'$.limits.observationTimeoutMs') FROM routing_releases r WHERE r.namespace=routing_rollout_assignments.namespace AND r.id=routing_rollout_assignments.release_id)+1,
        settled=EXISTS(SELECT 1 FROM routing_rollout_outcomes o WHERE o.namespace=routing_rollout_assignments.namespace AND o.receipt_id=routing_rollout_assignments.receipt_id);`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS routing_rollout_pending_deadline ON routing_rollout_assignments(deadline_at,namespace,release_id) WHERE settled=0;
    CREATE INDEX IF NOT EXISTS routing_rollout_pending_release ON routing_rollout_assignments(namespace,release_id,created_at) WHERE settled=0;
    PRAGMA user_version=5; COMMIT;`);
}
