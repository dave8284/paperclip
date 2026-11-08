import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModelIntelligence } from "./index.mjs";
import { inspectModelIntelligenceBackup } from "./migration-manifest.mjs";
import { importModelIntelligenceBackup } from "./migration-import.mjs";
import { MODEL_MIGRATION_TABLES as tables } from "./migration-schema.mjs";
import { createMigrationTableDigest } from "./migration-digest.mjs";
import { ModelMigrationError } from "./migration-errors.mjs";

async function fixture(t, modify = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "model-import-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "backup.sqlite"), engine = createModelIntelligence(path);
  for (let i = 0; i < 4; i++) engine.policy({ namespace: `private-company-${i % 2}`, candidateId: "baseline", action: "block", reason: `Private reason 日本語 ${i}` });
  engine.close();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=DELETE");
  db.exec("UPDATE policy_events SET rowid=rowid+9007199254740992");
  db.exec(`INSERT INTO routing_rollout_assignments VALUES('private','receipt','release','task','digest','candidate','canary','date',9007199254740993,0);
    INSERT INTO routing_rollout_events VALUES('private','event','coding',NULL,'rollback','reason','date');`);
  modify(db); db.close();
  return { path, manifest: await inspectModelIntelligenceBackup(path) };
}

// An independent controlled destination exercises importer recovery, not PG SQL
// or transaction/network compatibility. Actual PG tests are a separate suite.
function target({ afterBatch } = {}) {
  const data = new Map(Object.keys(tables).map(name => [name, new Map()]));
  let saved = null, state = "empty", finished = 0, writes = 0, starts = 0;
  const progress = new Map(Object.keys(tables).map(name => [name, { table_name: name, last_rowid: null, row_count: "0" }]));
  return {
    data, progress,
    get stats() { return { finished, writes, starts, state }; },
    async start(manifest) {
      starts++;
      if (saved && saved !== manifest.manifestSha256) throw new ModelMigrationError("Manifest mismatch");
      saved = manifest.manifestSha256; if (state === "empty") state = "importing";
      return { state, progress: structuredClone([...progress.values()]) };
    },
    async writeBatch(manifest, name, after, rows) {
      assert.equal(saved, manifest.manifestSha256); assert.equal(progress.get(name).last_rowid, after);
      const next = new Map(data.get(name));
      for (const row of rows) {
        if (next.has(row[0])) assert.deepEqual(next.get(row[0]), row);
        next.set(row[0], structuredClone(row));
      }
      data.set(name, next);
      progress.set(name, { table_name: name, last_rowid: rows.at(-1)[0], row_count: String(next.size) });
      writes++;
      await afterBatch?.({ name, rows, writes });
      return { lastRowid: rows.at(-1)[0] };
    },
    async finish(manifest) {
      for (const entry of manifest.tables) {
        const digest = createMigrationTableDigest(entry.name, entry.columns);
        const rows = [...data.get(entry.name).values()].sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : 1);
        for (const row of rows) digest.add(BigInt(row[0]), row.slice(1).map((value, index) =>
          tables[entry.name].integers.includes(tables[entry.name].columns[index]) && value !== null ? BigInt(value) : value));
        assert.deepEqual(digest.finish(), entry);
      }
      state = "imported_unaccepted"; finished++;
      return { state, manifestSha256: manifest.manifestSha256, runtimeEnabled: false };
    },
  };
}

test("imports every table without altering source bytes; preserves private namespaces, 64-bit order, nulls and deadlines", async t => {
  const { path, manifest } = await fixture(t), before = await readFile(path), destination = target();
  const result = await importModelIntelligenceBackup(path, manifest, destination, { batchRows: 2 });
  assert.equal(result.state, "imported_unaccepted"); assert.equal(result.runtimeEnabled, false);
  assert.deepEqual(await readFile(path), before);
  assert.equal(destination.data.get("policy_events").size, 4);
  assert.equal(destination.data.get("policy_events").keys().next().value, "9007199254740993");
  assert.equal([...destination.data.get("routing_rollout_assignments").values()][0].at(-2), "9007199254740993");
  assert.equal([...destination.data.get("routing_rollout_events").values()][0][4], null);
  const writes = destination.stats.writes;
  assert.deepEqual(await importModelIntelligenceBackup(path, manifest, destination), result);
  assert.equal(destination.stats.writes, writes);
});

test("lost acknowledgement resumes from committed progress without duplicates or new identities", async t => {
  const { path, manifest } = await fixture(t);
  let failed = false;
  const destination = target({ afterBatch() { if (!failed) { failed = true; throw Object.assign(new Error("private connection details"), { code: "ECONNRESET" }); } } });
  await assert.rejects(importModelIntelligenceBackup(path, manifest, destination, { batchRows: 2 }), error => !error.message.includes("private connection details"));
  assert.equal(destination.stats.finished, 0);
  await importModelIntelligenceBackup(path, manifest, destination, { batchRows: 2 });
  assert.equal(destination.stats.finished, 1);
  assert.equal([...destination.data.values()].reduce((n, rows) => n + rows.size, 0), manifest.totalRows);
});

test("cancellation preserves a resumable obligation and does not finalize incomplete staging", async t => {
  const { path, manifest } = await fixture(t), controller = new AbortController();
  const destination = target({ afterBatch() { controller.abort(); } });
  await assert.rejects(importModelIntelligenceBackup(path, manifest, destination, { batchRows: 1, signal: controller.signal }), /interrupted/);
  assert.equal(destination.stats.finished, 0); assert.equal(destination.stats.writes, 1);
  await importModelIntelligenceBackup(path, manifest, destination);
  assert.equal(destination.stats.finished, 1);
});

test("changed backups or source constraints fail before any destination call", async t => {
  const { path, manifest } = await fixture(t), destination = target();
  const db = new DatabaseSync(path); db.exec("UPDATE policy_events SET reason='changed'"); db.close();
  await assert.rejects(importModelIntelligenceBackup(path, manifest, destination));
  assert.equal(destination.stats.starts, 0);
  const drift = await fixture(t, db => db.exec("DROP INDEX routing_release_comparison"));
  await assert.rejects(importModelIntelligenceBackup(drift.path, drift.manifest, destination), /uniqueness index is missing/);
  assert.equal(destination.stats.starts, 0);
});

test("source type incompatibility, malformed JSON and oversized batches cannot finalize", async t => {
  for (const sql of ["UPDATE policy_events SET reason=CAST(X'0061' AS TEXT)", "INSERT INTO routing_rollout_policies VALUES('private','coding',1,'policy','hash','not json')"]) {
    const f = await fixture(t, db => db.exec(sql)), destination = target();
    await assert.rejects(importModelIntelligenceBackup(f.path, f.manifest, destination));
    assert.equal(destination.stats.finished, 0);
  }
  const f = await fixture(t), destination = target();
  await assert.rejects(importModelIntelligenceBackup(f.path, f.manifest, destination, { maxBatchBytes: 1 }), /byte limit/);
  assert.equal(destination.stats.finished, 0);
});

test("corrupted destination history and unrelated manifests remain unaccepted", async t => {
  const f = await fixture(t), destination = target();
  await importModelIntelligenceBackup(f.path, f.manifest, destination);
  const entry = destination.data.get("policy_events").values().next().value;
  entry[5] = "changed private reason";
  await assert.rejects(importModelIntelligenceBackup(f.path, f.manifest, destination));
  assert.equal(destination.stats.finished, 1);
  const other = await fixture(t);
  await assert.rejects(importModelIntelligenceBackup(other.path, other.manifest, destination), /Manifest mismatch/);
});
