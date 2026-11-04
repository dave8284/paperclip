// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AdminPeople } from "./AdminPeople";
const api = vi.hoisted(() => ({ people: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock("@/api/administration", () => ({ administrationApi: api, adminKey: (id: string) => ["admin", id] }));
vi.mock("@/api/access", () => ({ accessApi: { getUserCompanyAccess: async () => ({ companyAccess: [] }) } }));
vi.mock("@/api/companies-query", () => ({ companyDirectoryQueryOptions: () => ({ queryKey: ["directory"], queryFn: async () => [] }) }));

it("exposes edit/delete, saves a name with the current revision, and keeps ownership rejection visible", async () => {
  const person = { id: "member", name: "Member", email: "member@example.com", approvalStatus: "approved", approvalRevision: 4, providers: ["google"], activeCompanyMembershipCount: 1, emailVerified: true };
  api.people.mockResolvedValue({ people: [person, { ...person, id: "admin", name: "Owner" }], total: 2 });
  api.update.mockResolvedValue({}); api.delete.mockRejectedValue(new Error("Transfer company ownership before deleting this account."));
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); document.body.append(host);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  const click = async (label: string) => { await act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click()); await settle(); };
  const input = async (label: string, value: string) => { await act(async () => { const node = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); };
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AdminPeople userId="admin" /></QueryClientProvider>)); await settle();
    expect((host.querySelector('[aria-label="Delete Owner"]') as HTMLButtonElement).disabled).toBe(true);
    await click("Edit Member"); expect(document.activeElement?.getAttribute("aria-label")).toBe("Manage Member");
    await input("Display name", "Updated Member");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Save name")!.click()); await settle();
    expect(api.update).toHaveBeenCalledWith("member", { action: "rename", expectedRevision: 4, reason: "", name: "Updated Member" });
    await click("Delete Member");
    const remove = () => [...host.querySelectorAll("button")].find(button => button.textContent === "Permanently delete account")!;
    expect(remove().disabled).toBe(true);
    await input("Type email to confirm deletion", person.email);
    await act(async () => remove().click()); await settle();
    expect(api.delete).toHaveBeenCalledWith("member", 4, person.email);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Transfer company ownership");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
