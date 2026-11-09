// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeRunTranscripts } from "./useNativeRunTranscripts";
import { TRANSCRIPT_REQUEST_TIMEOUT_MS } from "./read-transcript-request";

const eventsMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/heartbeats", () => ({
  heartbeatsApi: { events: eventsMock },
}));

function Probe() {
  const { errorsByRun } = useNativeRunTranscripts([
    { id: "native-run", status: "succeeded", runtimeMode: "native" },
  ]);
  return (
    <div data-testid="errors">
      {[...errorsByRun.keys()].join(",")}
    </div>
  );
}

function MultiRunProbe() {
  useNativeRunTranscripts([
    { id: "failed-run", status: "succeeded", runtimeMode: "native" },
    { id: "healthy-run", status: "succeeded", runtimeMode: "native" },
  ]);
  return null;
}

describe("useNativeRunTranscripts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    eventsMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("exposes event transport failures and retries terminal runs until recovery", async () => {
    eventsMock
      .mockRejectedValueOnce(new Error("event endpoint unavailable"))
      .mockResolvedValue([]);

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("native-run");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(eventsMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("");
  });

  it("retries only terminal runs whose event request failed", async () => {
    eventsMock.mockImplementation((runId: string) => (
      runId === "failed-run"
        ? Promise.reject(new Error("event endpoint unavailable"))
        : Promise.resolve([])
    ));

    await act(async () => {
      root.render(<MultiRunProbe />);
      await Promise.resolve();
    });
    expect(eventsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(eventsMock).toHaveBeenCalledTimes(3);
    expect(eventsMock.mock.calls.at(-1)?.[0]).toBe("failed-run");
  });
});

// Initial readiness is separate from an empty transcript: the task shell must
// not reveal empty history while the first durable page is still in flight.
describe("native history readiness and stable projection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useNativeRunTranscripts>;
  function StateProbe({ runs = [{ id: "one", status: "running", runtimeMode: "native" as const }], companyId = "company" }) {
    latest = useNativeRunTranscripts(runs, companyId);
    return null;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    eventsMock.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("bounds paginated historical reads to two while live reads and event hints stay immediate", async () => {
    const pending = new Map<string, (rows: unknown[]) => void>();
    eventsMock.mockImplementation((id: string) => new Promise(resolve => { pending.set(id, resolve); }));
    const history = ["old-1", "old-2", "old-3", "old-4"].map(id => ({ id, status: "succeeded", runtimeMode: "native" as const }));
    const current = { id: "current", status: "running", runtimeMode: "native" as const };
    await act(async () => { root.render(<StateProbe runs={[...history, current]} />); });
    expect(eventsMock.mock.calls.map(([id]) => id)).toEqual(["current", "old-1", "old-2"]);
    await act(async () => {
      pending.get("current")!([{ seq: 1, payload: {}, eventType: "log" }]);
      pending.get("old-1")!(Array.from({ length: 1_000 }, (_, index) => ({ seq: index + 1, payload: {}, eventType: "log" })));
    });
    expect(latest.hydratedRunIds.has("current")).toBe(true);
    expect(latest.hydratedRunIds.has("old-1")).toBe(false);
    expect(eventsMock.mock.calls.map(([id]) => id)).toEqual(["current", "old-1", "old-2", "old-1"]);
    expect(eventsMock.mock.calls.at(-1)?.[1]).toBe(1_000);
    await act(async () => { latest.notifyRunEvent("current", 2); await vi.advanceTimersByTimeAsync(100); });
    expect(eventsMock.mock.calls.at(-1)?.[0]).toBe("current");
    await act(async () => { pending.get("old-2")!([]); });
    expect(eventsMock.mock.calls.at(-1)?.[0]).toBe("old-3");
    expect(eventsMock.mock.calls.some(([id]) => id === "old-4")).toBe(false);
    await act(async () => { pending.get("old-1")!([]); });
    expect(eventsMock.mock.calls.at(-1)?.[0]).toBe("old-4");
    expect(latest.terminalHydratedRunIds.has("old-1")).toBe(true);
  });

  it("keeps a newly settled live turn ahead of stalled history through terminal hydration", async () => {
    let finishCurrent!: (rows: unknown[]) => void;
    eventsMock.mockImplementation((id: string) => id === "current" ? Promise.resolve([]) : new Promise(() => {}));
    const history = ["old-1", "old-2", "old-3"].map(id => ({ id, status: "succeeded", runtimeMode: "native" as const }));
    const current = { id: "current", status: "running", runtimeMode: "native" as const };
    await act(async () => { root.render(<StateProbe runs={[...history, current]} />); });
    eventsMock.mockImplementation((id: string) => new Promise(resolve => { if (id === "current") finishCurrent = resolve; }));
    const callsBeforeSettle = eventsMock.mock.calls.length;
    await act(async () => { root.render(<StateProbe runs={[...history, { ...current, status: "succeeded" }]} />); });
    expect(eventsMock.mock.calls.slice(callsBeforeSettle).map(([id]) => id)).toEqual(["current", "old-1", "old-2"]);
    expect(latest.terminalHydratedRunIds.has("current")).toBe(false);
    await act(async () => { finishCurrent([]); });
    expect(latest.terminalHydratedRunIds.has("current")).toBe(true);
    expect(latest.hydratedRunIds.has("old-1")).toBe(false);
    expect(eventsMock.mock.calls.some(([id]) => id === "old-3")).toBe(false);
  });

  it("releases a failed history slot and queues its retry without delaying healthy runs", async () => {
    const pending = new Map<string, { resolve: (rows: unknown[]) => void; reject: (error: Error) => void }>();
    eventsMock.mockImplementation((id: string) => new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); }));
    const runs = ["failed", "old-2", "old-3", "old-4"].map(id => ({ id, status: "succeeded", runtimeMode: "native" as const }));
    await act(async () => { root.render(<StateProbe runs={runs} />); });
    await act(async () => { pending.get("failed")!.reject(new Error("offline")); });
    expect(eventsMock.mock.calls.map(([id]) => id)).toEqual(["failed", "old-2", "old-3"]);
    expect(latest.errorsByRun.has("failed")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(eventsMock).toHaveBeenCalledTimes(3);
    await act(async () => { pending.get("old-2")!.resolve([]); });
    expect(eventsMock.mock.calls.at(-1)?.[0]).toBe("old-4");
    await act(async () => { pending.get("old-3")!.resolve([]); });
    expect(eventsMock.mock.calls.at(-1)?.[0]).toBe("failed");
    await act(async () => { pending.get("failed")!.resolve([]); });
    expect(latest.errorsByRun.has("failed")).toBe(false);
    expect(latest.terminalHydratedRunIds.has("failed")).toBe(true);
    expect(latest.terminalHydratedRunIds.has("old-2")).toBe(true);
  });

  it("aborts active history and discards queued work on scope change and unmount", async () => {
    const finish: Array<(rows: unknown[]) => void> = [];
    eventsMock.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const runs = ["old-1", "old-2", "old-3"].map(id => ({ id, status: "succeeded", runtimeMode: "native" as const }));
    await act(async () => { root.render(<StateProbe runs={runs} />); });
    const oldSignals = eventsMock.mock.calls.map(([, , , options]) => options.signal as AbortSignal);
    await act(async () => { root.render(<StateProbe companyId="other-company" runs={[{ id: "new", status: "running", runtimeMode: "native" }]} />); });
    expect(oldSignals.every(signal => signal.aborted)).toBe(true);
    expect(eventsMock.mock.calls.map(([id]) => id)).toEqual(["old-1", "old-2", "new"]);
    await act(async () => { finish[0]([]); finish[1]([]); });
    expect(latest.hydratedRunIds.size).toBe(0);
    expect(eventsMock).toHaveBeenCalledTimes(3);
    const newSignal = eventsMock.mock.calls[2][3].signal as AbortSignal;
    await act(async () => { root.unmount(); finish[2]([]); await vi.advanceTimersByTimeAsync(20_000); });
    expect(newSignal.aborted).toBe(true);
    expect(eventsMock).toHaveBeenCalledTimes(3);
    root = createRoot(container);
  });

  it("coalesces authorized live event hints without waiting for polling or overlapping reads", async () => {
    eventsMock.mockResolvedValue([]);
    await act(async () => { root.render(<StateProbe />); });
    const emit = (runId: string, seq: number) => latest.notifyRunEvent(runId, seq);
    await act(async () => {
      emit("foreign-run", 1);
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(eventsMock).toHaveBeenCalledTimes(1);
    let finish!: (rows: unknown[]) => void;
    eventsMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => {
      for (let seq = 1; seq <= 20; seq++) emit("one", seq);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(eventsMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      for (let seq = 21; seq <= 40; seq++) emit("one", seq);
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(eventsMock).toHaveBeenCalledTimes(2);
    await act(async () => { finish([{ seq: 40, payload: {}, eventType: "log" }]); await vi.advanceTimersByTimeAsync(0); });
    expect(eventsMock).toHaveBeenCalledTimes(3);
    await act(async () => { emit("one", 39); await vi.advanceTimersByTimeAsync(100); });
    expect(eventsMock).toHaveBeenCalledTimes(3);
    await act(async () => { root.unmount(); emit("one", 41); await vi.advanceTimersByTimeAsync(3000); });
    expect(eventsMock).toHaveBeenCalledTimes(3);
    root = createRoot(container);
  });

  it("distinguishes pending, loaded-empty and failed, and supports explicit retry", async () => {
    let resolve!: (rows: never[]) => void;
    eventsMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => { root.render(<StateProbe />); });
    expect(latest.isInitialHydrating).toBe(true);
    await act(async () => { resolve([]); });
    expect(latest.isInitialHydrating).toBe(false);
    expect(latest.hydratedRunIds.has("one")).toBe(true);
    eventsMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(latest.errorsByRun.has("one")).toBe(true);
    expect(latest.isInitialHydrating).toBe(false);
    eventsMock.mockResolvedValue([]);
    await act(async () => { latest.retry(); });
    expect(latest.errorsByRun.size).toBe(0);
  });

  it("does not rebuild unchanged history on empty polls", async () => {
    eventsMock.mockResolvedValueOnce([{ seq: 1, payload: {}, eventType: "log" }]).mockResolvedValue([]);
    await act(async () => { root.render(<StateProbe />); });
    const projection = latest.transcriptByRun;
    const rows = projection.get("one");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(latest.transcriptByRun).toBe(projection);
    expect(latest.transcriptByRun.get("one")).toBe(rows);
  });

  it("waits for every page of a successful terminal refresh before allowing a fallback", async () => {
    eventsMock.mockResolvedValueOnce([{ seq: 1, payload: {}, eventType: "log" }]);
    await act(async () => { root.render(<StateProbe />); });
    expect(latest.terminalHydratedRunIds.has("one")).toBe(false);

    let resolvePage!: (rows: unknown[]) => void;
    eventsMock.mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
    await act(async () => { root.render(<StateProbe runs={[{ id: "one", status: "succeeded", runtimeMode: "native" }]} />); });
    expect(latest.terminalHydratedRunIds.has("one")).toBe(false);

    let resolveLastPage!: (rows: unknown[]) => void;
    eventsMock.mockImplementationOnce(() => new Promise(resolve => { resolveLastPage = resolve; }));
    await act(async () => {
      resolvePage(Array.from({ length: 1_000 }, (_, index) => ({ seq: index + 2, payload: {}, eventType: "log" })));
    });
    expect(latest.terminalHydratedRunIds.has("one")).toBe(false);
    expect(eventsMock.mock.calls.at(-1)?.[1]).toBe(1_001);
    await act(async () => { resolveLastPage([]); });
    expect(latest.terminalHydratedRunIds.has("one")).toBe(true);
  });

  it("keeps the fallback pending after a failed terminal refresh until retry succeeds", async () => {
    eventsMock.mockResolvedValueOnce([]);
    await act(async () => { root.render(<StateProbe />); });
    eventsMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { root.render(<StateProbe runs={[{ id: "one", status: "succeeded", runtimeMode: "native" }]} />); });
    expect(latest.terminalHydratedRunIds.has("one")).toBe(false);
    eventsMock.mockResolvedValueOnce([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(latest.terminalHydratedRunIds.has("one")).toBe(true);
  });

  it("times out stalled history, aborts its request, and ignores a late response before retry", async () => {
    let resolveLate!: (rows: never[]) => void;
    eventsMock.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve; }));
    await act(async () => { root.render(<StateProbe />); });
    const signal = eventsMock.mock.calls[0][3].signal as AbortSignal;
    expect(latest.isInitialHydrating).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSCRIPT_REQUEST_TIMEOUT_MS); });
    expect(signal.aborted).toBe(true);
    expect(latest.isInitialHydrating).toBe(false);
    expect(latest.errorsByRun.get("one")?.message).toContain("too long");
    await act(async () => { resolveLate([]); });
    expect(latest.errorsByRun.has("one")).toBe(true);
    eventsMock.mockResolvedValue([]);
    await act(async () => { latest.retry(); });
    expect(latest.errorsByRun.size).toBe(0);
    expect(eventsMock.mock.calls[1][3].signal.aborted).toBe(false);
  });

  it("commits a resolved run independently of a stalled sibling and retains its cursor", async () => {
    const rows = [{ seq: 7, payload: {}, eventType: "log" }];
    eventsMock.mockImplementation((id) => id === "slow" ? new Promise(() => {}) : Promise.resolve(rows));
    const one = { id: "one", status: "succeeded", runtimeMode: "native" as const };
    await act(async () => { root.render(<StateProbe runs={[one, { ...one, id: "slow" }]} />); });
    expect(latest.hydratedRunIds.has("one")).toBe(true);
    expect(latest.hydratedRunIds.has("slow")).toBe(false);
    expect(latest.transcriptByRun.has("one")).toBe(true);
    await act(async () => { root.render(<StateProbe runs={[one]} />); });
    expect(eventsMock.mock.calls.filter(([id]) => id === "one").map(([, cursor]) => cursor)).toEqual([0, 7]);
    expect(latest.isInitialHydrating).toBe(false);
  });
});
