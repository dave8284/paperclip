// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { AGENTOS_CONNECTORS } from "@/lib/agentos-connectors";
import { AgentOSConnectors } from "./AgentOSConnectors";

const api = vi.hoisted(() => ({ listSeats: vi.fn(), listConnections: vi.fn(), listGallery: vi.fn(),
  listConnectionGrants: vi.fn(), archiveConnection: vi.fn(), activeRuns: vi.fn() }));
const accounts = vi.hoisted(() => ({ owned: [] as Array<{ id: string; provider: string; sourceConnectionId: string; enabled: boolean; available: boolean; links: Array<{ connectionId: string }> }> }));
vi.mock("./AiWorkspaceAccounts", () => ({ AiWorkspaceAccounts: () => <section id="agentos-ai-accounts">AgentOS AI accounts</section>, useAiWorkspaceAccounts: () => accounts }));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { list: api.listSeats, activeRuns: api.activeRuns } }));
vi.mock("@/api/tools", () => ({ toolsApi: api }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
const seat = { id: "seat", name: "Private subscription", provider: "openai", status: "connected", method: "subscription" };
beforeEach(() => {
  vi.resetAllMocks();
  api.listSeats.mockResolvedValue({ connections: [seat] });
  api.listConnections.mockResolvedValue({ connections: [] });
  api.listGallery.mockResolvedValue({ apps: [...AGENTOS_CONNECTORS.map(row => ({ ...row, description: "Connector description" })), { slug: "slack", name: "Slack", description: "Later integration" }] });
  api.listConnectionGrants.mockResolvedValue({ capabilities: { canConfigure: true } });
  api.activeRuns.mockResolvedValue([]);
  api.archiveConnection.mockResolvedValue({});
  accounts.owned = [];
});
async function fixture() {
  const host = document.createElement("div"), root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.append(host);
  const render = async (companyId = "company") => {
    await act(async () => { root.render(<QueryClientProvider client={client}><AgentOSConnectors companyId={companyId} /></QueryClientProvider>); });
    await settle();
  };
  await render();
  return { host, client, render, close: async () => { await act(async () => root.unmount()); client.clear(); host.remove(); } };
}
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
async function click(host: Element, text: string) {
  const button = [...host.querySelectorAll("button")].find(row => row.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}

it.each(["seats", "tools"])("hides cached inventory and management after %s access fails, then recovers on retry", async source => {
  const view = await fixture();
  try {
    expect(view.host.textContent).toContain(seat.name);
    await click(view.host, "Disconnect");
    expect(view.host.querySelector('[aria-label="Confirm disconnect"]')).toBeTruthy();
    const failing = source === "seats" ? api.listSeats : api.listConnections;
    failing.mockRejectedValue(new Error("Company access denied"));
    await act(async () => { await view.client.invalidateQueries({ queryKey: source === "seats" ? ["ai-connections", "company"] : queryKeys.tools.connections("company") }); });
    await settle();
    expect(view.host.textContent).not.toContain(seat.name);
    expect(view.host.querySelector('a[href="/apps/seat/permissions"]')).toBeNull();
    expect(view.host.querySelector('[aria-label="Confirm disconnect"]')).toBeNull();
    expect(view.host.textContent).not.toContain("No connected accounts yet");
    expect(view.host.querySelector('a[href="/apps/connect?source=openai"]')).toBeNull();
    api.listSeats.mockResolvedValue({ connections: [] });
    api.listConnections.mockResolvedValue({ connections: [] });
    await click(view.host, "Retry connectors");
    expect(view.host.textContent).toContain("No connected accounts yet");
    expect(view.host.querySelector('[aria-label="Confirm disconnect"]')).toBeNull();
    expect(view.host.querySelector('a[href="/apps/connect?source=openai"]')).toBeTruthy();
  } finally { await view.close(); }
});

it("rechecks failed disconnect authority and refuses a busy subscription seat before native removal", async () => {
  const view = await fixture();
  try {
    await click(view.host, "Disconnect");
    const confirmation = () => view.host.querySelector('[aria-label="Confirm disconnect"]')!;
    api.listConnectionGrants.mockRejectedValue(new Error("Connection access denied"));
    await act(async () => { await view.client.invalidateQueries({ queryKey: queryKeys.tools.connectionGrants("seat") }); });
    await settle();
    expect([...confirmation().querySelectorAll("button")].find(row => row.textContent === "Disconnect")?.disabled).toBe(true);
    await click(confirmation(), "Disconnect");
    expect(api.archiveConnection).not.toHaveBeenCalled();
    api.listConnectionGrants.mockResolvedValue({ capabilities: { canConfigure: true } });
    await click(view.host, "Retry connectors");
    api.activeRuns.mockResolvedValue([{ id: "active-run" }]);
    await click(confirmation(), "Disconnect");
    expect(view.host.textContent).toContain("This seat is executing work");
    expect(api.archiveConnection).not.toHaveBeenCalled();
    api.activeRuns.mockResolvedValue([]);
    api.listSeats.mockResolvedValue({ connections: [] });
    await click(confirmation(), "Disconnect");
    expect(api.archiveConnection).toHaveBeenCalledExactlyOnceWith("seat");
    expect(view.host.querySelector('[aria-label="Confirm disconnect"]')).toBeNull();
    expect(view.host.textContent).not.toContain(seat.name);
  } finally { await view.close(); }
});

it("resets pending management when the settings company changes", async () => {
  const view = await fixture();
  try {
    await click(view.host, "Disconnect");
    api.listSeats.mockResolvedValue({ connections: [{ ...seat, id: "other-seat", name: "Other company seat" }] });
    await view.render("other-company");
    expect(view.host.textContent).not.toContain(seat.name);
    expect(view.host.querySelector('[aria-label="Confirm disconnect"]')).toBeNull();
    expect(view.host.textContent).toContain("Other company seat");
    expect(api.archiveConnection).not.toHaveBeenCalled();
    expect([...view.host.querySelectorAll(".agentos-project-grid h3")].map(row => row.textContent)).toEqual(AGENTOS_CONNECTORS.map(row => row.name));
  } finally { await view.close(); }
});

it("routes registered source and company accounts to workspace management without generic disconnect", async () => {
  api.listSeats.mockResolvedValue({ connections: [{ ...seat, workspaceAccountManaged: true }] });
  const view = await fixture();
  try {
    expect(view.host.querySelector('a[href="/apps/seat/permissions"]')).toBeNull();
    expect([...view.host.querySelectorAll("button")].some(row => row.textContent === "Disconnect")).toBe(false);
    expect(view.host.querySelector('a[href="#agentos-ai-accounts"]')?.textContent).toBe("Manage AI account");
  } finally { await view.close(); }
});

it("offers the existing workspace subscription before another provider sign-in", async () => {
  api.listSeats.mockResolvedValue({ connections: [] });
  accounts.owned = [{ id: "account", provider: "openai", sourceConnectionId: "source", enabled: true, available: true, links: [] }];
  const view = await fixture();
  try {
    expect(view.host.querySelector('a[href="/apps/connect?source=openai"]')).toBeNull();
    expect([...view.host.querySelectorAll('a[href="#agentos-ai-accounts"]')].some(row => row.textContent === "Use existing account")).toBe(true);
  } finally { await view.close(); }
});
