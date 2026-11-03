// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FridayWorkBlockers } from "./FridayWorkBlockers";
const list = vi.hoisted(() => vi.fn());
vi.mock("../api/attention", () => ({ attentionApi: { list } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
describe("work blockers without invented decisions", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const onTask = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
  async function render(projectId = "project") {
    await act(async () => root.render(<QueryClientProvider client={client}><FridayWorkBlockers companyId="company" projectId={projectId} onTask={onTask} /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  it("loads scoped work counts and opens the actual task, without approval/discussion controls", async () => {
    list.mockResolvedValue({ items: [{ id: "attention", subject: { kind: "issue", id: "task", title: "Restore failed worker" }, whyNow: "Missing credentials" }], totalCount: 12, nextCursor: "next" });
    await render();
    expect(list).toHaveBeenCalledWith("company", expect.objectContaining({ category: "work", projectId: "project", limit: 10 }));
    expect(host.textContent).toContain("12 work items in this project");
    expect(host.textContent).not.toMatch(/Disapprove|Discuss with Friday/);
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "View task")!.click());
    expect(onTask).toHaveBeenCalledWith("task");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "More work items")!.click());
    expect(list).toHaveBeenLastCalledWith("company", expect.objectContaining({ category: "work", projectId: "project", cursor: "next" }));
  });
  it("does not add an empty blocker panel to a quiet project", async () => {
    list.mockResolvedValue({ items: [], totalCount: 0, nextCursor: null }); await render();
    expect(host.querySelector("section")).toBeNull();
  });
});
