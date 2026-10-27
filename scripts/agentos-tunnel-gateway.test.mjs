import { once } from "node:events";
import { createServer, request } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { createTunnelGateway } from "./agentos-tunnel-gateway.mjs";
import { deploymentConfig } from "./stage-agentos-vercel.mjs";

async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test("streams request bodies, cookies and redirects while overwriting a forged tunnel marker", async () => {
  let observed;
  const backend = createServer(async (req, res) => {
    const body = []; for await (const chunk of req) body.push(chunk);
    observed = { headers: req.headers, body: Buffer.concat(body).toString(), path: req.url };
    res.writeHead(302, { location: "https://agentos.example/api/auth/callback/google", "set-cookie": ["one=1; HttpOnly; Secure", "two=2; HttpOnly; Secure"] }); res.end();
  });
  const origin = await listen(backend); const gateway = createTunnelGateway(origin); const proxy = await listen(gateway);
  try {
    const response = await fetch(`${proxy}/api/auth/sign-in?next=hello`, { method: "POST", body: "hello", redirect: "manual", headers: { cookie: "session=fixture", "x-agentos-public-tunnel": "0", connection: "x-agentos-public-tunnel" } });
    assert.equal(response.status, 302); assert.equal(response.headers.getSetCookie().length, 2);
    assert.equal(observed.headers["x-agentos-public-tunnel"], "1"); assert.equal(observed.headers.cookie, "session=fixture");
    assert.equal(observed.body, "hello"); assert.equal(observed.path, "/api/auth/sign-in?next=hello");
  } finally { await close(gateway); await close(backend); }
});

test("forwards a live upgrade bidirectionally with the mandatory marker", async () => {
  const backend = createServer();
  let marker;
  backend.on("upgrade", (req, socket, head) => {
    marker = req.headers["x-agentos-public-tunnel"];
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    if (head.length) socket.write(head);
    socket.on("data", chunk => socket.end(chunk));
  });
  const gateway = createTunnelGateway(await listen(backend)); const proxy = await listen(gateway);
  try {
    const echoed = await new Promise((resolve, reject) => {
      const req = request(`${proxy}/api/events/ws`, { headers: { connection: "Upgrade", upgrade: "websocket" } });
      req.on("upgrade", (_response, socket) => { socket.on("error", reject); socket.once("data", chunk => { socket.destroy(); resolve(chunk.toString()); }); socket.write("live-event"); });
      req.on("error", reject); req.setTimeout(2000, () => req.destroy(new Error("Timed out"))); req.end();
    });
    assert.equal(echoed, "live-event"); assert.equal(marker, "1");
  } finally { await close(gateway); await close(backend); }
});

test("backend outage returns an uncached error, and the gateway cannot target remote origins", async () => {
  const backend = createServer(); const origin = await listen(backend); await close(backend);
  const gateway = createTunnelGateway(origin); const proxy = await listen(gateway);
  try { const response = await fetch(`${proxy}/api/health`); assert.equal(response.status, 503); assert.equal((await response.json()).code, "agentos_backend_offline"); assert.equal(response.headers.get("cache-control"), "no-store"); }
  finally { await close(gateway); }
  assert.throws(() => createTunnelGateway("https://example.com"), /loopback/);
});

test("deployment preserves API/plugin paths before the SPA fallback", () => {
  assert.throws(() => deploymentConfig("http://localhost:3102"), /HTTPS/);
  const { routes } = deploymentConfig("https://example.ngrok-free.app");
  assert.equal(routes.find(route => route.src === "/api/(.*)" && !route.has).dest, "https://example.ngrok-free.app/api/$1");
  assert.equal(routes.find(route => route.src === "/_plugins/(.*)").dest, "https://example.ngrok-free.app/_plugins/$1");
  assert.equal(routes.at(-1).dest, "/index.html");
});
