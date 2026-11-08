import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createModelIntelligence } from "@agentos/model-intelligence";
import { activatePostgresModelIntelligence, createPostgresModelIntelligence, deactivatePostgresModelIntelligence } from "@agentos/model-intelligence/postgres";
import { createPostgresMigrationTarget, importModelIntelligenceBackup, inspectModelIntelligenceBackup,
  type ModelMigrationConnection } from "@agentos/model-intelligence/migration";
import { describeEmbeddedPostgres, useEmbeddedPostgres } from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("independent Model Intelligence PostgreSQL import", () => {
  const ctx = useEmbeddedPostgres("agentos-model-migration-");
  const temporary: string[] = [];
  // This entire database is a disposable harness fixture. Never use runtime
  // configuration, a live connection URL or a company database for this suite.
  beforeEach(async () => { await ctx.db.$client.unsafe("DROP SCHEMA IF EXISTS agentos_model_intelligence CASCADE"); });
  afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
  const client = () => ctx.db.$client as unknown as ModelMigrationConnection;
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "agentos-source-backup-")); temporary.push(directory);
    const path = join(directory, "offline.sqlite"), engine = createModelIntelligence(path);
    for (let i = 0; i < 5; i++) engine.policy({ namespace: `fixture-company-${i % 2}`, candidateId: "baseline", action: "block", reason: `Retained reason ${i}` });
    engine.close();
    const db = new DatabaseSync(path); db.exec("PRAGMA journal_mode=DELETE; UPDATE policy_events SET rowid=rowid+9007199254740992"); db.close();
    return { path, manifest: await inspectModelIntelligenceBackup(path) };
  }
  it("preserves exact row identities, verifies all tables and advances sequences while runtime remains disabled", async () => {
    const source = await fixture(), destination = createPostgresMigrationTarget(client(), { destinationId: randomUUID() });
    await destination.initialize();
    const result = await importModelIntelligenceBackup(source.path, source.manifest, destination, { batchRows: 2 });
    expect(result).toMatchObject({ state: "imported_unaccepted", rows: 5, runtimeEnabled: false });
    expect(await importModelIntelligenceBackup(source.path, source.manifest, destination)).toEqual(result);
    const rows = await ctx.db.$client.unsafe("SELECT rowid::text FROM agentos_model_intelligence.policy_events ORDER BY rowid");
    expect(rows.map(row => row.rowid)).toEqual(["9007199254740993", "9007199254740994", "9007199254740995", "9007199254740996", "9007199254740997"]);
    const [next] = await ctx.db.$client.unsafe("SELECT nextval(pg_get_serial_sequence('agentos_model_intelligence.policy_events','rowid'))::text AS n");
    expect(next.n).toBe("9007199254740998");
  });
  it("recovers a committed batch with a lost acknowledgement and rejects another destination identity", async () => {
    const source = await fixture(), destinationId = randomUUID(), destination = createPostgresMigrationTarget(client(), { destinationId });
    await destination.initialize();
    let lost = false;
    const interrupted = { ...destination, async writeBatch(...args: Parameters<typeof destination.writeBatch>) {
      const result = await destination.writeBatch(...args);
      if (!lost) { lost = true; throw new Error("Simulated lost reply after commit"); } return result;
    } };
    await expect(importModelIntelligenceBackup(source.path, source.manifest, interrupted, { batchRows: 2 })).rejects.toThrow("could not be confirmed");
    expect((await importModelIntelligenceBackup(source.path, source.manifest, destination)).rows).toBe(5);
    await expect(createPostgresMigrationTarget(client(), { destinationId: randomUUID() }).initialize()).rejects.toThrow("Destination identity");
    const different = await fixture();
    await expect(importModelIntelligenceBackup(different.path, different.manifest, destination)).rejects.toThrow("different source manifest");
  });
  it("rolls back an entire batch on a conflicting primary identity without overwriting history", async () => {
    const source = await fixture(), destination = createPostgresMigrationTarget(client(), { destinationId: randomUUID() });
    await destination.initialize(); await destination.start(source.manifest);
    const db = new DatabaseSync(source.path, { readOnly: true });
    const row = db.prepare("SELECT * FROM policy_events ORDER BY rowid LIMIT 1").get()!; db.close();
    await ctx.db.$client.unsafe("INSERT INTO agentos_model_intelligence.policy_events(rowid,namespace,id,candidate_id,action,reason,created_at) VALUES(1,$1,$2,$3,$4,'existing conflict',$5)",
      [row.namespace, row.id, row.candidate_id, row.action, row.created_at] as string[]);
    await expect(importModelIntelligenceBackup(source.path, source.manifest, destination)).rejects.toThrow("conflicts with the source");
    const [remaining] = await ctx.db.$client.unsafe("SELECT count(*)::text AS n,min(reason) AS reason FROM agentos_model_intelligence.policy_events");
    expect(remaining).toMatchObject({ n: "1", reason: "existing conflict" });
    const [progress] = await ctx.db.$client.unsafe("SELECT row_count::text FROM agentos_model_intelligence._migration_progress WHERE table_name='policy_events'");
    expect(progress.row_count).toBe("0");
  });
  it("rejects public schema exposure and detects post-import content changes", async () => {
    const source = await fixture(), destination = createPostgresMigrationTarget(client(), { destinationId: randomUUID() });
    await destination.initialize();
    await ctx.db.$client.unsafe("GRANT USAGE ON SCHEMA agentos_model_intelligence TO PUBLIC");
    await expect(importModelIntelligenceBackup(source.path, source.manifest, destination)).rejects.toThrow("public API role");
    await ctx.db.$client.unsafe("REVOKE ALL ON SCHEMA agentos_model_intelligence FROM PUBLIC");
    await importModelIntelligenceBackup(source.path, source.manifest, destination);
    await ctx.db.$client.unsafe("UPDATE agentos_model_intelligence.policy_events SET reason='changed after import'");
    await expect(importModelIntelligenceBackup(source.path, source.manifest, destination)).rejects.toThrow("differs from the source manifest");
  });
  it("serializes duplicate initialization/import and retains a single verified result", async () => {
    const source = await fixture(), destinationId = randomUUID();
    const a = createPostgresMigrationTarget(client(), { destinationId }), b = createPostgresMigrationTarget(client(), { destinationId });
    await Promise.all([a.initialize(), b.initialize()]);
    await Promise.allSettled([importModelIntelligenceBackup(source.path, source.manifest, a, { batchRows: 2 }), importModelIntelligenceBackup(source.path, source.manifest, b, { batchRows: 2 })]);
    const final = await importModelIntelligenceBackup(source.path, source.manifest, a, { batchRows: 2 });
    expect(final).toMatchObject({ rows: 5, state: "imported_unaccepted", runtimeEnabled: false });
    const [count] = await ctx.db.$client.unsafe("SELECT count(*)::text AS n FROM agentos_model_intelligence.policy_events");
    expect(count.n).toBe("5");
  });
  async function acceptedRuntime() {
    const source = await fixture(), destinationId = randomUUID(), activationId = randomUUID();
    const target = createPostgresMigrationTarget(client(), { destinationId });
    await target.initialize(); await importModelIntelligenceBackup(source.path, source.manifest, target);
    const identity = { destinationId, activationId, manifestSha256: source.manifest.manifestSha256 };
    await expect(createPostgresModelIntelligence(client(), identity)).rejects.toThrow("could not be confirmed");
    const acceptance = { destinationId, activationId, manifest: source.manifest, acceptanceRef: "disposable-integration-fixture-only" };
    await activatePostgresModelIntelligence(client(), acceptance);
    const store = await createPostgresModelIntelligence(client(), identity);
    return { source, target, identity, acceptance, store };
  }
  const selection = (namespace: string, id = "same-id") => ({ namespace, requestId: id, taskKey: id, taskType: "support.triage", complexity: "routine" as const,
    defaultCandidateId: "baseline", candidates: [{ id: "baseline", provider: "test", model: "baseline", method: "subscription" as const, available: true as const }] });
  it("opens only accepted evidence and preserves namespace, replay, report and exact sequence behavior", async () => {
    const f = await acceptedRuntime();
    try {
      const [left, replay] = await Promise.all([f.store.select(selection("company-a")), f.store.select(selection("company-a"))]);
      expect(replay).toEqual(left);
      const right = await f.store.select(selection("company-b")); expect(right.namespace).toBe("company-b");
      await expect(f.store.select({ ...selection("company-a"), taskKey: "changed" })).rejects.toThrow("different inputs");
      await f.store.evaluate({ namespace: "company-a", id: "review", receiptId: left.id, passed: true, iterations: 1, latencyMs: 20,
        source: "checks", evaluator: "fixture", evidenceRef: "fixture:review" });
      expect((await f.store.analytics("company-a")).counts).toEqual({ selections: 1, evaluations: 1, policyEvents: 0 });
      expect((await f.store.analytics("company-b")).counts.evaluations).toBe(0);
      expect(await f.store.selectionReceipt({ namespace: "company-a", receiptId: left.id })).toEqual(left);
      const policy = await f.store.policy({ namespace: "fixture-company-0", candidateId: "baseline", action: "restore", reason: "Fixture restore" });
      const [row] = await ctx.db.$client.unsafe("SELECT rowid::text FROM agentos_model_intelligence.policy_events WHERE id=$1", [policy.id]);
      expect(row.rowid).toBe("9007199254740998");
      expect((await f.store.analytics("fixture-company-0")).events[0]).toMatchObject({ candidateId: "baseline", createdAt: policy.createdAt });
      await expect(f.target.initialize()).rejects.toThrow("runtime is active");
      // Acceptance replay after ordinary runtime writes must neither re-import
      // old evidence nor reset sequences, and must retain the exact identity.
      expect(await activatePostgresModelIntelligence(client(), f.acceptance)).toMatchObject({ ...f.identity, active: true });
      expect((await f.store.analytics("company-a")).counts.selections).toBe(1);
    } finally { await f.store.close(); }
  });
  it("revocation rejects subsequent runtime use and cannot be undone by replaying old acceptance", async () => {
    const f = await acceptedRuntime();
    try {
      await f.store.select(selection("company-a"));
      await deactivatePostgresModelIntelligence(client(), f.identity);
      await expect(f.store.select(selection("company-a", "after-revocation"))).rejects.toThrow("could not be confirmed");
      await expect(createPostgresModelIntelligence(client(), f.identity)).rejects.toThrow("could not be confirmed");
      await expect(activatePostgresModelIntelligence(client(), f.acceptance)).rejects.toThrow("revoked");
      const [count] = await ctx.db.$client.unsafe("SELECT count(*)::text AS n FROM agentos_model_intelligence.routing_receipts");
      expect(count.n).toBe("1");
    } finally { await f.store.close(); }
  });
  it("rejects public exposure after opening an accepted runtime", async () => {
    const f = await acceptedRuntime();
    try {
      await ctx.db.$client.unsafe("GRANT USAGE ON SCHEMA agentos_model_intelligence TO PUBLIC");
      await expect(f.store.analytics("fixture-company-0")).rejects.toThrow("could not be confirmed");
    } finally { await f.store.close(); }
  });
  it("retains comparison gates, automatic canary adoption, exact deadlines and rollback on PostgreSQL", async () => {
    const f = await acceptedRuntime(), engine = f.store, namespace = "routing-fixture", taskType = "support.triage";
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const variant = (model: string) => ({ profileId: model, model, provider: "test", modelVersion: "v1", reasoningEffort: "medium", method: "subscription" as const,
      harnessFingerprint: sha("harness"), promptFingerprint: sha("prompt"), contextFingerprint: sha("context") });
    const limits = { canaryPercent: 5, maximumPending: 2, minimumObservations: 5, observationTimeoutMs: 60_000,
      qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 };
    const data = { namespace, id: "dataset", version: "1", taskFamily: taskType, taskFamilyVersion: "1", complexity: "routine" as const, provenance: "observed" as const,
      cases: Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, split: "holdout" as const, inputDigest: sha(`input-${i}`), checkDigest: sha(`checks-${i}`), sourceRef: `fixture:${i}` })) };
    const comparison = { namespace, id: "comparison", datasetId: data.id, datasetVersion: data.version, dimension: "model" as const, baseline: variant("baseline"), candidate: variant("fast"),
      thresholds: { minimumHoldoutPairs: 5, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 } };
    try {
      await engine.registerDataset(data); await engine.registerComparison(comparison);
      for (const item of data.cases) for (const arm of ["baseline", "candidate"] as const) {
        const profile = comparison[arm], id = `${item.id}:${arm}`;
        await engine.select({ ...selection(namespace, id), defaultCandidateId: profile.profileId,
          candidates: [{ id: profile.profileId, model: profile.model, provider: profile.provider, method: "subscription", available: true }],
          promptFingerprint: profile.promptFingerprint, contextFingerprint: profile.contextFingerprint });
        await engine.recordComparisonOutcome({ namespace, id, comparisonId: comparison.id, caseId: item.id, arm, attempt: 1, receiptId: id,
          inputDigest: item.inputDigest, checkDigest: item.checkDigest, observedVariant: profile, provenance: "observed", outcome: "passed", terminal: true,
          iterations: 1, latencyMs: arm === "baseline" ? 1000 : 400, source: "checks", evaluator: "fixture-reviewer", evidenceRef: `fixture:${id}` });
      }
      expect((await engine.comparisonReport({ namespace, comparisonId: comparison.id })).status).toBe("eligible_for_canary");
      await engine.configureRoutingPolicy({ namespace, id: "enroll", taskType, expectedRevision: 0, mode: "automatic", pinnedReleaseId: null, limits, reason: "Fixture enrollment" });
      const release = (await engine.routingRollouts({ namespace, taskType })).releases[0]; expect(release.state).toBe("canary");
      let serial = 0;
      const production = (id: string) => ({ ...selection(namespace, id), contextFingerprint: sha(id), candidates: [comparison.baseline, comparison.candidate].map(profile => ({
        id: profile.profileId, model: profile.model, provider: profile.provider, method: "subscription" as const, available: true as const, variant: profile })) });
      for (let i = 0; i < 5; i++) for (const arm of ["baseline", "candidate"] as const) {
        let id: string, bucket: number;
        do { id = `production-${serial++}`; bucket = parseInt(sha(JSON.stringify([release.id, id])).slice(0, 8), 16) % 100; }
        while (arm === "candidate" ? bucket >= 5 : bucket < 5 || bucket >= 10);
        const receipt = await engine.select(production(id));
        expect(receipt.rollout?.arm).toBe(arm);
        const [assignment] = await ctx.db.$client.unsafe("SELECT created_at,deadline_at::text FROM agentos_model_intelligence.routing_rollout_assignments WHERE namespace=$1 AND receipt_id=$2", [namespace, id]);
        expect(Number(assignment.deadline_at)).toBe(Date.parse(assignment.created_at) + limits.observationTimeoutMs + 1);
        expect(await engine.nextRoutingDeadline()).toBe(Number(assignment.deadline_at));
        await engine.recordRoutingOutcome({ namespace, id, receiptId: id, outcome: "passed", iterations: 1, latencyMs: arm === "baseline" ? 1000 : 400,
          observedVariant: receipt.candidate.variant!, source: "checks", evaluator: "fixture-reviewer", evidenceRef: `fixture:${id}` });
      }
      expect((await engine.routingRollouts({ namespace, taskType })).releases[0].state).toBe("adopted");
      expect(await engine.nextRoutingDeadline()).toBeNull();
      const next = await engine.select(production("expired-fixture")); expect(next.rollout?.assignmentId).toBe(next.id);
      await ctx.db.$client.unsafe("UPDATE agentos_model_intelligence.routing_rollout_assignments SET deadline_at=1 WHERE namespace=$1 AND receipt_id=$2", [namespace, next.id]);
      expect(await engine.reconcileRoutingDeadlines()).toBe(1);
      expect((await engine.routingRollouts({ namespace, taskType })).releases[0].state).toBe("rolled_back");
      expect(await engine.nextRoutingDeadline()).toBeNull();
    } finally { await engine.close(); }
  });
  it("bounds verification payloads by bytes when rows contain large text values", async () => {
    const source = await fixture(), db = new DatabaseSync(source.path);
    db.prepare("UPDATE policy_events SET reason=?").run("x".repeat(2 * 1024 * 1024)); db.close();
    source.manifest = await inspectModelIntelligenceBackup(source.path);
    const sizes: number[] = [], underlying = client();
    const measured: ModelMigrationConnection = {
      unsafe: (text, parameters) => underlying.unsafe(text, parameters),
      begin: work => underlying.begin(tx => work({ async unsafe(text, parameters) {
        const rows = await tx.unsafe(text, parameters);
        if (text.includes("AS __sequence") && !text.includes(" AS bytes")) {
          sizes.push(rows.reduce((total, row) => total + Object.values(row).reduce<number>((bytes, value) => bytes + (value === null ? 0 : Buffer.byteLength(String(value))), 0), 0));
        }
        return rows;
      } })),
    };
    const target = createPostgresMigrationTarget(measured, { destinationId: randomUUID() }); await target.initialize();
    expect((await importModelIntelligenceBackup(source.path, source.manifest, target)).rows).toBe(5);
    expect(sizes.filter(size => size > 0).length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
