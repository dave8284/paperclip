import { createHash, timingSafeEqual } from "node:crypto";

const MAX_HOSTS = 100, MAX_NAMESPACES_PER_HOST = 100, MAX_NAMESPACE_GRANTS = 1000;
const invalid = () => new Error("Invalid Model Intelligence HTTP credential configuration");
const digest = value => createHash("sha256").update(value).digest();
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const validNamespace = value => typeof value === "string" && value.length <= 300 && value.trim().length > 0;

/** Parse only the named environment settings; malformed JSON must never print
 * its source, which includes credentials. Configuration changes require restart. */
export function httpAuthFromEnvironment(environment) {
  let hostCredentials = [];
  if (environment.MODEL_INTELLIGENCE_HOST_CREDENTIALS !== undefined) {
    const encoded = environment.MODEL_INTELLIGENCE_HOST_CREDENTIALS;
    if (typeof encoded !== "string" || Buffer.byteLength(encoded) > 524288) throw invalid();
    try { hostCredentials = JSON.parse(encoded); } catch { throw invalid(); }
  }
  return createHttpAuthority({ operatorToken: environment.MODEL_INTELLIGENCE_TOKEN, hostCredentials });
}

/** The server owns this configuration. Request fields cannot create authority.
 * Keep only fixed-size token digests and exact namespace sets in the matcher. */
export function createHttpAuthority({ operatorToken, hostCredentials = [] } = {}) {
  if (!Array.isArray(hostCredentials) || hostCredentials.length > MAX_HOSTS) throw invalid();
  const entries = [], ids = new Set(), secrets = new Set();
  let namespaceGrants = 0;
  function add(token, principal) {
    // HTTP bearer credentials cannot contain whitespace/control characters.
    if (typeof token !== "string" || token.length < 32 || token.length > 512 || !/^[\x21-\x7e]+$/.test(token)) throw invalid();
    const hash = digest(`Bearer ${token}`), key = hash.toString("hex");
    if (secrets.has(key)) throw invalid();
    secrets.add(key); entries.push({ hash, principal });
  }
  if (operatorToken !== undefined) add(operatorToken, Object.freeze({ kind: "operator" }));
  for (const host of hostCredentials) {
    if (!object(host) || Object.keys(host).some(key => !["id", "token", "namespaces"].includes(key))
      || typeof host.id !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(host.id) || ids.has(host.id)
      || !Array.isArray(host.namespaces) || !host.namespaces.length || host.namespaces.length > MAX_NAMESPACES_PER_HOST
      || host.namespaces.some(namespace => !validNamespace(namespace) || namespace === "*")
      || new Set(host.namespaces).size !== host.namespaces.length) throw invalid();
    namespaceGrants += host.namespaces.length;
    if (namespaceGrants > MAX_NAMESPACE_GRANTS) throw invalid();
    ids.add(host.id);
    add(host.token, Object.freeze({ kind: "host", id: host.id, namespaces: Object.freeze([...host.namespaces]) }));
  }
  if (!entries.length) throw invalid();
  return Object.freeze({
    authenticate(header) {
      if (typeof header !== "string" || header.length > 519) return null;
      const provided = digest(header);
      let principal = null;
      // Compare fixed-size hashes for every configured credential, including
      // after a match. Never compare variable-length plaintext tokens.
      for (const entry of entries) if (timingSafeEqual(provided, entry.hash)) principal = entry.principal;
      return principal;
    },
    permits(principal, namespace) {
      return principal?.kind === "operator" || (principal?.kind === "host" && principal.namespaces.includes(namespace));
    },
  });
}
