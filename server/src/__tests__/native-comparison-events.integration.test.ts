import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRunEvents, heartbeatRuns, issues, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { nativeComparisonEventSink } from "../services/native-runtime/native-comparison-events.js";
import { nativeComparisonContextEvidence, nativeComparisonContextReceipt } from "../services/native-runtime/native-comparison-context.js";
import { NATIVE_COMPARISON_EVENT, NATIVE_COMPARISON_SOURCE, MAX_COMPARISON_EVENTS } from "../services/native-runtime/native-comparison-event-projection.js";
import { readModelComparisonEvents, comparisonWorkIterations } from "../services/model-comparison-measurements.js";
import { modelComparisonTaskScope } from "../services/model-comparison-scope.js";
import type { NativeModelComparisonBinding } from "../services/model-comparison-admission.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { validatePrpEvent, type NativeExecutionInput, type PrpEvent } from "../vendor/paperclip-runner/index.js";

// Real native rows/leases, projection SQL and concurrent transactions. These
// server-owned fixture bindings are not enrollment, provider or quality proof.
describe("native comparison journal persistence", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("native-comparison-journal-"); db = createDb(database.connectionString); }, 60_000);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  async function fixture() {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID(), runnerId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Journal fixture", issuePrefix: `J${companyId.slice(0, 5)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Fixture author", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Fixture work", status: "in_progress" });
    const task = { identifier: "J-1", title: "Classify", description: "PRIVATE SOURCE BODY", prompt: "PRIVATE PROMPT", workMode: "standard" as const };
    const execution: NativeExecutionInput = { schema: "paperclip.native-execution-input.v1",
      binding: { runId, companyId, agentId, issueId, executionWorkspaceId: randomUUID() }, task,
      workspace: { cwd: "/private/fixture", repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: randomUUID(), driverKind: "codex_app_server", protocolVersion: 1, lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "codex", model: "fixture" }, interactionResponses: [], credentialBindings: [],
      completionContract: { id: randomUUID(), sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "fixture", objective: "Classify", criteria: [{ id: "objective", requirement: "Classify" }] } },
    };
    const binding = { schema: "agentos.native-model-comparison.v1", companyId, runId,
      assignment: { ...modelComparisonTaskScope(task), comparisonId: randomUUID(), caseId: "case", arm: "baseline" } } as NativeModelComparisonBinding;
    const [run] = await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, issueId, nativeIssueId: issueId,
      runtimeMode: "native", status: "running", nativeSessionId: execution.session.normalizedSessionId, runnerInstanceId: runnerId }).returning();
    binding.contextReceipt = nativeComparisonContextReceipt(run, execution, binding);
    run.runnerProfileJson = { nativeModelComparison: binding, nativeExecutionInput: execution };
    await db.update(heartbeatRuns).set({ runnerProfileJson: run.runnerProfileJson }).where(eq(heartbeatRuns.id, runId));
    const authority = { leaseOwner: randomUUID(), attempt: 1, controller: { bootId: randomUUID(), pid: 12345, processStartedAt: new Date() }, assertActive() {} };
    await db.insert(nativeRunFinalizations).values({ runId, companyId, issueId, phase: "observed", attempt: authority.attempt,
      leaseOwner: authority.leaseOwner, leaseExpiresAt: new Date(Date.now() + 60_000), controllerBootId: authority.controller.bootId,
      controllerPid: authority.controller.pid, controllerProcessStartedAt: authority.controller.processStartedAt });
    const args = { execution, runnerInstanceId: runnerId, binding, authority };
    const event = (sourceSeq: number, eventType: PrpEvent["eventType"], payload: Record<string, unknown> = {}): PrpEvent => ({
      schema: "paperclip.prp.event.v1", schemaVersion: 1, sourceKind: "runner", sourceInstanceId: runnerId,
      sourceEventId: `event-${runId}-${sourceSeq}`, sourceSeq, runId, normalizedSessionId: execution.session.normalizedSessionId!,
      turnId: `turn-${runId}`, itemId: `item-${runId}`, priority: 0, emittedAt: new Date().toISOString(), eventType, payload,
    });
    const sink = nativeComparisonEventSink(db, args)!;
    const rows = () => db.select().from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, runId), eq(heartbeatRunEvents.eventType, NATIVE_COMPARISON_EVENT))).orderBy(heartbeatRunEvents.seq);
    return { args, run, event, sink, rows };
  }

  it("preserves original chronology/digests, separates facade rows and excludes private bodies", async () => {
    const f = await fixture(), receipt = f.args.binding.contextReceipt!;
    const events = [
      f.event(1, "session.started", { privateInstructions: "PRIVATE INSTRUCTIONS", providerDescriptor: { observedCodexIdentity: { contextReceipt: {
        schema: "paperclip.provider-context-receipt.v1", stage: "thread_accepted", source: "thread/start", parametersSha256: "b".repeat(64), instructionsSha256: "c".repeat(64),
      } } } }),
      f.event(2, "turn.accepted", { providerTurnId: "provider-turn", inputReceipt: { schema: "paperclip.provider-context-receipt.v1",
        stage: "turn_accepted", source: "turn/start", parametersSha256: "d".repeat(64), promptSha256: "e".repeat(64), modelEnvelopeSha256: receipt.initialEnvelopeSha256 } }),
      f.event(3, "turn.started", { providerTurnId: "provider-turn" }),
      f.event(4, "turn.completed", { providerTurnId: "provider-turn" }),
      f.event(5, "run.terminal", { schema: "paperclip.prp.terminal.v1", turnTerminalState: "completed", runTerminalState: "succeeded", reportedWorkDisposition: "done" }),
    ];
    // Same source instance/sequence in the facade is a different stream.
    await db.insert(heartbeatRunEvents).values({ companyId: f.run.companyId, runId: f.run.id, agentId: f.run.agentId,
      seq: 1, eventType: "session.started", sourceInstanceId: f.args.runnerInstanceId, sourceEventId: "facade-1", sourceSeq: 1,
      sourcePayloadSha256: "f".repeat(64), protocolSchemaVersion: 3, payload: { prpEvent: { privateBody: "PRIVATE FACADE" } } });
    await db.update(heartbeatRuns).set({ nextEventSeq: 2 }).where(eq(heartbeatRuns.id, f.run.id));
    for (const event of events) { expect(validatePrpEvent(event).ok).toBe(true); await f.sink(event); }
    const stored = await f.rows();
    expect(stored.map(row => row.sourcePayloadSha256)).toEqual(events.map(nativeSha256));
    expect(stored.every(row => row.sourceInstanceId === `${NATIVE_COMPARISON_SOURCE}${f.args.runnerInstanceId}`)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("PRIVATE");
    const projected = await readModelComparisonEvents(db, f.run);
    expect(projected).toHaveLength(5);
    expect(projected.map(row => row.sourceEventId)).toEqual(events.map(row => row.sourceEventId));
    const completed = { ...f.run, status: "succeeded" };
    expect(comparisonWorkIterations(completed, projected)).toBe(1);
    expect(nativeComparisonContextEvidence(completed, f.args.binding, projected)).toMatchObject({ stage: "partial", initialInputMatched: true });
  });

  it("deduplicates concurrent and commit-before-ACK replay, and rejects changed bytes", async () => {
    const f = await fixture(), event = f.event(1, "session.started");
    await Promise.all([f.sink(event), f.sink(structuredClone(event))]);
    let uncertain = true;
    const uncertainDb = new Proxy(db, { get(target, key) {
      if (key === "transaction") return async (body: Parameters<Db["transaction"]>[0]) => {
        const result = await target.transaction(body); if (uncertain) { uncertain = false; throw new Error("fixture_ack_lost_after_commit"); } return result;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const sink = nativeComparisonEventSink(uncertainDb, f.args)!, next = f.event(2, "turn.accepted");
    await expect(sink(next)).rejects.toThrow("fixture_ack_lost_after_commit");
    await sink(next);
    expect(await f.rows()).toHaveLength(2);
    // The existing selection outbox may finish its acknowledgement later;
    // this allowed null → exact run receipt does not change frozen admission.
    const acknowledged = structuredClone(f.run.runnerProfileJson!);
    (acknowledged.nativeModelComparison as NativeModelComparisonBinding).receiptId = f.run.id;
    await db.update(heartbeatRuns).set({ runnerProfileJson: acknowledged }).where(eq(heartbeatRuns.id, f.run.id));
    await sink(next);
    await expect(f.sink({ ...event, payload: { changed: true } })).rejects.toThrow("native_event_replay_conflict");
    // An exact retained final ACK may be acknowledged after the lease ends.
    await db.update(nativeRunFinalizations).set({ leaseOwner: null, leaseExpiresAt: null }).where(eq(nativeRunFinalizations.runId, f.run.id));
    await f.sink(next);
    await expect(f.sink(f.event(3, "turn.started"))).rejects.toThrow("native_comparison_event_authority_lost");
    expect(await f.rows()).toHaveLength(2);
  });

  it.each(["lease", "attempt", "controller", "input", "binding"] as const)("denies a changed %s before persistence", async fault => {
    const f = await fixture();
    if (fault === "lease") await db.update(nativeRunFinalizations).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeRunFinalizations.runId, f.run.id));
    if (fault === "attempt") await db.update(nativeRunFinalizations).set({ attempt: 2 }).where(eq(nativeRunFinalizations.runId, f.run.id));
    if (fault === "controller") await db.update(nativeRunFinalizations).set({ controllerBootId: randomUUID() }).where(eq(nativeRunFinalizations.runId, f.run.id));
    if (fault === "input" || fault === "binding") {
      const profile = structuredClone(f.run.runnerProfileJson!);
      if (fault === "input") (profile.nativeExecutionInput as NativeExecutionInput).task.prompt += " changed";
      else (profile.nativeModelComparison as NativeModelComparisonBinding).assignment.caseId = "changed";
      await db.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, f.run.id));
    }
    await expect(f.sink(f.event(1, "session.started"))).rejects.toThrow(/native_comparison_event_(authority_lost|binding_changed)/);
    expect(await f.rows()).toHaveLength(0);
  });

  it("retains missing-prefix and over-limit witnesses without fabricating full history", async () => {
    const f = await fixture();
    await f.sink(f.event(10, "session.resumed"));
    await expect(f.sink(f.event(12, "turn.started"))).rejects.toThrow("native_comparison_event_source_gap");
    expect(comparisonWorkIterations(f.run, await readModelComparisonEvents(db, f.run))).toBeNull();
    const overflow = await fixture();
    await overflow.sink(overflow.event(MAX_COMPARISON_EVENTS + 1, "session.started"));
    await overflow.sink(overflow.event(MAX_COMPARISON_EVENTS + 2, "turn.started"));
    const terminal = overflow.event(MAX_COMPARISON_EVENTS + 3, "run.terminal", { schema: "paperclip.prp.terminal.v1", turnTerminalState: "completed", runTerminalState: "succeeded", reportedWorkDisposition: "done" });
    await overflow.sink(terminal);
    await db.update(nativeRunFinalizations).set({ leaseOwner: null, leaseExpiresAt: null }).where(eq(nativeRunFinalizations.runId, overflow.run.id));
    await overflow.sink(terminal); // Lost ACK after the durable cap; no evidence claim or insert.
    expect(await overflow.rows()).toHaveLength(1);
    expect((await overflow.rows())[0].payload).toMatchObject({ event: null });
    expect(comparisonWorkIterations(overflow.run, await readModelComparisonEvents(db, overflow.run))).toBeNull();
  });

  it("rolls back the allocated event when controller authority is withdrawn before insert", async () => {
    const f = await fixture(); let assertions = 0;
    f.args.authority.assertActive = () => { if (++assertions === 2) throw new Error("fixture_controller_detached"); };
    await expect(f.sink(f.event(1, "session.started"))).rejects.toThrow("fixture_controller_detached");
    expect(await f.rows()).toHaveLength(0);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(run.nextEventSeq).toBe(f.run.nextEventSeq);
  });
});
