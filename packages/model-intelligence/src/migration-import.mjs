import { DatabaseSync } from "node:sqlite";
import { verifyModelIntelligenceBackup } from "./migration-manifest.mjs";
import { MODEL_MIGRATION_TABLES as tables, quoteIdentifier as q, validateMigrationManifest, migrationRowValues } from "./migration-schema.mjs";
import { ModelMigrationError, safeMigrationOperation } from "./migration-errors.mjs";

/** Reject drift in source uniqueness/collation before contacting a destination.
 * The manifest itself inventories schema; inventory is not compatibility proof. */
function validateSourceIndexes(db) {
  for (const [name, definition] of Object.entries(tables)) {
    const expected = [definition.primary, ...definition.unique].map(keys => JSON.stringify(keys)).sort();
    const actual = [];
    for (const index of db.prepare(`PRAGMA index_list(${q(name)})`).all().filter(row => row.unique)) {
      const keys = db.prepare(`PRAGMA index_xinfo(${q(index.name)})`).all().filter(row => row.key);
      if (index.partial || keys.some(key => key.coll !== "BINARY" || key.desc)) throw new ModelMigrationError("Unsupported source uniqueness or collation");
      if (name === "routing_releases" && index.name === "routing_release_comparison") {
        const { sql } = db.prepare("SELECT sql FROM sqlite_schema WHERE name=? AND type='index'").get(index.name) ?? {};
        if (JSON.stringify(keys.map(key => key.name)) !== JSON.stringify(["namespace", null])
          || !sql?.replace(/\s+/g, "").endsWith("(namespace,json_extract(payload,'$.comparisonId'))")) throw new ModelMigrationError("The source comparison uniqueness contract changed");
      } else actual.push(JSON.stringify(keys.map(key => key.name)));
    }
    if (JSON.stringify(actual.sort()) !== JSON.stringify(expected)) throw new ModelMigrationError("Source identity constraints differ from the destination contract");
    if (name === "routing_releases" && !db.prepare("SELECT 1 FROM sqlite_schema WHERE name='routing_release_comparison' AND type='index'").get()) throw new ModelMigrationError("The source comparison uniqueness index is missing");
  }
}

/** Operator-only asynchronous importer. It can commit bounded staging batches;
 * it cannot enable runtime reads, switch stores, acquire credentials or qualify
 * report/selection parity. A lost reply is recovered from durable progress. */
export const importModelIntelligenceBackup = safeMigrationOperation(async (path, manifest, destination,
  { batchRows = 250, maxBatchBytes = 8 * 1024 * 1024, signal, ...inventoryOptions } = {}) => {
  if (!Number.isSafeInteger(batchRows) || batchRows < 1 || batchRows > 250 || !Number.isSafeInteger(maxBatchBytes)
    || maxBatchBytes < 1 || maxBatchBytes > 64 * 1024 * 1024 || !["start", "writeBatch", "finish"].every(key => typeof destination?.[key] === "function")) {
    throw new ModelMigrationError("Invalid bounded import configuration");
  }
  const abort = () => { if (signal?.aborted) throw new ModelMigrationError("Import interrupted; committed batches remain resumable and runtime stays disabled"); };
  abort(); manifest = structuredClone(manifest); validateMigrationManifest(manifest);
  await verifyModelIntelligenceBackup(path, manifest, inventoryOptions);
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true, enableLoadExtension: false });
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");
    validateSourceIndexes(db);
    abort();
    const state = await destination.start(manifest);
    if (!["importing", "imported_unaccepted"].includes(state.state) || !Array.isArray(state.progress)
      || state.progress.length !== manifest.tables.length || new Set(state.progress.map(row => row.table_name)).size !== manifest.tables.length) throw new ModelMigrationError("Invalid destination progress");
    for (const entry of manifest.tables) {
      abort();
      const cursor = state.progress.find(row => row.table_name === entry.name);
      if (!cursor || !/^\d+$/.test(cursor.row_count) || BigInt(cursor.row_count) > BigInt(entry.rows)
        || cursor.last_rowid !== null && !/^-?\d+$/.test(cursor.last_rowid)) throw new ModelMigrationError("Invalid destination progress");
      let after = cursor.last_rowid;
      const statement = db.prepare(`SELECT rowid AS __sequence,${tables[entry.name].columns.map(q).join(",")} FROM ${q(entry.name)} ORDER BY rowid`);
      statement.setReadBigInts(true);
      let batch = [], bytes = 0, seen = 0, beforeCursor = 0;
      const flush = async () => {
        if (!batch.length) return;
        abort();
        const expected = batch.at(-1)[0];
        const result = await destination.writeBatch(manifest, entry.name, after, batch);
        if (result.lastRowid !== expected) throw new ModelMigrationError("Import progress changed; reload the saved checkpoint");
        after = expected; batch = []; bytes = 0;
      };
      for (const row of statement.iterate()) {
        seen++;
        const values = migrationRowValues(entry.name, row);
        if (cursor.last_rowid !== null && row.__sequence <= BigInt(cursor.last_rowid)) { beforeCursor++; continue; }
        if (state.state === "imported_unaccepted") throw new ModelMigrationError("A supposedly imported destination is missing source rows");
        const size = Buffer.byteLength(JSON.stringify(values));
        if (size > maxBatchBytes) throw new ModelMigrationError("A source row exceeds the import batch byte limit");
        if (batch.length && (batch.length >= batchRows || bytes + size > maxBatchBytes)) await flush();
        batch.push(values); bytes += size;
      }
      if (seen !== entry.rows || beforeCursor !== Number(cursor.row_count)
        || cursor.last_rowid !== null && beforeCursor === 0) throw new ModelMigrationError("Source rows differ from the saved progress");
      await flush();
    }
    db.exec("ROLLBACK"); db.close(); db = null;
    // Any source change across the snapshot prevents finalization. Partial
    // destination batches remain bound to the original manifest and disabled.
    abort(); await verifyModelIntelligenceBackup(path, manifest, inventoryOptions); abort();
    return await destination.finish(manifest);
  } finally { db?.close(); }
});
