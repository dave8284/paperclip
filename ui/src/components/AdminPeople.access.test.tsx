// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminPeople } from "./AdminPeople";

const api = vi.hoisted(() => ({ people: vi.fn(), update: vi.fn(), delete: vi.fn(), getAccess: vi.fn(), setAccess: vi.fn(), companies: vi.fn() }));
vi.mock("@/api/administration", () => ({ administrationApi: api, adminKey: (id: string) => ["admin", id] }));
vi.mock("@/api/access", () => ({ accessApi: { getUserCompanyAccess: api.getAccess, setUserCompanyAccess: api.setAccess } }));
vi.mock("@/api/companies-query", () => ({ companyDirectoryQueryOptions: () => ({ queryKey: ["directory"], queryFn: api.companies }) }));
const person = { id: "member", name: "Private Person", email: "private@example.com", approvalStatus: "approved", approvalRevision: 4, providers: ["google"], activeCompanyMembershipCount: 1, emailVerified: true };
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  api.people.mockResolvedValue({ people: [person], total: 1 });
  api.getAccess.mockResolvedValue({ companyAccess: [{ companyId: "venture", status: "active" }] });
  api.companies.mockResolvedValue([{ id: "venture", name: "Private venture" }]);
  api.setAccess.mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
async function render(userId = "admin") {
  await act(async () => root.render(<QueryClientProvider client={client}><AdminPeople userId={userId} /></QueryClientProvider>)); await settle();
}
function button(label: string) { return [...host.querySelectorAll("button")].find(node => node.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); await settle(); }

it("hides cached identities and open deletion after a failed current read, then recovers from the current inventory", async () => {
  await render(); await click("Delete");
  expect(host.querySelector('[aria-label="Manage Private Person"]')).not.toBeNull();
  api.people.mockRejectedValue(new Error("Administrator access was revoked"));
  await click("Refresh");
  expect(host.textContent).toContain("Administrator access was revoked");
  expect(host.textContent).not.toContain(person.email);
  expect(host.querySelector('[aria-label="Manage Private Person"]')).toBeNull();
  expect(button("Permanently delete account")).toBeUndefined();
  expect(api.delete).not.toHaveBeenCalled();
  api.people.mockResolvedValue({ people: [], total: 0 });
  await click("Refresh");
  expect(host.textContent).toContain("No matching accounts.");
  expect(host.textContent).not.toContain(person.email);
});

it.each(["access", "directory"] as const)("discards an edited company grant when the %s read fails and requires a fresh edit after retry", async source => {
  await render(); await click("Edit");
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  expect(button("Save company access").disabled).toBe(false);
  const read = source === "access" ? api.getAccess : api.companies;
  read.mockRejectedValue(new Error("Current company access unavailable"));
  await act(async () => { await client.invalidateQueries({ queryKey: source === "access" ? ["admin", "admin", "company-access", "member"] : ["directory"] }); }); await settle();
  expect(host.textContent).not.toContain("Private venture");
  expect(button("Save company access").disabled).toBe(true);
  expect(api.setAccess).not.toHaveBeenCalled();
  api.getAccess.mockResolvedValue({ companyAccess: [] });
  api.companies.mockResolvedValue([{ id: "venture", name: "Private venture" }]);
  await click("Retry company access");
  const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  expect(button("Save company access").disabled).toBe(true);
  await act(async () => checkbox.click());
  await click("Save company access");
  expect(api.setAccess).toHaveBeenCalledWith("member", ["venture"]);
});

it("resets an open deletion confirmation when the administrator identity changes", async () => {
  await render(); await click("Delete");
  expect(button("Permanently delete account")).toBeDefined();
  await render("other-admin");
  expect(button("Permanently delete account")).toBeUndefined();
  expect(api.delete).not.toHaveBeenCalled();
});
