import { validNamespace } from "./http-auth.mjs";

const writes = Object.freeze({
  "/v1/select": "select", "/v1/evaluations": "evaluate", "/v1/policy": "policy",
  "/v1/datasets": "registerDataset", "/v1/comparisons": "registerComparison", "/v1/comparison-outcomes": "recordComparisonOutcome",
});
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const badRequest = message => new HttpError(400, message);

function parseObject(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw badRequest("Invalid JSON request"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("Expected a JSON object");
  // JSON.parse keeps the last duplicate key. Reject ambiguous root fields,
  // including Unicode-escaped namespace keys, before selecting any namespace.
  const keys = new Set();
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      for (index++; index < text.length; index++) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      let next = index + 1;
      while (/\s/.test(text[next] ?? "")) next++;
      if (depth === 1 && text[next] === ":") {
        const key = JSON.parse(text.slice(start, index + 1));
        if (keys.has(key)) throw badRequest("Duplicate request field");
        keys.add(key);
      }
    } else if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") depth--;
  }
  return value;
}
async function readObject(request, maximumBytes) {
  const chunks = []; let size = 0;
  // Keep the incoming socket alive long enough to send a bounded error. The
  // handler closes oversized requests after responding instead of allowing the
  // async iterator's early exit to destroy the socket before the 413 response.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw new HttpError(413, "Request too large");
    chunks.push(bytes);
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw badRequest("Invalid UTF-8 request"); }
  return parseObject(text);
}
function queryFields(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw badRequest("Unexpected or repeated query parameter");
  }
}

/** Actual standalone HTTP request boundary, usable without opening a listener.
 * Authorization precedes every store access, including policy and reports. */
export function createHttpHandler(store, authority) {
  return async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    const principal = authority.authenticate(request.headers.authorization);
    if (!principal) { response.setHeader("Connection", "close"); send(401, { error: "Unauthorized" }); return; }
    function authorizeNamespace(namespace, allowAggregate = false) {
      if (namespace === undefined && allowAggregate && principal.kind === "operator") return;
      if (!validNamespace(namespace)) throw badRequest("An explicit namespace is required");
      if (!authority.permits(principal, namespace)) throw new HttpError(403, "Namespace access denied");
    }
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && (request.headers["transfer-encoding"] !== undefined
        || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))) throw badRequest("GET requests do not accept a body");
      if (request.method === "GET" && url.pathname === "/v1/analytics") {
        queryFields(url, ["namespace"]);
        const namespace = url.searchParams.get("namespace") ?? undefined;
        authorizeNamespace(namespace, true);
        send(200, store.analytics(namespace)); return;
      }
      if (request.method === "GET" && url.pathname === "/v1/comparisons/report") {
        queryFields(url, ["namespace", "comparisonId"]);
        const namespace = url.searchParams.get("namespace") ?? undefined;
        authorizeNamespace(namespace);
        send(200, store.comparisonReport({ namespace, comparisonId: url.searchParams.get("comparisonId") })); return;
      }
      const method = Object.hasOwn(writes, url.pathname) ? writes[url.pathname] : null;
      if (request.method !== "POST" || !method) { send(404, { error: "Not found" }); return; }
      // Writes carry namespace only in JSON. Reject query/body ambiguity rather
      // than choosing precedence, even if both values happen to match.
      queryFields(url, []);
      const input = await readObject(request, method === "registerDataset" ? 131072 : 65536);
      authorizeNamespace(input.namespace);
      send(200, store[method](input));
    } catch (error) {
      if (error instanceof HttpError && error.status === 413) response.setHeader("Connection", "close");
      send(error instanceof HttpError ? error.status : 400, { error: error.message });
    }
  };
}
