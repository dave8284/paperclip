import { createHash } from "node:crypto";

export const MODEL_BACKUP_MANIFEST_SCHEMA = "agentos.model-intelligence-backup-manifest.v1";
function cell(value, maxCellBytes) {
  if (value === null) return ["null"];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number" && Number.isFinite(value)) return ["real", Object.is(value, -0) ? "-0" : value.toString()];
  if (typeof value === "string" && Buffer.byteLength(value) <= maxCellBytes) return ["text", value];
  if (value instanceof Uint8Array && value.byteLength <= maxCellBytes) return ["blob", Buffer.from(value).toString("base64")];
  throw new Error("A stored value exceeds the bounded inventory contract; no manifest produced");
}

export function createMigrationTableDigest(name, columns, maxCellBytes = 2 * 1024 * 1024) {
  const digest = createHash("sha256");
  digest.update(JSON.stringify({ schema: MODEL_BACKUP_MANIFEST_SCHEMA, table: name, columns }));
  let count = 0, minimum = null, maximum = null;
  return {
    add(sequence, values) {
      if (typeof sequence !== "bigint" || maximum !== null && sequence <= BigInt(maximum) || values.length !== columns.length) throw new Error("Migration rows are not in exact source sequence order");
      digest.update("\n"); digest.update(JSON.stringify([sequence, ...values].map(value => cell(value, maxCellBytes))));
      minimum ??= sequence.toString(); maximum = sequence.toString(); count++;
    },
    finish() { return { name, columns, rows: count, rowidMinimum: minimum, rowidMaximum: maximum, contentSha256: digest.digest("hex") }; },
  };
}
