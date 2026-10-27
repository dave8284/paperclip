// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AgentOSDelete } from "./AgentOSDelete";
const api = vi.hoisted(() => ({ company: vi.fn(), project: vi.fn(), task: vi.fn(), archiveCompany: vi.fn(), archiveProject: vi.fn() }));
vi.mock("@/api/companies", () => ({ companiesApi: { remove: api.company, archive: api.archiveCompany } }));
vi.mock("@/api/projects", () => ({ projectsApi: { remove: api.project, update: api.archiveProject } }));
vi.mock("@/api/issues", () => ({ issuesApi: { remove: api.task } }));
describe("Agent OS record deletion", () => {
  let root: Root, host: HTMLDivElement, client: QueryClient;
  const removed = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); api.company.mockResolvedValue({ ok: true }); api.project.mockResolvedValue({ id: "record" }); api.task.mockResolvedValue({ id: "record" }); api.archiveCompany.mockResolvedValue({}); api.archiveProject.mockResolvedValue({}); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!; expect(button).toBeDefined(); await act(async () => button.click()); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
  async function open(kind: "company" | "project" | "task") { await act(async () => root.render(<QueryClientProvider client={client}><AgentOSDelete kind={kind} id="record" companyId="company" name="Launch" onRemoved={removed} /></QueryClientProvider>)); await click(`Delete ${kind}`); }
  async function confirm() { const field = document.querySelector<HTMLInputElement>('input[aria-label="Confirm name to delete"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Launch"); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
  it.each(["company", "project", "task"] as const)("requires an explicit name confirmation before deleting a %s", async kind => {
    await open(kind); expect(api[kind]).not.toHaveBeenCalled();
    const deleteButton = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(b => b.textContent === `Delete ${kind}`)!;
    expect(deleteButton.disabled).toBe(true); await confirm(); expect(deleteButton.disabled).toBe(false);
    await act(async () => deleteButton.click()); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(api[kind]).toHaveBeenCalledWith("record", ...(kind === "project" ? ["company"] : [])); expect(removed).toHaveBeenCalledOnce();
  });
  it("keeps a rejected deletion visible and offers the native archive path", async () => {
    api.project.mockRejectedValue(new Error("Retained workspaces prevent deletion."));
    await open("project"); await confirm();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Delete project")!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(dialog.textContent).toContain("Retained workspaces prevent deletion."); expect(removed).not.toHaveBeenCalled();
    await click("Archive instead"); expect(api.archiveProject).toHaveBeenCalledWith("record", { archivedAt: expect.any(String) }, "company"); expect(removed).toHaveBeenCalledOnce();
  });
  it("cancels without changing any company record", async () => { await open("company"); await click("Cancel"); expect(api.company).not.toHaveBeenCalled(); expect(api.archiveCompany).not.toHaveBeenCalled(); expect(removed).not.toHaveBeenCalled(); });
});
