import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { MODEL_MIGRATION_TABLES as tables, MODEL_MIGRATION_SCHEMA as schema, quoteIdentifier as q, validateMigrationManifest } from "./migration-schema.mjs";
import { createMigrationTableDigest } from "./migration-digest.mjs";
import { ModelMigrationError, safeMigrationOperation as safe } from "./migration-errors.mjs";

const target = `${q(schema)}._migration_target`, progress = `${q(schema)}._migration_progress`;
const qualified = name => `${q(schema)}.${q(name)}`;
const ddl = await readFile(new URL("./postgres-migrations/0001_model_evidence_v5.sql", import.meta.url), "utf8");
const ddlHash = createHash("sha256").update(ddl).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const query = (sql, text, parameters = []) => sql.unsafe(text, parameters);


/** Explicit operator-only factory using a caller-owned postgres.js connection.
 * It never reads runtime credentials, changes the live factory or enables work.
 * initialize() is a separate mutation for an approved isolated destination. */
export function createPostgresMigrationTarget(sql, { destinationId }) {
  if (!uuid.test(destinationId) || typeof sql?.begin !== "function" || typeof sql?.unsafe !== "function") throw new ModelMigrationError("Supply a pinned destination identity and PostgreSQL connection");
  destinationId = destinationId.toLowerCase();
  async function transaction(work) {
    for (let attempt = 0; ; attempt++) {
      try { return await sql.begin(work); }
      catch (error) {
        // These codes establish transaction rollback. Connection/commit reply
        // loss is uncertain and must recover from the durable import cursor.
        if (attempt >= 2 || !["40001", "40P01"].includes(error.code)) throw error;
      }
    }
  }
  async function control(tx, manifest) {
    const rows = await query(tx, `SELECT destination_id::text,format_version,ddl_sha256,state,manifest_sha256,manifest_json FROM ${target} WHERE singleton=1 FOR UPDATE`);
    const row = rows[0];
    if (rows.length !== 1 || row.destination_id !== destinationId || row.format_version !== 1 || row.ddl_sha256 !== ddlHash) throw new ModelMigrationError("Destination identity or migration format changed");
    const [activation] = await query(tx, "SELECT to_regclass($1)::text AS name", [`${schema}._runtime_activation`]);
    if (activation?.name && (await query(tx, `SELECT 1 FROM ${q(schema)}._runtime_activation WHERE active=true`)).length) throw new ModelMigrationError("The destination runtime is active; importing is disabled");
    if (manifest && (row.manifest_sha256 !== manifest.manifestSha256 || !isDeepStrictEqual(JSON.parse(row.manifest_json), manifest))) throw new ModelMigrationError("The destination belongs to a different source manifest");
    // Public API roles must not even discover this private schema. The native
    // host's generic SQL connector grants remain a separate cutover gate.
    const exposed = await query(tx, `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') AND has_schema_privilege(oid,$1,'USAGE')`, [schema]);
    const publicAccess = await query(tx, `SELECT 1 FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname=$1 AND a.grantee=0 AND a.privilege_type IN ('USAGE','CREATE')`, [schema]);
    if (exposed.length || publicAccess.length) throw new ModelMigrationError("Destination schema is accessible to a public API role");
    return row;
  }
  const progressRows = tx => query(tx, `SELECT table_name,last_rowid::text,row_count::text FROM ${progress} ORDER BY table_name`);
  const selected = name => ["rowid::text AS __sequence", ...tables[name].columns.map(column =>
    `${q(column)}${tables[name].integers.includes(column) ? "::text" : ""} AS ${q(column)}`)].join(",");
  const compare = (name, actual, values) => !!actual && isDeepStrictEqual([actual.__sequence, ...tables[name].columns.map(column => actual[column])], values);
  return {
    initialize: safe(async () => transaction(async tx => {
      await query(tx, "SELECT pg_advisory_xact_lock($1)", [81300541]);
      const [encoding] = await query(tx, "SHOW server_encoding");
      if (encoding?.server_encoding !== "UTF8") throw new ModelMigrationError("Destination must preserve UTF-8 text");
      const existing = await query(tx, "SELECT oid FROM pg_namespace WHERE nspname=$1", [schema]);
      if (!existing.length) {
        await query(tx, ddl);
        await query(tx, `INSERT INTO ${target} (singleton,destination_id,format_version,ddl_sha256,state) VALUES(1,$1,1,$2,'empty')`, [destinationId, ddlHash]);
      }
      const row = await control(tx);
      return { destinationId, state: row.state, runtimeEnabled: false };
    })),
    start: safe(async manifest => {
      manifest = structuredClone(manifest); validateMigrationManifest(manifest);
      return transaction(async tx => {
        const row = await control(tx);
        if (row.state === "empty") {
          for (const name of Object.keys(tables)) if ((await query(tx, `SELECT 1 FROM ${qualified(name)} LIMIT 1`)).length) throw new ModelMigrationError("The destination already contains unrelated evidence");
          await query(tx, `UPDATE ${target} SET state='importing',manifest_sha256=$1,manifest_json=$2 WHERE singleton=1`, [manifest.manifestSha256, JSON.stringify(manifest)]);
          for (const name of Object.keys(tables)) await query(tx, `INSERT INTO ${progress} (table_name) VALUES($1)`, [name]);
        } else if (row.manifest_sha256 !== manifest.manifestSha256 || !isDeepStrictEqual(JSON.parse(row.manifest_json), manifest)) throw new ModelMigrationError("The destination belongs to a different source manifest");
        return { state: row.state === "empty" ? "importing" : row.state, progress: await progressRows(tx) };
      });
    }),
    writeBatch: safe(async (manifest, name, after, rows) => {
      manifest = structuredClone(manifest); validateMigrationManifest(manifest);
      rows = structuredClone(rows);
      const definition = tables[name];
      if (!definition || !rows.length || rows.length > 250 || rows.some(values => values.length !== definition.columns.length + 1)) throw new ModelMigrationError("Invalid import batch");
      return transaction(async tx => {
        const state = await control(tx, manifest);
        if (state.state !== "importing") throw new ModelMigrationError("The destination is not accepting import batches");
        const [cursor] = await query(tx, `SELECT last_rowid::text,row_count::text FROM ${progress} WHERE table_name=$1 FOR UPDATE`, [name]);
        if (!cursor) throw new ModelMigrationError("Missing import progress");
        const replay = cursor.last_rowid !== after;
        let previous = after === null ? null : BigInt(after);
        for (const values of rows) {
          const sequence = BigInt(values[0]);
          if (previous !== null && sequence <= previous) throw new ModelMigrationError("Import batch sequence is not increasing");
          previous = sequence;
          if (replay && (cursor.last_rowid === null || sequence > BigInt(cursor.last_rowid))) throw new ModelMigrationError("Import progress changed; resume from the saved cursor");
        }
        // Two bounded data queries per batch; remote latency must not multiply
        // by every field or row. All parameters retain their exact text value.
        if (!replay) {
          const width = definition.columns.length + 1;
          const placeholders = rows.map((values, row) => `(${values.map((_, column) => `$${row * width + column + 1}`).join(",")})`).join(",");
          await query(tx, `INSERT INTO ${qualified(name)} (rowid,${definition.columns.map(q).join(",")}) VALUES${placeholders} ON CONFLICT DO NOTHING`, rows.flat());
        }
        const actual = await query(tx, `SELECT ${selected(name)} FROM ${qualified(name)} WHERE rowid IN (${rows.map((_, index) => `$${index + 1}`).join(",")})`, rows.map(values => values[0]));
        const bySequence = new Map(actual.map(row => [row.__sequence, row]));
        if (actual.length !== rows.length || rows.some(values => !compare(name, bySequence.get(values[0]), values))) throw new ModelMigrationError("Destination evidence conflicts with the source; no batch committed");
        if (!replay) await query(tx, `UPDATE ${progress} SET last_rowid=$1,row_count=row_count+$2 WHERE table_name=$3`, [rows.at(-1)[0], rows.length, name]);
        return { lastRowid: replay ? cursor.last_rowid : rows.at(-1)[0] };
      });
    }),
    finish: safe(async manifest => {
      manifest = structuredClone(manifest); validateMigrationManifest(manifest);
      return transaction(async tx => {
      const state = await control(tx, manifest);
      if (!["importing", "imported_unaccepted"].includes(state.state)) throw new ModelMigrationError("No import is ready for verification");
      await query(tx, `LOCK TABLE ${Object.keys(tables).map(qualified).join(",")} IN EXCLUSIVE MODE`);
      const savedProgress = await progressRows(tx);
      for (const entry of manifest.tables) {
        const cursor = savedProgress.find(row => row.table_name === entry.name);
        if (!cursor || cursor.row_count !== String(entry.rows) || cursor.last_rowid !== entry.rowidMaximum) throw new ModelMigrationError("Import progress does not cover the complete source");
        const digest = createMigrationTableDigest(entry.name, entry.columns);
        let after = null;
        while (true) {
          const sizes = tables[entry.name].columns.map(column => `coalesce(octet_length(${q(column)}::text),0)`);
          // Inspect lengths before transferring payloads. A row-count limit
          // alone can load hundreds of MiB when source text cells are large.
          const candidates = await query(tx, `SELECT rowid::text AS __sequence,(${sizes.join("+")})::bigint::text AS bytes,GREATEST(${sizes.join(",")}) AS max_cell FROM ${qualified(entry.name)}${after === null ? "" : " WHERE rowid>$1"} ORDER BY rowid LIMIT 250`, after === null ? [] : [after]);
          if (!candidates.length) break;
          let bytes = 0, end;
          for (const candidate of candidates) {
            const size = Number(candidate.bytes), maxCell = Number(candidate.max_cell);
            if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(maxCell) || maxCell < 0 || maxCell > 2 * 1024 * 1024) throw new ModelMigrationError("Destination value exceeds the verification limit");
            if (end !== undefined && bytes + size > 8 * 1024 * 1024) break;
            bytes += size; end = candidate.__sequence;
          }
          const rows = await query(tx, `SELECT ${selected(entry.name)} FROM ${qualified(entry.name)} WHERE rowid<=$1${after === null ? "" : " AND rowid>$2"} ORDER BY rowid`, after === null ? [end] : [end, after]);
          if (!rows.length) throw new ModelMigrationError("Destination verification range changed");
          for (const row of rows) digest.add(BigInt(row.__sequence), tables[entry.name].columns.map(column =>
            tables[entry.name].integers.includes(column) && row[column] !== null ? BigInt(row[column]) : row[column]));
          after = rows.at(-1).__sequence;
        }
        if (!isDeepStrictEqual(digest.finish(), entry)) throw new ModelMigrationError("Destination row content or sequence differs from the source manifest");
      }
      // Do not lower a live sequence. This destination is still disabled; replay
      // validates all rows again and never repeats sequence initialization.
      if (state.state === "importing") {
        for (const entry of manifest.tables) {
          const maximum = entry.rowidMaximum === null ? 0n : BigInt(entry.rowidMaximum);
          await query(tx, "SELECT setval(pg_get_serial_sequence($1,'rowid'),$2::bigint,$3)", [qualified(entry.name), maximum > 0n ? maximum.toString() : "1", maximum > 0n]);
        }
        await query(tx, `UPDATE ${target} SET state='imported_unaccepted' WHERE singleton=1`);
      }
      return { destinationId, manifestSha256: manifest.manifestSha256, state: "imported_unaccepted", rows: manifest.totalRows, runtimeEnabled: false };
      });
    }),
  };
}
