#!/usr/bin/env node
import { writeFile, readFile } from "node:fs/promises";
import { inspectModelIntelligenceBackup, verifyModelIntelligenceBackup } from "../packages/model-intelligence/src/migration-manifest.mjs";

const [mode, backupPath, manifestPath, ...extra] = process.argv.slice(2);
try {
  if (!["--inspect", "--verify"].includes(mode) || !backupPath || !manifestPath || extra.length) {
    throw new Error("Usage: node scripts/agentos-model-backup-manifest.mjs --inspect|--verify <offline-backup.sqlite> <manifest.json>");
  }
  const manifest = mode === "--verify"
    ? await verifyModelIntelligenceBackup(backupPath, JSON.parse(await readFile(manifestPath, "utf8")))
    : await inspectModelIntelligenceBackup(backupPath);
  if (mode === "--inspect") await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: mode === "--verify" ? "manifest_matches" : "manifest_created",
    purpose: manifest.purpose, schemaVersion: manifest.userVersion, tables: manifest.tables.length, rows: manifest.totalRows,
    manifestSha256: manifest.manifestSha256, migrationAccepted: false })}\n`);
} catch (error) {
  // Never expose parser excerpts, filesystem paths or source records.
  process.stderr.write(`${error.code || error instanceof SyntaxError ? "The offline backup or manifest could not be read/written; no migration performed" : error.message}\n`);
  process.exitCode = 1;
}
