// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAiCapacity } from "./AdminAiCapacity";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("@/api/client", () => ({ requestResponse: mocks.read, api: { post: mocks.save } }));
vi.mock("@/api/response", () => ({ readApiJson: async (value: unknown) => value }));
const binding = { companyId: "d8c1bc81-9ee1-4814-94d7-d70e99e24a17", connectionId: "bde3dff4-0d58-4292-9801-f3c01fc08f65", grantId: "241013cd-e3ca-4af6-8d01-5645a90fe069" };
const group = { id: "bb482215-7882-48ec-8fab-1a0a935d7cdc", revision: 2, name: "Owner seat", provider: "openai", maxConcurrent: 2, interactiveReserved: 1, interactivePriority: true, waitWarningMs: 60_000, active: 1, waiting: 2, overdue: 1, bindings: [binding] };
const fixture = { groups: [group], connections: [{ ...binding, companyName: "Example", connectionName: "Codex", provider: "openai", groupId: group.id }] };

describe("administrator AI capacity", () => {
  let root: Root, host: HTMLDivElement, client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks(); mocks.read.mockResolvedValue(fixture); mocks.save.mockResolvedValue({ id: group.id, revision: 3 });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><AdminAiCapacity userId="owner" /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  async function click(label: string) { const button = [...host.querySelectorAll("button")].find(node => node.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); }
  it("explains real active, waiting and overdue counts without treating them as provider entitlement", async () => {
    await render();
    expect(host.textContent).toContain("1 active · 2 waiting · Limit 2");
    expect(host.textContent).toContain("uncertain running work keeps its slot");
    expect(host.textContent).toContain("does not increase the provider’s quota");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("saves explicit bindings and the revision and can cancel an edit", async () => {
    await render(); await click("Edit group"); await click("Cancel");
    expect(host.querySelector("form")).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
    await click("Edit group"); await click("Save capacity group");
    expect(mocks.save).toHaveBeenCalledWith("/instance/ai-execution-capacity", { id: group.id, expectedRevision: 2,
      policy: { name: "Owner seat", provider: "openai", maxConcurrent: 2, interactiveReserved: 1, interactivePriority: true, waitWarningMs: 60_000 }, bindings: [binding] });
  });
  it("does not choose or activate a starting limit on behalf of the owner", async () => {
    mocks.read.mockResolvedValue({ groups: [], connections: [] });
    await render(); await click("Create capacity group");
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value)).toEqual(["", "", ""]);
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.disabled ?? [...host.querySelectorAll("button")].find(node => node.textContent === "Save capacity group")?.disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("shows backend/access failures without rendering cached groups", async () => {
    await render(); await click("Edit group");
    expect(host.textContent).toContain("Owner seat");
    expect(host.querySelector("form")).not.toBeNull();
    mocks.read.mockRejectedValue(new Error("Instance admin access required"));
    await act(async () => { await client.refetchQueries(); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Instance admin access required");
    expect(host.textContent).not.toContain("Owner seat");
    expect(host.textContent).not.toContain("Example · Codex");
    expect(host.querySelector("form")).toBeNull();
  });
});
