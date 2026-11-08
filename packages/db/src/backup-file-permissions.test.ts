import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBufferedTextFileWriter, runDatabaseBackup } from "./backup-lib.js";

const database = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("postgres", () => ({ default: database.connect }));

const retention = { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 };
const mode = (file: string) => fs.statSync(file).mode & 0o777;
let root: string;
let oldUmask: number;
let backupDir: string;
let observedStagingModes: number[];

beforeEach(() => {
  oldUmask = process.umask(0o022);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backup-permissions-"));
  backupDir = path.join(root, "new", "backups");
  observedStagingModes = [];
  database.connect.mockReset().mockImplementation(() => {
    // Only database transport is controlled. The real backup engine still
    // writes SQL, compresses it, spawns the dump fixture and manages files.
    const sql = vi.fn(async () => {
      if (fs.existsSync(backupDir)) {
        for (const file of fs.readdirSync(backupDir).filter(name => name.endsWith(".sql"))) {
          observedStagingModes.push(mode(path.join(backupDir, file)));
        }
      }
      return [];
    });
    return Object.assign(sql, { unsafe: vi.fn(() => []), end: vi.fn(async () => {}) });
  });
});

afterEach(() => {
  process.umask(oldUmask);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function dumpExecutable(fail = false) {
  const file = path.join(root, "pg-dump-fixture");
  fs.writeFileSync(file, `#!/bin/sh\nprintf 'SELECT 1;\\n'\n${fail ? "exit 7\n" : ""}`, { mode: 0o700 });
  vi.stubEnv("PAPERCLIP_PG_DUMP_PATH", file);
}

function backup(backupEngine: "javascript" | "pg_dump" | "auto", extra: Partial<Parameters<typeof runDatabaseBackup>[0]> = {}) {
  return runDatabaseBackup({ connectionString: "postgres://fixture:fixture@unused/fixture", backupDir, retention, backupEngine, ...extra });
}

describe("private database backup creation", () => {
  it("creates a buffered staging file with owner-only permissions before writing", async () => {
    const file = path.join(root, "buffered.sql");
    const writer = createBufferedTextFileWriter(file, 8);
    await writer.drain();
    expect(mode(file)).toBe(0o600);
    writer.emit("-- first");
    writer.emit("SELECT 1;");
    await writer.close();
    expect(mode(file)).toBe(0o600);
    expect(fs.readFileSync(file, "utf8")).toBe("-- first\nSELECT 1;");
  });

  it.each(["file", "symlink"])("never overwrites or removes an existing staging %s when opening fails", async kind => {
    const original = path.join(root, "existing.sql");
    fs.writeFileSync(original, "retained private data", { mode: 0o640 });
    const file = kind === "file" ? original : path.join(root, "linked.sql");
    if (kind === "symlink") fs.symlinkSync(original, file);
    const writer = createBufferedTextFileWriter(file);
    await expect(writer.drain()).rejects.toMatchObject({ code: "EEXIST" });
    await writer.abort();
    expect(fs.readFileSync(original, "utf8")).toBe("retained private data");
    expect(mode(original)).toBe(0o640);
    expect(fs.existsSync(file)).toBe(true);
  });

  it.each(["javascript", "pg_dump"] as const)("keeps %s staging and compressed archives private", async engine => {
    dumpExecutable();
    const result = await backup(engine);
    expect(mode(path.join(root, "new"))).toBe(0o700);
    expect(mode(backupDir)).toBe(0o700);
    expect(mode(result.backupFile)).toBe(0o600);
    expect(observedStagingModes.length).toBeGreaterThan(0);
    expect(observedStagingModes.every(value => value === 0o600)).toBe(true);
    const contents = gunzipSync(fs.readFileSync(result.backupFile)).toString("utf8");
    if (engine === "pg_dump") expect(contents).toBe("SELECT 1;\n");
    else { expect(contents).toContain("BEGIN;"); expect(contents).toContain("COMMIT;"); }
    expect(fs.readdirSync(backupDir)).toEqual([path.basename(result.backupFile)]);
  });

  it.each(["missing", "failed"])("retains private permissions and cleans partial dump output on %s pg_dump fallback", async failure => {
    if (failure === "failed") dumpExecutable(true);
    else vi.stubEnv("PAPERCLIP_PG_DUMP_PATH", path.join(root, "missing-dump"));
    const result = await backup("auto");
    expect(database.connect).toHaveBeenCalledTimes(2);
    expect(mode(result.backupFile)).toBe(0o600);
    expect(mode(backupDir)).toBe(0o700);
    expect(gunzipSync(fs.readFileSync(result.backupFile)).toString()).toContain("-- Paperclip database backup");
    expect(fs.readdirSync(backupDir)).toEqual([path.basename(result.backupFile)]);
  });

  it.each(["javascript", "pg_dump", "auto"] as const)("does not overwrite or delete an existing %s archive after a same-second collision", async engine => {
    dumpExecutable();
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o755 });
    fs.chmodSync(backupDir, 0o755);
    const first = await backup(engine);
    const bytes = fs.readFileSync(first.backupFile);
    fs.chmodSync(first.backupFile, 0o640);
    await expect(backup(engine)).rejects.toMatchObject({ code: "EEXIST" });
    expect(fs.readFileSync(first.backupFile)).toEqual(bytes);
    expect(mode(first.backupFile)).toBe(0o640);
    expect(mode(backupDir)).toBe(0o755);
    expect(fs.readdirSync(backupDir)).toEqual([path.basename(first.backupFile)]);
    expect(database.connect).toHaveBeenCalledTimes(2);
  });

  it("preserves an existing staging file and archive on reservation failure", async () => {
    const first = await backup("javascript");
    const staging = first.backupFile.slice(0, -3);
    fs.writeFileSync(staging, "owned by another attempt", { mode: 0o640 });
    const bytes = fs.readFileSync(first.backupFile);
    await expect(backup("javascript")).rejects.toMatchObject({ code: "EEXIST" });
    expect(fs.readFileSync(staging, "utf8")).toBe("owned by another attempt");
    expect(mode(staging)).toBe(0o640);
    expect(fs.readFileSync(first.backupFile)).toEqual(bytes);
  });

  it.each(["javascript", "pg_dump"] as const)("keeps history and removes only its own %s output when verification rejects", async engine => {
    dumpExecutable();
    fs.mkdirSync(backupDir, { recursive: true });
    const history = path.join(backupDir, "paperclip-history.sql.gz");
    const bytes = gzipSync("prior recovery point");
    fs.writeFileSync(history, bytes, { mode: 0o640 });
    fs.utimesSync(history, new Date(0), new Date(0));
    const failure = new Error("Controlled verification failure");
    await expect(backup(engine, { verifyBeforePrune: async archive => {
      expect(mode(archive)).toBe(0o600);
      expect(fs.existsSync(history)).toBe(true);
      throw failure;
    } })).rejects.toBe(failure);
    expect(database.connect).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(backupDir)).toEqual([path.basename(history)]);
    expect(fs.readFileSync(history)).toEqual(bytes);
    expect(mode(history)).toBe(0o640);
  });

  it("still prunes expired history only after successful verification", async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const history = path.join(backupDir, "paperclip-history.sql.gz");
    fs.writeFileSync(history, gzipSync("expired recovery point"));
    fs.utimesSync(history, new Date(0), new Date(0));
    const verify = vi.fn(async (archive: string) => {
      expect(fs.existsSync(history)).toBe(true);
      expect(mode(archive)).toBe(0o600);
    });
    const result = await backup("javascript", { verifyBeforePrune: verify });
    expect(verify).toHaveBeenCalledOnce();
    expect(result.prunedCount).toBe(1);
    expect(fs.readdirSync(backupDir)).toEqual([path.basename(result.backupFile)]);
  });
});
