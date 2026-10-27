// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Friday } from "./Friday";
import { AgentOSNativeFrame } from "@/components/AgentOSNativeFrame";

const fixture = vi.hoisted(() => {
  const first = "00000000-0000-4000-8000-000000000001", second = "00000000-0000-4000-8000-000000000002";
  const project = "00000000-0000-4000-8000-000000000003", agent = "00000000-0000-4000-8000-000000000004";
  return { first, second, project, agent,
    companies: [{ id: first, name: "Northstar", issuePrefix: "NOR", status: "active", description: "Useful tools." }, { id: second, name: "Forma", issuePrefix: "FOR", status: "active", description: "Creative work." }],
    work: vi.fn(), attention: vi.fn(), routines: vi.fn(), getProject: vi.fn(), transcript: vi.fn(), send: vi.fn(),
  };
});
vi.mock("@/lib/router", async () => ({ ...await import("react-router-dom"), CompanyRouteScope: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.first, companies: fixture.companies }), CompanyViewProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ setTheme: () => {} }) }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => ({ userId: "owner" }) }));
vi.mock("@/api/administration", () => ({ administrationApi: { registration: async () => ({ status: "approved", isInstanceAdmin: true }) }, registrationKey: () => ["registration"] }));
vi.mock("@/api/operating-profile", () => ({ operatingProfileKey: () => ["profile"], operatingProfileApi: { get: async () => ({ fridayAgentId: fixture.agent, revision: 1 }) } }));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { list: async () => ({ connections: [{ method: "subscription", status: "connected" }] }) } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async (companyId: string) => [{ id: fixture.agent, companyId, name: "Friday", role: "coordinator", status: "idle", adapterType: "codex_local", adapterConfig: { model: "test-model" }, capabilities: "Coordinate projects" }], skills: async () => ({ entries: [], warnings: [] }) } }));
vi.mock("@/api/friday", () => ({ fridayApi: { work: fixture.work }, fridayKey: (id: string) => ["work", id] }));
vi.mock("@/api/attention", () => ({ attentionApi: { list: fixture.attention } }));
vi.mock("@/api/projects", () => ({ projectsApi: { get: fixture.getProject } }));
vi.mock("@/api/workforce", () => ({ workforceApi: { list: async () => [{ id: "portfolio", homeCompanyId: fixture.first }] }, workforceKeys: { list: () => ["portfolio"], detail: () => ["portfolio-detail"] } }));
vi.mock("@/api/routines", () => ({ routinesApi: { list: fixture.routines } }));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: async () => [] } }));
vi.mock("@/api/issues", () => ({ issuesApi: { listDocuments: async () => [] } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: "owner" } }) } }));
vi.mock("@/api/activity", () => ({ activityApi: { list: async () => [] } }));
vi.mock("@/hooks/useFridayUpdates", () => ({ useFridayUpdates: () => {} }));
vi.mock("@/hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("@/components/FridayOrb", () => ({ FridayOrb: ({ decorative, label, onActivate, state }: any) => decorative ? <span data-orb="brand" /> : <button aria-label={label} data-orb={state} onClick={onActivate}>Orb</button> }));
vi.mock("./AgentChat", async () => {
  const { FridayConversationPanel } = await import("@/components/FridayConversationPanel");
  return { AgentChat: ({ focusView }: any) => <>{focusView.render({ issueId: "conversation", attachments: [], workProducts: [], runStatus: "idle", awaitingInput: false, unavailable: false, loading: false, voiceDisabled: false, onTranscript: fixture.transcript, onVoiceMessage: fixture.send })}<FridayConversationPanel focus={focusView} open={focusView.showTranscript || !focusView.composerCollapsed} required={false}><div>Persisted conversation</div><input aria-label="Message Friday" /></FridayConversationPanel></> };
});

class Recognition {
  static latest: Recognition;
  constructor() { Recognition.latest = this; }
  onstart?: () => void; onend?: () => void; onerror?: unknown; onresult?: (event: unknown) => void;
  start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {}
}

describe("Agent OS approved Friday experience", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Recognition });
    fixture.attention.mockResolvedValue({ items: [], totalCount: 0, generatedAt: new Date().toISOString(), nextCursor: null });
    fixture.routines.mockResolvedValue([]);
    fixture.getProject.mockResolvedValue({ id: fixture.project, name: "Customer portal", companyId: fixture.first });
    fixture.work.mockImplementation(async (id: string) => ({ observedAt: new Date().toISOString(), projects: id === fixture.first ? [{ id: fixture.project, name: "Customer portal", status: "in_progress", leadAgentId: fixture.agent }] : [], projectCount: id === fixture.first ? 1 : 0, nextProjectOffset: null, applications: [], tasks: [], counts: { in_progress: 2, done: 3 }, nextOffset: null, assignments: [], evidence: [], handoffs: [], assignmentsTruncated: false, evidenceTruncated: false, handoffsTruncated: false }));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); delete (window as any).SpeechRecognition; });
  async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
  async function render(path = "/friday", native = false) { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{native ? <AgentOSNativeFrame><h1>Native record</h1></AgentOSNativeFrame> : <Friday />}</MemoryRouter></QueryClientProvider>)); await settle(); await settle(); }
  async function click(text: string, within: ParentNode = host) { const button = [...within.querySelectorAll("button")].find(node => node.textContent?.trim() === text || node.getAttribute("aria-label") === text); expect(button, text).toBeDefined(); await act(async () => button!.click()); await settle(); await settle(); }
  const navigation = () => host.querySelector('nav[aria-label="Main navigation"]')!;

  it("opens real company and project cards in the canvas with scoped decisions and routines", async () => {
    await render();
    expect(host.textContent).toContain("A little clarity. A lot in motion.");
    expect(host.textContent).not.toContain("Paperclip");
    expect(navigation().textContent).toContain("Agent Map");
    await click("Companies", navigation());
    const card = [...host.querySelectorAll(".agentos-company-card")].find(node => node.textContent?.includes("Northstar"))!;
    await act(async () => (card as HTMLButtonElement).click()); await settle(); await settle();
    const project = host.querySelector<HTMLButtonElement>(".agentos-project-card")!;
    expect(project.textContent).toContain("Customer portal");
    await act(async () => project.click()); await settle(); await settle();
    expect(host.querySelector('dialog[open]')).toBeNull();
    const tabs = host.querySelector('nav[aria-label="Workspace views"]')!;
    await click("Decisions", tabs);
    expect(fixture.attention).toHaveBeenCalledWith(fixture.first, expect.objectContaining({ projectId: fixture.project }));
    await click("Routines", host.querySelector('nav[aria-label="Workspace views"]')!);
    expect(fixture.routines).toHaveBeenLastCalledWith(fixture.first, { projectId: fixture.project });
    await click("All projects");
    await click("Routines", host.querySelector('nav[aria-label="Workspace views"]')!);
    expect(fixture.routines).toHaveBeenLastCalledWith(fixture.first, { projectId: undefined });
  });

  it("keeps Kanban board-only and navigation visible on the audit trail", async () => {
    await render(`/friday?panel=work&companyId=${fixture.first}&projectId=${fixture.project}&mode=kanban`);
    expect(host.querySelector('[aria-label="Kanban board"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Project and agent work graph"]')).toBeNull();
    expect(host.textContent).not.toContain("Combined");
    await click("Audit trail", host.querySelector('nav[aria-label="People and history"]')!);
    expect(host.querySelector('aside[aria-label="Portfolio navigation"]')).not.toBeNull();
    expect(host.querySelector('nav[aria-label="Workspace"]')).not.toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Audit trail");
  });

  it("listens without opening history, shows the paused mic, and docks the same conversation", async () => {
    await render();
    const history = host.querySelector<HTMLElement>('.agentos-conversation-panel')!;
    expect(history.hidden).toBe(true);
    expect(host.querySelector('[data-testid="friday-mic-paused"]')).not.toBeNull();
    expect(host.querySelector('.agentos-presence-orb .agentos-orb-microphone')?.getAttribute("data-enabled")).toBe("false");
    await click("Talk to Friday");
    expect(host.querySelector('.agentos-orb-microphone')?.getAttribute("data-enabled")).toBe("true");
    await act(async () => Recognition.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Show my projects" } }] }));
    const preview = host.querySelector('.agentos-live-transcript')!;
    expect(preview.textContent).toBe("Show my projects");
    expect(preview.compareDocumentPosition(host.querySelector('.agentos-prefer-type')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fixture.send).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="friday-mic-listening"]')).not.toBeNull();
    expect(history.hidden).toBe(true);
    await click("Pause microphone");
    expect(host.querySelector('[data-testid="friday-mic-paused"]')).not.toBeNull();
    await click("Prefer to type?");
    expect(history.hidden).toBe(false);
    expect(history.dataset.docked).toBe("false");
    await click("Companies", navigation());
    expect(host.querySelector('.agentos-conversation-panel')).toBe(history);
    expect(history.dataset.docked).toBe("true");
    expect(history.hidden).toBe(true);
    expect(host.querySelector('.agentos-friday-presence')?.getAttribute("data-docked")).toBe("true");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Minimise conversation"]')!.click());
    expect(history.hidden).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open Friday conversation history"]')!.click());
    expect(history.hidden).toBe(false);
  });

  it("shows a clickable employee table", async () => {
    await render("/friday?panel=team");
    expect(host.querySelector('.agentos-employee-table')).not.toBeNull();
    expect(host.querySelector('.agentos-employee-table')?.textContent).toContain("test-model");
    const profile = host.querySelector<HTMLButtonElement>('[aria-label="Open Friday profile"]')!;
    await act(async () => profile.click()); await settle();
    expect(host.textContent).toContain("Profile & instructions");
  });

  it("rejects an unknown company scope without querying its work", async () => {
    await render("/friday?panel=work&companyId=00000000-0000-4000-8000-000000000099");
    expect(host.textContent).toContain("Company unavailable");
    expect(fixture.work).not.toHaveBeenCalled();
  });

  it("keeps Friday's real conversation reachable alongside a native record", async () => {
    await render("/NOR/company/settings", true);
    expect(host.textContent).toContain("Native record");
    expect(host.querySelector('.agentos-friday-presence')?.getAttribute("data-docked")).toBe("true");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open Friday conversation history"]')!.click());
    expect(host.querySelector<HTMLElement>('.agentos-conversation-panel')?.hidden).toBe(false);
    expect(host.textContent).toContain("Native record");
    expect(host.textContent).toContain("Persisted conversation");
  });
});
