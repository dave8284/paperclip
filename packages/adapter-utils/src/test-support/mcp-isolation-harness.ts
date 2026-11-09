import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function createMcpIsolationRoot(prefix: string): Promise<string> {
  const parent = process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? os.tmpdir();
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, prefix));
}

export async function commandVersion(command: string): Promise<string | null> {
  try {
    const result = await runCommand(command, ["--version"], { timeoutMs: 5_000 });
    if (result.exitCode !== 0) return null;
    return `${result.stdout}${result.stderr}`.trim();
  } catch {
    return null;
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const stop = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(error);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      stop("SIGTERM");
      killTimer = setTimeout(() => stop("SIGKILL"), 1_000);
      killTimer.unref();
    }, options.timeoutMs ?? 15_000);
    timer.unref();

    // A CLI launcher can exit before its native child closes inherited pipes.
    // Await drain before the caller reads debug files or removes the test home.
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (timedOut) stop("SIGKILL");
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    });
  });
}

export async function writeClaudeMcpConfig(
  filePath: string,
  servers: Record<string, { command: string; args: string[] }>,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ mcpServers: servers }), "utf8");
}

export async function writeCodexMcpConfig(
  codexHome: string,
  servers: Record<string, { command: string; args: string[] }>,
): Promise<void> {
  const sections = Object.entries(servers).flatMap(([name, server]) => [
    `[mcp_servers.${JSON.stringify(name)}]`,
    `command = ${JSON.stringify(server.command)}`,
    `args = ${JSON.stringify(server.args)}`,
    "",
  ]);
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), sections.join("\n"), "utf8");
}
