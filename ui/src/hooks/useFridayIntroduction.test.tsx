// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFridayIntroduction } from "./useFridayIntroduction";

describe("Friday first-interaction introduction", () => {
  let host: HTMLDivElement, root: Root;
  const renders: boolean[] = [];
  function Home({ scope, started }: { scope: string; started: boolean }) {
    const { introduced, dismissIntroduction } = useFridayIntroduction(scope, started);
    renders.push(introduced);
    return <>{!introduced && <p>Introduction</p>}<button onClick={dismissIntroduction}>Talk</button></>;
  }
  beforeEach(() => { localStorage.clear(); renders.length = 0; host = document.createElement("div"); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); });
  async function render(scope = "conversation-a", started = false) { await act(async () => root.render(<Home scope={scope} started={started} />)); }
  it("dismisses immediately after deliberate interaction and remains dismissed when the conversation closes", async () => {
    await render(); expect(host.textContent).toContain("Introduction");
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).not.toContain("Introduction"); expect(localStorage.getItem("conversation-a")).toBe("true");
    await render("conversation-a", true); await render();
    expect(host.textContent).not.toContain("Introduction");
  });
  it("uses each conversation's current preference without flashing another scope's state", async () => {
    localStorage.setItem("conversation-a", "true");
    await render(); expect(renders[0]).toBe(true);
    await render("conversation-b"); expect(renders.at(-1)).toBe(false);
    await render("conversation-b", true); expect(host.textContent).not.toContain("Introduction");
    await render("conversation-c"); expect(host.textContent).toContain("Introduction");
    await render("conversation-b"); expect(host.textContent).not.toContain("Introduction");
  });
  it("retains the in-tab preference if browser storage is unavailable", async () => {
    const storage = localStorage instanceof Storage ? Storage.prototype : localStorage;
    vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    await render(); await act(async () => host.querySelector("button")!.click());
    await render("conversation-b"); expect(host.textContent).toContain("Introduction");
    await render(); expect(host.textContent).not.toContain("Introduction");
  });
});
