// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFridayUpdates } from "./useFridayUpdates";
const events = vi.hoisted(() => ({ listener: (_event: any) => {} }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (callback: typeof events.listener) => { events.listener = callback; } }));

describe("Friday event-driven refresh", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  function Listener() { useFridayUpdates("company"); return null; }
  beforeEach(async () => { vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false); host = document.createElement("div"); root = createRoot(host); client = new QueryClient(); await act(async () => root.render(<QueryClientProvider client={client}><Listener /></QueryClientProvider>)); });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });
  it("coalesces live events, ignores other companies, and does no idle polling", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    events.listener({ companyId: "other", type: "activity.logged" });
    await vi.advanceTimersByTimeAsync(60000); expect(invalidate).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) events.listener({ companyId: "company", type: "activity.logged" });
    await vi.advanceTimersByTimeAsync(1000); expect(invalidate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000); expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it("defers hidden-tab changes until visibility returns and cancels pending work on unmount", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    events.listener({ companyId: "company", type: "heartbeat.run.status" });
    await vi.advanceTimersByTimeAsync(1000); expect(invalidate).not.toHaveBeenCalled();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange")); expect(invalidate).toHaveBeenCalledTimes(2);
    events.listener({ companyId: "company", type: "activity.logged" });
    await act(async () => root.render(null)); await vi.advanceTimersByTimeAsync(2000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
