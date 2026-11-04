// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingApproval } from "./PendingApproval";

const { registration, signOut, navigateTopLevel, identity } = vi.hoisted(() => ({
  registration: vi.fn(), signOut: vi.fn(), navigateTopLevel: vi.fn(),
  identity: { userId: "person" as string | null, settled: true, failed: false },
}));
vi.mock("@/components/FridayOrb", () => ({ FridayOrb: () => null }));
vi.mock("@/lib/router", async () => await import("react-router-dom"));
vi.mock("@/api/administration", () => ({ administrationApi: { registration }, registrationKey: (id: string | null) => ["registration", id] }));
vi.mock("@/api/auth", () => ({ authApi: { signOut } }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => identity }));
vi.mock("@/lib/browserNavigation", () => ({ navigateTopLevel }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
function reply(status: string) { return { status, userId: identity.userId, isInstanceAdmin: false }; }
function render() {
  root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/pending-approval"]}>
    <Routes>
      <Route path="/pending-approval" element={<PendingApproval />} />
      <Route path="/workspace" element={<p>Workspace destination</p>} />
      <Route path="/auth" element={<p>Sign-in destination</p>} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}
async function mount() { await act(async () => render()); await settle(); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function waitForText(text: string) { await vi.waitFor(async () => { await settle(); expect(container.textContent).toContain(text); }); }
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await settle();
}
function burst() { return container.querySelector(".waitlist-celebration"); }

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(identity, { userId: "person", settled: true, failed: false });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  registration.mockImplementation(async () => reply("pending"));
  signOut.mockResolvedValue({ redirectTo: "/welcome" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); container.remove(); vi.unstubAllGlobals();
});

describe("PendingApproval", () => {
  it("thanks a confirmed waiting-list member and explains the manual status check without promising email", async () => {
    await mount();
    await waitForText("Thank you for joining the waiting list");
    expect(container.textContent).toContain("Your registration is complete. An administrator will review your request for access.");
    expect(container.textContent).toContain("Refresh your approval status");
    expect(container.textContent).not.toMatch(/email|companies and agents|company access/i);
    expect(burst()).not.toBeNull();
    expect(burst()?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("waits for identity before reading registration", async () => {
    identity.settled = false; identity.userId = null;
    await mount();
    expect(container.textContent).toContain("Checking your account…");
    expect(registration).not.toHaveBeenCalled();
    expect(burst()).toBeNull();
    identity.settled = true; identity.userId = "person";
    await act(async () => render());
    await waitForText("Thank you for joining the waiting list");
    expect(registration).toHaveBeenCalledTimes(1);
  });

  it("does not celebrate cached pending status before revalidation", async () => {
    client.setQueryData(["registration", "person"], reply("pending"));
    registration.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(burst()).toBeNull();
    expect(container.textContent).toContain("Checking approval…");
  });

  it.each(["approved", "pending"])("hides stale %s status and confetti on a read failure", async cached => {
    client.setQueryData(["registration", "person"], reply(cached));
    registration.mockRejectedValue(new Error("Unable to read approval. Try again."));
    await mount();
    await waitForText("Unable to check access");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to read approval");
    expect(container.textContent).not.toContain("Workspace destination");
    expect(container.textContent).not.toContain("Thank you for joining");
    expect(burst()).toBeNull();
  });

  it("fails closed on an identity error without fetching another account's status", async () => {
    identity.failed = true; identity.settled = false;
    await mount();
    expect(container.textContent).toContain("Unable to check your session");
    expect(registration).not.toHaveBeenCalled();
    expect(burst()).toBeNull();
  });

  it.each([
    ["approved", "Workspace destination"], ["anonymous", "Sign-in destination"],
    ["suspended", "Your access has been suspended"], ["rejected", "Your registration was not approved"],
  ])("handles %s without celebrating", async (status, text) => {
    registration.mockResolvedValue(reply(status));
    await mount(); await waitForText(text);
    expect(burst()).toBeNull();
    expect(container.textContent).not.toContain("Thank you for joining");
  });

  it("reports still pending after refresh and never replays the completed celebration", async () => {
    await mount(); await waitForText("Thank you for joining");
    const celebration = burst()!;
    await act(async () => celebration.dispatchEvent(new Event("AnimationEvent" in window ? "animationend" : "webkitAnimationEnd", { bubbles: true })));
    expect(burst()).toBeNull();
    await click("Refresh approval status");
    await waitForText("Status refreshed. Your account is still waiting for approval.");
    expect(registration).toHaveBeenCalledTimes(2);
    expect(burst()).toBeNull();
  });

  it("shows refresh progress and routes a newly approved member to the workspace", async () => {
    await mount(); await waitForText("Thank you for joining");
    let resolve!: (value: unknown) => void;
    registration.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await click("Refresh approval status");
    expect(container.textContent).toContain("Checking approval…");
    expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Checking approval…")?.disabled).toBe(true);
    expect(burst()).toBeNull();
    await act(async () => resolve(reply("approved")));
    await waitForText("Workspace destination");
    expect(burst()).toBeNull();
  });

  it("refresh failure clears stale pending acknowledgement, and retry restores it without replay", async () => {
    await mount(); await waitForText("Thank you for joining");
    registration.mockRejectedValueOnce(new Error("Check failed. Try again."));
    await click("Refresh approval status"); await waitForText("Check failed. Try again.");
    expect(container.textContent).not.toContain("Thank you for joining");
    expect(burst()).toBeNull();
    await click("Refresh approval status"); await waitForText("Status refreshed.");
    expect(burst()).toBeNull();
  });

  it("does not apply an earlier account's refresh acknowledgement to the next account", async () => {
    await mount(); await waitForText("Thank you for joining");
    let resolve!: (value: unknown) => void;
    registration.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await click("Refresh approval status");
    identity.userId = "next-person";
    await act(async () => render()); await waitForText("Thank you for joining");
    await act(async () => resolve({ status: "pending", userId: "person", isInstanceAdmin: false })); await settle();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(client.getQueryData(["registration", "next-person"])).toMatchObject({ userId: "next-person" });
  });

  it("clears cached account data on sign-out and uses the native redirect", async () => {
    await mount(); await waitForText("Thank you for joining");
    client.setQueryData(["administration", "person"], { private: true });
    await click("Sign out");
    await vi.waitFor(() => expect(navigateTopLevel).toHaveBeenCalledWith("/welcome"));
    expect(client.getQueryData(["administration", "person"])).toBeUndefined();
  });

  it("keeps sign-out failure visible without losing the waiting-list state", async () => {
    signOut.mockRejectedValue(new Error("Sign-out failed. Try again."));
    await mount(); await waitForText("Thank you for joining"); await click("Sign out");
    await waitForText("Sign-out failed. Try again.");
    expect(container.textContent).toContain("Thank you for joining");
    expect(navigateTopLevel).not.toHaveBeenCalled();
  });
});
