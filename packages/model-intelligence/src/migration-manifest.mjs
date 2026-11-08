// Offline operator tooling only. Never imported by the HTTP server or runtime
// factory: a complete inventory scans every row and must not block live work.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createMigrationTableDigest, MODEL_BACKUP_MANIFEST_SCHEMA } from "./migration-digest.mjs";

const tables = ["routing_receipts", "evaluations", "policy_events", "comparison_datasets", "comparison_cases",
  "controlled_comparisons", "comparison_outcomes", "routing_rollout_policies", "routing_releases",
  "routing_rollout_assignments", "routing_rollout_outcomes", "routing_rollout_events"].sort();
const schema = MODEL_BACKUP_MANIFEST_SCHEMA;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identifier = name => `"${name.replaceAll('"', '""')}"`;
const sameFile = (a, b) => ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(key => a[key] === b[key]);
const changed = () => new Error("The backup changed during inspection; create a consistent offline backup and retry");

async function stableFile(path, expected) {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Supply a regular offline SQLite backup, not a symlink or live store");
  if (expected && !sameFile(stat, expected)) throw changed();
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { await lstat(`${path}${suffix}`); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw new Error("SQLite sidecars are present; inspect a consistent standalone backup instead of the live store");
  }
  return stat;
}

async function fileHash(path, expected) {
  const digest = createHash("sha256");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!sameFile(await file.stat({ bigint: true }), expected)) throw changed();
    // Prevent SQLite from creating WAL/SHM files even for a read-only connection.
    const header = Buffer.alloc(100);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== 100 || header.subarray(0, 16).toString("binary") !== "SQLite format 3\0"
      || header[18] !== 1 || header[19] !== 1) {
      throw new Error("Supply a standalone SQLite backup in rollback-journal format; this command never checkpoints or changes a live store");
    }
    const stream = createReadStream(path, { fd: file.fd, autoClose: false, start: 0 });
    for await (const chunk of stream) digest.update(chunk);
    if (!sameFile(await file.stat({ bigint: true }), expected)) throw changed();
    return digest.digest("hex");
  } finally { await file.close(); }
}

/** Inventory one immutable backup. Raw rows, namespace IDs, JSON payloads and
 * paths never enter the manifest. SQL row order includes exact signed 64-bit
 * rowids: receipt cutoffs and same-timestamp policy decisions depend on them.
 * A manifest is integrity evidence, not schema/import/runtime parity approval. */
export async function inspectModelIntelligenceBackup(path, { maxRows = 1_000_000, maxCellBytes = 2 * 1024 * 1024 } = {}) {
  if (typeof path !== "string" || !path || path === ":memory:" || path.startsWith("file:")) throw new Error("Supply an offline backup filesystem path");
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || !Number.isSafeInteger(maxCellBytes) || maxCellBytes < 1) throw new Error("Invalid inventory bounds");
  const before = await stableFile(path);
  const fileSha256 = await fileHash(path, before);
  await stableFile(path, before);
  let db;
  let inventory;
  try {
    db = new DatabaseSync(path, { readOnly: true, enableLoadExtension: false });
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;");
    const userVersion = db.prepare("PRAGMA user_version").get().user_version;
    if (userVersion !== 5) throw new Error("Only schema v5 backups are supported; the source is never upgraded by inspection");
    const integrity = db.prepare("PRAGMA integrity_check(1)").get();
    if (integrity?.integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").get()) throw new Error("SQLite integrity validation failed; no manifest produced");
    const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
    const actualTables = objects.filter(row => row.type === "table").map(row => row.name).sort();
    if (JSON.stringify(actualTables) !== JSON.stringify(tables) || objects.some(row => !["table", "index"].includes(row.type))) {
      throw new Error("Unexpected database objects; inspect schema compatibility before migration");
    }
    let totalRows = 0;
    const contents = tables.map(name => {
      const columns = db.prepare(`PRAGMA table_xinfo(${identifier(name)})`).all().map(column => ({
        cid: column.cid, name: column.name, type: column.type, notnull: column.notnull, pk: column.pk, hidden: column.hidden,
        defaultExpressionSha256: column.dflt_value === null ? null : hash(column.dflt_value),
      }));
      if (!columns.length || columns.some(column => column.hidden || ["rowid", "_rowid_", "oid", "__sequence"].includes(column.name.toLowerCase()))) {
        throw new Error("Unsupported stored columns or row identity; no manifest produced");
      }
      // Reject oversized cells in SQLite before materializing them in JS.
      if (db.prepare(`SELECT 1 FROM ${identifier(name)} WHERE ${columns.map(column =>
        `length(CAST(${identifier(column.name)} AS BLOB)) > ?`).join(" OR ")} LIMIT 1`).get(...columns.map(() => maxCellBytes))) {
        throw new Error("A stored value exceeds the bounded inventory contract; no manifest produced");
      }
      const statement = db.prepare(`SELECT rowid AS __sequence, ${columns.map(column => identifier(column.name)).join(", ")} FROM ${identifier(name)} ORDER BY rowid`);
      statement.setReadBigInts(true);
      const digest = createMigrationTableDigest(name, columns, maxCellBytes);
      // Versioned typed framing separates NULL/text/integer/real/blob and retains
      // exact stored JSON text. Never parse and reserialize source payloads.
      for (const row of statement.iterate()) {
        if (++totalRows > maxRows) throw new Error("The backup exceeds the row limit; no manifest produced");
        digest.add(row.__sequence, columns.map(column => row[column.name]));
      }
      return digest.finish();
    });
    inventory = { schema, purpose: "offline_inventory_only", userVersion, fileBytes: before.size.toString(), fileSha256,
      schemaSha256: hash(objects), totalRows, tables: contents };
    db.exec("ROLLBACK;");
  } catch (error) {
    // SQLite errors may embed schema SQL or values; return only our own bounded
    // messages, never driver errors or private payloads.
    if (error.code?.startsWith("ERR_SQLITE")) throw new Error("SQLite backup inspection failed; no manifest produced");
    throw error;
  } finally { db?.close(); }
  await stableFile(path, before);
  if (await fileHash(path, before) !== fileSha256) throw changed();
  await stableFile(path, before);
  return { ...inventory, manifestSha256: hash(inventory) };
}

/** Exact replay identity. A changed file/schema/row/order/cutoff cannot reuse an
 * earlier manifest even when counts happen to match. No destination is written. */
export async function verifyModelIntelligenceBackup(path, manifest, options) {
  const actual = await inspectModelIntelligenceBackup(path, options);
  if (!manifest || !isDeepStrictEqual(manifest, actual)) throw new Error("The backup does not match the saved manifest");
  return actual;
}
