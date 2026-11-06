// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IssueDocument } from "@paperclipai/shared";
import { FridaySavedDisplay } from "./FridaySavedDisplay";
import type { FridayDisplayScope } from "@/lib/friday-saved-display";
import { fridayKey } from "@/api/friday";

const api = vi.hoisted(() => ({ work: vi.fn(), getDocument: vi.fn() }));
vi.mock("@/api/issues", () => ({ issuesApi: { getDocument: api.getDocument } }));
vi.mock("@/api/friday", () => ({ fridayKey: (id: string) => ["friday", id], fridayApi: { work: api.work } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "00000000-0000-4000-8000-000000000001", projectId = "00000000-0000-4000-8000-000000000002";
const descriptor = { version: 1, kind: "table", title: "Launch table", source: "tasks", companyId, projectId, status: "active", limit: 2 };
const saved = { issueId: "conversation", companyId: "source", key: "friday-display-launch", latestRevisionId: "revision-1", body: JSON.stringify(descriptor) } as IssueDocument;
const scope: FridayDisplayScope = { issueId: "conversation", sourceCompanyId: "source", accessibleCompanyIds: [companyId], companyId, projectId };
const work = (title = "Prepare launch") => ({ observedAt: "2026-11-03T12:00:00Z", projects: [{ id: projectId, name: "Spring launch", status: "in_progress" }],
  tasks: [{ id: "task", title, identifier: "APP-1", projectId, status: "todo", priority: "high" }, { id: "wrong", title: "Other project secret", projectId: companyId, status: "todo", priority: "low" }], nextOffset: null, nextProjectOffset: null });
let root: Root, host: HTMLDivElement, client: QueryClient;
const navigate = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); api.getDocument.mockResolvedValue(saved); api.work.mockResolvedValue(work());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
async function render(document: IssueDocument | null = saved, selectedScope = scope) {
  await act(async () => root.render(<QueryClientProvider client={client}>{document && <FridaySavedDisplay document={document} scope={selectedScope} companyNames={{ [companyId]: "Launch Co" }} navigate={navigate} />}</QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function settled(text: string) { await vi.waitFor(() => expect(host.textContent).toContain(text)); }
it("reads scoped current data with company/project/time labels and native task navigation", async () => {
  await render(); await settled("Prepare launch");
  expect(api.work).toHaveBeenCalledWith(companyId, { projectId, status: "active", limit: 2, offset: 0, projectOffset: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal), cache: "no-store" }));
  expect(host.textContent).toContain("Launch Co · Spring launch"); expect(host.textContent).toContain("Observed");
  expect(host.textContent).not.toContain("Other project secret");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Open task")!.click());
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ companyId, projectId, taskId: "task", panel: "work" }));
});
it.each(["list", "board"])("renders the registered %s with scoped current records and hides it after access loss", async kind => {
  const document = { ...saved, body: JSON.stringify({ ...descriptor, kind }) };
  api.getDocument.mockResolvedValue(document);
  await render(document); await settled("Prepare launch");
  expect(host.textContent).not.toContain("Other project secret");
  expect(host.querySelector("table")).toBeNull();
  const record = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Prepare launch"))!;
  await act(async () => record.click());
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ companyId, projectId, taskId: "task" }));
  api.work.mockRejectedValue(new Error("Access denied"));
  await act(async () => { await client.invalidateQueries({ queryKey: fridayKey(companyId) }); });
  await settled("Current data unavailable: Access denied");
  expect(host.textContent).not.toContain("Prepare launch");
});
it("refetches on reopen despite a fresh cache and never shows cached rows after access failure", async () => {
  await render(); await settled("Prepare launch"); await render(null);
  api.work.mockResolvedValue(work("Launch shipped"));
  await render(); await settled("Launch shipped");
  expect(api.getDocument).toHaveBeenCalledTimes(2); expect(api.work).toHaveBeenCalledTimes(2);
  api.work.mockRejectedValue(new Error("Access denied"));
  await act(async () => { await client.invalidateQueries({ queryKey: fridayKey(companyId) }); });
  await settled("Current data unavailable: Access denied");
  expect(host.textContent).not.toContain("Launch shipped"); expect(host.querySelector("table")).toBeNull();
});
it("rejects mismatched cached and freshly revised document scopes before requesting work", async () => {
  await render({ ...saved, companyId: "other-source" });
  expect(api.getDocument).not.toHaveBeenCalled(); expect(api.work).not.toHaveBeenCalled();
  api.getDocument.mockResolvedValue({ ...saved, body: JSON.stringify({ ...descriptor, projectId: companyId }) });
  await render(); await settled("not available in this workspace"); expect(api.work).not.toHaveBeenCalled();
});
it("reauthorizes the document on reopen and hides the old table when document access is lost", async () => {
  await render(); await settled("Prepare launch"); await render(null);
  api.getDocument.mockRejectedValue(new Error("Document unavailable"));
  await render(); await settled("Saved display unavailable");
  expect(host.textContent).not.toContain("Prepare launch"); expect(api.work).toHaveBeenCalledTimes(1);
});
it("retries a failed definition read and uses its freshly authorized revision before loading data", async () => {
  api.getDocument.mockRejectedValueOnce(new Error("Temporary connection failure"));
  await render(); await settled("Saved display unavailable");
  expect(api.work).not.toHaveBeenCalled();
  const revised = { ...saved, latestRevisionId: "revision-2", body: JSON.stringify({ ...descriptor, kind: "list", status: "completed" }) };
  api.getDocument.mockResolvedValue(revised); api.work.mockResolvedValue(work("Completed after refresh"));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Retry saved display")!.click());
  await settled("Completed after refresh");
  expect(api.getDocument).toHaveBeenCalledTimes(2);
  expect(api.work).toHaveBeenCalledWith(companyId, expect.objectContaining({ status: "completed" }), expect.objectContaining({ cache: "no-store" }));
  expect(host.querySelector("table")).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("pages project tables within the chosen company without skipping a native page", async () => {
  const document = { ...saved, body: JSON.stringify({ ...descriptor, source: "projects", status: "all", projectId: undefined }) };
  api.getDocument.mockResolvedValue(document);
  api.work.mockResolvedValue({ ...work(), projects: [1, 2, 3].map(id => ({ id: String(id), name: `Project ${id}`, status: "planned" })) });
  await render(document, { ...scope, projectId: undefined }); await settled("Project 2");
  expect(host.textContent).not.toContain("Project 3");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Next page")!.click());
  expect(api.work).toHaveBeenLastCalledWith(companyId, expect.objectContaining({ projectOffset: 2, offset: 0, limit: 1 }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it.each(["document", "work"])("aborts an unfinished %s read on Stop and starts fresh on Resume", async phase => {
  let signal!: AbortSignal;
  let finish!: (value: unknown) => void;
  const pending = (_first: unknown, _second: unknown, options: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    signal = options.signal; finish = resolve;
    signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
  });
  if (phase === "document") api.getDocument.mockImplementationOnce(pending);
  else api.work.mockImplementationOnce(pending);
  await render(); await vi.waitFor(() => expect(signal).toBeDefined());
  expect(signal.aborted).toBe(false);
  await render(null); expect(signal.aborted).toBe(true);
  api.getDocument.mockResolvedValue(saved); api.work.mockResolvedValue(work("Fresh after resume"));
  await render(); await settled("Fresh after resume");
  finish(phase === "document" ? { ...saved, body: JSON.stringify({ ...descriptor, companyId: projectId }) } : work("Pre-stop result"));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.textContent).not.toContain("Pre-stop result");
  expect(api.getDocument).toHaveBeenCalledTimes(2);
  expect(api.work).toHaveBeenCalledTimes(phase === "work" ? 2 : 1);
});
