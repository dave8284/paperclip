import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalCodexIdentity } from "./codex-provider-identity.js";
const directories: string[] = [];
async function executable(body: string) {
  const directory = await mkdtemp(join(tmpdir(), "codex-identity-")); directories.push(directory);
  const command = join(directory, "codex");
  await writeFile(command, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return { command, workingDirectory: directory };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe("native Codex identity metadata", () => {
  it("reads only --version without inheriting model credentials or starting inference", async () => {
    const options = await executable(`if (process.argv.slice(2).join() !== '--version' || process.env.OPENAI_API_KEY || process.env.CODEX_HOME) process.exit(9); console.log('codex-cli 0.160.0');`);
    await expect(readLocalCodexIdentity({ ...options, environment: { PATH: process.env.PATH, OPENAI_API_KEY: "private", CODEX_HOME: "/private" } })).resolves.toEqual({ cliVersion: "0.160.0" });
  });
  it("terminates a nonresponsive subprocess on deadline while other work remains responsive", async () => {
    const options = await executable("setInterval(() => {}, 1000);");
    let responsive = false; const tick = setTimeout(() => { responsive = true; }, 10);
    await expect(readLocalCodexIdentity({ ...options, timeoutMs: 100 })).rejects.toThrow("timed out");
    clearTimeout(tick); expect(responsive).toBe(true);
  });
  it("cancels an active probe and rejects malformed or excessive output", async () => {
    const options = await executable("setInterval(() => {}, 1000);");
    const controller = new AbortController();
    const promise = readLocalCodexIdentity({ ...options, signal: controller.signal }); controller.abort();
    await expect(promise).rejects.toThrow("cancelled");
    await expect(readLocalCodexIdentity(await executable("console.log('unexpected output');"))).rejects.toThrow("valid CLI version");
    await expect(readLocalCodexIdentity(await executable("console.log('x'.repeat(2048));"))).rejects.toThrow("exceeds its bound");
  });
});
