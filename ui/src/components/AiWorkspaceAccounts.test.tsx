// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { AiConnectionList, AiWorkspaceAccountSummary } from "@paperclipai/shared";
import { queryKeys } from "@/lib/queryKeys";
import { aiWorkspaceAccountKeys } from "@/api/ai-workspace-accounts";
import { AiWorkspaceAccounts } from "./AiWorkspaceAccounts";

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), install: vi.fn(), revoke: vi.fn(), update: vi.fn(), enroll: vi.fn(), source: vi.fn(), setup: vi.fn() }));
vi.mock("./AiAccountSetupNotice", () => ({ AiCompanyAccountSetup: () => null }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: mocks.session } }));
vi.mock("@/api/ai-workspace-accounts", () => ({ aiWorkspaceAccountsApi: { list: mocks.list, install: mocks.install,
  revoke: mocks.revoke, update: mocks.update, enroll: mocks.enroll }, aiWorkspaceAccountKeys: {
    all: ["ai-workspace-accounts"], list: (userId: string | null, companyId: string) => ["ai-workspace-accounts", userId, companyId],
  } }));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { list: mocks.source } }));
vi.mock("./ai-connections/AiProviderSetup", () => ({ AiProviderSetup: (props: { companyId: string; reconnect: { id: string }; onComplete: () => void }) => {
  mocks.setup(props); return <button onClick={props.onComplete}>Complete account sign-in</button>;
} }));

const account = (): AiWorkspaceAccountSummary => ({ id: "account", ownerUserId: "owner", sourceCompanyId: "source-company",
  sourceConnectionId: "source-connection", sourceGrantId: "source-grant", revision: 3, enabled: true, available: true,
  autoInstall: true, name: "My subscription", provider: "openai", method: "subscription", links: [] });
const local = (): AiConnectionList => ({ currentUserId: "owner", canManageConnections: true, connections: [{
  id: "local-connection", grantId: "local-grant", companyId: "company", provider: "openai", method: "subscription",
  name: "Existing subscription", ownership: "shared", isDefault: true, status: "connected",
}] });
let saved: AiWorkspaceAccountSummary[];
beforeEach(() => {
  vi.resetAllMocks(); saved = [account()];
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.list.mockImplementation(async () => structuredClone(saved));
  mocks.install.mockResolvedValue({}); mocks.revoke.mockResolvedValue({}); mocks.update.mockResolvedValue({}); mocks.enroll.mockResolvedValue({});
});
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
async function click(host: Element, label: string) {
  const button = [...host.querySelectorAll("button")].find(row => row.textContent === label);
  expect(button).toBeTruthy(); await act(async () => button!.click()); await settle();
}
async function fixture(connections?: AiConnectionList) {
  const host = document.createElement("div"), root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  document.body.append(host);
  const render = async (companyId = "company") => {
    await act(async () => { root.render(<QueryClientProvider client={client}><AiWorkspaceAccounts companyId={companyId} connections={connections} /></QueryClientProvider>); });
    await settle(); await settle();
  };
  await render();
  return { host, client, render, close: async () => { await act(async () => root.unmount()); client.clear(); host.remove(); } };
}

it("reuses a connected account in another company without starting provider sign-in", async () => {
  mocks.install.mockImplementation(async () => { saved[0].links = [{ id: "link", companyId: "company", connectionId: "alias", grantId: "alias-grant", revision: 1, enabled: true }]; return saved[0].links[0]; });
  const view = await fixture();
  try {
    await click(view.host, "Use in this company");
    expect(mocks.install).toHaveBeenCalledExactlyOnceWith("account", "company", { expectedRevision: 3, expectedLinkRevision: null });
    expect(view.host.textContent).toContain("Connected to this company");
    expect(mocks.setup).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it("keeps failed installation visibly unconnected", async () => {
  mocks.install.mockRejectedValue(new Error("Current work must finish first"));
  const view = await fixture();
  try {
    await click(view.host, "Use in this company");
    expect(view.host.textContent).toContain("Current work must finish first");
    expect(view.host.textContent).toContain("Not used by this company");
    expect(view.host.textContent).not.toContain("Connected to this company");
  } finally { await view.close(); }
});
it("removes access only from the selected company after a clear confirmation", async () => {
  saved[0].links = [{ id: "link", companyId: "company", connectionId: "alias", grantId: "alias-grant", revision: 2, enabled: true }];
  const view = await fixture();
  try {
    await click(view.host, "Remove from this company");
    const confirmation = view.host.querySelector('[aria-label="Confirm AI account change"]')!;
    expect(confirmation.textContent).toContain("Your other companies keep their access");
    expect(mocks.revoke).not.toHaveBeenCalled();
    await click(confirmation, "Remove company access");
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("account", "company", { expectedRevision: 3, expectedLinkRevision: 2 });
    expect(mocks.update).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it("confirms that disabling the account affects every company", async () => {
  const view = await fixture();
  try {
    await click(view.host, "Disable in all companies");
    const confirmation = view.host.querySelector('[aria-label="Confirm AI account change"]')!;
    expect(confirmation.textContent).toContain("Every company using this account will lose access");
    expect(mocks.update).not.toHaveBeenCalled();
    await click(confirmation, "Disable account");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("account", { expectedRevision: 3, enabled: false });
  } finally { await view.close(); }
});
it("saves automatic reuse with the observed account revision", async () => {
  const view = await fixture();
  try {
    await act(async () => view.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await settle();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("account", { expectedRevision: 3, autoInstall: false });
  } finally { await view.close(); }
});
it("enrolls an existing sign-in with one stable request identity across a failed retry", async () => {
  saved = []; mocks.enroll.mockRejectedValueOnce(new Error("Temporary save failure"));
  const view = await fixture(local());
  try {
    await click(view.host, "Use across my companies");
    const confirmation = view.host.querySelector('[aria-label="Confirm AI account change"]')!;
    await click(confirmation, "Use across my companies");
    await click(confirmation, "Use across my companies");
    const input = mocks.enroll.mock.calls[0][0];
    expect(input).toMatchObject({ sourceCompanyId: "company", sourceConnectionId: "local-connection", sourceGrantId: "local-grant", autoInstall: true });
    expect(input.id).toMatch(/^[\da-f-]{36}$/);
    expect(mocks.enroll.mock.calls[1][0]).toEqual(input);
    expect(mocks.setup).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it("does not offer somebody else's personal or already registered connection for enrollment", async () => {
  saved = []; const connections = local(); connections.connections[0].ownership = "personal"; connections.connections[0].ownerUserId = "someone-else";
  connections.connections.push({ ...local().connections[0], id: "managed", workspaceAccountManaged: true });
  const view = await fixture(connections);
  try { expect(view.host.textContent).not.toContain("Use across my companies"); } finally { await view.close(); }
});
it("reconnects once against the original company connection", async () => {
  saved[0].available = false;
  mocks.source.mockResolvedValue({ ...local(), connections: [{ ...local().connections[0], id: "source-connection", grantId: "source-grant", status: "needs_attention" }] });
  const view = await fixture();
  try {
    expect(view.host.textContent).toContain("Needs attention");
    await click(view.host, "Reconnect account"); await settle();
    expect(mocks.source).toHaveBeenCalledWith("source-company");
    expect(mocks.setup).toHaveBeenCalledWith(expect.objectContaining({ companyId: "source-company", reconnect: expect.objectContaining({ id: "source-connection", grantId: "source-grant" }) }));
  } finally { await view.close(); }
});
it("hides cached account details and pending actions after an authorization failure", async () => {
  const view = await fixture();
  try {
    await click(view.host, "Disable in all companies");
    mocks.list.mockRejectedValue(new Error("Account access denied"));
    await act(async () => { await view.client.invalidateQueries({ queryKey: aiWorkspaceAccountKeys.all }); }); await settle();
    expect(view.host.textContent).not.toContain("My subscription");
    expect(view.host.querySelector('[aria-label="Confirm AI account change"]')).toBeNull();
    expect(view.host.textContent).toContain("Account access denied");
    expect(mocks.update).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it("separates account caches and controls when the signed-in owner changes", async () => {
  const view = await fixture();
  try {
    await click(view.host, "Disable in all companies");
    mocks.list.mockRejectedValue(new Error("New account has no access"));
    await act(async () => { view.client.setQueryData(queryKeys.auth.session, { user: { id: "other-owner" } }); }); await settle();
    expect(view.host.textContent).not.toContain("My subscription");
    expect(view.host.querySelector('[aria-label="Confirm AI account change"]')).toBeNull();
    expect(view.client.getQueryData(aiWorkspaceAccountKeys.list("owner", "company"))).toBeDefined();
    expect(mocks.update).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it("does not display account records whose owner does not match the current session", async () => {
  saved[0].ownerUserId = "someone-else";
  const view = await fixture();
  try { expect(view.host.textContent).not.toContain("My subscription"); } finally { await view.close(); }
});
