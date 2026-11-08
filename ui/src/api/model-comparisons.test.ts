// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { modelComparisonsApi } from "./model-comparisons";

afterEach(() => vi.unstubAllGlobals());
it("separates overlapping account reads and sends no-store abortable requests", async () => {
  let first!: (response: Response) => void, second!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { second = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const oldController = new AbortController(), currentController = new AbortController();
  const old = modelComparisonsApi.discover("company", oldController.signal), current = modelComparisonsApi.discover("company", currentController.signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]).toEqual(["/api/companies/company/friday/model-comparisons", expect.objectContaining({ cache: "no-store", signal: oldController.signal })]);
  expect(fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store", signal: currentController.signal });
  second(Response.json({ enabled: true, comparisons: [] })); expect((await current).comparisons).toEqual([]);
  first(Response.json({ enabled: true, comparisons: [{ id: "previous-account-only" }] })); expect((await old).comparisons[0].id).toBe("previous-account-only");
});
it("submits only the selected native assignment through the existing company owner", async () => {
  const input = { requestKey: "saved-key", comparisonId: "comparison", caseId: "case", issueId: "task", arm: "candidate" as const };
  const fetch = vi.fn().mockResolvedValue(Response.json({ created: true })); vi.stubGlobal("fetch", fetch);
  await modelComparisonsApi.prepare("company", input);
  expect(fetch).toHaveBeenCalledWith("/api/companies/company/friday/model-comparisons/prepare", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
});
