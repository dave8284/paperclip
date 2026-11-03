import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_PALETTE_IDS, appearanceForPalette } from "@paperclipai/shared";
import { agentAvatarUrl } from "./agent-avatar-url";

const publicDir = resolve(import.meta.dirname, "../../public");
describe("AgentOS product identity", () => {
  it("ships exact product metadata and complete installation icons", () => {
    const html = readFileSync(resolve(publicDir, "../index.html"), "utf8");
    expect(html).toContain("<title>AgentOS</title>");
    expect(html).toContain('property="og:title" content="AgentOS"');
    expect(html).not.toMatch(/(?:>Paperclip|"Paperclip (?:is|couldn))/);
    const manifest = JSON.parse(readFileSync(resolve(publicDir, "site.webmanifest"), "utf8"));
    expect(manifest.name).toBe("AgentOS"); expect(manifest.short_name).toBe("AgentOS");
    for (const icon of manifest.icons) expect(existsSync(resolve(publicDir, icon.src.split("?")[0].slice(1)))).toBe(true);
    for (const [file, size] of [["favicon-16x16.png", 16], ["favicon-32x32.png", 32], ["apple-touch-icon.png", 180], ["android-chrome-192x192.png", 192], ["android-chrome-512x512.png", 512]] as const) {
      const png = readFileSync(resolve(publicDir, file));
      expect(png.subarray(1, 4).toString()).toBe("PNG"); expect(png.readUInt32BE(16)).toBe(size); expect(png.readUInt32BE(20)).toBe(size);
    }
  });
  it("resolves every saved palette to a real particle orb without changing user uploads", () => {
    for (const palette of AGENT_PALETTE_IDS) {
      const url = agentAvatarUrl(appearanceForPalette(palette));
      const svg = readFileSync(resolve(publicDir, url.slice(1)), "utf8");
      expect(svg).toContain("<circle"); expect(svg).not.toMatch(/cliplab|<path/i);
    }
    const custom = { ...appearanceForPalette("arctic-blue"), customAvatarAssetId: "22222222-2222-4222-8222-222222222222" };
    expect(agentAvatarUrl(custom)).toBe("/api/assets/22222222-2222-4222-8222-222222222222/content");
  });
  it("replaces legacy favicon and thinking URLs with orb artwork", () => {
    for (const name of ["agentos-mark.svg", "favicon.svg", "worktree-favicon.svg", "paperclip-thinking.svg"]) {
      const svg = readFileSync(resolve(publicDir, name), "utf8");
      expect(svg).toContain("<title>AgentOS</title>"); expect(svg).toContain("<circle"); expect(svg).not.toMatch(/cliplab|<path|paperclip-thinking-draw/i);
    }
  });
});
