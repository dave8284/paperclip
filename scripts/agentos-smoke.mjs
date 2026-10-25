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
  // Generated displays use native attachments/work products and revisioned
  // documents. Exercise the real publication path without invoking a model.
  const html = '<!doctype html><title>Verification display</title><button onclick="this.textContent=\'Ready\'">Inspect</button>';
  const form = new FormData();
  form.set("file", new Blob([html], { type: "text/html" }), "verification.html");
  const upload = await fetch(new URL(`/api${base}/issues/${first.task.id}/attachments`, origin), {
    method: "POST", headers: { Origin: origin.origin, Authorization: `Bearer ${key.token}` }, body: form,
  });
  assert(upload.ok, `Artifact upload failed: ${upload.status}`);
  const attachment = await upload.json();
  const canvas = await api(`/issues/${first.task.id}/work-products`, "POST", {
    type: "artifact", provider: "paperclip", title: "Verification display", status: "ready_for_review",
    externalId: "friday-display-verification", metadata: { attachmentId: attachment.id },
  }, undefined, key.token);
  assert.equal(canvas.metadata.attachmentId, attachment.id);
  assert.equal(canvas.metadata.contentType, "text/html");
  const content = await fetch(new URL(`/api/attachments/${attachment.id}/content`, origin));
  assert(content.ok); assert.equal(await content.text(), html);
  const documentPath = `/issues/${first.task.id}/documents/friday-canvas-${attachment.id}`;
  const saved = await api(documentPath, "PUT", { format: "markdown", title: "Saved verification display", baseRevisionId: null,
    body: JSON.stringify({ version: 1, attachmentId: attachment.id, workProductId: canvas.id }) });
  assert(saved.latestRevisionId);
  assert.equal(JSON.parse((await api(documentPath, "GET", undefined, undefined, key.token)).body).attachmentId, attachment.id);
  await api(documentPath, "PUT", { format: "markdown", title: "Stale overwrite", baseRevisionId: null, body: "stale" }, 409);
  // Friday's read model includes projects outside the application registry.
  const initiative = await api(`${base}/projects`, "POST", { name: "Unregistered initiative", leadAgentId: coordinator.id, idempotencyKey: randomUUID() }, undefined, key.token);
  const awareness = await api(`${base}/friday/work?limit=1`, "GET", undefined, undefined, key.token);
  assert.equal(awareness.projectCount, 3);
  assert.equal(awareness.counts.done, 2);
  assert.equal(awareness.tasks.length, 1);
  assert.equal(awareness.nextOffset, 1);
  const ownWork = await api(`${base}/friday/work?agentId=${coordinator.id}`, "GET", undefined, undefined, key.token);
  assert(ownWork.projects.some(item => item.id === initiative.id));
  const scoped = await api(`${base}/friday/work?projectId=${first.project.id}`, "GET", undefined, undefined, key.token);
  assert(scoped.evidence.some(item => item.id === canvas.id && item.kind === "artifact"));
  const viewPath = `/issues/${first.task.id}/documents/friday-view`;
  const view = { version: 1, panel: "work", projectId: first.project.id, mode: "combined" };
  const shown = await api(viewPath, "PUT", { format: "markdown", title: "Current work view", body: JSON.stringify(view), baseRevisionId: null }, undefined, key.token);
  assert.deepEqual(JSON.parse(shown.body), view);
  await api(viewPath, "PUT", { format: "markdown", title: "Stale view", body: "{}", baseRevisionId: null }, 409, key.token);
  const routine = await api(`${base}/routines`, "POST", { title: "Verification feedback loop", projectId: initiative.id, assigneeAgentId: coordinator.id, status: "paused", description: "Disposable paused routine; no external operations." }, undefined, key.token);
  assert.equal(routine.status, "paused");
  assert((await api(`${base}/routines?projectId=${initiative.id}`)).some(item => item.id === routine.id));
  await api(`${base}/attention?projectId=${first.project.id}`, "GET", undefined, 200);
  await api(`${base}/attention`, "GET", undefined, 403, key.token);
  console.log("PASS: registration/replay, native aggregation, Friday binding, authenticated delegation/hiring, platform separation, galaxy, publication, shared awareness, revision-controlled displays/views, and agent-created paused routines.");
} finally {
  if (company) {
    await api(`/companies/${company.id}`, "DELETE");
    console.log("Removed disposable verification company.");
  }
}
