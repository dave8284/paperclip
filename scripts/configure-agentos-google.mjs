import { readFile, writeFile, rename, chmod, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** Import Google's downloaded web client without printing credentials or
 * changing admission mode before the owner claim flow is ready. */
export function googleClientSettings(document, origin, projectId = "agentos-dave8284") {
  const client = document?.web;
  if (!client || client.project_id !== projectId) throw new Error("Choose the Web application client from the AgentOS Google Cloud project.");
  if (typeof client.client_id !== "string" || !client.client_id.endsWith(".apps.googleusercontent.com") || typeof client.client_secret !== "string" || !client.client_secret) throw new Error("The downloaded client must include its client ID and secret. Do not paste credentials into chat.");
  let url;
  try { url = new URL(origin); } catch { throw new Error("Provide an absolute application origin."); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Provide only the application origin, without credentials, a path, query or fragment.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Use HTTPS for a public deployment or HTTP on localhost for local setup.");
  const callback = `${url.origin}/api/auth/callback/google`;
  if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(callback)) throw new Error(`Register this exact redirect URI in the Google web client, then download it again: ${callback}`);
  return { PAPERCLIP_GOOGLE_CLIENT_ID: client.client_id, PAPERCLIP_GOOGLE_CLIENT_SECRET: client.client_secret, PAPERCLIP_AUTH_PUBLIC_BASE_URL: url.origin, PAPERCLIP_PUBLIC_URL: url.origin };
}

export function updateEnvironment(previous, settings) {
  const lines = previous.split(/\r?\n/).filter(line => !Object.keys(settings).some(key => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)));
  return `${lines.join("\n").trimEnd()}\n${Object.entries(settings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`;
}

async function main() {
  const [clientPath, envPath, origin = "http://localhost:3100"] = process.argv.slice(2);
  if (!clientPath || !envPath) throw new Error("Usage: node scripts/configure-agentos-google.mjs CLIENT_JSON PRIVATE_ENV_FILE [ORIGIN]");
  const destination = resolve(envPath);
  if (destination === resolve(clientPath)) throw new Error("The environment file must be separate from the downloaded client.");
  let document;
  try { document = JSON.parse(await readFile(clientPath, "utf8")); } catch { throw new Error("Could not read the downloaded Google client JSON."); }
  const settings = googleClientSettings(document, origin);
  const previous = await readFile(destination, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; });
  await mkdir(dirname(destination), { recursive: true });
  if (previous) await writeFile(`${destination}.before-google-${Date.now()}`, previous, { mode: 0o600 });
  const temp = `${destination}.google-${process.pid}`;
  await writeFile(temp, updateEnvironment(previous, settings), { mode: 0o600 });
  await chmod(temp, 0o600); await rename(temp, destination);
  console.log("Google client settings saved to the private environment file. Credentials were not printed.");
  console.log(`Callback: ${new URL(origin).origin}/api/auth/callback/google`);
  console.log("Authentication mode is unchanged. Prepare owner access, then enable authenticated mode and restart the server.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
