// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { agentosModelsApi } from "./agentos-models";

afterEach(() => vi.unstubAllGlobals());

it("does not coalesce account-sensitive qualification reads across a session change", async () => {
  let first!: (response: Response) => void, second!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { second = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const oldController = new AbortController(), currentController = new AbortController();
  const oldRead = agentosModelsApi.qualifications("company", oldController.signal);
  const currentRead = agentosModelsApi.qualifications("company", currentController.signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]).toEqual(["/api/companies/company/friday/model-qualifications", expect.objectContaining({ cache: "no-store", signal: oldController.signal })]);
  expect(fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store", signal: currentController.signal });
  second(Response.json({ qualifications: [], availableEvidence: [], limit: 100, evidenceLimit: 20 }));
  expect((await currentRead).qualifications).toEqual([]);
  first(Response.json({ qualifications: [{ id: "previous-account-only" }], availableEvidence: [], limit: 100, evidenceLimit: 20 }));
  expect((await oldRead).qualifications[0].id).toBe("previous-account-only");
});
