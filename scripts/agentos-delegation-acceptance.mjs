#!/usr/bin/env node
// Prepare an owner-authorized local test company and a planned objective. This
// never grants agent permissions, selects an account, runs providers or records
// acceptance. Native execution/review evidence must come from the later journey.
import { readFile, writeFile, rename, mkdir, open, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const fixture = JSON.parse(await readFile(new URL("./fixtures/agentos-delegation-acceptance.json", import.meta.url), "utf8"));
const fixtureHash = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function newAcceptanceState() {
  return { schema: "agentos.delegation-acceptance-state.v1", qualificationId: randomUUID(), fixtureHash, resources: {}, acceptance: "not_run" };
}
export function objectiveDescription(marker) {
  return `${fixture.brief}\n\nSupplied fictional facts:\n${JSON.stringify(fixture.facts, null, 2)}\n\nRequired outputs:\n`
    + fixture.requiredOutputs.map(item => `- ${item.name}: ${item.criteria}`).join("\n")
    + "\n\nAcceptance gates:\n" + fixture.acceptanceGates.map(item => `- ${item}`).join("\n") + `\n\n${marker}`;
}

/** Persist intent before each non-idempotent API write. On an uncertain reply,
 * recover an exact existing marker; absence never licenses a duplicate POST. */
export async function prepareAcceptance({ api, state, persist }) {
  if (state.schema !== "agentos.delegation-acceptance-state.v1" || !uuid.test(state.qualificationId)
    || state.fixtureHash !== fixtureHash || state.acceptance !== "not_run" || !state.resources) throw new Error("The acceptance state or fixture changed; inspect it before preparing work");
  await api("GET", "/api/health");
  const marker = `AgentOS test qualification: ${state.qualificationId}`;
  async function ensure(kind, path, payload, companyId) {
    const prior = state.resources[kind];
    const records = await api("GET", path);
    if (!Array.isArray(records)) throw new Error(`Cannot establish the existing ${kind} records`);
    const matches = records.filter(row => row.description?.includes(marker));
    if (matches.length > 1) throw new Error(`Multiple ${kind} records match this qualification; no changes made`);
    let record = matches[0];
    if (prior?.id && (!record || record.id !== prior.id)) throw new Error(`The saved ${kind} was removed or changed; no replacement created`);
    if (!record) {
      if (prior?.phase === "creating" || prior?.phase === "uncertain") throw new Error(`${kind} creation is unresolved; no duplicate request was sent`);
      state.resources[kind] = { phase: "creating" }; await persist(state);
      try { record = await api("POST", path, payload); }
      catch (error) { state.resources[kind].phase = "uncertain"; await persist(state); throw error; }
    }
    if (!record || !uuid.test(record.id) || (companyId && record.companyId !== companyId)) throw new Error(`Unexpected ${kind} identity; inspect native records before retrying`);
    state.resources[kind] = { phase: "prepared", id: record.id }; await persist(state);
    return record;
  }
  const company = await ensure("company", "/api/companies", {
    name: `${fixture.companyName} ${state.qualificationId.slice(0, 8)}`,
    description: `Fictional company for the owner's AgentOS delegation/review qualification. No real business activity.\n${marker}`,
  });
  const base = `/api/companies/${company.id}`;
  const goal = await ensure("goal", `${base}/goals`, { title: fixture.objectiveTitle,
    description: objectiveDescription(marker), level: "company", status: "planned" }, company.id);
  const project = await ensure("project", `${base}/projects`, { name: "DeskBuddy test launch",
    description: objectiveDescription(marker), goalId: goal.id, idempotencyKey: `qualification:${state.qualificationId}:project` }, company.id);
  state.preparedAt = new Date().toISOString(); await persist(state);
  return { companyId: company.id, goalId: goal.id, projectId: project.id, status: "prepared", acceptance: "not_run",
    next: "Qualify the intended subscription account and native roles, then have Friday direct the CEO. Retain actual execution, review and owner-acceptance evidence." };
}

async function main(args) {
  if (args.length === 0 || args[0] === "--plan") {
    process.stdout.write(`${JSON.stringify({ ...fixture, status: "prepared_fixture_only", acceptance: "not_run" }, null, 2)}\n`); return;
  }
  if (args.length !== 2 || args[0] !== "--prepare") throw new Error("Usage: node scripts/agentos-delegation-acceptance.mjs --plan | --prepare <state.json>");
  const origin = new URL(process.env.AGENTOS_ACCEPTANCE_URL ?? "http://localhost:3100");
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Use the owner's exact local HTTP origin");
  const statePath = resolve(args[1]); await mkdir(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`, lock = await open(lockPath, "wx", 0o600);
  const persist = async state => {
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try { await rename(temporary, statePath); } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  };
  try {
    let state;
    try { state = JSON.parse(await readFile(statePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; state = newAcceptanceState(); await persist(state); }
    const api = async (method, path, body) => {
      let response;
      try { response = await fetch(new URL(path, origin), { method, redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", Origin: origin.origin,
          ...(process.env.AGENTOS_ACCEPTANCE_TOKEN ? { Authorization: `Bearer ${process.env.AGENTOS_ACCEPTANCE_TOKEN}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) }); }
      catch { throw new Error(`The local AgentOS API could not confirm ${method} ${path}; retained setup state is not acceptance evidence`); }
      if (!response.ok) throw new Error(`AgentOS returned HTTP ${response.status} for ${method} ${path}; native owner authorization is required`);
      return response.json();
    };
    process.stdout.write(`${JSON.stringify(await prepareAcceptance({ api, state, persist }), null, 2)}\n`);
  } finally { await lock.close(); await unlink(lockPath); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
