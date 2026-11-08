import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createModelIntelligence } from "../packages/model-intelligence/src/index.mjs";

test("operator CLI writes a private manifest once, verifies it and never overwrites existing output", async t => {
  const directory = await mkdtemp(join(tmpdir(), "agentos-manifest-cli-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "offline.sqlite"), output = join(directory, "manifest.json");
  createModelIntelligence(path).close();
  const db = new DatabaseSync(path); db.exec("PRAGMA journal_mode=DELETE"); db.close();
  const run = promisify(execFile), script = fileURLToPath(new URL("./agentos-model-backup-manifest.mjs", import.meta.url));
  const first = await run(process.execPath, [script, "--inspect", path, output]);
  assert.equal(JSON.parse(first.stdout).migrationAccepted, false);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const saved = await readFile(output, "utf8");
  const verified = await run(process.execPath, [script, "--verify", path, output]);
  assert.equal(JSON.parse(verified.stdout).status, "manifest_matches");
  await assert.rejects(run(process.execPath, [script, "--inspect", path, output]), error => error.code === 1 && !error.stderr.includes(path));
  assert.equal(await readFile(output, "utf8"), saved);
  await writeFile(output, "private malformed JSON");
  await assert.rejects(run(process.execPath, [script, "--verify", path, output]), error => error.code === 1 && !error.stderr.includes("private malformed"));
});
