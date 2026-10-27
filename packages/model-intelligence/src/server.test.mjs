import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

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
