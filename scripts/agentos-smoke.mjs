#!/usr/bin/env node
// Opt-in integration check against an owned local instance. No model or external
// provider is invoked. The disposable company is removed in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = new URL(process.env.AGENTOS_SMOKE_URL ?? "http://127.0.0.1:3100");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "Smoke checks require a local instance");
assert(origin.protocol === "http:" && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash, "Use a plain local HTTP origin");
async function api(path, method = "GET", body, expected, token) {
  const response = await fetch(new URL(`/api${path}`, origin), {
    method, headers: { "Content-Type": "application/json", Origin: origin.origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = response.status === 204 ? null : await response.json();
  assert(expected ? response.status === expected : response.ok, `${method} ${path}: ${response.status} ${result?.error ?? ""}`);
  return result;
}
const health = await api("/health");
assert.equal(health.deploymentMode, "local_trusted", "This smoke test is only for an owned local development instance");
let company;
try {
  company = await api("/companies", "POST", { name: `AgentOS verification ${randomUUID().slice(0, 8)}` });
  const base = `/companies/${company.id}`;
  const products = [];
  for (const source of ["existing", "new"]) {
    const key = randomUUID();
    const input = { name: `${source} application`, description: "Disposable integration verification", idempotencyKey: `agentos-smoke:${key}`, ...(source === "existing" ? { repositoryUrls: ["https://github.com/dave8284/paperclip"] } : {}) };
    const project = await api(`${base}/projects`, "POST", input);
    assert.equal((await api(`${base}/projects`, "POST", input)).id, project.id);
    const registration = { idempotencyKey: key, name: input.name, brief: input.description, source, homeProjectId: project.id };
    const application = await api(`${base}/managed-applications`, "POST", registration, 201);
    assert.equal((await api(`${base}/managed-applications`, "POST", registration, 200)).id, application.id);
    const task = await api(`${base}/issues`, "POST", { title: `Verify ${source} task visibility`, projectId: project.id, status: "done", idempotencyKey: `agentos-smoke:${key}:task` });
    products.push({ application, project, task });
    const work = await api(`${base}/managed-applications/${application.id}/work`);
    assert.equal(work.counts.done, 1);
    assert.equal(work.tasks[0].id, task.id);
  }
  const [first, second] = products;
  const links = `${base}/managed-applications/${first.application.id}/projects`;
  await api(links, "POST", { projectId: second.project.id }, 204);
  await api(links, "POST", { projectId: second.project.id }, 204);
  const combined = await api(`${base}/managed-applications/${first.application.id}/work?limit=1`);
  assert.equal(combined.projects.length, 2);
  assert.equal(combined.counts.done, 2);
  assert.equal(combined.tasks.length, 1);
  assert.equal(combined.nextOffset, 1);
  const portfolio = await api(`${base}/managed-applications`);
  assert.equal(portfolio.applications.length, 2);
  assert.equal(portfolio.summaries[first.application.id].taskCounts.done, 2);
  assert.equal(portfolio.summaries[second.application.id].taskCounts.done, 1);
  await api(`${links}/${first.project.id}`, "DELETE", undefined, 409);
  await api(`${links}/${second.project.id}`, "DELETE", undefined, 204);
  assert.equal((await api(`${base}/managed-applications/${first.application.id}/work`)).counts.done, 1);
  const coordinator = await api(`${base}/agents`, "POST", { name: "Verification Friday", role: "general", adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } });
  const profile = await api(`${base}/operating-profile`, "PUT", { fridayAgentId: coordinator.id, expectedRevision: 0 });
  assert.equal(profile.fridayAgentId, coordinator.id);
  assert.equal(profile.modelBilling, "subscription_only");
  const key = await api(`/agents/${coordinator.id}/keys`, "POST", { name: "Disposable coordination verification" });
  assert.equal(typeof key.token, "string");
  const delegated = await api(`${base}/managed-applications/${first.application.id}`, "PATCH", { brief: "Updated through Friday's native permission" }, 200, key.token);
  assert.equal(delegated.brief, "Updated through Friday's native permission");
  const hire = await api(`${base}/agent-hires`, "POST", { name: "Verification project lead", role: "general", reportsTo: coordinator.id,
    adapterType: "paperclip_runner", inheritRuntimeFrom: "caller", sourceIssueId: first.task.id,
    instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": "Own this disposable project's plan, delegate bounded work, and report evidence to Friday. Do not run external actions." } } }, undefined, key.token);
  assert(hire.agent?.id, "Native hiring should return the created lead");
  const project = await api(`/projects/${first.project.id}`, "PATCH", { leadAgentId: hire.agent.id }, 200, key.token);
  assert.equal(project.leadAgentId, hire.agent.id);
  await api(`${base}/operating-profile`, "PUT", { fridayAgentId: null, expectedRevision: 0 }, 409);
  await api(`${base}/managed-applications/${first.application.id}`, "PATCH", { kind: "platform" });
  assert.equal((await api(`${base}/managed-applications`)).applications.length, 1);
  const galaxy = await api(`${base}/managed-applications/galaxy?kind=all`);
  assert.equal(galaxy.applications.length, 2);
  assert.equal(galaxy.tasks.length, 2);
  assert.equal(galaxy.tasksTruncated, false);
  assert.equal((await api(`${base}/managed-applications/${first.application.id}/work`)).tasks[0].id, first.task.id);
  console.log("PASS: registration/replay, native task aggregation, Friday binding/stale-write denial, authenticated delegation/hiring/project leadership, platform separation and galaxy records.");
} finally {
  if (company) {
    await api(`/companies/${company.id}`, "DELETE");
    console.log("Removed disposable verification company.");
  }
}
