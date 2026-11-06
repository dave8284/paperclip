import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createModelIntelligence } from "./index.mjs";

async function startService(database, credentials) {
  const env = { ...process.env, PORT: "0", MODEL_INTELLIGENCE_DB: database };
  delete env.MODEL_INTELLIGENCE_TOKEN;
  delete env.MODEL_INTELLIGENCE_HOST_CREDENTIALS;
  Object.assign(env, credentials);
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 2000);
    try { await closed; } finally { clearTimeout(deadline); }
  };
  let deadline;
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      deadline = setTimeout(() => reject(new Error("Service readiness timed out")), 5000);
      child.stdout.on("data", chunk => {
        output += chunk;
        const match = output.match(/127\.0\.0\.1:(\d+)/);
        if (match) resolve(`http://127.0.0.1:${match[1]}`);
      });
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Server exited before readiness")));
    });
    return { stop, request: async (token, path, body) => {
      const response = await fetch(`${address}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, body: await response.json() };
    } };
  } catch (error) { await stop(); throw error; }
  finally { clearTimeout(deadline); }
}

test("real HTTP upgrade and credential replacement preserve data and revoke exact namespace access", { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "model-http-upgrade-"));
  const database = join(directory, "records.sqlite");
  const tokenA = randomBytes(32).toString("hex"), tokenB = randomBytes(32).toString("hex");
  const replacement = randomBytes(32).toString("hex"), operator = randomBytes(32).toString("hex");
  const selection = { namespace: "company-a", requestId: "legacy", taskKey: "task", taskType: "analysis", complexity: "routine", defaultCandidateId: "baseline", candidates: [{ id: "baseline", model: "fixture-model", provider: "fixture-provider", method: "subscription", available: true }] };
  const review = { namespace: "company-a", id: "review", receiptId: "legacy", passed: true, iterations: 1, latencyMs: 20, source: "human", evaluator: "fixture-owner", evidenceRef: "fixture:acceptance-review" };
  let service;
  try {
    // Reconstruct the existing v1 storage footprint, including legacy evidence.
    const legacy = createModelIntelligence(database);
    legacy.select(selection); legacy.evaluate(review); legacy.close();
    const previous = new DatabaseSync(database);
    previous.exec("DROP TABLE comparison_outcomes; DROP TABLE controlled_comparisons; DROP TABLE comparison_cases; DROP TABLE comparison_datasets; PRAGMA user_version=1;");
    previous.close();
    const credentials = (a) => JSON.stringify([
      { id: "host-a", token: a, namespaces: ["company-a"] },
      { id: "host-b", token: tokenB, namespaces: ["company-b"] },
    ]);
    service = await startService(database, { MODEL_INTELLIGENCE_TOKEN: operator, MODEL_INTELLIGENCE_HOST_CREDENTIALS: credentials(tokenA) });
    const upgraded = await service.request(tokenA, "/v1/analytics?namespace=company-a");
    assert.equal(upgraded.status, 200); assert.equal(upgraded.body.counts.evaluations, 1);
    assert.equal((await service.request(tokenA, "/v1/select", selection)).body.id, "legacy");
    assert.equal((await service.request(tokenA, "/v1/evaluations", review)).status, 200);
    assert.equal((await service.request(tokenA, "/v1/analytics?namespace=company-b")).status, 403);
    assert.equal((await service.request(tokenA, "/v1/select", { ...selection, namespace: "company-b" })).status, 403);
    assert.equal((await service.request(tokenA, "/v1/analytics")).status, 400);
    assert.equal((await service.request(tokenA, "/v1/analytics?namespace=company-a&namespace=company-b")).status, 400);
    assert.equal((await service.request(operator, "/v1/analytics")).status, 200);
    const dataset = { namespace: "company-a", id: "upgrade-data", version: "v1", taskFamily: "analysis", taskFamilyVersion: "v1", complexity: "routine", provenance: "synthetic", cases: [{ id: "case", split: "holdout", inputDigest: "a".repeat(64), checkDigest: "b".repeat(64), sourceRef: "fixture:case" }] };
    assert.equal((await service.request(tokenA, "/v1/datasets", dataset)).status, 200);
    await service.stop(); service = null;
    const upgradedDb = new DatabaseSync(database);
    assert.equal(upgradedDb.prepare("PRAGMA user_version").get().user_version, 2);
    upgradedDb.close();

    // A fresh process retains the audit while replacing host A and removing
    // the all-namespace operator credential entirely.
    service = await startService(database, { MODEL_INTELLIGENCE_HOST_CREDENTIALS: credentials(replacement) });
    assert.equal((await service.request(tokenA, "/v1/analytics?namespace=company-a")).status, 401);
    assert.equal((await service.request(operator, "/v1/analytics?namespace=company-a")).status, 401);
    assert.deepEqual((await service.request(replacement, "/v1/analytics?namespace=company-a")).body, upgraded.body);
    assert.equal((await service.request(replacement, "/v1/datasets", dataset)).status, 200);
    assert.equal((await service.request(replacement, "/v1/analytics?namespace=company-b")).status, 403);
    const other = await service.request(tokenB, "/v1/analytics?namespace=company-b");
    assert.equal(other.status, 200); assert.equal(other.body.counts.selections, 0);
    assert.equal((await service.request(tokenB, "/v1/analytics?namespace=company-a")).status, 403);
  } finally { await service?.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("standalone service authenticates requests and preserves selection/evaluation receipts", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "model-http-")), token = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: "0", MODEL_INTELLIGENCE_TOKEN: token, MODEL_INTELLIGENCE_DB: join(directory, "records.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.resume();
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; const match = output.match(/127\.0\.0\.1:(\d+)/); if (match) resolve(`http://127.0.0.1:${match[1]}`); });
      child.once("error", reject); child.once("exit", () => reject(new Error("Server exited before readiness")));
    });
    const denied = await fetch(`${address}/v1/analytics`); assert.equal(denied.status, 401); await denied.text();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const request = { namespace: "fixture", requestId: "run", taskKey: "task", taskType: "analysis", complexity: "routine", defaultCandidateId: "baseline", candidates: [{ id: "baseline", model: "fixture-model", provider: "fixture-provider", method: "subscription", available: true }] };
    const select = await fetch(`${address}/v1/select`, { method: "POST", headers, body: JSON.stringify(request) });
    assert.equal(select.status, 200); const receipt = await select.json(); assert.equal(receipt.candidate.id, "baseline");
    const review = await fetch(`${address}/v1/evaluations`, { method: "POST", headers, body: JSON.stringify({ namespace: "fixture", id: "review", receiptId: "run", passed: true, iterations: 1, latencyMs: 20, source: "human", evaluator: "fixture-owner", evidenceRef: "fixture:acceptance-review" }) });
    assert.equal(review.status, 200); await review.json();
    const analytics = await fetch(`${address}/v1/analytics?namespace=fixture`, { headers }); assert.equal((await analytics.json()).counts.evaluations, 1);
    const other = await fetch(`${address}/v1/analytics?namespace=other`, { headers }); assert.equal((await other.json()).counts.selections, 0);
    const malformed = await fetch(`${address}/v1/select`, { method: "POST", headers, body: "invalid" }); assert.equal(malformed.status, 400); await malformed.text();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, "exit"); child.kill("SIGTERM"); await closed; }
    await rm(directory, { recursive: true, force: true });
  }
});
