import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { createModelIntelligence } from "./index.mjs";
import { createHttpAuthority, httpAuthFromEnvironment } from "./http-auth.mjs";
import { createHttpHandler } from "./http-handler.mjs";

const token = () => randomBytes(32).toString("hex");
const sha = value => createHash("sha256").update(value).digest("hex");
const operatorToken = token(), tokenA = token(), tokenB = token();
const hosts = () => [{ id: "host-a", token: tokenA, namespaces: ["a"] }, { id: "host-b", token: tokenB, namespaces: ["b"] }];
const selection = (namespace = "a", requestId = "selection", model = "baseline") => ({ namespace, requestId, taskKey: requestId, taskType: "support.triage", complexity: "routine", defaultCandidateId: model,
  candidates: [{ id: model, model, provider: "test", method: "subscription", available: true }] });
const evaluation = (namespace = "a") => ({ namespace, id: "review", receiptId: "selection", passed: true, iterations: 1, latencyMs: 20, source: "checks", evaluator: "fixture-checks", evidenceRef: "fixture:acceptance" });
const policy = (namespace = "a") => ({ namespace, id: "block", candidateId: "candidate", action: "block", reason: "Fixture policy" });
const variant = profileId => ({ profileId, model: profileId, provider: "test", modelVersion: "v1", reasoningEffort: "medium", method: "subscription", harnessFingerprint: sha("harness"), promptFingerprint: sha("prompt"), contextFingerprint: sha("context") });
const dataset = (namespace = "a") => ({ namespace, id: "dataset", version: "v1", taskFamily: "support.triage", taskFamilyVersion: "v1", complexity: "routine", provenance: "synthetic",
  cases: Array.from({ length: 5 }, (_, index) => ({ id: `case-${index}`, split: "holdout", inputDigest: sha(`input-${index}`), checkDigest: sha(`checks-${index}`), sourceRef: `fixture:case-${index}` })) });
const comparison = (namespace = "a") => ({ namespace, id: "comparison", datasetId: "dataset", datasetVersion: "v1", dimension: "model", baseline: variant("baseline"), candidate: variant("candidate"),
  thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } });

function setup(t, configuration = { operatorToken, hostCredentials: hosts() }) {
  const engine = createModelIntelligence(":memory:"); t.after(() => engine.close());
  const calls = [];
  const store = new Proxy(engine, { get(target, key) { const value = target[key]; return typeof value === "function" ? (...args) => { calls.push({ method: key, args }); return value(...args); } : value; } });
  return { engine, calls, handler: createHttpHandler(store, createHttpAuthority(configuration)), store };
}
async function call(handler, { method = "GET", path = "/v1/analytics", credential = tokenA, body, raw, chunks, headers = {} } = {}) {
  const bytes = raw === undefined ? body === undefined ? undefined : JSON.stringify(body) : raw;
  const request = Readable.from(chunks ?? (bytes === undefined ? [] : [Buffer.from(bytes)]));
  request.method = method; request.url = path;
  request.headers = { ...(credential === null ? {} : { authorization: `Bearer ${credential}` }), ...(bytes === undefined ? {} : { "content-length": String(Buffer.byteLength(bytes)) }), ...headers };
  const response = { status: 200, headers: {}, value: undefined, setHeader(name, value) { this.headers[name] = value; }, writeHead(status) { this.status = status; }, end(text) { this.value = JSON.parse(text); } };
  await handler(request, response);
  return response;
}
const post = (handler, path, body, credential = tokenA) => call(handler, { method: "POST", path, body, credential });

test("legacy operator mode keeps all-namespace analytics and existing selection/evaluation/policy APIs", async t => {
  const f = setup(t, { operatorToken });
  for (const namespace of ["a", "b"]) {
    assert.equal((await post(f.handler, "/v1/select", selection(namespace), operatorToken)).status, 200);
    assert.equal((await post(f.handler, "/v1/evaluations", evaluation(namespace), operatorToken)).status, 200);
    assert.equal((await post(f.handler, "/v1/policy", policy(namespace), operatorToken)).status, 200);
  }
  const aggregate = await call(f.handler, { credential: operatorToken });
  assert.equal(aggregate.status, 200); assert.equal(aggregate.value.counts.selections, 2); assert.equal(aggregate.value.counts.evaluations, 2);
  assert.equal(aggregate.headers["Cache-Control"], "no-store");
  assert.equal(aggregate.headers["Content-Type"], "application/json");
  assert.equal((await call(f.handler, { path: "/v1/analytics?namespace=a", credential: operatorToken })).value.counts.selections, 1);
});

test("host-only credentials authorize exact namespaces and never aggregate analytics", async t => {
  const f = setup(t, { hostCredentials: hosts() });
  await post(f.handler, "/v1/select", selection("a"));
  await post(f.handler, "/v1/select", selection("b"), tokenB);
  assert.equal((await call(f.handler, { path: "/v1/analytics?namespace=a" })).value.counts.selections, 1);
  assert.equal((await call(f.handler, { path: "/v1/analytics?namespace=b", credential: tokenB })).value.counts.selections, 1);
  const before = f.calls.length;
  for (const path of ["/v1/analytics", "/v1/analytics?namespace=", "/v1/comparisons/report?comparisonId=comparison"]) assert.equal((await call(f.handler, { path })).status, 400);
  for (const namespace of ["b", "A", "a ", " a", "*", "unknown"]) assert.equal((await call(f.handler, { path: `/v1/analytics?namespace=${encodeURIComponent(namespace)}` })).status, 403);
  assert.equal(f.calls.length, before);
});

test("every write and comparison read rejects a foreign namespace before store access", async t => {
  const f = setup(t);
  for (const path of ["/v1/select", "/v1/evaluations", "/v1/policy", "/v1/datasets", "/v1/comparisons", "/v1/comparison-outcomes"]) {
    assert.equal((await post(f.handler, path, { namespace: "b" })).status, 403);
    assert.equal((await post(f.handler, path, { namespace: "a" }, tokenB)).status, 403);
    assert.equal((await post(f.handler, path, {})).status, 400);
  }
  assert.equal((await call(f.handler, { path: "/v1/comparisons/report?namespace=b&comparisonId=anything" })).status, 403);
  assert.equal(f.calls.length, 0);
});

test("comparison HTTP contracts preserve scoped immutable evidence, failure history and policy gates", async t => {
  const f = setup(t), data = dataset(), run = comparison();
  assert.equal((await post(f.handler, "/v1/datasets", data)).status, 200);
  assert.equal((await post(f.handler, "/v1/comparisons", run)).status, 200);
  for (let index = 0; index < data.cases.length; index++) for (const arm of ["baseline", "candidate"]) {
    const item = data.cases[index], profile = run[arm], id = `${item.id}:${arm}`;
    assert.equal((await post(f.handler, "/v1/select", { ...selection("a", id, profile.profileId), promptFingerprint: profile.promptFingerprint, contextFingerprint: profile.contextFingerprint })).status, 200);
    const outcome = { namespace: "a", id, comparisonId: run.id, caseId: item.id, arm, attempt: 1, receiptId: id, inputDigest: item.inputDigest, checkDigest: item.checkDigest,
      observedVariant: profile, provenance: "synthetic", outcome: arm === "candidate" && index === 0 ? "failed" : "passed", terminal: true, iterations: 1, latencyMs: arm === "baseline" ? 100 : 50,
      source: "checks", evaluator: "fixture-checks", evidenceRef: `fixture:${id}` };
    assert.equal((await post(f.handler, "/v1/comparison-outcomes", outcome)).status, 200);
    assert.equal((await post(f.handler, "/v1/comparison-outcomes", outcome)).status, 200);
    if (outcome.outcome === "failed") assert.equal((await post(f.handler, "/v1/comparison-outcomes", { ...outcome, outcome: "passed" })).status, 400);
  }
  const path = "/v1/comparisons/report?namespace=a&comparisonId=comparison";
  const report = await call(f.handler, { path });
  assert.equal(report.status, 200); assert.equal(report.value.status, "not_ready"); assert.equal(report.value.productionImprovementProven, false);
  assert.equal(report.value.evidenceTrust, "host_attested"); assert.equal(report.value.candidate.failedAttempts, 1);
  assert(report.value.blockers.includes("synthetic_dataset")); assert(report.value.blockers.includes("paired_quality_regression"));
  await post(f.handler, "/v1/policy", policy());
  assert((await call(f.handler, { path })).value.blockers.includes("profile_blocked_by_policy"));
  assert.equal((await call(f.handler, { path, credential: tokenB })).status, 403);
  assert.equal((await call(f.handler, { path: path.replace("namespace=a", "namespace=b"), credential: tokenB })).status, 400);
  assert.equal((await call(f.handler, { path: "/v1/analytics?namespace=a" })).value.counts.evaluations, 0);
});

test("same IDs remain namespace-isolated, including evaluations and policy changes", async t => {
  const f = setup(t);
  await post(f.handler, "/v1/select", selection("a"));
  assert.equal((await post(f.handler, "/v1/evaluations", evaluation("b"), tokenB)).status, 400);
  await post(f.handler, "/v1/select", selection("b"), tokenB);
  await post(f.handler, "/v1/evaluations", evaluation("b"), tokenB);
  await post(f.handler, "/v1/policy", { ...policy("b"), candidateId: "baseline" }, tokenB);
  assert.equal((await call(f.handler, { path: "/v1/analytics?namespace=a" })).value.counts.evaluations, 0);
  assert.equal((await post(f.handler, "/v1/select", selection("a", "next"))).status, 200);
  assert.equal((await post(f.handler, "/v1/select", selection("b", "next"), tokenB)).status, 400);
});

test("namespace ambiguity, duplicate fields and malformed bodies fail before store access", async t => {
  const f = setup(t);
  for (const path of ["/v1/analytics?namespace=a&namespace=b", "/v1/analytics?namespace=a&namespace=a", "/v1/analytics?namespace=a&other=x", "/v1/comparisons/report?namespace=a&comparisonId=x&comparisonId=x"]) assert.equal((await call(f.handler, { path })).status, 400);
  for (const path of ["/v1/select?namespace=a", "/v1/select?namespace=b", "/v1/select?other=x"]) assert.equal((await post(f.handler, path, selection())).status, 400);
  for (const raw of ['{"namespace":"b","namespace":"a"}', '{"namespace":"a","na\\u006despace":"a"}', '{"namespace":"a","requestId":"x","requestId":"y"}', 'null', '[]', '"a"', '{"namespace":null}', '{"namespace":"a", INVALID_BODY_SECRET']) {
    const result = await call(f.handler, { method: "POST", path: "/v1/select", raw });
    assert.equal(result.status, 400); assert(!JSON.stringify(result.value).includes("INVALID_BODY_SECRET"));
  }
  assert.equal((await call(f.handler, { path: "/v1/analytics?namespace=a", body: { namespace: "b" } })).status, 400);
  assert.equal((await call(f.handler, { path: "/v1/analytics?namespace=a", headers: { "transfer-encoding": "chunked" } })).status, 400);
  assert.equal(f.calls.length, 0);
});

test("credential failures do not consume bodies or disclose configuration", async t => {
  const f = setup(t);
  for (const credential of [null, "short", token(), `${tokenA} `, operatorToken.slice(1)]) {
    const response = await post(f.handler, "/v1/select", { namespace: "a", secret: "BODY_SECRET" }, credential);
    assert.equal(response.status, 401); assert.equal(response.headers.Connection, "close"); assert.deepEqual(response.value, { error: "Unauthorized" });
  }
  const duplicateHeader = await call(f.handler, { headers: { authorization: [`Bearer ${tokenA}`, `Bearer ${tokenB}`] } });
  assert.equal(duplicateHeader.status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await call(f.handler, { path: "/__proto__" })).status, 404);
});

test("stream limits reject oversized or invalid UTF-8 data and preserve split multibyte input", async t => {
  const f = setup(t);
  for (const [path, size] of [["/v1/select", 65537], ["/v1/datasets", 131073]]) {
    const oversized = await call(f.handler, { method: "POST", path, raw: "x".repeat(size) });
    assert.equal(oversized.status, 413); assert.equal(oversized.headers.Connection, "close");
  }
  assert.equal((await call(f.handler, { method: "POST", path: "/v1/select", chunks: [Buffer.from([0xff])] })).status, 400);
  assert.equal(f.calls.length, 0);
  const input = selection("a", "unicode", "mødėl");
  const chunks = [...Buffer.from(JSON.stringify(input))].map(byte => Buffer.from([byte]));
  const response = await call(f.handler, { method: "POST", path: "/v1/select", chunks });
  assert.equal(response.status, 200); assert.equal(response.value.candidate.model, "mødėl");
  const large = dataset(); large.cases = Array.from({ length: 100 }, (_, index) => ({ id: `case-${index}`.padEnd(300, "x"), split: "holdout", inputDigest: sha(`large-input-${index}`), checkDigest: sha(`large-check-${index}`), sourceRef: "x".repeat(300) }));
  assert(Buffer.byteLength(JSON.stringify(large)) > 65536);
  assert.equal((await post(f.handler, "/v1/datasets", large)).status, 200);
});

test("new startup configuration revokes removed tokens without changing retained namespace data", async t => {
  const f = setup(t, { hostCredentials: hosts() });
  await post(f.handler, "/v1/select", selection("a"));
  const replacement = token();
  const restarted = createHttpHandler(f.store, createHttpAuthority({ hostCredentials: [{ id: "replacement", token: replacement, namespaces: ["a", "b"] }] }));
  assert.equal((await call(restarted, { path: "/v1/analytics?namespace=a" })).status, 401);
  assert.equal((await call(restarted, { path: "/v1/analytics?namespace=b", credential: tokenB })).status, 401);
  assert.equal((await call(restarted, { credential: operatorToken })).status, 401);
  assert.equal((await call(restarted, { path: "/v1/analytics?namespace=a", credential: replacement })).value.counts.selections, 1);
  assert.equal((await call(restarted, { path: "/v1/analytics?namespace=b", credential: replacement })).status, 200);
  assert.equal((await call(restarted, { credential: replacement })).status, 400);
});

test("invalid or ambiguous credential configuration fails closed without echoing secrets", () => {
  const validHost = hosts()[0];
  const invalidConfigurations = [
    {}, { operatorToken: "short" }, { operatorToken: "x".repeat(513) }, { operatorToken: `${tokenA}\n` }, { hostCredentials: [] }, { hostCredentials: {} },
    { operatorToken: tokenA, hostCredentials: [validHost] }, { hostCredentials: [validHost, { ...validHost, token: tokenB }] },
    { hostCredentials: [validHost, { ...validHost, id: "other" }] }, { hostCredentials: [{ ...validHost, namespaces: [] }] },
    { hostCredentials: [{ ...validHost, namespaces: ["*"] }] }, { hostCredentials: [{ ...validHost, namespaces: ["a", "a"] }] },
    { hostCredentials: [{ ...validHost, namespaces: [""] }] }, { hostCredentials: [{ ...validHost, namespaces: ["a".repeat(301)] }] },
    { hostCredentials: [{ ...validHost, unexpected: tokenA }] }, { hostCredentials: [{ ...validHost, namespaces: Array.from({ length: 101 }, (_, index) => `n-${index}`) }] },
    { hostCredentials: Array.from({ length: 101 }, (_, index) => ({ id: `host-${index}`, token: token(), namespaces: ["a"] })) },
    { hostCredentials: Array.from({ length: 11 }, (_, index) => ({ id: `host-${index}`, token: token(), namespaces: Array.from({ length: 100 }, (_, count) => `n-${count}`) })) },
  ];
  for (const configuration of invalidConfigurations) assert.throws(() => createHttpAuthority(configuration), error => error.message === "Invalid Model Intelligence HTTP credential configuration" && !error.stack.includes(tokenA));
  for (const encoded of [`[{"token":"${tokenA}", BROKEN`, "null", "[]", "x".repeat(524289)]) {
    assert.throws(() => httpAuthFromEnvironment({ MODEL_INTELLIGENCE_HOST_CREDENTIALS: encoded }), error => error.message === "Invalid Model Intelligence HTTP credential configuration" && !error.stack.includes(tokenA));
  }
  const configured = httpAuthFromEnvironment({ MODEL_INTELLIGENCE_HOST_CREDENTIALS: JSON.stringify(hosts()) });
  assert.equal(configured.authenticate(`Bearer ${tokenA}`).kind, "host");
  assert.equal(configured.authenticate(`Bearer ${operatorToken}`), null);
  assert.equal(httpAuthFromEnvironment({ MODEL_INTELLIGENCE_TOKEN: operatorToken }).authenticate(`Bearer ${operatorToken}`).kind, "operator");
});
