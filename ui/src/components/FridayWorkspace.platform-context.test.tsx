// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Company } from "@paperclipai/shared";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { FridayWorkspace } from "./FridayWorkspace";
import type { FridayNavigation } from "@/lib/friday-navigation";

const { listAgents, getProject } = vi.hoisted(() => ({ listAgents: vi.fn(async () => [{ id: "friday", name: "Friday", role: "ceo", status: "idle", adapterType: "codex_local" }]), getProject: vi.fn() }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: listAgents } }));
vi.mock("@/api/projects", () => ({ projectsApi: { get: getProject } }));
vi.mock("./FridayPresence", () => ({ FridayPresence: () => <div data-friday-present /> }));
vi.mock("./AgentOSCompanyScope", () => ({ AgentOSCompanyScope: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./AgentOSSettings", () => ({ AgentOSSettings: ({ companyId }: { companyId: string }) => <div data-settings-context={companyId} /> }));
vi.mock("@/lib/router", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));

const internal = { id: "core", name: "Platform Operations", purpose: "platform", issuePrefix: "AGE" } as Company;
const data = { attachments: [], workProducts: [], onTranscript: vi.fn(), voiceDisabled: false, runStatus: "idle", unavailable: false, loading: false } as unknown as AgentConversationFocusData;
let client: QueryClient, host: HTMLDivElement, root: Root;
const navigate = vi.fn();
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(view: FridayNavigation) {
  await act(async () => root.render(<QueryClientProvider client={client}><FridayWorkspace companyId={internal.id} contextCompany={internal} companies={[]} data={data} panel={view.panel} view={view} navigate={navigate} setPanel={vi.fn()} compact={false} connected /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
it("opens an empty portfolio from an internal project link without fetching or displaying internal projects", async () => {
  await render({ panel: "work", companyId: "core", projectId: "internal-project" });
  expect(host.querySelector("[data-friday-present]")).not.toBeNull();
  expect(host.textContent).toContain("ready for its first company");
  expect(host.textContent).not.toContain("Platform Operations");
  expect(getProject).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Create a company")!.click());
  expect(navigate).toHaveBeenCalledWith({ panel: "companies", scope: "portfolio" });
});
it("retains explicit platform settings when the portfolio has no businesses", async () => {
  await render({ panel: "settings", scope: "portfolio" });
  expect(host.querySelector("[data-settings-context]")?.getAttribute("data-settings-context")).toBe("core");
});
it("retains employees under Platform without adding a business company", async () => {
  await render({ panel: "team", scope: "portfolio" });
  expect(listAgents).toHaveBeenCalledWith("core");
  expect(host.textContent).toContain("Friday");
  expect(host.textContent).toContain("Platform");
  expect(host.textContent).not.toContain("Platform Operations");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Open Friday profile"]')!.click());
  expect(navigate).toHaveBeenCalledWith({ panel: "team", companyId: "core", agentId: "friday" });
});
