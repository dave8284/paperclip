import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function deploymentConfig(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Provide the HTTPS tunnel origin without credentials or a path.");
  return {
    version: 3,
    routes: [
      { src: "/(?:api|_plugins)/(.*)", headers: { "Cache-Control": "no-store" }, continue: true },
      // Native cookies and OAuth redirects keep the browser's Vercel origin.
      // Public WebSocket forwarding still requires qualification before this
      // deferred deployment can replace the active localhost application.
      ...["api", "_plugins"].map(prefix => ({
        src: `/${prefix}/(.*)`, dest: `${url.origin}/${prefix}/$1`,
        transforms: [{ type: "request.headers", op: "set", target: { key: "ngrok-skip-browser-warning" }, args: "1" }],
      })),
      { src: "/(?:index.html|sw.js|manifest.webmanifest)?", headers: { "Cache-Control": "no-cache" }, continue: true },
      { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
      { handle: "filesystem" },
      { src: "/assets/(.*)", status: 404 },
      { src: "/(.*)", dest: "/index.html", headers: { "Cache-Control": "no-cache" } },
    ],
  };
}

async function main() {
  const [origin] = process.argv.slice(2);
  if (!origin) throw new Error("Usage: node scripts/stage-agentos-vercel.mjs HTTPS_TUNNEL_ORIGIN");
  const config = deploymentConfig(origin);
  const root = resolve(import.meta.dirname, "..");
  const ui = resolve(root, "ui/dist");
  await readFile(resolve(ui, "index.html"));
  const output = resolve(root, ".vercel/output");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  // Only compiled public assets are uploaded, never the local DB, source tree,
  // private environment or downloaded OAuth credentials.
  await cp(ui, resolve(output, "static"), { recursive: true });
  await writeFile(resolve(output, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  console.log("Staged compiled Agent OS interface. Deploy with vercel deploy --prebuilt --prod.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
