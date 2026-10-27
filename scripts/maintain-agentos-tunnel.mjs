import { spawn, execFile } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { deploymentConfig } from "./stage-agentos-vercel.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".vercel/output/config.json");
const owner = JSON.parse(await readFile(resolve(root, ".vercel/release-owner.json"), "utf8"));
const project = JSON.parse(await readFile(resolve(root, ".vercel/project.json"), "utf8"));
if (project.projectId !== owner.projectId || project.orgId !== owner.orgId) throw new Error("Vercel project differs from the approved release owner.");

async function cli(args) {
  const { stdout } = await exec("npm", ["exec", "--yes", "--package=vercel@65.3.1", "--", "vercel", ...args], { cwd: root, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

let pending = null;
let updating = false;
let stopping = false;
async function retarget(origin) {
  const previous = await readFile(output, "utf8");
  const current = JSON.parse(previous);
  if (current.routes.some(route => route.dest === `${origin}/api/$1`)) return;
  const identity = JSON.parse(await cli(["api", "/v2/user"]));
  if (identity.user?.username !== owner.username) throw new Error("Vercel CLI account changed. Reconnect the approved account before refreshing the tunnel.");
  const next = `${JSON.stringify(deploymentConfig(origin), null, 2)}\n`;
  await writeFile(`${output}.next`, next); await rename(`${output}.next`, output);
  try {
    // Deploy the last explicitly staged static release. Never run a build here:
    // unpublished source changes must not go live when the tunnel reconnects.
    await cli(["deploy", "--prebuilt", "--prod", "--yes", "--scope", owner.scope]);
    console.log("Vercel reconnected to the local backend using the previously staged interface.");
  } catch (error) {
    await writeFile(output, previous);
    throw error;
  }
}

async function reconcile() {
  if (updating) return;
  updating = true;
  try {
    while (pending && !stopping) {
      const origin = pending; pending = null;
      for (let attempt = 1; attempt <= 3 && !stopping; attempt++) {
        try { await retarget(origin); break; }
        catch {
          console.error(`Tunnel routing update failed (attempt ${attempt}/3). Check Vercel CLI authentication and the local service log.`);
          if (attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 10_000));
        }
      }
    }
  } finally { updating = false; }
}

const tunnel = spawn("ngrok", ["http", "http://127.0.0.1:3102", "--inspect=false", "--log=stdout", "--log-format=json"], { stdio: ["ignore", "pipe", "pipe"] });
createInterface({ input: tunnel.stdout }).on("line", line => {
  let event; try { event = JSON.parse(line); } catch { return; }
  if (event.msg === "started tunnel" && event.addr === "http://127.0.0.1:3102") {
    try { deploymentConfig(event.url); } catch { return; }
    console.log(`Tunnel connected: ${event.url}`);
    pending = event.url; void reconcile();
  } else if (["eror", "crit"].includes(event.lvl)) console.error(event.msg);
});
// Keep provider output out of service logs: it may include future credentials.
tunnel.stderr.resume();
tunnel.on("error", () => { console.error("Could not start ngrok."); process.exitCode = 1; });
tunnel.on("exit", code => { if (!stopping) process.exitCode = code || 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopping = true; tunnel.kill("SIGTERM"); });
