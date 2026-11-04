// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOSLanding } from "./AgentOSLanding";

const fixture = vi.hoisted(() => ({ status: "anonymous", setTheme: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { status: fixture.status } }) }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => ({ userId: null }) }));
vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ setTheme: fixture.setTheme }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>, Navigate: ({ to }: any) => <div data-redirect={to} /> }));
vi.mock("@/components/FridayOrb", () => ({ FridayOrb: ({ decorative, pointerReactive }: any) => <span data-decorative={decorative} data-pointer-reactive={pointerReactive} /> }));

describe("AgentOS public landing", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => { fixture.status = "anonymous"; host = document.createElement("div"); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); });
  async function render(preview = false) { await act(async () => root.render(<AgentOSLanding preview={preview} />)); }
  it("introduces Friday and the work, keeps waitlist links, and makes the hero decorative and reactive", async () => {
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("Turn ideas into coordinated action.");
    expect(host.textContent).not.toMatch(/Whisper|speech into text|local voice enabled/);
    expect(host.querySelectorAll('a[href="/auth?mode=sign_up"]')[0]?.textContent).toContain("Join the waiting list");
    expect(host.querySelector('[data-pointer-reactive="true"][data-decorative="true"]')).not.toBeNull();
    expect(host.querySelectorAll('a[href="/auth?mode=sign_up"]')).toHaveLength(3);
    for (const anchor of host.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) expect(host.querySelector(anchor.getAttribute("href")!)).not.toBeNull();
    expect(host.querySelector('button[aria-label*="microphone"]')).toBeNull();
  });
  it("preserves approved and pending registration redirects", async () => {
    fixture.status = "approved"; await render(); expect(host.querySelector('[data-redirect="/workspace"]')).not.toBeNull();
    fixture.status = "pending"; await render(); expect(host.querySelector('[data-redirect="/pending-approval"]')).not.toBeNull();
  });
  it("keeps the explicit preview available for an approved user", async () => {
    fixture.status = "approved"; await render(true);
    expect(host.querySelector("h1")).not.toBeNull(); expect(host.querySelector("[data-redirect]")).toBeNull();
  });
});
