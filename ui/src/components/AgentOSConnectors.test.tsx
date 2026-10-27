// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AgentOSConnectors } from "./AgentOSConnectors";
const api = vi.hoisted(() => ({ archiveConnection: vi.fn(), listConnectionGrants: vi.fn().mockResolvedValue({ capabilities: { canConfigure: false } }) }));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { list: async () => ({ connections: [{ id: "seat", name: "Codex seat", provider: "openai", status: "connected", method: "subscription" }] }) } }));
vi.mock("@/api/tools", () => ({ toolsApi: { ...api,
  listConnections: async () => ({ connections: [{ id: "pending", name: "Higgsfield marketing", status: "draft", healthStatus: "failed", enabled: false, config: { sourceTemplateKey: "higgsfield" }, ownership: "organization" }] }),
  listGallery: async () => ({ apps: [{ slug: "higgsfield", name: "Higgsfield", description: "Create marketing assets" }, { slug: "supabase", name: "Supabase", description: "Data and storage" }] }),
} }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
it("distinguishes pending provider sign-in from connected seats and checks disconnect authority", async () => {
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); document.body.append(host);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><AgentOSConnectors companyId="company" /></QueryClientProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.textContent).toContain("Sign-in required");
    expect(host.textContent).toContain("connected");
    expect(host.querySelector('a[href="/apps/connect?source=higgsfield&resume=pending"]')?.textContent).toBe("Finish sign-in");
    expect(host.querySelector('a[href="/apps/connect?source=supabase"]')).toBeTruthy();
    await act(async () => [...host.querySelectorAll("button")].filter(button => button.textContent === "Disconnect")[1].click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const confirm = host.querySelector('[aria-label="Confirm disconnect"]')!;
    expect(confirm.textContent).toContain("Only a connection administrator");
    expect([...confirm.querySelectorAll("button")].find(button => button.textContent === "Disconnect")?.disabled).toBe(true);
    expect(api.archiveConnection).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
