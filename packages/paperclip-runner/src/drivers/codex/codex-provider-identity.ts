import { spawn } from "node:child_process";
import { resolveCodexCommand } from "./codex-command.js";

import { parseExpectedCodexIdentity } from "../../contracts/codex-identity.js";

function isVersion(cliVersion: string): boolean {
  try { parseExpectedCodexIdentity({ cliVersion, model: "probe" }); return true; } catch { return false; }
}

/** Metadata only. Reuse native executable resolution, exclude credential
 * variables, and terminate the whole process group on failure or cancellation. */
export async function readLocalCodexIdentity(options: {
  command?: string; workingDirectory?: string; environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal; timeoutMs?: number;
} = {}): Promise<{ cliVersion: string }> {
  options.signal?.throwIfAborted();
  const environment = options.environment ?? process.env;
  const cwd = options.workingDirectory ?? process.cwd();
  const command = options.command ?? resolveCodexCommand(import.meta.url, environment, cwd);
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--version"], { cwd, env: { PATH: environment.PATH, ...(process.platform === "win32" ? { SystemRoot: environment.SystemRoot } : {}) },
      stdio: ["ignore", "pipe", "ignore"], detached: process.platform !== "win32", windowsHide: true });
    let output = "", failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already exited. */ }
    };
    const abort = () => stop(new Error("Codex identity probe cancelled"));
    const timer = setTimeout(() => stop(new Error("Codex identity probe timed out")), Math.max(1, Math.min(options.timeoutMs ?? 3000, 5000)));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (failure) return; if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > 1024) { stop(new Error("Codex identity probe output exceeds its bound")); return; } output += chunk; });
    child.on("error", error => { failure ??= error; });
    child.on("close", code => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      if (failure) { reject(failure); return; }
      const version = /^codex-cli ([^\s]+)\s*$/.exec(output)?.[1];
      if (code !== 0 || !version || !isVersion(version)) { reject(new Error("Codex executable did not report a valid CLI version")); return; }
      resolve({ cliVersion: version });
    });
  });
}
