import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";

export const PUBLIC_TUNNEL_HEADER = "x-agentos-public-tunnel";

/** The tunnel inserts this marker on every request. It can only restrict access;
 * it never supplies an identity. Native session/company checks still apply. */
export function publicTunnelRejection(req: IncomingMessage, authenticated: boolean) {
  if (req.headers[PUBLIC_TUNNEL_HEADER] === undefined) return null;
  if (!authenticated) return { status: 503, error: "Remote access is waiting for sign-in setup.", code: "agentos_tunnel_auth_required" };
  let path: string;
  try { path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname).toLowerCase(); }
  catch { return { status: 400, error: "Invalid request path.", code: "invalid_path" }; }
  // Vercel serves the compiled UI. Never publish Vite's source/filesystem
  // endpoints or the local development supervisor through the tunnel.
  if ((!path.startsWith("/api/") && !path.startsWith("/_plugins/"))
    || path.startsWith("/api/health/dev-server")) {
    return { status: 404, error: "Not found.", code: "not_found" };
  }
  return null;
}

/** Runs before *all* HTTP and upgrade listeners, including plugin/runner
 * listeners which deliberately live outside Express. No polling or DB calls. */
export function protectPublicTunnel(server: Server, authenticated: boolean) {
  const emit = server.emit;
  server.emit = function (event: string | symbol, ...args: unknown[]): boolean {
    if (event === "request" || event === "upgrade" || event === "checkContinue" || event === "checkExpectation") {
      const rejection = publicTunnelRejection(args[0] as IncomingMessage, authenticated);
      if (rejection) {
        const body = JSON.stringify(rejection);
        const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body), Connection: "close" };
        if (event === "upgrade") {
          (args[1] as Socket).end(`HTTP/1.1 ${rejection.status} Request Rejected\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n${body}`);
        } else {
          const response = args[1] as ServerResponse;
          response.writeHead(rejection.status, headers); response.end(body);
        }
        return true;
      }
    }
    return Reflect.apply(emit, this, [event, ...args]);
  };
}
