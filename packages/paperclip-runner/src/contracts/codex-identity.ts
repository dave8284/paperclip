export interface ExpectedCodexIdentity { cliVersion: string; model: string }
export interface ObservedCodexIdentity {
  cliVersion: string | null;
  model: string | null;
  /** The reported session default; never evidence of a per-turn override. */
  reasoningEffort: string | null;
  source: "thread/start" | "thread/resume";
}
const versionPattern = /^[0-9][A-Za-z0-9.+-]{0,79}$/;
export function parseExpectedCodexIdentity(value: unknown): ExpectedCodexIdentity {
  const row = value as Partial<ExpectedCodexIdentity> | null;
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "cliVersion,model"
    || typeof row.cliVersion !== "string" || !versionPattern.test(row.cliVersion)
    || typeof row.model !== "string" || !row.model.trim() || row.model !== row.model.trim() || row.model.length > 240 || /[\x00-\x1f\x7f]/.test(row.model)) {
    throw new Error("Invalid expected native Codex identity");
  }
  return { cliVersion: row.cliVersion, model: row.model };
}

