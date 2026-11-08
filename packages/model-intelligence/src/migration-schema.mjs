// The v5 data shape, including SQLite row order, is the migration contract.
// This belongs to the independent store; it imports no AgentOS runtime code.
import { createHash } from "node:crypto";
import { ModelMigrationError } from "./migration-errors.mjs";
const zeroDefault = createHash("sha256").update(JSON.stringify("0")).digest("hex");
const table = (columns, primary, integers = [], nullable = [], unique = []) => ({ columns: columns.split(" "), primary: primary.split(" "), integers, nullable, unique });
export const MODEL_MIGRATION_TABLES = Object.freeze({
  routing_receipts: table("namespace id task_key task_type candidate_id request_hash receipt created_at", "namespace id"),
  evaluations: table("namespace id receipt_id candidate_id task_type payload created_at", "namespace id", [], [], [["namespace", "receipt_id"]]),
  policy_events: table("namespace id candidate_id action reason created_at", "namespace id"),
  comparison_datasets: table("namespace id version input_hash payload created_at", "namespace id version"),
  comparison_cases: table("namespace dataset_id dataset_version case_id split input_digest check_digest", "namespace dataset_id dataset_version case_id"),
  controlled_comparisons: table("namespace id input_hash payload created_at receipt_cutoff", "namespace id", ["receipt_cutoff"]),
  comparison_outcomes: table("namespace id comparison_id case_id arm attempt receipt_id input_hash payload created_at", "namespace id", ["attempt"], [],
    [["namespace", "comparison_id", "case_id", "arm", "attempt"], ["namespace", "receipt_id"]]),
  routing_rollout_policies: table("namespace task_type revision id input_hash payload", "namespace task_type revision", ["revision"], [], [["namespace", "id"]]),
  routing_releases: table("namespace id task_type version state input_hash payload", "namespace id", ["version"], [], [["namespace", "task_type", "version"]]),
  routing_rollout_assignments: table("namespace receipt_id release_id task_key input_digest arm phase created_at deadline_at settled", "namespace receipt_id", ["deadline_at", "settled"], [],
    [["namespace", "release_id", "task_key"], ["namespace", "release_id", "input_digest"]]),
  routing_rollout_outcomes: table("namespace id receipt_id release_id input_hash payload created_at", "namespace id", [], [], [["namespace", "receipt_id"]]),
  routing_rollout_events: table("namespace id task_type release_id action reason created_at", "namespace id", [], ["release_id"]),
});
export const MODEL_MIGRATION_SCHEMA = "agentos_model_intelligence";
export const quoteIdentifier = value => `"${value.replaceAll('"', '""')}"`;

export function validateMigrationManifest(manifest) {
  if (manifest?.schema !== "agentos.model-intelligence-backup-manifest.v1" || manifest.userVersion !== 5
    || !/^[a-f0-9]{64}$/.test(manifest.manifestSha256 ?? "") || !Array.isArray(manifest.tables)
    || JSON.stringify(manifest.tables.map(row => row.name)) !== JSON.stringify(Object.keys(MODEL_MIGRATION_TABLES).sort())) {
    throw new ModelMigrationError("The source is not a supported v5 migration manifest");
  }
  const { manifestSha256, ...identity } = manifest;
  if (createHash("sha256").update(JSON.stringify(identity)).digest("hex") !== manifestSha256) throw new ModelMigrationError("The source manifest identity changed");
  for (const entry of manifest.tables) {
    const definition = MODEL_MIGRATION_TABLES[entry.name];
    if (!Array.isArray(entry.columns) || entry.columns.length !== definition.columns.length || !Number.isSafeInteger(entry.rows) || entry.rows < 0
      || !/^[a-f0-9]{64}$/.test(entry.contentSha256) || entry.columns.some((column, index) => column.name !== definition.columns[index]
        || column.defaultExpressionSha256 !== (column.name === "settled" ? zeroDefault : null)
        || column.type !== (definition.integers.includes(column.name) ? "INTEGER" : "TEXT") || column.hidden !== 0
        || column.pk !== definition.primary.indexOf(column.name) + 1 || column.notnull !== (definition.nullable.includes(column.name) ? 0 : 1))) {
      throw new ModelMigrationError("Source columns or identities differ from the v5 migration contract");
    }
    if (entry.rowidMaximum !== null && BigInt(entry.rowidMaximum) >= 9223372036854775807n) {
      throw new ModelMigrationError("The source row sequence has no remaining PostgreSQL identity capacity");
    }
  }
}

export function migrationRowValues(tableName, row) {
  const definition = MODEL_MIGRATION_TABLES[tableName];
  if (!definition || typeof row.__sequence !== "bigint") throw new ModelMigrationError("Unsupported migration row identity");
  const values = [row.__sequence.toString()];
  for (const column of definition.columns) {
    const value = row[column];
    if (value === null && definition.nullable.includes(column)) { values.push(null); continue; }
    if (typeof value !== (definition.integers.includes(column) ? "bigint" : "string")) throw new ModelMigrationError("A source value cannot be preserved by the destination type");
    // PostgreSQL text rejects NUL. Preserve JSON as exact text, not jsonb; the
    // source's request/replay identities can depend on its original byte order.
    if (typeof value === "string" && value.includes("\0")) throw new ModelMigrationError("A source text value is incompatible with PostgreSQL");
    if (["payload", "receipt"].includes(column)) {
      let parsed;
      try { parsed = JSON.parse(value); } catch { throw new ModelMigrationError("A source record contains invalid stored JSON"); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ModelMigrationError("A source record contains an invalid stored object");
    }
    values.push(typeof value === "bigint" ? value.toString() : value);
  }
  return values;
}
