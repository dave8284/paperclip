import { describe, expect, it } from "vitest";
import type { DurableRecoveryCommittedEvent, DurableRecoveryIdentity } from "../contracts/durable-recovery.js";
import { providerThreadContextReceipt, providerTurnInputReceipt } from "../contracts/provider-context-receipt.js";
import { acceptedRunnerTurnInputReceipt } from "./runner-provider-context.js";

const identity: DurableRecoveryIdentity = { runId: "run-1", runnerInstanceId: "runner-1", environmentLeaseId: "lease-1",
  normalizedSessionId: "session-1", turnId: "invocation-1", itemId: "item-1" };
const receipt = { schema: "paperclip.provider-context-receipt.v1", stage: "turn_accepted", source: "turn/start",
  parametersSha256: "a".repeat(64), promptSha256: "b".repeat(64), modelEnvelopeSha256: "c".repeat(64) };
const event = (): DurableRecoveryCommittedEvent => ({ eventType: "turn.accepted", sourceSeq: 4, sourceEventId: "event-4",
  priority: 0, deliveryCount: 1, logicalEffectCount: 1, envelope: { ...identity, payload: {
    runId: identity.runId, normalizedSessionId: identity.normalizedSessionId, sourceInstanceId: identity.runnerInstanceId,
    eventType: "turn.accepted", sourceSeq: 4, sourceEventId: "event-4", payload: { providerTurnId: "provider-turn-1", providerSessionId: "provider-session-1", inputReceipt: receipt },
  } } });

describe("accepted native provider receipt projection", () => {
  it("forwards only the exact accepted turn's content-free receipt", () => {
    const row = event();
    const payload = (row.envelope.payload as Record<string, unknown>).payload as Record<string, unknown>;
    payload.inputReceipt = { ...receipt, prompt: "PRIVATE SOURCE", accessToken: "SECRET" };
    const projected = acceptedRunnerTurnInputReceipt([row], identity, "provider-turn-1", "provider-session-1");
    expect(projected).toEqual(receipt);
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE SOURCE|SECRET/);
  });
  it.each(Object.keys(identity))("does not reuse another %s authority", key => {
    const row = event(); row.envelope[key] = "another-authority";
    expect(acceptedRunnerTurnInputReceipt([row], identity, "provider-turn-1", "provider-session-1")).toBeUndefined();
  });
  it.each(["runId", "normalizedSessionId", "sourceInstanceId", "sourceEventId", "sourceSeq", "eventType"])(
    "rejects a mismatched native event %s", key => {
      const row = event(); (row.envelope.payload as Record<string, unknown>)[key] = "changed";
      expect(acceptedRunnerTurnInputReceipt([row], identity, "provider-turn-1", "provider-session-1")).toBeUndefined();
    });
  it("leaves missing, stale and duplicate acceptance unknown", () => {
    expect(acceptedRunnerTurnInputReceipt([event()], identity, "provider-turn-1", "another-session")).toBeUndefined();
    expect(acceptedRunnerTurnInputReceipt([], identity, "provider-turn-1", "provider-session-1")).toBeUndefined();
    expect(acceptedRunnerTurnInputReceipt([event()], identity, "previous-turn", "provider-session-1")).toBeUndefined();
    expect(acceptedRunnerTurnInputReceipt([event(), event()], identity, "provider-turn-1", "provider-session-1")).toBeUndefined();
  });
  it.each([undefined, null, { ...receipt, stage: "server_prepared" }, { ...receipt, promptSha256: "not-a-digest" },
    { ...receipt, modelEnvelopeSha256: "private text" }])("leaves absent or invalid receipts unknown (%j)", value => {
    expect(providerTurnInputReceipt(value)).toBeUndefined();
  });
  it("preserves an explicitly unmeasured model envelope without inventing its hash", () => {
    expect(providerTurnInputReceipt({ ...receipt, modelEnvelopeSha256: null })).toEqual({ ...receipt, modelEnvelopeSha256: null });
  });
  it("whitelists thread receipt fields and retains accepted source", () => {
    const thread = { schema: receipt.schema, source: "thread/resume", stage: "thread_accepted",
      parametersSha256: receipt.parametersSha256, instructionsSha256: receipt.promptSha256 };
    expect(providerThreadContextReceipt({ ...thread, instructions: "PRIVATE" })).toEqual(thread);
    expect(providerThreadContextReceipt({ ...thread, source: "thread/start_requested" })).toBeUndefined();
  });
});
