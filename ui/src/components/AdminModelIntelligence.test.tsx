// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminModelIntelligence } from "./AdminModelIntelligence";
const intelligence = vi.hoisted(() => vi.fn());
vi.mock("@/api/administration", () => ({ administrationApi: { intelligence }, adminKey: (id: string) => ["admin", id] }));
vi.mock("./ModelLearningPanel", () => ({ ModelLearningPanel: () => null }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient;
const fixture = {
  usage: [{ provider: "typesafe", model: "typesafe/jev-1.13", billingType: "metered_api", usageKind: "decision", receipts: 1, inputTokens: 1, outputTokens: 0, recordedCostCents: 0, unpriced: 1 }],
  decisions: [{ provider: "openrouter", model: "typesafe/jev-1.13", feature: "model_intelligence.triage", attempts: 1, succeeded: 0, failed: 0, unknown: 1, running: 0, meanDurationMs: null }],
  runs: [], learning: { status: "not_connected", evaluations: null, policyReleases: null, selections: 0, explanation: "No reviewed outcomes." },
  triage: { groups: [{ taskType: "engineering.building", complexity: "complex", contextStrategy: "context_rich_author_and_independent_review", decisionStatus: "not_run", reason: "subscription_only_policy", runs: 2 }],
    recordedRuns: 2, unrecordedRuns: 3, nativeReviewPreparedRuns: 1, quality: "not_evaluated" },
};
beforeEach(() => {
  intelligence.mockReset().mockResolvedValue(fixture);
  host = document.createElement("div"); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); });
async function mount() {
  await act(async () => root.render(<QueryClientProvider client={client}><AdminModelIntelligence userId="admin" /></QueryClientProvider>));
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(host.textContent).not.toContain("Loading recorded model activity"); });
}
it("distinguishes historical paid-policy blocks, recorded Jev calls and unproven review", async () => {
  await mount();
  expect(host.textContent).toContain("Decision inference not run · subscription-only policy");
  expect(host.textContent).toContain("Jev route · typed decisions");
  expect(host.textContent).toContain("Routing quality has not been evaluated");
  expect(host.textContent).toContain("do not prove fresh reviewer isolation");
  expect(host.textContent).toContain("Elephant: context-rich author + Goldfish: independent fresh-context review requested");
  expect(host.textContent).toContain("Not recorded");
  expect(host.textContent).not.toContain("100%");
});
it("shows missing server evidence explicitly", async () => {
  intelligence.mockResolvedValue({ ...fixture, triage: undefined }); await mount();
  expect(host.textContent).toContain("Task triage evidence is not available from this server");
});
it("hides cached administrative evidence when refresh access fails", async () => {
  client.setQueryData(["admin", "admin", "model-intelligence"], fixture);
  intelligence.mockRejectedValue(new Error("Administrator access revoked")); await mount();
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Administrator access revoked"); });
  expect(host.textContent).not.toContain("typesafe/jev-1.13");
  expect(host.textContent).not.toContain("Runs with triage evidence");
});

it("shows local readiness and measured shadow evidence without claiming quality or zero hardware cost", async () => {
  intelligence.mockResolvedValue({ ...fixture, decisions: [], triage: { ...fixture.triage,
    localRuntime: { provider: "local_laya", state: "warming", model: "convaiinnovations/laya@pinned/typed-decisions", sdkVersion: "0.4.22", checkpoint: "typed-decisions", externalFallback: false },
    groups: [{ ...fixture.triage.groups[0], provider: "local_laya", requestedModel: "convaiinnovations/laya@pinned/typed-decisions", resolvedModel: null, reason: "local_warming_up", computationKind: "not_run", meanElapsedMs: null }],
  } });
  await mount();
  expect(host.textContent).toContain("Local Laya · warming · SDK 0.4.22 · typed-decisions checkpoint · No external fallback");
  expect(host.textContent).toContain("Inference time not recorded");
  expect(host.textContent).toContain("Reported unknown");
  expect(host.textContent).toContain("Hardware cost unpriced");
  expect(host.textContent).not.toContain("Jev route · typed decisions");
});
