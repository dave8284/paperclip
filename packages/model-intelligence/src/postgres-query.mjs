import { MODEL_MIGRATION_TABLES as tables, MODEL_MIGRATION_SCHEMA as schema, quoteIdentifier as q } from "./migration-schema.mjs";
import { normalizeStorageRows } from "./storage-effects.mjs";

// This adapter handles only the package's fixed policy queries. No host SQL,
// names, identifiers or values enter the query text. Values stay parameters.
export function postgresQuery(sql) {
  sql = sql.replace(/json_extract\(payload,'\$\.comparisonId'\)/g, "(payload::jsonb)->>'comparisonId'");
  sql = sql.replace(/INSERT INTO (\w+) VALUES/g, (_match, name) => {
    if (!Object.hasOwn(tables, name)) throw new Error("Unknown Model Intelligence table");
    return `INSERT INTO ${name} (${tables[name].columns.map(q).join(",")}) VALUES`;
  });
  sql = sql.replace(/\b(FROM|JOIN|UPDATE|INTO) (\w+)\b/g, (_match, keyword, name) => {
    if (!Object.hasOwn(tables, name)) throw new Error("Unknown Model Intelligence table");
    return `${keyword} ${q(schema)}.${q(name)}`;
  });
  // PostgreSQL folds unquoted aliases; preserve the existing public camel case.
  sql = sql.replace(/\bAS ([a-zA-Z]+)\b/g, (_match, name) => `AS ${q(name)}`);
  let index = 0;
  sql = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === "?" ? `$${++index}` : token);
  return sql;
}

const integers = new Set(["rowid", "sequence", "receipt_cutoff", "deadline_at", "n", "next", "selections"]);
export async function executePostgresQuery(tx, effect) {
  const rows = await tx.unsafe(postgresQuery(effect.sql), effect.parameters.map(value => typeof value === "bigint" ? value.toString() : value));
  if (effect.method === "run") return;
  // postgres.js normally returns int8 as text. Never configure a lossy global
  // number parser on a host-owned connection. This conversion is local only.
  const normalized = normalizeStorageRows(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (integers.has(key) && typeof value === "string" && /^-?\d+$/.test(value)) return [key, BigInt(value)];
    return [key, value];
  }))));
  return effect.method === "get" ? normalized[0] : normalized;
}
