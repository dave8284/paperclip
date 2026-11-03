// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appearanceForPalette } from "@paperclipai/shared";
import { OnboardingCharacter } from "./OnboardingCharacter";

const createCharacter = vi.hoisted(() => vi.fn());
vi.mock("@paperclipai/shared/cliplab/runtime", () => ({ createCharacter }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); });
it("shows a muted orb before review and the selected palette on review without loading a mascot", async () => {
  const appearance = appearanceForPalette("arctic-blue");
  await act(async () => root.render(<OnboardingCharacter appearance={appearance} awake={false} />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/agentos-orbs/muted-dream.svg");
  await act(async () => root.render(<OnboardingCharacter appearance={appearance} awake />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/agentos-orbs/arctic-blue.svg");
  expect(createCharacter).not.toHaveBeenCalled(); expect(host.querySelector("canvas")).toBeNull();
});
it("keeps the appearance selection responsive without WebGL or a browser animation runtime", async () => {
  await act(async () => root.render(<OnboardingCharacter appearance={appearanceForPalette("arctic-blue")} awake />));
  await act(async () => root.render(<OnboardingCharacter appearance={appearanceForPalette("coral-mint")} awake />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/agentos-orbs/coral-mint.svg");
  expect(createCharacter).not.toHaveBeenCalled();
});
it("preserves a custom avatar uploaded by the user", async () => {
  const appearance = { ...appearanceForPalette("arctic-blue"), customAvatarAssetId: "22222222-2222-4222-8222-222222222222" };
  await act(async () => root.render(<OnboardingCharacter appearance={appearance} awake />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/assets/22222222-2222-4222-8222-222222222222/content");
});
