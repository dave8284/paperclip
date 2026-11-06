// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOSRoutines } from "./AgentOSRoutines";
const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), createTrigger: vi.fn(), run: vi.fn(), update: vi.fn(), updateTrigger: vi.fn(), listRevisions: vi.fn() }));
const taskList = vi.hoisted(() => vi.fn());
vi.mock("@/api/routines", () => ({ routinesApi: api }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: taskList } }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: () => Promise.resolve([{ id: "campaign", name: "Launch campaign" }, { id: "other-project", name: "Other project" }]) } }));
vi.mock("@/lib/router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const routine = { id: "loop", companyId: "company", projectId: "campaign", title: "Campaign feedback", description: "Measure results and propose improvements", assigneeAgentId: "lead", status: "paused", concurrencyPolicy: "coalesce_if_active", latestRevisionId: "revision-1", updatedAt: "2026-11-04", triggers: [], recentRuns: [] };
const agents = [{ id: "lead", name: "Marketing lead", status: "idle" } as never];

describe("operating loop actions", () => {
  let client: QueryClient, host: HTMLDivElement, root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    taskList.mockResolvedValue([{ id: "objective", identifier: "APP-1", title: "Launch objective" }]);
    api.list.mockResolvedValue([]); api.get.mockResolvedValue(routine); api.create.mockResolvedValue(routine);
    api.createTrigger.mockResolvedValue({}); api.update.mockResolvedValue(routine); api.updateTrigger.mockResolvedValue({}); api.listRevisions.mockResolvedValue([]);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function render(projectId = "campaign") {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSRoutines companyId="company" projectId={projectId} agents={agents} onAsk={vi.fn()} /></QueryClientProvider>));
    await settle();
  }
  async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
  async function click(text: string) {
    const button = [...document.querySelectorAll("button")].find(button => button.textContent === text);
    expect(button).toBeDefined(); await act(async () => { button!.focus(); button!.click(); }); await settle();
  }
  async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    await act(async () => { const prototype = element.tagName === "INPUT" ? HTMLInputElement.prototype : element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
  }
  async function fillCreation() {
    await click("Create loop");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"] input'));
    await change(document.querySelector('[role="dialog"] input')!, "Campaign feedback");
    await change(document.querySelector('[role="dialog"] textarea')!, "Measure results, propose an improved version, request publication approval.");
    await change(document.querySelector('select[required]')!, "lead");
  }
  it("opens a focused form and saves a scoped paused loop by clicking its submit button", async () => {
    await render(); expect(api.list).toHaveBeenCalledWith("company", { projectId: "campaign" });
    await fillCreation();
    await change(document.querySelectorAll('[role="dialog"] select')[2] as HTMLSelectElement, "0 9 * * *");
    await click("Save loop");
    expect(api.create).toHaveBeenCalledExactlyOnceWith("company", expect.objectContaining({ projectId: "campaign", title: "Campaign feedback", assigneeAgentId: "lead", status: "paused", concurrencyPolicy: "coalesce_if_active" }));
    expect(api.createTrigger).toHaveBeenCalledWith("loop", expect.objectContaining({ kind: "schedule", cronExpression: "0 9 * * *", enabled: true }));
    expect(api.run).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("shows trigger failures in the dialog and retries the existing draft without duplicating it", async () => {
    api.createTrigger.mockRejectedValueOnce(new Error("Schedule unavailable"));
    await render(); await fillCreation();
    await change(document.querySelectorAll('[role="dialog"] select')[2] as HTMLSelectElement, "0 9 * * *");
    await click("Save loop");
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("Schedule unavailable");
    await click("Finish trigger setup");
    expect(api.create).toHaveBeenCalledOnce(); expect(api.createTrigger).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("opens Edit loop above the workflow, saves through native revision control and closes", async () => {
    api.list.mockResolvedValue([routine]); await render();
    await act(async () => (host.querySelector('.agentos-loop-card') as HTMLButtonElement).click()); await settle();
    await click("Edit loop");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull(); expect(document.activeElement).toBe(dialog.querySelector('input'));
    await change(dialog.querySelector('input')!, "Updated feedback");
    await click("Save revision");
    expect(api.update).toHaveBeenCalledWith("loop", expect.objectContaining({ title: "Updated feedback", baseRevisionId: "revision-1" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(api.run).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("Edit loop");
  });
  it("keeps revision conflicts visible and preserves unsaved edits", async () => {
    api.list.mockResolvedValue([routine]); api.update.mockRejectedValueOnce(new Error("Routine changed; refresh before saving")); await render();
    await act(async () => (host.querySelector('.agentos-loop-card') as HTMLButtonElement).click()); await settle(); await click("Edit loop");
    await change(document.querySelector('[role="dialog"] input')!, "Keep this draft"); await click("Save revision");
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Routine changed");
    expect((document.querySelector('[role="dialog"] input') as HTMLInputElement).value).toBe("Keep this draft");
  });
  it("saves project and parent-objective links through the same revision without running a cycle", async () => {
    api.list.mockResolvedValue([routine]); await render();
    await act(async () => (host.querySelector('.agentos-loop-card') as HTMLButtonElement).click()); await settle(); await click("Edit loop");
    await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    const labeledSelect = (label: string) => [...dialog.querySelectorAll("label")].find(node => node.textContent?.startsWith(label))!.querySelector("select")!;
    await change(labeledSelect("Project"), "other-project");
    await change(labeledSelect("Parent objective"), "objective");
    await click("Save revision");
    expect(api.update).toHaveBeenCalledWith("loop", expect.objectContaining({ projectId: "other-project", parentIssueId: "objective", baseRevisionId: "revision-1" }));
    expect(api.run).not.toHaveBeenCalled();
  });
  it("resets draft scope when navigation reuses the panel for another project", async () => {
    await render(); await fillCreation(); await render("other-project");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); await fillCreation(); await click("Save loop");
    expect(api.create).toHaveBeenCalledWith("company", expect.objectContaining({ projectId: "other-project" }));
  });
});
