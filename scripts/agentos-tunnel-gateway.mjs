import { createServer, request } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Local-only transport boundary. Authentication remains in the native server.
 * The mandatory marker makes that server reject local-trusted mode on every
 * request/upgrade, including after a backend restart or configuration change. */
export function createTunnelGateway(origin = "http://127.0.0.1:3100") {
  const target = new URL(origin);
  if (target.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(target.hostname) || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("The gateway upstream must be a loopback HTTP origin.");
  function headers(req, upgrade) {
    const forwarded = { ...req.headers };
    // Hop-by-hop headers must not remove our mandatory marker or leak proxy
    // credentials to the application. Preserve native cookies/Authorization.
    for (const name of String(req.headers.connection ?? "").split(",")) delete forwarded[name.trim().toLowerCase()];
    for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) delete forwarded[name];
    forwarded["x-agentos-public-tunnel"] = "1";
    forwarded["x-forwarded-proto"] = "https";
    if (upgrade) { forwarded.connection = "Upgrade"; forwarded.upgrade = "websocket"; }
    return forwarded;
  }
  function upstream(req, upgrade) {
    const outgoing = request({ hostname: target.hostname.replace(/^\[|\]$/g, ""), port: target.port || 80, path: req.url, method: req.method, headers: headers(req, upgrade) });
    // Bound connection/header wait; established streams remain open.
    outgoing.setTimeout(10_000, () => outgoing.destroy(new Error("Backend unavailable")));
    return outgoing;
  }
  function unavailable(res) {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "The local Agent OS backend is offline. Start it on the host computer and retry.", code: "agentos_backend_offline" }));
  }
  const server = createServer((req, res) => {
    const outgoing = upstream(req, false);
    outgoing.on("response", incoming => {
      outgoing.setTimeout(0);
      res.writeHead(incoming.statusCode ?? 502, { ...incoming.headers, "cache-control": "no-store" });
      incoming.on("error", () => res.destroy()); incoming.pipe(res);
    });
    outgoing.on("error", () => unavailable(res));
    req.on("aborted", () => outgoing.destroy());
    res.on("close", () => outgoing.destroy());
    req.pipe(outgoing);
  });
  server.on("upgrade", (req, socket, head) => {
    const outgoing = upstream(req, true);
    socket.on("error", () => outgoing.destroy());
    socket.on("close", () => outgoing.destroy());
    outgoing.on("upgrade", (response, remote, remoteHead) => {
      outgoing.setTimeout(0); remote.setTimeout(0);
      const responseHeaders = [];
      for (let i = 0; i < response.rawHeaders.length; i += 2) responseHeaders.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders.join("\r\n")}\r\n\r\n`);
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      remote.on("error", () => socket.destroy());
      remote.on("close", () => socket.destroy());
      socket.on("close", () => remote.destroy());
      remote.pipe(socket); socket.pipe(remote);
    });
    outgoing.on("response", response => {
      response.resume();
      socket.end(`HTTP/1.1 ${response.statusCode ?? 502} Upgrade Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    });
    outgoing.on("error", () => socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"));
    outgoing.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createTunnelGateway();
  server.listen(3102, "127.0.0.1", () => console.log("Agent OS tunnel gateway listening on 127.0.0.1:3102. Forward ngrok to this port, never directly to 3100."));
  const sockets = new Set();
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { for (const socket of sockets) socket.destroy(); server.close(); });
}
