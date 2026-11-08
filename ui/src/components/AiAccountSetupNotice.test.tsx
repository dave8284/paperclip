// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { AiWorkspaceAccountSetupResult } from "@paperclipai/shared";
import { AiAccountSetupNotice, AiCompanyAccountSetup } from "./AiAccountSetupNotice";
import { queryKeys } from "@/lib/queryKeys";

const mocks = vi.hoisted(() => ({ finish: vi.fn(), status: vi.fn(), session: vi.fn() }));
vi.mock("@/api/ai-workspace-accounts", () => ({ aiWorkspaceAccountsApi: { finishSetup: mocks.finish, companySetup: mocks.status }, aiWorkspaceAccountKeys: { all: ["ai-workspace-accounts"] } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: mocks.session } }));
const pending: AiWorkspaceAccountSetupResult = { status: "pending", accountId: "account", installedCompanyIds: [],
  pending: [{ companyId: "company", reason: "busy", message: "Wait for current work to finish." }], retry: { kind: "account", accountId: "account" } };
const ready: AiWorkspaceAccountSetupResult = { ...pending, status: "ready", pending: [], retry: null };
beforeEach(() => { vi.resetAllMocks(); mocks.status.mockResolvedValue(pending); mocks.session.mockResolvedValue({ user: { id: "owner" } }); });
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
async function fixture(company = false) {
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const changed = vi.fn(); document.body.append(host);
  await act(async () => { root.render(<QueryClientProvider client={client}>{company ? <AiCompanyAccountSetup companyId="company" /> : <AiAccountSetupNotice result={pending} onChange={changed} />}</QueryClientProvider>); });
  await settle(); await settle();
  return { host, client, changed, close: async () => { await act(async () => root.unmount()); client.clear(); host.remove(); } };
}
async function retry(host: Element) {
  await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Retry account setup")!.click(); }); await settle();
}
it("retains the failed state and retries the saved account without a second sign-in", async () => {
  mocks.finish.mockRejectedValueOnce(new Error("Connection still busy")).mockResolvedValueOnce(ready);
  const view = await fixture();
  try {
    await retry(view.host);
    expect(view.host.textContent).toContain("Connection still busy"); expect(view.changed).not.toHaveBeenCalled();
    await retry(view.host);
    expect(mocks.finish).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenLastCalledWith({ kind: "account", accountId: "account" });
    expect(view.changed).toHaveBeenCalledExactlyOnceWith(ready);
  } finally { await view.close(); }
});
it("reconstructs pending company setup on reload using reads only", async () => {
  const view = await fixture(true);
  try {
    expect(view.host.textContent).toContain("Wait for current work to finish");
    expect(mocks.status).toHaveBeenCalledWith("company", expect.any(AbortSignal));
    expect(mocks.finish).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it("withholds an old owner's pending details when the signed-in account changes and cannot read setup", async () => {
  const view = await fixture(true);
  try {
    mocks.status.mockRejectedValue(new Error("Access denied"));
    await act(async () => { view.client.setQueryData(queryKeys.auth.session, { user: { id: "new-owner" } }); }); await settle();
    expect(view.host.textContent).not.toContain("Wait for current work to finish");
    expect(view.host.textContent).toContain("Could not check automatic AI account setup");
    expect(mocks.finish).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
