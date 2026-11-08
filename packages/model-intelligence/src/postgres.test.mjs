import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPostgresModelIntelligence, ModelStorageError } from "./postgres.mjs";
import { executePostgresQuery } from "./postgres-query.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const migrationHash = sha(await readFile(new URL("./postgres-migrations/0001_model_evidence_v5.sql", import.meta.url)));
const runtimeHash = sha(await readFile(new URL("./postgres-migrations/0002_runtime_activation.sql", import.meta.url)));
const identity = { destinationId: randomUUID(), activationId: randomUUID(), manifestSha256: sha("fixture") };
const selection = { namespace: "fixture-company", requestId: "selection", taskKey: "task", taskType: "support.triage", complexity: "routine", defaultCandidateId: "baseline",
  candidates: [{ id: "baseline", model: "baseline", provider: "test", method: "subscription", available: true }] };

// Driver fault fixture, not a SQL engine or database-compatibility claim.
function connection(hooks = {}) {
  let attempts = 0; const statements = [];
  const tx = { async unsafe(sql, parameters = []) {
    statements.push({ sql, parameters }); await hooks.query?.(sql, parameters);
    if (sql.includes('FROM "agentos_model_intelligence"._migration_target')) return [{ destination_id: identity.destinationId, state: "imported_unaccepted", format_version: 1, ddl_sha256: migrationHash, manifest_sha256: identity.manifestSha256 }];
    if (sql.includes('FROM "agentos_model_intelligence"._runtime_activation')) return [{ destination_id: identity.destinationId, activation_id: identity.activationId, manifest_sha256: identity.manifestSha256, ddl_sha256: runtimeHash, active: hooks.active?.() ?? true }];
    return [];
  } };
  return { ...tx, statements, attempts: () => attempts, async begin(work) {
    attempts++; await hooks.begin?.(); const result = await work(tx); await hooks.commit?.(); return result;
  } };
}

test("opening an accepted runtime is read only and checks its activation before any policy query", async t => {
  let active = true;
  const sql = connection({ active: () => active }), store = await createPostgresModelIntelligence(sql, identity); t.after(() => store.close());
  assert.equal(sql.statements.some(({ sql }) => /^(CREATE|INSERT|UPDATE|DELETE)\b/.test(sql)), false);
  active = false; sql.statements.length = 0;
  await assert.rejects(store.select(selection), ModelStorageError);
  assert.equal(sql.statements.some(({ sql }) => sql.includes('"routing_receipts"')), false);
  await assert.rejects(createPostgresModelIntelligence(sql, { ...identity, activationId: "wrong" }), /accepted PostgreSQL/);
});

test("driver acknowledgement is awaited, query values stay bound and company writes take company locks", async t => {
  let enter, release, delayed = false;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const sql = connection({ async commit() { if (delayed) { enter(); await gate; } } });
  const store = await createPostgresModelIntelligence(sql, identity); t.after(() => store.close());
  delayed = true; let acknowledged = false;
  const input = { ...selection, taskKey: "private ' $1 ? task" };
  const pending = store.select(input).then(value => { acknowledged = true; return value; });
  await entered; assert.equal(acknowledged, false); release();
  assert.equal((await pending).taskKey, input.taskKey);
  const insert = sql.statements.find(({ sql }) => sql.startsWith("INSERT INTO"));
  assert.ok(insert); assert.equal(insert.sql.includes(input.taskKey), false); assert.equal(insert.parameters[2], input.taskKey);
  assert.ok(sql.statements.some(({ sql, parameters }) => sql.includes("hashtext($2)") && parameters[1] === selection.namespace));
});

test("only confirmed serialization/deadlock rollback retries; uncertain commit failures retain no driver secrets", async t => {
  for (const code of ["40001", "40P01", "08006", "ECONNRESET"]) {
    let fail = false;
    const sql = connection({ commit() { if (fail) throw Object.assign(new Error("postgres://private-user:private-password@private-host"), { code }); } });
    const store = await createPostgresModelIntelligence(sql, identity); t.after(() => store.close());
    const before = sql.attempts(); fail = true;
    await assert.rejects(store.select(selection), error => error instanceof ModelStorageError && !error.message.includes("private-") && !error.cause);
    assert.equal(sql.attempts() - before, ["40001", "40P01"].includes(code) ? 3 : 1);
  }
});

test("int8 text retains exact ordering, public counters become numbers and lossy driver parsers fail", async () => {
  const effect = { sql: "SELECT rowid AS sequence,receipt_cutoff FROM controlled_comparisons WHERE namespace=?", method: "get", parameters: [selection.namespace] };
  const exact = await executePostgresQuery({ unsafe: async () => [{ sequence: "9007199254740993", receipt_cutoff: "9007199254740992" }] }, effect);
  assert.equal(exact.sequence, 9007199254740993n); assert.equal(exact.receipt_cutoff, 9007199254740992n);
  assert.equal((await executePostgresQuery({ unsafe: async () => [{ n: "4" }] }, { ...effect, sql: "SELECT count(*) AS n FROM routing_receipts" })).n, 4);
  await assert.rejects(executePostgresQuery({ unsafe: async () => [{ sequence: 9007199254740992 }] }, effect), /exceeds/);
});
