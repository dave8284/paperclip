// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_ROUTING_LIMITS, type ModelRoutingDiscovery } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { modelRoutingKey } from "@/api/model-routing";
import { ModelRoutingControls } from "./ModelRoutingControls";
const mocks = vi.hoisted(() => ({ discover: vi.fn(), configure: vi.fn(), rollback: vi.fn() }));
vi.mock("@/api/model-routing", async original => ({ ...await original<typeof import("@/api/model-routing")>(), modelRoutingApi: mocks }));
function data(): ModelRoutingDiscovery { return { enabled: true, families: [{ id: "operations.support", name: "Support", policy: null,
  releases: [], events: [] }] }; }
beforeEach(() => { vi.resetAllMocks(); mocks.discover.mockResolvedValue(data()); mocks.configure.mockResolvedValue({ revision: 1, mode: "automatic" }); mocks.rollback.mockResolvedValue({ state: "rolled_back" }); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function fixture() {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = async (companyId = "company", userId = "owner") => {
    await act(async () => root.render(<QueryClientProvider client={client}><ModelRoutingControls companyId={companyId} userId={userId} /></QueryClientProvider>)); await settle();
  };
  await render();
  return { host, client, render, close: async () => { await act(async () => root.unmount()); client.clear(); host.remove(); } };
}
async function choose(host: Element, name: string, value: string) {
  const field = host.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
  await act(async () => { field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function click(host: Element, name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === name)!;
  expect(button).toBeTruthy(); await act(async () => button.click()); await settle();
}
it("keeps an empty company on its baseline and saves explicit family enrollment with bounded limits", async () => {
  const f = await fixture();
  try {
    expect(mocks.configure).not.toHaveBeenCalled();
    await choose(f.host, "Routing task family", "operations.support");
    expect(f.host.textContent).toContain("No routing release has qualified");
    expect(f.host.querySelector<HTMLOptionElement>('option[value="pinned"]')!.disabled).toBe(true);
    await choose(f.host, "Routing policy", "automatic"); await click(f.host, "Save routing policy");
    expect(mocks.configure).toHaveBeenCalledExactlyOnceWith("company", expect.objectContaining({ taskType: "operations.support", expectedRevision: 0,
      mode: "automatic", pinnedReleaseId: null, limits: DEFAULT_MODEL_ROUTING_LIMITS, requestKey: expect.any(String) }));
    expect(mocks.rollback).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
it("retains one request identity when a committed policy response is lost", async () => {
  mocks.configure.mockRejectedValueOnce(new Error("Response lost"));
  const f = await fixture();
  try {
    await choose(f.host, "Routing task family", "operations.support"); await choose(f.host, "Routing policy", "automatic");
    await click(f.host, "Save routing policy"); expect(f.host.textContent).toContain("Response lost");
    const first = mocks.configure.mock.calls[0][1];
    await click(f.host, "Save routing policy"); expect(mocks.configure.mock.calls[1][1]).toEqual(first);
  } finally { await f.close(); }
});
it("hides cached policy and release details after a revoked refresh or a rejected write", async () => {
  const result = data(); result.families[0].releases.push({ id: "release", version: 1, state: "adopted", baselineModel: "private baseline", candidateModel: "private candidate", createdAt: new Date().toISOString() });
  mocks.discover.mockResolvedValue(result);
  const f = await fixture();
  try {
    await choose(f.host, "Routing task family", "operations.support"); expect(f.host.textContent).toContain("private candidate");
    mocks.discover.mockRejectedValue(new ApiError("Revoked", 403, null));
    await act(async () => { await f.client.invalidateQueries({ queryKey: modelRoutingKey("company", "owner") }); }); await settle();
    expect(f.host.textContent).not.toContain("private candidate"); expect(f.host.querySelector('select[aria-label="Routing policy"]')).toBeNull();
    mocks.discover.mockResolvedValue(result); await click(f.host, "Retry routing policies"); await choose(f.host, "Routing task family", "operations.support");
    mocks.configure.mockRejectedValue(new ApiError("Revoked", 403, null)); await click(f.host, "Save routing policy");
    expect(f.host.textContent).not.toContain("private candidate"); expect(f.host.querySelector('select[aria-label="Routing policy"]')).toBeNull();
  } finally { await f.close(); }
});
it("pins only adopted versions, retains rollback identity on retry, and clears drafts on company/account switch", async () => {
  const result = data(); result.families[0].policy = { revision: 3, mode: "automatic", pinnedReleaseId: null, limits: DEFAULT_MODEL_ROUTING_LIMITS, authorityCurrent: true };
  result.families[0].releases = [{ id: "adopted", version: 1, state: "adopted", baselineModel: "strong", candidateModel: "fast", createdAt: new Date().toISOString() },
    { id: "canary", version: 2, state: "canary", baselineModel: "fast", candidateModel: "faster", createdAt: new Date().toISOString() }];
  mocks.discover.mockResolvedValue(result); mocks.rollback.mockRejectedValueOnce(new Error("Response lost"));
  const f = await fixture();
  try {
    await choose(f.host, "Routing task family", "operations.support"); await choose(f.host, "Routing policy", "pinned");
    const versions = f.host.querySelector<HTMLSelectElement>('select[aria-label="Pinned routing version"]')!;
    expect([...versions.options].map(item => item.value)).toEqual(["adopted"]);
    await click(f.host, "Save routing policy"); expect(mocks.configure.mock.calls[0][1]).toMatchObject({ expectedRevision: 3, mode: "pinned", pinnedReleaseId: "adopted" });
    await click(f.host, "Roll back version 2"); const first = mocks.rollback.mock.calls[0][1];
    await click(f.host, "Roll back version 2"); expect(mocks.rollback.mock.calls[1][1]).toEqual(first);
    await f.render("other-company", "other-owner"); expect(f.host.querySelector('select[aria-label="Routing policy"]')).toBeNull();
    expect(mocks.discover.mock.calls.at(-1)![0]).toBe("other-company");
  } finally { await f.close(); }
});
