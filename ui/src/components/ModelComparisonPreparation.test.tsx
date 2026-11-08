// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModelComparisonDiscovery } from "@paperclipai/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { modelComparisonsKey } from "../api/model-comparisons";
import { ModelComparisonPreparation } from "./ModelComparisonPreparation";

const mocks = vi.hoisted(() => ({ access: vi.fn(), discover: vi.fn(), prepare: vi.fn(), userId: "owner" as string | null }));
vi.mock("../api/model-comparisons", async importOriginal => ({ ...await importOriginal<typeof import("../api/model-comparisons")>(), modelComparisonsApi: mocks }));
vi.mock("../lib/router", () => ({ Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const inventory = (): ModelComparisonDiscovery => ({ enabled: true, comparisons: [{ id: "comparison", dimension: "model", datasetId: "dataset", datasetVersion: "Version 1", taskFamily: "Coding", baseline: { model: "baseline-model", reasoningEffort: "medium" }, candidate: { model: "candidate-model", reasoningEffort: "medium" }, cases: [{ id: "case", split: "holdout", label: "Saved table acceptance", tasks: [{ issueId: "task", identifier: "WORK-1", title: "Private backlog table", agentId: "employee", agentName: "Alex", arms: ["baseline", "candidate"] }] }] }] });
beforeEach(() => {
  vi.clearAllMocks(); mocks.userId = "owner";
  mocks.access.mockImplementation(async () => ({ userId: mocks.userId, source: "session", isInstanceAdmin: true, companyIds: ["company", "other-company"] }));
  mocks.discover.mockResolvedValue(inventory());
  mocks.prepare.mockResolvedValue({ created: true, companyId: "company", task: { id: "task", identifier: "WORK-1", title: "Private backlog table", status: "backlog" }, assignment: { documentId: "document", revisionId: "revision" } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
async function render(companyId = "company", userId: string | null = "owner") { mocks.userId = userId; await act(async () => root.render(<QueryClientProvider client={client}><ModelComparisonPreparation companyId={companyId} userId={userId} /></QueryClientProvider>)); await settle(); await settle(); }
const button = (name: string) => [...host.querySelectorAll("button")].find(button => button.textContent === name)!;
async function click(name: string) { await act(async () => button(name).click()); await settle(); }
async function choose(label: string, value: string) { await act(async () => { const field = host.querySelector(`[aria-label="${label}"]`)! as HTMLSelectElement; field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); }); await settle(); }
async function fill() { await choose("Saved comparison", "comparison"); await choose("Saved case", "case"); await choose("Backlog task and employee", "task"); await choose("Comparison arm", "candidate"); }

it("prepares only a native selected task and arm, without accepting hashes, scores, or automatically starting work", async () => {
  await render(); await fill();
  expect(host.textContent).toContain("Saved table acceptance"); expect(host.textContent).toContain("WORK-1 · Private backlog table · Alex");
  expect(host.querySelectorAll("input,textarea")).toHaveLength(0); expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Prepare backlog task");
  expect(mocks.prepare).toHaveBeenCalledWith("company", { requestKey: expect.any(String), comparisonId: "comparison", caseId: "case", issueId: "task", arm: "candidate" });
  expect(host.textContent).toContain("Comparison assignment saved"); expect(host.querySelector('a[href="/issues/WORK-1"]')).not.toBeNull();
});
it("preserves selections and request identity through an ambiguous response and failed access refresh", async () => {
  mocks.prepare.mockRejectedValueOnce(new Error("Response lost after commit"));
  await render(); await fill(); await click("Prepare backlog task"); const submitted = mocks.prepare.mock.calls[0][1];
  mocks.discover.mockRejectedValueOnce(new Error("Current access unavailable")); await click("Refresh comparisons");
  expect(host.querySelector("form")).toBeNull(); expect(host.textContent).not.toContain("Private backlog table");
  await click("Check comparison access again");
  expect((host.querySelector('[aria-label="Backlog task and employee"]') as HTMLSelectElement).value).toBe("task");
  expect((host.querySelector('[aria-label="Comparison arm"]') as HTMLSelectElement).value).toBe("candidate");
  await click("Prepare backlog task"); expect(mocks.prepare.mock.calls[1][1]).toEqual(submitted);
});
it("allocates a different request identity when the owner changes the selected arm", async () => {
  mocks.prepare.mockRejectedValue(new Error("Response unavailable"));
  await render(); await fill(); await click("Prepare backlog task"); const submitted = mocks.prepare.mock.calls[0][1];
  await choose("Comparison arm", "baseline"); await click("Prepare backlog task");
  expect(mocks.prepare.mock.calls[1][1]).toMatchObject({ arm: "baseline" }); expect(mocks.prepare.mock.calls[1][1].requestKey).not.toBe(submitted.requestKey);
});
it("hides private cached choices and success receipts after authority is lost", async () => {
  await render(); await fill(); await click("Prepare backlog task");
  mocks.discover.mockRejectedValue(new ApiError("Access revoked", 403, {})); await click("Refresh comparisons");
  expect(host.textContent).not.toContain("Private backlog table"); expect(host.querySelector("a")).toBeNull(); expect(host.querySelector("select")).toBeNull();
});
it("withholds mutation controls after a denied preparation until a fresh native discovery succeeds", async () => {
  mocks.prepare.mockRejectedValueOnce(new ApiError("Task permission changed", 403, {}));
  await render(); await fill(); await click("Prepare backlog task");
  expect(host.querySelector("select")).toBeNull(); expect(host.textContent).not.toContain("Private backlog table");
  await click("Check comparison access again"); expect(button("Prepare backlog task").disabled).toBe(false);
  await click("Prepare backlog task"); expect(mocks.prepare.mock.calls[1][1]).toEqual(mocks.prepare.mock.calls[0][1]);
});
it("discards selections and receipts on account or company changes, never reuses the old account query", async () => {
  await render(); await fill();
  mocks.discover.mockResolvedValue({ enabled: true, comparisons: [] });
  await render("company", "another-owner"); expect(host.querySelector("select")).toBeNull(); expect(host.textContent).not.toContain("Private backlog table");
  expect(client.getQueryData(modelComparisonsKey("company", "another-owner"))).toEqual({ enabled: true, comparisons: [] });
  await render("other-company", "another-owner"); expect(host.querySelector("select")).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled();
});
it("disables preparation if the chosen task or arm is no longer in current native choices", async () => {
  await render(); await fill(); const refreshed = inventory(); refreshed.comparisons[0].cases[0].tasks[0].arms = ["baseline"];
  mocks.discover.mockResolvedValue(refreshed); await click("Refresh comparisons");
  expect(button("Prepare backlog task").disabled).toBe(true); expect(mocks.prepare).not.toHaveBeenCalled();
});
it.each([false, true])("shows the %s configured empty state without inventing eligible work", async enabled => {
  mocks.discover.mockResolvedValue({ enabled, comparisons: [] }); await render();
  expect(host.textContent).toContain(enabled ? "No saved comparisons" : "not configured"); expect(host.querySelector("form")).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled();
});
it.each([null, "owner"])("withholds discovery and preparation in the local trusted context (%s)", async userId => {
  mocks.access.mockResolvedValue({ userId: "owner", source: "local_implicit", isInstanceAdmin: true, companyIds: ["company"] });
  await render("company", userId);
  expect(host.textContent).toContain("signed-in, approved instance administrator");
  if (userId) expect(host.textContent).toContain("local trusted context cannot prepare comparisons");
  expect(host.querySelector("button,select,form")).toBeNull(); expect(mocks.discover).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});
it("hides cached choices if current administrator access fails, then restores the same draft after a fresh check", async () => {
  await render(); await fill(); mocks.access.mockRejectedValueOnce(new Error("Account access lookup failed")); await click("Refresh comparisons");
  expect(host.textContent).not.toContain("Private backlog table"); expect(host.querySelector("select")).toBeNull();
  await click("Check comparison access again");
  expect((host.querySelector('[aria-label="Backlog task and employee"]') as HTMLSelectElement).value).toBe("task");
  expect(button("Prepare backlog task").disabled).toBe(false);
});
