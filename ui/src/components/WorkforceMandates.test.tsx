// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentosWorkforce, PortfolioReadMandate } from "@paperclipai/shared";
import { WorkforceMandates } from "./WorkforceMandates";

const mocks = vi.hoisted(() => ({ mandates: vi.fn(), saveMandate: vi.fn(), revokeMandate: vi.fn(), agents: vi.fn() }));
vi.mock("../api/workforce", () => ({ workforceApi: mocks, workforceKeys: { account: (id: string) => ["workforce", id], detail: (id: string, portfolio: string) => ["workforce", id, portfolio] } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: mocks.agents } }));
vi.mock("../api/client", () => ({ detachInflightGet: vi.fn() }));
const workforce = { portfolio: { id: "portfolio" }, canManage: true, assignments: [{ agentId: "agent", agentName: "Friday" }], companies: [
  { id: "source", name: "Home company", canManage: true }, { id: "target", name: "Second venture", canManage: true },
] } as AgentosWorkforce;
const mandate: PortfolioReadMandate = { id: "mandate", portfolioId: "portfolio", revision: 4, sourceCompanyId: "source", sourceAgentId: "agent",
  targetCompanyIds: ["target"], action: "portfolio_work:read", readScope: "company_shared_only", expiresAt: null, revokedAt: null, updatedAt: new Date().toISOString() };

describe("explicit portfolio read controls", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks(); mocks.mandates.mockResolvedValue([]); mocks.agents.mockResolvedValue([{ id: "agent", name: "Friday", status: "idle", lifecycleState: "ready" }]);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  const button = (text: string) => Array.from(host.querySelectorAll("button")).find(row => row.textContent === text)!;
  async function click(text: string) { await act(async () => button(text).click()); }
  async function render(data = workforce) { await act(async () => root.render(<QueryClientProvider client={client}><WorkforceMandates userId="owner" workforce={data} /></QueryClientProvider>)); }
  async function open(data = workforce) { await render(data); await click("Portfolio read access"); await vi.waitFor(() => expect(mocks.mandates).toHaveBeenCalled()); }
  async function select(index: number, value: string) { await act(async () => { const input = host.querySelectorAll("select")[index]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("change", { bubbles: true })); }); }
  it("starts closed and requires explicit shared-work scope and expiry; retries the same creation intent", async () => {
    mocks.saveMandate.mockRejectedValue(new Error("Delivery unknown"));
    await render(); expect(mocks.mandates).not.toHaveBeenCalled();
    await click("Portfolio read access"); await vi.waitFor(() => expect(button("Grant portfolio read access")).toBeDefined());
    await click("Grant portfolio read access");
    expect(host.querySelectorAll("select")[2].value).toBe(""); expect(host.querySelectorAll("select")[3].value).toBe("");
    expect(button("Save explicit read grant").disabled).toBe(true);
    await select(0, "source"); await vi.waitFor(() => expect(host.querySelectorAll("select")[1].textContent).toContain("Friday"));
    await select(1, "agent");
    await act(async () => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
    await select(2, "company_shared_only"); await select(3, "none");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(host.textContent).toContain("Delivery unknown"));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(mocks.saveMandate).toHaveBeenCalledTimes(2));
    expect(mocks.saveMandate.mock.calls[0]).toEqual(mocks.saveMandate.mock.calls[1]);
    expect(mocks.saveMandate.mock.calls[0][1]).toMatchObject({ expectedRevision: 0, sourceCompanyId: "source", sourceAgentId: "agent", targetCompanyIds: ["target"], readScope: "company_shared_only", action: "portfolio_work:read", expiresAt: null });
  });
  it("revises an existing mandate without changing its delegate and revokes the shown revision", async () => {
    mocks.mandates.mockResolvedValue([mandate]); mocks.revokeMandate.mockResolvedValue({ ...mandate, revokedAt: new Date().toISOString() });
    await open(); await vi.waitFor(() => expect(button("Edit access")).toBeDefined()); await click("Edit access");
    expect(host.querySelectorAll("select")[0].disabled).toBe(true); expect(host.querySelectorAll("select")[1].disabled).toBe(true);
    await click("Cancel"); await click("Revoke access");
    expect(mocks.revokeMandate).toHaveBeenCalledWith("portfolio", "mandate", 4);
  });
  it("hides retained mandate details and controls after a denied refetch", async () => {
    mocks.mandates.mockResolvedValue([mandate]); await open(); await vi.waitFor(() => expect(host.textContent).toContain("Second venture"));
    mocks.mandates.mockRejectedValue(new Error("Portfolio access revoked"));
    await act(async () => { await client.invalidateQueries(); });
    await vi.waitFor(() => expect(host.textContent).toContain("Portfolio access revoked"));
    expect(host.textContent).not.toContain("Second venture"); expect(button("Grant portfolio read access")).toBeUndefined();
  });
  it("keeps read-only portfolio owners out of grant, edit and revoke controls", async () => {
    mocks.mandates.mockResolvedValue([mandate]); await open({ ...workforce, canManage: false }); await vi.waitFor(() => expect(host.textContent).toContain("Second venture"));
    expect(button("Grant portfolio read access")).toBeUndefined(); expect(button("Edit access")).toBeUndefined(); expect(button("Revoke access")).toBeUndefined();
  });
  it("shows the authorized current agent name without requiring a shared workforce assignment", async () => {
    mocks.mandates.mockResolvedValue([{ ...mandate, sourceAgentName: "Friday coordinator" }]);
    await open({ ...workforce, assignments: [] });
    await vi.waitFor(() => expect(host.textContent).toContain("Friday coordinator"));
    expect(host.textContent).not.toContain("Agent agent");
  });
});
