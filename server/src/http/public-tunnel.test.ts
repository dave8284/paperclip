import { once } from "node:events";
import { createServer, request } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { protectPublicTunnel, PUBLIC_TUNNEL_HEADER } from "./public-tunnel.js";

describe("public tunnel admission", () => {
  async function fixture(authenticated: boolean) {
    const listener = vi.fn((_req, res) => res.end("native handler"));
    const server = createServer(listener);
    protectPublicTunnel(server, authenticated);
    const upgraded = vi.fn((_req, socket: Socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"));
    server.on("upgrade", upgraded);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Not listening");
    return { origin: `http://127.0.0.1:${address.port}`, listener, upgraded, close: async () => {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    } };
  }

  it("blocks local-trusted traffic without breaking direct localhost requests", async () => {
    const f = await fixture(false);
    try {
      const denied = await fetch(`${f.origin}/api/companies`, { headers: { [PUBLIC_TUNNEL_HEADER]: "1" } });
      expect(denied.status).toBe(503); expect(denied.headers.get("cache-control")).toBe("no-store");
      expect(f.listener).not.toHaveBeenCalled();
      expect(await (await fetch(`${f.origin}/api/companies`)).text()).toBe("native handler");
    } finally { await f.close(); }
  });

  it("hands authenticated API requests to native auth but hides dev assets and controls", async () => {
    const f = await fixture(true);
    try {
      for (const path of ["/@fs/private", "/src/App.tsx", "/api/health/dev-server/restart", "/API/health/dev-server/restart"]) {
        expect((await fetch(`${f.origin}${path}`, { headers: { [PUBLIC_TUNNEL_HEADER]: "1" } })).status).toBe(404);
      }
      expect(f.listener).not.toHaveBeenCalled();
      expect(await (await fetch(`${f.origin}/api/auth/get-session`, { headers: { [PUBLIC_TUNNEL_HEADER]: "1" } })).text()).toBe("native handler");
      expect(await (await fetch(`${f.origin}/_plugins/example/ui/index.js`, { headers: { [PUBLIC_TUNNEL_HEADER]: "1" } })).text()).toBe("native handler");
    } finally { await f.close(); }
  });

  it.each([false, true])("guards upgrades before every listener (authenticated=%s)", async authenticated => {
    const f = await fixture(authenticated);
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${f.origin}/api/companies/example/events/ws`, { headers: { connection: "Upgrade", upgrade: "websocket", [PUBLIC_TUNNEL_HEADER]: "1" } }, res => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject); req.setTimeout(2000, () => req.destroy(new Error("Upgrade timed out"))); req.end();
      });
      expect(status).toBe(authenticated ? 401 : 503);
      expect(f.upgraded).toHaveBeenCalledTimes(authenticated ? 1 : 0);
    } finally { await f.close(); }
  });
});
