// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToastActions, type ToastInput } from "../context/ToastContext";
import { ToastViewport } from "./ToastViewport";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
vi.stubGlobal("cancelAnimationFrame", clearTimeout);
function Notify({ toast, presentation }: { toast: ToastInput; presentation?: "inline" }) {
  const { pushToast } = useToastActions();
  useEffect(() => { pushToast(toast); }, [pushToast, toast]);
  return <ToastViewport presentation={presentation} />;
}
describe("notification avatars", () => {
  it("keeps AgentOS activity quiet and shows failures inline with their recovery action", () => {
    const container = document.createElement("div"), root = createRoot(container), recover = vi.fn();
    try {
      act(() => root.render(<ToastProvider><Notify presentation="inline" toast={{ title: "Routine completed", tone: "success" }} /></ToastProvider>));
      expect(container.textContent).not.toContain("Routine completed");
      act(() => root.render(<ToastProvider><Notify presentation="inline" toast={{ title: "Could not save", body: "Your draft remains available.", tone: "error", action: { label: "Retry", onClick: recover } }} /></ToastProvider>));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your draft remains available.");
      expect(container.querySelector("aside, .fixed")).toBeNull();
      act(() => [...container.querySelectorAll("button")].find(button => button.textContent === "Retry")!.click());
      expect(recover).toHaveBeenCalledOnce();
    } finally { act(() => root.unmount()); }
  });
  it.each(["user", "agent"] as const)("carries the %s identity through the provider to the viewport", (type) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(<ToastProvider><Notify toast={{ title: "Alex Example created a task", actor: { type, id: "actor-1", name: "Alex Example" } }} /></ToastProvider>));
      expect(container.textContent).toContain("Alex Example created a task");
      if (type === "user") expect(container.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe("AE");
      else expect(container.querySelector('[data-slot="agent-avatar"] img')?.getAttribute("src")).toContain("/agentos-orbs/");
    } finally { act(() => root.unmount()); }
  });
});
