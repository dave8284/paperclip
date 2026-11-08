// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { ModelProfileQualification, ModelProfileQualificationEvidence, ModelProfileQualificationList } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { agentosModelsKey } from "@/api/agentos-models";
import { AgentOSModelSettings } from "./AgentOSModelSettings";
vi.mock("./ModelComparisonPreparation", () => ({ ModelComparisonPreparation: () => <section aria-label="Prepare model comparison" /> }));
vi.mock("./ModelRoutingControls", () => ({ ModelRoutingControls: () => <section aria-label="Automatic model routing" /> }));

const mocks = vi.hoisted(() => ({ accounts: vi.fn(), catalog: vi.fn(), qualifications: vi.fn(), register: vi.fn(), revoke: vi.fn(),
  identity: { userId: "owner", settled: true, failed: false } }));
vi.mock("@/api/agentos-models", async original => ({ ...await original<typeof import("@/api/agentos-models")>(), agentosModelsApi: mocks }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => mocks.identity }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("./ModelIntelligenceInsights", () => ({ ModelIntelligenceInsights: () => <p>Private company learning</p> }));

const run = "11111111-1111-4111-8111-111111111111", review = "22222222-2222-4222-8222-222222222222";
function evidence(overrides: Partial<ModelProfileQualificationEvidence> = {}): ModelProfileQualificationEvidence {
  return { runId: run, issueId: "task", issueIdentifier: "WORK-1", issueTitle: "Repair the report", agentId: "employee", agentName: "Alex",
    model: "observed-model", reviewDecisionId: null, nativeReviewInteractionId: review, state: "workflow_qualified",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(), maximumValidUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(), ...overrides };
}
function qualification(overrides: Partial<ModelProfileQualification> = {}): ModelProfileQualification {
  return { id: "qualification", agentId: "employee", runId: run, issueId: "task", reviewDecisionId: null, nativeReviewInteractionId: review,
    state: "workflow_qualified", profile: { schema: "agentos.model-profile-binding.v1", provider: "openai", model: "observed-model", requestedEffort: "high",
      taskType: "engineering.debugging", complexity: "routine", promptFingerprint: "prompt", configurationFingerprint: "config", accountFingerprint: "account" },
    observedProviderVersion: "1.0", observedModel: "observed-model", observedEffort: "high", observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    validUntil: new Date(Date.now() + 86_400_000).toISOString(), qualifiedByUserId: "owner", evidenceScope: "completed_native_session", ...overrides };
}
function list(rows = [qualification()], available = [evidence()]): ModelProfileQualificationList {
  return { qualifications: rows, availableEvidence: available, limit: 100, evidenceLimit: 20 };
}
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(mocks.identity, { userId: "owner", settled: true, failed: false });
  mocks.accounts.mockResolvedValue({ currentUserId: "owner", canManageConnections: true, connections: [{ id: "seat", grantId: "grant", name: "Private seat", provider: "openai", method: "subscription", status: "connected" }] });
  mocks.catalog.mockResolvedValue({ learning: {}, learningAccess: "admin", models: [{ id: "observed-model", label: "Observed model", provider: "openai", observed: true, configuredAgents: [{ id: "employee", name: "Alex" }] }] });
  mocks.qualifications.mockResolvedValue(list());
  mocks.register.mockResolvedValue({ created: true, qualification: qualification() });
  mocks.revoke.mockResolvedValue(qualification({ state: "revoked" }));
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function fixture() {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = async (companyId = "company") => { await act(async () => root.render(<QueryClientProvider client={client}><AgentOSModelSettings companyId={companyId} /></QueryClientProvider>)); await settle(); };
  await render();
  return { host, client, render, close: async () => { await act(async () => root.unmount()); client.clear(); host.remove(); } };
}
const button = (host: Element, name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(row => row.textContent === name)!;
async function click(host: Element, name: string) { expect(button(host, name)).toBeTruthy(); await act(async () => button(host, name).click()); await settle(); }
async function choose(host: Element) {
  const field = host.querySelector<HTMLSelectElement>("select")!;
  await act(async () => { field.value = field.options[1].value; field.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function expiry(host: Element, value: string) {
  const field = host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("registers selected native reviewed evidence with finite expiry and keeps one request identity across a lost-response retry", async () => {
  mocks.register.mockRejectedValueOnce(new Error("Response unavailable"));
  const view = await fixture();
  try {
    expect(view.host.textContent).toContain("current account and workflow qualification");
    expect(view.host.textContent).not.toContain("until account-specific model qualification is implemented");
    expect(view.host.querySelector("select")?.textContent).toContain("WORK-1 · Repair the report · Alex · observed-model · Workflow qualified");
    await choose(view.host);
    expect(view.host.querySelectorAll("input")).toHaveLength(1);
    await click(view.host, "Register qualification");
    const first = mocks.register.mock.calls[0][1];
    expect(first).toEqual({ requestKey: expect.any(String), runId: run, nativeReviewInteractionId: review, validUntil: expect.any(String) });
    expect(first.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(first.validUntil)).toBeGreaterThan(Date.now());
    expect(Date.parse(first.validUntil)).toBeLessThanOrEqual(Date.parse(evidence().maximumValidUntil));
    await click(view.host, "Register qualification");
    expect(mocks.register.mock.calls[1][1]).toEqual(first);
    expect(view.host.textContent).toContain("Workflow qualified recorded.");
    expect(view.host.querySelector<HTMLInputElement>("input")).toBeNull();
  } finally { await view.close(); }
});

it.each(["access", "legacy"])("uses only the discovered %s review reference and rejects an expiry outside the evidence window", async kind => {
  const row = evidence({ nativeReviewInteractionId: null, reviewDecisionId: kind === "legacy" ? review : null, state: kind === "legacy" ? "workflow_qualified" : "access_verified" });
  mocks.qualifications.mockResolvedValue(list([], [row]));
  const view = await fixture();
  try {
    await choose(view.host);
    const initial = view.host.querySelector<HTMLInputElement>("input")!.value;
    await expiry(view.host, "2000-01-01T00:00");
    expect(button(view.host, "Register qualification").disabled).toBe(true);
    await expiry(view.host, "2099-01-01T00:00");
    expect(button(view.host, "Register qualification").disabled).toBe(true);
    expect(mocks.register).not.toHaveBeenCalled();
    await expiry(view.host, initial);
    await click(view.host, "Register qualification");
    expect(mocks.register.mock.calls[0][1]).toEqual({ requestKey: expect.any(String), runId: run,
      ...(kind === "legacy" ? { reviewDecisionId: review } : {}), validUntil: expect.any(String) });
    expect(view.host.textContent).toContain("Session access alone never enables alternative routing");
  } finally { await view.close(); }
});

it("gives edited evidence a new request identity after a failed registration", async () => {
  mocks.register.mockRejectedValue(new Error("Response unavailable"));
  const view = await fixture();
  try {
    await choose(view.host); await click(view.host, "Register qualification");
    const first = mocks.register.mock.calls[0][1];
    const field = view.host.querySelector<HTMLInputElement>("input")!;
    const edited = new Date(new Date(field.value).getTime() - 3_600_000);
    const local = new Date(edited.getTime() - edited.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await expiry(view.host, local); await click(view.host, "Register qualification");
    expect(mocks.register.mock.calls[1][1].requestKey).not.toBe(first.requestKey);
    expect(mocks.register.mock.calls[1][1].validUntil).not.toBe(first.validUntil);
  } finally { await view.close(); }
});

it("hides cached evidence, selection and revoke confirmation after read denial, then requires a fresh selection on retry", async () => {
  const view = await fixture();
  try {
    await choose(view.host); await click(view.host, "Revoke");
    mocks.qualifications.mockRejectedValue(new ApiError("Forbidden", 403, null));
    await act(async () => { await view.client.invalidateQueries({ queryKey: [...agentosModelsKey("company", "owner"), "qualifications"] }); }); await settle();
    const scope = view.host.querySelector('[aria-label="Current model qualifications"]')!;
    expect(scope.textContent).not.toContain("Repair the report");
    expect(scope.querySelector("select")).toBeNull();
    expect(scope.querySelector('[aria-label="Confirm qualification revocation"]')).toBeNull();
    expect(scope.textContent).not.toContain("No model qualifications registered");
    mocks.qualifications.mockResolvedValue(list()); await click(view.host, "Retry qualifications");
    expect(view.host.querySelector<HTMLSelectElement>("select")?.value).toBe("");
    expect(view.host.querySelector("input")).toBeNull();
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it("keeps account and company evidence isolated and discards draft actions when either changes", async () => {
  const view = await fixture();
  try {
    await choose(view.host); await click(view.host, "Revoke");
    mocks.accounts.mockResolvedValue({ currentUserId: "other", canManageConnections: false, connections: [] });
    mocks.catalog.mockResolvedValue({ learning: null, models: [] });
    mocks.qualifications.mockResolvedValue(list([], []));
    mocks.identity.userId = "other"; await view.render();
    expect(view.host.textContent).not.toContain("Private seat");
    expect(view.host.textContent).not.toContain("Repair the report");
    expect(view.host.querySelector("input")).toBeNull();
    expect(view.host.querySelector('[aria-label="Confirm qualification revocation"]')).toBeNull();
    await view.render("second-company");
    expect(mocks.qualifications).toHaveBeenLastCalledWith("second-company", expect.any(AbortSignal));
    expect(view.client.getQueryData([...agentosModelsKey("company", "owner"), "qualifications"])).toBeDefined();
    expect(view.client.getQueryData([...agentosModelsKey("second-company", "other"), "qualifications"])).toEqual(list([], []));
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it("does not read unknown account evidence and suppresses cached subscription and learning data after their reads fail", async () => {
  mocks.identity.settled = false;
  const view = await fixture();
  try {
    expect(mocks.qualifications).not.toHaveBeenCalled(); expect(mocks.accounts).not.toHaveBeenCalled();
    mocks.identity.settled = true; await view.render();
    expect(view.host.textContent).toContain("Private seat"); expect(view.host.textContent).toContain("Private company learning");
    mocks.accounts.mockRejectedValue(new Error("Account access lost")); mocks.catalog.mockRejectedValue(new Error("Catalogue access lost"));
    await act(async () => { await view.client.invalidateQueries({ queryKey: agentosModelsKey("company", "owner") }); }); await settle();
    expect(view.host.textContent).not.toContain("Private seat"); expect(view.host.textContent).not.toContain("Private company learning");
    expect(view.host.querySelector('a[href="/apps/seat/permissions"]')).toBeNull();
  } finally { await view.close(); }
});

it("revokes only the reviewed selection after confirmation and refreshes the native state", async () => {
  const view = await fixture();
  try {
    await click(view.host, "Revoke"); await click(view.host.querySelector('[aria-label="Confirm qualification revocation"]')!, "Cancel");
    expect(mocks.revoke).not.toHaveBeenCalled();
    await click(view.host, "Revoke"); mocks.qualifications.mockResolvedValue(list([qualification({ state: "revoked" })]));
    await click(view.host, "Revoke qualification");
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("company", "qualification");
    expect(view.host.textContent).toContain("Revoked"); expect(button(view.host, "Revoke")).toBeUndefined();
  } finally { await view.close(); }
});

it("removes controls when mutation authority is denied even while a previously successful read is cached", async () => {
  mocks.register.mockRejectedValue(new ApiError("Membership revoked", 403, null));
  const view = await fixture();
  try {
    await choose(view.host); await click(view.host, "Register qualification");
    expect(view.host.querySelector("select")).toBeNull();
    expect(view.host.querySelector('[aria-label="Current model qualifications"]')?.textContent).not.toContain("Repair the report");
    mocks.qualifications.mockResolvedValue(list([], [])); await click(view.host, "Retry qualifications");
    expect(view.host.querySelector("select")).not.toBeNull(); expect(view.host.querySelector("input")).toBeNull();
  } finally { await view.close(); }
});
