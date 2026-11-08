// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { AgentDetail } from "@paperclipai/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agentsApi, type AgentPermissionUpdate } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { ConfigurationTab } from "./AgentDetail";

const mocks = vi.hoisted(() => ({ update: vi.fn(), board: vi.fn(), members: vi.fn() }));
vi.mock("../api/agents", async original => {
  const actual = await original<typeof import("../api/agents")>();
  return { ...actual, agentsApi: { ...actual.agentsApi, updatePermissions: mocks.update } };
});
vi.mock("../api/access", () => ({ accessApi: { getCurrentBoardAccess: mocks.board, listMembers: mocks.members } }));
vi.mock("@/lib/router", async original => {
  const actual = await original<typeof import("@/lib/router")>();
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ tab: "permissions" }) };
});
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: vi.fn() }) }));
vi.mock("../components/TrustPresetSection", () => ({ TrustPresetSection: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const noop = () => {};
function agent(enabled = false): AgentDetail {
  return { id: "employee", companyId: "company", name: "CEO", role: "ceo", status: "idle", adapterType: "paperclip_runner",
    adapterConfig: {}, runtimeConfig: {}, permissions: { canCreateAgents: true }, chainOfCommand: [],
    access: { canAssignTasks: true, grants: enabled ? [{ permissionKey: "applications:manage", scope: null }] : [] } } as unknown as AgentDetail;
}
const board = { userId: "owner", source: "session", isInstanceAdmin: false, companyIds: ["company"] };
function members(keys = ["users:manage_permissions", "applications:manage"]) {
  return { members: [{ principalId: "owner", status: "active", grants: keys.map(permissionKey => ({ permissionKey, scope: null })) }] };
}
const cleanups: (() => Promise<void>)[] = [];
async function render(value: AgentDetail, options: { keys?: string[]; boardKnown?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (options.boardKnown !== false) client.setQueryData(queryKeys.access.currentBoardAccess, board);
  client.setQueryData(queryKeys.access.companyMembers("company"), members(options.keys));
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  function View() {
    const mutation = useMutation({ mutationFn: (payload: AgentPermissionUpdate) => agentsApi.updatePermissions(value.id, payload, value.companyId) });
    return <ConfigurationTab agent={value} companyId={value.companyId} content="permissions" updatePermissions={mutation}
      onDirtyChange={noop} onSaveActionChange={noop} onCancelActionChange={noop} onSavingChange={noop} />;
  }
  await act(async () => root.render(<QueryClientProvider client={client}><View /></QueryClientProvider>));
  cleanups.push(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
  const control = () => container.querySelector<HTMLButtonElement>('[aria-label="Manage departments and projects"]')!;
  return { container, control, client };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.board.mockResolvedValue(board); mocks.members.mockResolvedValue(members()); mocks.update.mockResolvedValue(agent());
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it.each([true, false])("shows the actual native application grant %s and sends only its opposite", async enabled => {
  const view = await render(agent(enabled));
  expect(view.control().getAttribute("aria-checked")).toBe(String(enabled));
  expect(view.control().disabled).toBe(false);
  await act(async () => view.control().click());
  expect(mocks.update).toHaveBeenCalledWith("employee", { canManageApplications: !enabled }, "company");
});
it("does not infer the grant from CEO title or legacy creator permission", async () => {
  const value = agent(); value.permissions = { ...value.permissions, canManageApplications: true } as typeof value.permissions;
  const view = await render(value);
  expect(view.control().getAttribute("aria-checked")).toBe("false");
});
it("keeps legacy toggles on their existing exclusive payload", async () => {
  const view = await render(agent(true));
  await act(async () => view.container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1].click());
  expect(mocks.update).toHaveBeenCalledWith("employee", { canCreateAgents: false, canCreateSkills: true, canAssignTasks: true }, "company");
});
it.each([{ keys: [] }, { keys: ["applications:manage"] }])("disables changes without current board permission-management authority: %j", async ({ keys }) => {
  const view = await render(agent(true), { keys });
  expect(view.control().disabled).toBe(true);
});
it("requires the granting capability to enable but permits an authorized revocation without it", async () => {
  const options = { keys: ["users:manage_permissions"] };
  const disabled = await render(agent(), options); expect(disabled.control().disabled).toBe(true);
  const enabled = await render(agent(true), options); expect(enabled.control().disabled).toBe(false);
  await act(async () => enabled.control().click());
  expect(mocks.update).toHaveBeenCalledWith("employee", { canManageApplications: false }, "company");
});
it("keeps unknown board authority disabled", async () => {
  mocks.board.mockReturnValue(new Promise(() => {}));
  const view = await render(agent(), { boardKnown: false });
  expect(view.control().disabled).toBe(true);
});
it.each(["board", "members"] as const)("disables cached authority after a failed %s refresh", async source => {
  const view = await render(agent(true));
  expect(view.control().disabled).toBe(false);
  mocks[source].mockRejectedValue(new Error("Authority unavailable"));
  await act(async () => { await view.client.refetchQueries({ queryKey: source === "board"
    ? queryKeys.access.currentBoardAccess : queryKeys.access.companyMembers("company") }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(view.control().disabled).toBe(true);
  expect(view.control().getAttribute("aria-checked")).toBe("true");
});
it("shows a server denial inline and retains the original grant state", async () => {
  mocks.update.mockRejectedValue(new Error("Your permission changed. Refresh and try again."));
  const view = await render(agent());
  await act(async () => view.control().click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Your permission changed. Refresh and try again.");
  expect(view.control().getAttribute("aria-checked")).toBe("false");
});
