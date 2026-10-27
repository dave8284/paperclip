import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createModelIntelligence } from "./index.mjs";
const token = process.env.MODEL_INTELLIGENCE_TOKEN;
if (!token || token.length < 32) throw new Error("Set MODEL_INTELLIGENCE_TOKEN to at least 32 characters");
const store = createModelIntelligence(process.env.MODEL_INTELLIGENCE_DB ?? "./model-intelligence.sqlite");
const server = createServer(async (request,response) => {
  response.setHeader("Content-Type","application/json"); response.setHeader("Cache-Control","no-store");
  const provided = Buffer.from(request.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${token}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided,expected)) { response.writeHead(401); response.end(JSON.stringify({ error:"Unauthorized" })); return; }
  try {
    const url = new URL(request.url,"http://localhost");
    if (request.method === "GET" && url.pathname === "/v1/analytics") { response.end(JSON.stringify(store.analytics(url.searchParams.get("namespace") ?? undefined))); return; }
    const routes = { "/v1/select": "select", "/v1/evaluations": "evaluate", "/v1/policy": "policy" };
    const method = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    if (request.method !== "POST" || !method) { response.writeHead(404); response.end(JSON.stringify({ error:"Not found" })); return; }
    let body = "";
    for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 65536) { response.writeHead(413); response.end(JSON.stringify({ error:"Request too large" })); return; } }
    response.end(JSON.stringify(store[method](JSON.parse(body))));
  } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error:error.message })); }
});
server.requestTimeout = 15000;
server.listen(Number(process.env.PORT ?? 3191),"127.0.0.1",() => console.log(`Model Intelligence ready on 127.0.0.1:${server.address().port}`));
for (const signal of ["SIGINT","SIGTERM"]) process.once(signal,() => server.close(() => { store.close(); process.exit(0); }));
