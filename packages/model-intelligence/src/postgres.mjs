import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAsyncPolicyStore } from "./async-store.mjs";
import { executePostgresQuery } from "./postgres-query.mjs";
import { createPostgresMigrationTarget } from "./postgres-migration-target.mjs";
import { ModelMigrationError, safeMigrationOperation } from "./migration-errors.mjs";
import { MODEL_MIGRATION_SCHEMA as schema, quoteIdentifier as q, validateMigrationManifest } from "./migration-schema.mjs";

const migrationDdl = await readFile(new URL("./postgres-migrations/0001_model_evidence_v5.sql", import.meta.url), "utf8");
const runtimeDdl = await readFile(new URL("./postgres-migrations/0002_runtime_activation.sql", import.meta.url), "utf8");
const hash = value => createHash("sha256").update(value).digest("hex");
const migrationHash = hash(migrationDdl), runtimeHash = hash(runtimeDdl);
const target = `${q(schema)}._migration_target`, activation = `${q(schema)}._runtime_activation`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class ModelStorageError extends Error {
  constructor(code) {
    const state = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined;
    super(`Model Intelligence storage operation could not be confirmed${state ? ` (${state})` : ""}`);
    this.name = "ModelStorageError"; this.code = state;
  }
}
function identity(sql, input) {
  if (typeof sql?.begin !== "function" || typeof sql?.unsafe !== "function" || !uuid.test(input?.destinationId ?? "")
    || !uuid.test(input?.activationId ?? "") || !/^[a-f0-9]{64}$/.test(input?.manifestSha256 ?? "")) throw new Error("Supply the accepted PostgreSQL destination, manifest and activation identities");
  return { destinationId: input.destinationId.toLowerCase(), activationId: input.activationId.toLowerCase(), manifestSha256: input.manifestSha256 };
}
async function privateSchema(tx) {
  const exposed = await tx.unsafe("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') AND has_schema_privilege(oid,$1,'USAGE')", [schema]);
  const publicAccess = await tx.unsafe("SELECT 1 FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname=$1 AND a.grantee=0 AND a.privilege_type IN ('USAGE','CREATE')", [schema]);
  if (exposed.length || publicAccess.length) throw new ModelStorageError();
}
function sameActivation(row, expected) {
  return row?.destination_id === expected.destinationId && row.activation_id === expected.activationId
    && row.manifest_sha256 === expected.manifestSha256 && row.ddl_sha256 === runtimeHash;
}
async function checkActivation(tx, expected, write = false) {
  const [source] = await tx.unsafe(`SELECT destination_id::text,state,format_version,ddl_sha256,manifest_sha256 FROM ${target} WHERE singleton=1`);
  if (source?.destination_id !== expected.destinationId || source.state !== "imported_unaccepted" || source.format_version !== 1
    || source.ddl_sha256 !== migrationHash || source.manifest_sha256 !== expected.manifestSha256) throw new ModelStorageError();
  const [row] = await tx.unsafe(`SELECT destination_id::text,activation_id::text,manifest_sha256,ddl_sha256,active FROM ${activation} WHERE singleton=1${write ? " FOR SHARE" : ""}`);
  if (!sameActivation(row, expected) || !row.active) throw new ModelStorageError();
  await privateSchema(tx);
}
async function boundedTransaction(sql, work) {
  for (let attempt = 0; ; attempt++) {
    let domainError;
    try {
      return await sql.begin(async raw => {
        // Do not expose driver messages, SQL parameters or connection details.
        const tx = { async unsafe(...args) {
          try { return await raw.unsafe(...args); } catch (error) { throw new ModelStorageError(error?.code); }
        } };
        try { return await work(tx); }
        catch (error) { domainError = error; throw error; }
      });
    } catch (error) {
      if (attempt < 2 && ["40001", "40P01"].includes(error?.code)) continue;
      if (domainError === error) throw error;
      // A lost commit acknowledgement is uncertain, never automatically retried.
      throw new ModelStorageError(error?.code);
    }
  }
}

/** Explicit async runtime factory. Opening never creates schemas, imports data,
 * records acceptance or owns the caller's PostgreSQL connection lifecycle. */
export async function createPostgresModelIntelligence(sql, input) {
  const expected = identity(sql, input);
  const transaction = (operation, work) => boundedTransaction(sql, async tx => {
    if (operation.readOnly) await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await tx.unsafe("SELECT set_config('search_path','pg_catalog',true),set_config('lock_timeout','5s',true),set_config('statement_timeout','15s',true),set_config('idle_in_transaction_session_timeout','30s',true)");
    if (!operation.readOnly) {
      // Different namespaces can write concurrently. Global deadline recovery
      // takes the exclusive lock so it cannot race company-scoped mutations.
      if (typeof operation.namespace === "string") {
        await tx.unsafe("SELECT pg_advisory_xact_lock_shared($1)", [81300543]);
        await tx.unsafe("SELECT pg_advisory_xact_lock($1,hashtext($2))", [81300542, operation.namespace]);
      } else await tx.unsafe("SELECT pg_advisory_xact_lock($1)", [81300543]);
    }
    await checkActivation(tx, expected, !operation.readOnly);
    return work(effect => executePostgresQuery(tx, effect));
  });
  await transaction({ readOnly: true }, async () => null);
  return createAsyncPolicyStore(transaction);
}

/** Operator-only acceptance mutation, separate from importing and opening.
 * The reference identifies externally reviewed rehearsal evidence; a string is
 * not proof of that review. Never invoke automatically from application startup. */
export const activatePostgresModelIntelligence = safeMigrationOperation(async (sql, input) => {
  const manifest = structuredClone(input.manifest); validateMigrationManifest(manifest);
  const expected = identity(sql, { ...input, manifestSha256: manifest.manifestSha256 });
  const acceptanceRef = input.acceptanceRef;
  if (typeof acceptanceRef !== "string" || !acceptanceRef.trim() || acceptanceRef.length > 500 || /[\0-\x1f]/.test(acceptanceRef)) throw new ModelMigrationError("Supply the reviewed migration acceptance reference");
  return sql.begin(async tx => {
    await tx.unsafe("SELECT pg_advisory_xact_lock($1)", [81300541]);
    await privateSchema(tx);
    const [present] = await tx.unsafe("SELECT to_regclass($1)::text AS name", [`${schema}._runtime_activation`]);
    if (present?.name) {
      const [row] = await tx.unsafe(`SELECT destination_id::text,activation_id::text,manifest_sha256,ddl_sha256,acceptance_ref,active FROM ${activation} WHERE singleton=1 FOR UPDATE`);
      if (!sameActivation(row, expected) || row.acceptance_ref !== acceptanceRef || !row.active) throw new ModelMigrationError("Runtime activation differs or has been revoked");
      await checkActivation(tx, expected);
      return { ...expected, active: true };
    }
    // Reverify every imported row inside this same transaction; locks survive
    // verification through the activation commit. No intermediate writer window.
    await createPostgresMigrationTarget({ unsafe: (...args) => tx.unsafe(...args), begin: work => work(tx) }, expected).finish(manifest);
    await tx.unsafe(runtimeDdl);
    await tx.unsafe(`INSERT INTO ${activation} (singleton,destination_id,activation_id,manifest_sha256,ddl_sha256,acceptance_ref,active) VALUES(1,$1,$2,$3,$4,$5,true)`,
      [expected.destinationId, expected.activationId, expected.manifestSha256, runtimeHash, acceptanceRef]);
    return { ...expected, active: true };
  });
});

export const deactivatePostgresModelIntelligence = safeMigrationOperation(async (sql, input) => {
  const expected = identity(sql, input);
  return sql.begin(async tx => {
    const [row] = await tx.unsafe(`SELECT destination_id::text,activation_id::text,manifest_sha256,ddl_sha256 FROM ${activation} WHERE singleton=1 FOR UPDATE`);
    if (!sameActivation(row, expected)) throw new ModelMigrationError("Runtime activation identity differs");
    await tx.unsafe(`UPDATE ${activation} SET active=false WHERE singleton=1`);
    return { ...expected, active: false };
  });
});
