import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import * as controlPlane from "../control-plane/durable-prp-control-plane.js";
import type { PrpEvent } from "../protocol/replay-contract.js";
import { createRunnerdCodexTransport, defaultCapabilityRunnerdBinary } from "./runnerd-codex-transport.js";

// Enter the real transport construction path, but stop before registration or
// process launch. This checks its actual shared cold/resume commit callback;
// authentication, socket delivery and PostgreSQL remain separate boundaries.
it("awaits original native evidence before other commits and preserves replay after a rejected write", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "runner-native-evidence-")));
  const stop = new Error("fixture_before_registration");
  let captured: ConstructorParameters<typeof controlPlane.DurablePrpControlPlane>[0] | undefined;
  const spy = vi.spyOn(controlPlane, "DurablePrpControlPlane").mockImplementation(function(options: ConstructorParameters<typeof controlPlane.DurablePrpControlPlane>[0]) {
    captured = options;
    throw stop;
  } as unknown as typeof controlPlane.DurablePrpControlPlane);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let rejectFirst = true;
  const evidence = vi.fn(async (_event: PrpEvent) => { await gate; if (rejectFirst) { rejectFirst = false; throw new Error("fixture_commit_uncertain"); } });
  const credentials = vi.fn(async (_event: PrpEvent) => undefined);
  const bundle = createRunnerdCodexTransport({ stateDirectory: root, runnerBinary: defaultCapabilityRunnerdBinary(),
    onAuthenticatedEvent: evidence, onCredentialsUpdated: credentials,
  });
  try {
    await expect(bundle.transport.request("thread/start", { cwd: root, dynamicTools: [] })).rejects.toBe(stop);
    expect(captured?.onCommittedEvent).toBeTypeOf("function");
    const event: PrpEvent = { schema: "paperclip.prp.event.v1", schemaVersion: 1, sourceKind: "runner",
      sourceInstanceId: "runner-fixture", sourceEventId: "event-1", sourceSeq: 1, runId: "run-fixture", normalizedSessionId: "session-fixture",
      eventType: "auth.credentials.updated", emittedAt: new Date().toISOString(), priority: 0, payload: { revision: 1 } };
    let settled = false;
    const first = captured!.onCommittedEvent!(event).finally(() => { settled = true; });
    const rejected = expect(first).rejects.toThrow("fixture_commit_uncertain");
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(credentials).not.toHaveBeenCalled();
    release();
    await rejected;
    expect(credentials).not.toHaveBeenCalled();
    await captured!.onCommittedEvent!(event);
    expect(evidence).toHaveBeenNthCalledWith(1, event);
    expect(evidence).toHaveBeenNthCalledWith(2, event);
    expect(credentials).toHaveBeenCalledExactlyOnceWith(event);
    await captured!.onCommittedEvent!({ ...event, sourceSeq: 2, sourceEventId: "event-2", eventType: "item.delta", payload: { text: "fixture body" } });
    expect(evidence).toHaveBeenCalledTimes(3); // Irrelevant sequence positions are not filtered out.
    expect(credentials).toHaveBeenCalledTimes(1);
  } finally {
    release(); spy.mockRestore(); await bundle.transport.close(); await rm(root, { recursive: true, force: true });
  }
});
