// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Administration } from "./Administration";
import { PendingApproval } from "./PendingApproval";

const mocks = vi.hoisted(() => ({ overview: vi.fn(), people: vi.fn(), update: vi.fn(), intelligence: vi.fn(), registration: vi.fn() }));
vi.mock("@/api/administration", () => ({ administrationApi: mocks, adminKey: (id: string) => ["admin", id], registrationKey: (id: string) => ["registration", id] }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => ({ userId: "admin" }), companyDirectoryQueryOptions: () => ({ queryKey: ["directory"], queryFn: async () => [] }) }));
vi.mock("@/api/access", () => ({ accessApi: { getUserCompanyAccess: async () => ({ companyAccess: [] }) } }));
vi.mock("@/lib/router", async () => await import("react-router-dom"));

describe("Agent OS administration screens", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.overview.mockResolvedValue({ counts: { users: 1, pending: 1, approved: 0, suspended: 0, admins: 1 }, google: { configured: false, callbackPath: "/api/auth/callback/google" }, mode: "authenticated" });
    mocks.people.mockResolvedValue({ people: [{ id: "pending-user", name: "New Person", email: "new@example.com", approvalStatus: "pending", approvalRevision: 1, isInstanceAdmin: false, providers: ["google"], activeCompanyMembershipCount: 0, emailVerified: true }], total: 1, offset: 0, limit: 30 });
    mocks.update.mockResolvedValue({ approvalRevision: 2 });
    mocks.intelligence.mockResolvedValue({ usage: [], decisions: [], runs: [], learning: { explanation: "No learning service connected." } });
    mocks.registration.mockResolvedValue({ status: "pending", userId: "admin", isInstanceAdmin: false });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
  async function render(path = "/admin", pending = false) {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{pending ? <PendingApproval /> : <Administration />}</MemoryRouter></QueryClientProvider>));
    await settle(); await settle();
  }
  async function click(text: string) {
    const button = [...host.querySelectorAll("button")].find(node => node.textContent?.includes(text));
    expect(button).toBeDefined(); await act(async () => button!.click()); await settle();
  }
  it("reviews a pending account with its revision and retains navigation", async () => {
    await render("/admin?tab=pending");
    expect(host.querySelector('nav[aria-label="Administration"]')).not.toBeNull();
    await click("New Person"); await click("Approve access");
    expect(mocks.update).toHaveBeenCalledWith("pending-user", { action: "approve", expectedRevision: 1, reason: "" });
    expect(mocks.people.mock.calls.length).toBeGreaterThan(1);
    expect(host.querySelector('nav[aria-label="Administration"]')).not.toBeNull();
  });
  it("does not load administrative datasets when access is denied", async () => {
    mocks.overview.mockRejectedValue(new Error("Instance administrator access is required."));
    await render("/admin?tab=users");
    expect(host.textContent).toContain("Administrator access required");
    expect(mocks.people).not.toHaveBeenCalled(); expect(mocks.intelligence).not.toHaveBeenCalled();
  });
  it("distinguishes absent learning evidence from recorded performance", async () => {
    await render("/admin?tab=intelligence");
    expect(host.textContent).toContain("Learning & improvement · Not connected");
    expect(host.textContent).toContain("No model usage receipts in this period.");
    expect(host.textContent).not.toContain("100%");
  });
  it("keeps pending users on a status page and supports an explicit refresh", async () => {
    await render("/pending-approval", true);
    expect(host.textContent).toContain("You're on the list.");
    await click("Check status");
    expect(mocks.registration.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.people).not.toHaveBeenCalled();
  });
});
