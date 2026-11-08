import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelIntelligence } from "./index.mjs";
import { inspectModelIntelligenceBackup, verifyModelIntelligenceBackup } from "./migration-manifest.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "agentos-backup-inventory-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "offline.sqlite"), engine = createModelIntelligence(path);
  const selection = engine.select({ namespace: "private-company", requestId: "receipt-1", taskKey: "private-task", taskType: "coding",
    complexity: "routine", defaultCandidateId: "baseline", candidates: [{ id: "baseline", provider: "openai", model: "test-only", method: "subscription", available: true }] });
  engine.evaluate({ namespace: "private-company", id: "evaluation-1", receiptId: selection.id, passed: false, iterations: 2,
    latencyMs: 3000, source: "human", evaluator: "private-reviewer", evidenceRef: "private:evidence" });
  engine.policy({ namespace: "private-company", candidateId: "baseline", action: "block", reason: "Private finding 日本語" });
  engine.close();
  // Fixture-only conversion: the inspector must never do this to its input.
  const db = new DatabaseSync(path); db.exec("PRAGMA journal_mode=DELETE"); db.close();
  return { path, directory };
}
function mutate(path, sql) { const db = new DatabaseSync(path); try { db.exec(sql); } finally { db.close(); } }

test("offline inventory covers every v5 table and exact replay without changing the backup or exposing records", async t => {
  const { path, directory } = await fixture(t), original = await readFile(path), files = await readdir(directory);
  const manifest = await inspectModelIntelligenceBackup(path);
  assert.equal(manifest.purpose, "offline_inventory_only");
  assert.equal(manifest.userVersion, 5);
  assert.equal(manifest.tables.length, 12);
  assert.equal(manifest.totalRows, 3);
  assert.equal(manifest.tables.find(row => row.name === "evaluations").rows, 1);
  assert.equal(manifest.tables.find(row => row.name === "routing_rollout_assignments").rows, 0);
  assert.deepEqual(await verifyModelIntelligenceBackup(path, JSON.parse(JSON.stringify(manifest))), manifest);
  assert.deepEqual(await readFile(path), original);
  assert.deepEqual(await readdir(directory), files);
  assert(!JSON.stringify(manifest).includes("private-company"));
  assert(!JSON.stringify(manifest).includes("Private finding"));
  assert(!JSON.stringify(manifest).includes(path));
});

test("same counts cannot conceal changed history or changed receipt sequence", async t => {
  const { path } = await fixture(t), original = await inspectModelIntelligenceBackup(path);
  mutate(path, "UPDATE policy_events SET reason='Different private result'");
  const modified = await inspectModelIntelligenceBackup(path);
  assert.equal(modified.totalRows, original.totalRows);
  assert.notEqual(modified.tables.find(row => row.name === "policy_events").contentSha256,
    original.tables.find(row => row.name === "policy_events").contentSha256);
  await assert.rejects(verifyModelIntelligenceBackup(path, original), /does not match/);
  mutate(path, "UPDATE routing_receipts SET rowid=9007199254740993");
  const ordered = await inspectModelIntelligenceBackup(path), receipt = ordered.tables.find(row => row.name === "routing_receipts");
  assert.equal(receipt.rowidMinimum, "9007199254740993");
  assert.equal(receipt.rowidMaximum, "9007199254740993");
  assert.notEqual(receipt.contentSha256, original.tables.find(row => row.name === "routing_receipts").contentSha256);
});

test("pending and settled rollout rows retain exact deadlines and nullable history in inventory", async t => {
  const { path } = await fixture(t);
  mutate(path, `INSERT INTO routing_rollout_assignments VALUES('private-company','pending','release','task','digest','candidate','canary','date',9007199254740993,0);
    INSERT INTO routing_rollout_events VALUES('private-company','event','coding',NULL,'rollback','reason','date');`);
  const first = await inspectModelIntelligenceBackup(path);
  mutate(path, "UPDATE routing_rollout_assignments SET deadline_at=9007199254740994, settled=1");
  const second = await inspectModelIntelligenceBackup(path);
  assert.notEqual(first.tables.find(row => row.name === "routing_rollout_assignments").contentSha256,
    second.tables.find(row => row.name === "routing_rollout_assignments").contentSha256);
  assert.equal(first.tables.find(row => row.name === "routing_rollout_events").contentSha256,
    second.tables.find(row => row.name === "routing_rollout_events").contentSha256);
});

test("WAL, sidecars, symlinks and missing files fail without creating or upgrading source files", async t => {
  const { path, directory } = await fixture(t);
  await writeFile(`${path}-wal`, "uncheckpointed fixture");
  await assert.rejects(inspectModelIntelligenceBackup(path), /sidecars/);
  await rm(`${path}-wal`);
  mutate(path, "PRAGMA journal_mode=WAL");
  const original = await readFile(path);
  await assert.rejects(inspectModelIntelligenceBackup(path), /rollback-journal/);
  assert.deepEqual(await readFile(path), original);
  assert.deepEqual(await readdir(directory), ["offline.sqlite"]);
  const link = join(directory, "linked.sqlite"); await symlink(path, link);
  await assert.rejects(inspectModelIntelligenceBackup(link), /regular offline/);
  await assert.rejects(inspectModelIntelligenceBackup(join(directory, "missing.sqlite")), { code: "ENOENT" });
  assert.deepEqual((await readdir(directory)).sort(), ["linked.sqlite", "offline.sqlite"]);
});

test("unknown and older schemas, extra objects and missing tables are not treated as compatible backups", async t => {
  const { path } = await fixture(t);
  for (const version of [1, 4, 6]) {
    mutate(path, `PRAGMA user_version=${version}`);
    await assert.rejects(inspectModelIntelligenceBackup(path), /Only schema v5/);
    const db = new DatabaseSync(path, { readOnly: true });
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, version); db.close();
  }
  mutate(path, "PRAGMA user_version=5; CREATE VIEW private_view AS SELECT * FROM evaluations");
  await assert.rejects(inspectModelIntelligenceBackup(path), /Unexpected database objects/);
  mutate(path, "DROP VIEW private_view; DROP TABLE evaluations");
  await assert.rejects(inspectModelIntelligenceBackup(path), /Unexpected database objects/);
});

test("resource limits and malformed backups produce no partial manifest", async t => {
  const { path, directory } = await fixture(t);
  await assert.rejects(inspectModelIntelligenceBackup(path, { maxRows: 2 }), /row limit/);
  await assert.rejects(inspectModelIntelligenceBackup(path, { maxCellBytes: 10 }), /bounded inventory/);
  await assert.rejects(inspectModelIntelligenceBackup(path, { maxRows: Infinity }), /Invalid inventory bounds/);
  const malformed = join(directory, "malformed.sqlite"); await writeFile(malformed, "private secret payload");
  await assert.rejects(inspectModelIntelligenceBackup(malformed), error => !error.message.includes("private secret") && /standalone SQLite/.test(error.message));
  const manifest = await inspectModelIntelligenceBackup(path);
  await assert.rejects(verifyModelIntelligenceBackup(path, { ...manifest, totalRows: 0 }), /does not match/);
});
