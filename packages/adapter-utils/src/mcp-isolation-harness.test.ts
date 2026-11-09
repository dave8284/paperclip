import { expect, it } from "vitest";
import { runCommand } from "./test-support/mcp-isolation-harness.js";

it("drains inherited output after a CLI launcher exits", async () => {
  const script = `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", "setTimeout(() => process.stdout.write('native-child-complete'), 100)"], {
      stdio: ["ignore", "inherit", "inherit"]
    }).unref();
  `;
  const result = await runCommand(process.execPath, ["-e", script], { timeoutMs: 5_000 });
  expect(result).toMatchObject({ exitCode: 0, timedOut: false, stdout: "native-child-complete" });
});

it.skipIf(process.platform === "win32")("reaps an owned subprocess that ignores timeout termination", async () => {
  const script = `
    process.on("SIGTERM", () => {});
    process.stdout.write("ready");
    setInterval(() => {}, 100);
  `;
  const result = await runCommand(process.execPath, ["-e", script], { timeoutMs: 500 });
  expect(result).toMatchObject({ exitCode: null, signal: "SIGKILL", timedOut: true, stdout: "ready" });
});
