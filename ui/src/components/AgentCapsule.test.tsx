// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentCapsule } from "./AgentCapsule";

describe("legacy design preview portrait", () => {
  it("uses static particle artwork in every state, including old draw-on previews", () => {
    for (const state of ["slot", "configured", "online"] as const) {
      const html = renderToStaticMarkup(<AgentCapsule state={state} strokeDraw />);
      expect(html).toContain('/agentos-orbs/');
      expect(html).toContain(`data-state="${state}"`);
      expect(html).not.toMatch(/agent-cap-|<canvas|<rect|<animate/);
    }
  });
  it("retains accessible state, size and palette contracts", () => {
    const html = renderToStaticMarkup(<AgentCapsule state="online" gradient={11} size={{ width: 28, height: 96 }} />);
    expect(html).toContain('aria-label="agent online"');
    expect(html).toContain('data-gradient="1"');
    expect(html).toContain("width:28px;height:96px");
  });
});
