// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentosWorkforce, PortfolioReadMandate } from "@paperclipai/shared";
import { WorkforceMandates } from "./WorkforceMandates";

const mocks = vi.hoisted(() => ({ mandates: vi.fn(), saveMandate: vi.fn(), revokeMandate: vi.fn(), setBoardDirectionAuthority: vi.fn(), agents: vi.fn() }));
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
  it("saves an explicit Friday private scope and retains it when reopening", async () => {
    mocks.mandates.mockResolvedValue([{ ...mandate, readScope: "owner_accessible_private" }]);
    mocks.saveMandate.mockResolvedValue({ ...mandate, readScope: "owner_accessible_private", revision: 5 });
    await open(); await vi.waitFor(() => expect(button("Edit access")).toBeDefined());
    expect(host.textContent).toContain("Authorized shared and private work, documents, task and case attachments, and your personal chats");
    await click("Edit access");
    expect(host.querySelectorAll("select")[2].value).toBe("owner_accessible_private");
    expect(host.textContent).toContain("designated Friday");
    await vi.waitFor(() => expect(button("Save explicit read grant").disabled).toBe(false));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(mocks.saveMandate).toHaveBeenCalledWith("portfolio", expect.objectContaining({
      id: "mandate", expectedRevision: 4, readScope: "owner_accessible_private", sourceAgentId: "agent",
    })));
  });
  it("never converts private reading into writes without an explicit owner action", async () => {
    mocks.mandates.mockResolvedValue([{ ...mandate, readScope: "owner_accessible_private", boardDirectionGrantId: null, boardDirectionAuthority: null }]);
    mocks.setBoardDirectionAuthority.mockResolvedValue({});
    await open(); await vi.waitFor(() => expect(button("Authorize executive directions")).toBeDefined());
    expect(mocks.setBoardDirectionAuthority).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Reading access does not authorize executive directions");
    await click("Authorize executive directions");
    expect(mocks.setBoardDirectionAuthority).toHaveBeenCalledWith("portfolio", "mandate", { expectedRevision: 4, expectedGrantId: null, enabled: true });
  });
  it("revokes the exact shown write grant and explains already admitted work", async () => {
    mocks.mandates.mockResolvedValue([{ ...mandate, readScope: "owner_accessible_private", boardDirectionGrantId: "grant", boardDirectionAuthority: { grantId: "grant", mandateRevision: 4 } }]);
    mocks.setBoardDirectionAuthority.mockResolvedValue({});
    await open(); await vi.waitFor(() => expect(button("Revoke executive directions")).toBeDefined());
    expect(button("Authorize executive directions")).toBeUndefined(); expect(host.textContent).toContain("work already admitted remains with its company");
    await click("Revoke executive directions");
    expect(mocks.setBoardDirectionAuthority).toHaveBeenCalledWith("portfolio", "mandate", { expectedRevision: 4, expectedGrantId: "grant", enabled: false });
  });
  it("replaces a stale write grant explicitly without describing it as current authority", async () => {
    mocks.mandates.mockResolvedValue([{ ...mandate, readScope: "owner_accessible_private", boardDirectionGrantId: "old", boardDirectionAuthority: null }]);
    mocks.setBoardDirectionAuthority.mockRejectedValue(new Error("Direction authority changed"));
    await open(); await vi.waitFor(() => expect(button("Authorize executive directions")).toBeDefined()); await click("Authorize executive directions");
    await vi.waitFor(() => expect(host.textContent).toContain("Direction authority changed"));
    expect(mocks.setBoardDirectionAuthority).toHaveBeenCalledWith("portfolio", "mandate", { expectedRevision: 4, expectedGrantId: "old", enabled: true });
    expect(host.textContent).not.toContain("Executive directions are authorized");
  });
  it("does not show direction mutation controls without native portfolio management", async () => {
    mocks.mandates.mockResolvedValue([{ ...mandate, readScope: "owner_accessible_private", boardDirectionGrantId: "grant", boardDirectionAuthority: { grantId: "grant", mandateRevision: 4 } }]);
    await open({ ...workforce, canManage: false }); await vi.waitFor(() => expect(host.textContent).toContain("Executive directions are authorized"));
    expect(button("Authorize executive directions")).toBeUndefined(); expect(button("Revoke executive directions")).toBeUndefined();
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
