// @vitest-environment jsdom

import { act as reactAct } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { AuthPage } from "./Auth";
import { CliAuthPage } from "./CliAuth";
import { ApiError } from "../api/client";

const getSessionMock = vi.hoisted(() => vi.fn());
const signInEmailMock = vi.hoisted(() => vi.fn());
const signUpEmailMock = vi.hoisted(() => vi.fn());
const signInGoogleMock = vi.hoisted(() => vi.fn());
const authOptionsMock = vi.hoisted(() => vi.fn());
const navigateTopLevelMock = vi.hoisted(() => vi.fn());
const healthMock = vi.hoisted(() => vi.fn());
const beginCloudSignInMock = vi.hoisted(() => vi.fn());
vi.mock("@/api/administration", () => ({ administrationApi: { authOptions: () => authOptionsMock() } }));
vi.mock("@/lib/browserNavigation", () => ({ navigateTopLevel: (url: string) => navigateTopLevelMock(url) }));
vi.mock("@/components/FridayOrb", () => ({ FridayOrb: () => <div>Friday</div> }));

vi.mock("../api/health", () => ({ healthApi: { get: () => healthMock() } }));
vi.mock("@/lib/cloud-sign-in", () => ({
  beginCloudSignIn: (url: string) => beginCloudSignInMock(url),
  clearCloudSignInAttempt: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  authApi: {
    getSession: () => getSessionMock(),
    signInEmail: (input: unknown) => signInEmailMock(input),
    signUpEmail: (input: unknown) => signUpEmailMock(input),
    signInGoogle: (input: unknown) => signInGoogleMock(input),
  },
}));

// The ASCII art animation drives a canvas/requestAnimationFrame loop that adds
// nothing to these assertions, so stub it out.
vi.mock("@/components/AsciiArtAnimation", () => ({
  AsciiArtAnimation: () => null,
}));

// The auth page renders a ThemeToggle, which reads ThemeContext. The provider
// lives in main.tsx (above the router), so mock the hook here the same way
// SidebarAccountMenu.test.tsx does.
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

// The router's navigate wrapper reads the active company prefix from context.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: null,
    selectedCompanyId: null,
    companies: [],
    selectionSource: "manual",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  flushSync(() => {});
}

function renderAuthPage(container: HTMLElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { root, queryClient };
}

describe("AuthPage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    getSessionMock.mockResolvedValue(null);
    healthMock.mockResolvedValue({ status: "ok", deploymentMode: "authenticated" });
    beginCloudSignInMock.mockReturnValue(true);
    signInEmailMock.mockResolvedValue(undefined);
    signUpEmailMock.mockResolvedValue(undefined);
    signInGoogleMock.mockReset().mockResolvedValue("https://accounts.example.test/oauth-fixture");
    authOptionsMock.mockReset().mockResolvedValue({ googleEnabled: true, passwordSignInEnabled: true, passwordSignUpEnabled: true, approvalRequired: true });
    window.localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function mount(path = "/auth", cachedOptions?: Record<string, unknown>) {
    const { root, queryClient } = renderAuthPage(container);
    if (cachedOptions) queryClient.setQueryData(["public-auth-options"], cachedOptions);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await flushReact();
    await flushReact();
    return { root, queryClient };
  }

  it.each(["https://my.paperclip.app", "https://my-staging.paperclip.app"])("recovers Cloud auth through %s without rendering an instance form", async (origin) => {
    healthMock.mockResolvedValue({ cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: origin, stackSlug: "team" } });
    const { root } = await mount("/auth?next=%2FTEST%2Fissues%2FTEST-1%3Ftab%3Dactivity%23comment");
    await vi.waitFor(() => expect(beginCloudSignInMock).toHaveBeenCalledTimes(1));
    const target = new URL(beginCloudSignInMock.mock.calls[0][0]);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/v1/stacks/team/entry-redirect");
    expect(target.searchParams.get("returnTo")).toBe("/TEST/issues/TEST-1?tab=activity#comment");
    expect(container.querySelector("form")).toBeNull();
    await act(() => root.unmount());
  });

  it("never flashes a form while deployment metadata is loading", async () => {
    healthMock.mockReturnValue(new Promise(() => {}));
    const { root } = await mount();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Opening AgentOS");
    await act(() => root.unmount());
  });

  it("fails closed when deployment metadata cannot be loaded", async () => {
    healthMock.mockRejectedValue(new Error("offline"));
    const { root } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Unable to check sign-in"));
    expect(container.querySelector("form")).toBeNull();
    await act(() => root.unmount());
  });

  it("offers a manual Cloud retry after the automatic recovery limit", async () => {
    healthMock.mockResolvedValue({ cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: "https://my.paperclip.app", stackSlug: "team" } });
    beginCloudSignInMock.mockReturnValue(false);
    const { root } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Continue to the connection service"));
    expect(container.querySelector("form")).toBeNull();
    await act(() => root.unmount());
  });

  it("keeps incomplete Cloud configuration out of the instance form", async () => {
    healthMock.mockResolvedValue({ cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: null, stackSlug: null } });
    const { root } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Cloud sign-in is unavailable"));
    expect(container.querySelector("form")).toBeNull();
    expect(beginCloudSignInMock).not.toHaveBeenCalled();
    await act(() => root.unmount());
  });

  it.each(["/auth", "/auth?mode=sign_up"])("offers Google only without password registration at %s", async path => {
    authOptionsMock.mockResolvedValue({ googleEnabled: true, passwordSignInEnabled: false, passwordSignUpEnabled: false, approvalRequired: true });
    const { root } = await mount(path);
    expect(container.textContent).toContain("Continue with Google");
    expect(container.textContent).toContain("New accounts require administrator approval.");
    expect(container.querySelector("h1")?.textContent).toBe(path.includes("sign_up") ? "Join the AgentOS waiting list" : "Sign in to AgentOS");
    expect(container.textContent).toContain("Turn ideas into coordinated action.");
    expect(container.textContent).not.toContain("Registration is closed");
    expect(container.textContent).not.toContain("Create one");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(signInEmailMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
    await act(() => root.unmount());
  });

  it("never flashes cached password options while fresh options are loading", async () => {
    authOptionsMock.mockReturnValue(new Promise(() => {}));
    const { root } = await mount("/auth", { googleEnabled: false, passwordSignInEnabled: true, passwordSignUpEnabled: true, approvalRequired: true });
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Opening AgentOS");
    await act(() => root.unmount());
  });

  it("hides stale methods on an options error and lets the user retry", async () => {
    authOptionsMock.mockRejectedValueOnce(new Error("Options unavailable"));
    const { root } = await mount("/auth", { googleEnabled: false, passwordSignInEnabled: true, passwordSignUpEnabled: true, approvalRequired: true });
    await vi.waitFor(() => expect(container.textContent).toContain("Unable to load sign-in options"));
    expect(container.querySelector("form")).toBeNull();
    const retry = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Try again")!;
    await act(() => retry.click());
    await vi.waitFor(() => expect(container.textContent).toContain("Continue with Google"));
    expect(container.querySelector("input")).toBeNull();
    expect(authOptionsMock).toHaveBeenCalledTimes(2);
    await act(() => root.unmount());
  });

  it("keeps Google errors visible without a password form", async () => {
    authOptionsMock.mockResolvedValue({ googleEnabled: true, passwordSignInEnabled: false, passwordSignUpEnabled: false, approvalRequired: true });
    signInGoogleMock.mockRejectedValue(new Error("Google sign-in could not start. Try again."));
    const { root } = await mount();
    const google = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Continue with Google")!;
    await act(() => google.click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("Google sign-in could not start"));
    expect(container.querySelector("form")).toBeNull();
    expect(navigateTopLevelMock).not.toHaveBeenCalled();
    expect(google.disabled).toBe(false);
    await act(() => root.unmount());
  });

  it.each([
    ["/board-claim/fixture-owner?source=sign-in", "/board-claim/fixture-owner?source=sign-in"],
    ["/invite/fixture-invite", "/invite/fixture-invite"],
    ["https://untrusted.example.test/redirect", "/"],
  ])("retains the safe Google return path for %s", async (requested, expected) => {
    authOptionsMock.mockResolvedValue({ googleEnabled: true, passwordSignInEnabled: false, passwordSignUpEnabled: false, approvalRequired: true });
    const { root } = await mount(`/auth?next=${encodeURIComponent(requested)}`);
    const google = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Continue with Google")!;
    await act(() => google.click());
    await vi.waitFor(() => {
      expect(signInGoogleMock).toHaveBeenCalledWith(expected);
      expect(navigateTopLevelMock).toHaveBeenCalledWith("https://accounts.example.test/oauth-fixture");
    });
    await act(() => root.unmount());
  });

  it("retains the remembered invite when Google sign-in has no explicit return path", async () => {
    window.localStorage.setItem("paperclip:pending-invite-token", "fixture-remembered-invite");
    authOptionsMock.mockResolvedValue({ googleEnabled: true, passwordSignInEnabled: false, passwordSignUpEnabled: false, approvalRequired: true });
    const { root } = await mount();
    const google = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Continue with Google")!;
    await act(() => google.click());
    await vi.waitFor(() => expect(signInGoogleMock).toHaveBeenCalledWith("/invite/fixture-remembered-invite"));
    await act(() => root.unmount());
  });

  it("retains local-trusted entry when auth options are unavailable", async () => {
    healthMock.mockResolvedValue({ status: "ok", deploymentMode: "local_trusted" });
    authOptionsMock.mockRejectedValue(new Error("No authenticated options"));
    const { root } = await mount();
    expect(container.textContent).toContain("Your local workspace is ready.");
    expect(container.querySelector('a[href="/workspace"]')).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
    await act(() => root.unmount());
  });

  it("does not offer a password fallback when no sign-in method is available", async () => {
    authOptionsMock.mockResolvedValue({ googleEnabled: false, passwordSignInEnabled: false, passwordSignUpEnabled: false, approvalRequired: true });
    const { root } = await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign-in is unavailable");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    await act(() => root.unmount());
  });

  it.each([
    { passwordSignInEnabled: true, passwordSignUpEnabled: true },
    { passwordSignInEnabled: true, passwordSignUpEnabled: false },
    { passwordSignUpEnabled: true },
  ])("ignores legacy password options and keeps Google-only entry: %j", async passwordOptions => {
    authOptionsMock.mockResolvedValue({ googleEnabled: true, ...passwordOptions, approvalRequired: true });
    const { root } = await mount("/auth?mode=sign_up");
    expect(container.textContent).toContain("Continue with Google");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("Create one");
    expect(signInEmailMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
    await act(() => root.unmount());
  });

  it("does not expose legacy password entry when Google is unavailable", async () => {
    authOptionsMock.mockResolvedValue({ googleEnabled: false, passwordSignInEnabled: true, passwordSignUpEnabled: true, approvalRequired: true });
    const { root } = await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign-in is unavailable");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    await act(() => root.unmount());
  });

  it("drops previous-account access and companies before the Google redirect", async () => {
    const { root, queryClient } = await mount();
    queryClient.setQueryData(["registration", "previous-user"], { status: "approved" });
    queryClient.setQueryData(["administration", "previous-user", "overview"], { private: "previous account" });
    queryClient.setQueryData(queryKeys.access.currentBoardAccess, { companyIds: ["private-previous-company"] });
    queryClient.setQueryData(queryKeys.companies.all, [{ id: "private-previous-company" }]);
    navigateTopLevelMock.mockImplementationOnce(() => {
      expect(queryClient.getQueryData(["registration", "previous-user"])).toBeUndefined();
      expect(queryClient.getQueryData(["administration", "previous-user", "overview"])).toBeUndefined();
      expect(queryClient.getQueryData(queryKeys.access.currentBoardAccess)).toBeUndefined();
      expect(queryClient.getQueryData(queryKeys.companies.all)).toBeUndefined();
    });
    const google = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Continue with Google")!;
    await act(() => google.click());
    await vi.waitFor(() => expect(navigateTopLevelMock).toHaveBeenCalledWith("https://accounts.example.test/oauth-fixture"));
    await act(() => root.unmount());
  });
});

describe("CliAuthPage rate-limit recovery", () => {
  const challengeId = "00000000-0000-4000-8000-000000000429";
  const challengeToken = "synthetic-cli-approval-fixture-token";
  const challengePath = `/api/cli-auth/challenges/${challengeId}?token=${challengeToken}`;
  const challengeQueryKey = ["cli-auth-challenge", challengeId, challengeToken];
  const fetchCli = vi.fn<typeof fetch>();
  let cliContainer: HTMLDivElement;
  let cliRoot: ReturnType<typeof createRoot> | undefined;
  let cliClient: QueryClient | undefined;

  function response(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  function pending(expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()) {
    return { id: challengeId, status: "pending", command: "paperclipai auth login", clientName: "paperclipai cli",
      requestedAccess: "board", requestedCompanyId: null, requestedCompanyName: null, approvedAt: null,
      cancelledAt: null, expiresAt, approvedByUser: null, requiresSignIn: false, canApprove: true, currentUserId: "operator" };
  }

  async function advance(milliseconds: number) {
    await reactAct(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
    await reactAct(async () => { await vi.advanceTimersByTimeAsync(0); });
  }

  async function mountCli() {
    cliClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    cliRoot = createRoot(cliContainer);
    await reactAct(async () => {
      cliRoot!.render(<MemoryRouter initialEntries={[`/cli-auth/${challengeId}?token=${challengeToken}`]}>
        <QueryClientProvider client={cliClient!}><Routes>
          <Route path="/cli-auth/:id" element={<CliAuthPage />} />
        </Routes></QueryClientProvider>
      </MemoryRouter>);
    });
    await advance(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T20:00:00Z"));
    fetchCli.mockReset();
    vi.stubGlobal("fetch", fetchCli);
    getSessionMock.mockResolvedValue({ user: { id: "operator" }, session: { id: "operator-session" } });
    cliContainer = document.createElement("div");
    document.body.appendChild(cliContainer);
  });

  afterEach(async () => {
    await reactAct(async () => { cliRoot?.unmount(); });
    cliClient?.clear();
    cliRoot = undefined;
    cliClient = undefined;
    cliContainer.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("waits for the real API retry hint and recovers approval without a reload or automatic mutation", async () => {
    fetchCli.mockResolvedValueOnce(response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 2 } }, 429))
      .mockResolvedValueOnce(response(pending()));
    await mountCli();
    expect(fetchCli).toHaveBeenCalledTimes(1);
    expect(cliContainer.textContent).toContain("Retrying shortly");
    expect(cliContainer.textContent).not.toContain("CLI auth challenge unavailable");
    await advance(1999);
    expect(fetchCli).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchCli).toHaveBeenCalledTimes(2);
    expect(cliClient!.getQueryState(challengeQueryKey)).toMatchObject({ status: "success", fetchStatus: "idle", data: { status: "pending" } });
    await advance(1);
    expect(cliContainer.textContent).toContain("Approve AgentOS CLI access");
    expect(fetchCli.mock.calls.map(([url, init]) => [String(url), init?.method]))
      .toEqual([[challengePath, "GET"], [challengePath, "GET"]]);
  });

  it.each([400, 401, 403, 404, 410, 500])("does not retry an ordinary approval GET failure with HTTP%s", async status => {
    fetchCli.mockImplementation(async () => response({ error: "Challenge unavailable" }, status));
    await mountCli();
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    expect(cliClient!.getQueryState(challengeQueryKey)?.error).toBeInstanceOf(ApiError);
    await advance(10 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(1);
  });

  it("uses a nonzero fallback and stops after three retries when the actual challenge expiry is unknown", async () => {
    fetchCli.mockImplementation(async () => response({ error: "Too many CLI auth requests" }, 429));
    await mountCli();
    expect(cliClient!.getQueryData(challengeQueryKey)).toBeUndefined();
    await advance(59_999);
    expect(fetchCli).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchCli).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(fetchCli).toHaveBeenCalledTimes(3);
    await advance(60_000);
    expect(fetchCli).toHaveBeenCalledTimes(4);
    expect(cliClient!.getQueryState(challengeQueryKey)).toMatchObject({ status: "error", fetchStatus: "idle", error: { status: 429 } });
    await advance(1);
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    await advance(10 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(4);
  });

  it("does not schedule a hinted retry beyond the actual expiry from an earlier successful read", async () => {
    fetchCli.mockResolvedValueOnce(response(pending(new Date(Date.now() + 1500).toISOString())))
      .mockImplementation(async () => response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 2 } }, 429));
    await mountCli();
    expect(cliContainer.textContent).toContain("Approve AgentOS CLI access");
    await reactAct(async () => { void cliClient!.invalidateQueries({ queryKey: challengeQueryKey }); });
    await advance(0);
    expect(fetchCli).toHaveBeenCalledTimes(2);
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    await advance(10 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(2);
  });

  it("does not shorten a hint that falls outside the finite page retry window", async () => {
    fetchCli.mockImplementation(async () => response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 600 } }, 429));
    await mountCli();
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    await advance(20 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(1);
  });

  it("retries only the rate-limited read after one operator approval, without resubmitting it", async () => {
    let reads = 0;
    fetchCli.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") return response({ approved: true, status: "approved" });
      reads += 1;
      if (reads === 2) return response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 2 } }, 429);
      return response({ ...pending(), status: reads > 2 ? "approved" : "pending" });
    });
    await mountCli();
    const approve = [...cliContainer.querySelectorAll("button")].find(button => button.textContent === "Approve CLI access");
    expect(approve).toBeDefined();
    await reactAct(async () => { approve!.click(); });
    await advance(0);
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(reads).toBe(2);
    await advance(2000);
    expect(reads).toBe(3);
    expect(cliClient!.getQueryState(challengeQueryKey)).toMatchObject({ status: "success", fetchStatus: "idle", data: { status: "approved" } });
    await advance(1);
    expect(cliContainer.textContent).toContain("CLI access approved");
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => String(url)))
      .toEqual([`/api/cli-auth/challenges/${challengeId}/approve`]);
  });
});
