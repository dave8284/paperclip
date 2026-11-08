/** Content-free evidence from an accepted provider request. Absence (including
 * an older runner) stays unknown; configuration alone cannot create a receipt. */
export interface ProviderThreadContextReceipt {
  schema: "paperclip.provider-context-receipt.v1";
  stage: "thread_accepted";
  source: "thread/start" | "thread/resume";
  parametersSha256: string;
  instructionsSha256: string;
}
export interface ProviderTurnInputReceipt {
  schema: "paperclip.provider-context-receipt.v1";
  stage: "turn_accepted";
  source: "turn/start";
  parametersSha256: string;
  promptSha256: string;
  modelEnvelopeSha256: string | null;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function providerThreadContextReceipt(value: unknown): ProviderThreadContextReceipt | undefined {
  const row = record(value);
  if (row.schema !== "paperclip.provider-context-receipt.v1" || row.stage !== "thread_accepted"
    || (row.source !== "thread/start" && row.source !== "thread/resume")
    || !digest(row.parametersSha256) || !digest(row.instructionsSha256)) return undefined;
  return { schema: row.schema, stage: row.stage, source: row.source,
    parametersSha256: row.parametersSha256, instructionsSha256: row.instructionsSha256 };
}

export function providerTurnInputReceipt(value: unknown): ProviderTurnInputReceipt | undefined {
  const row = record(value);
  if (row.schema !== "paperclip.provider-context-receipt.v1" || row.stage !== "turn_accepted" || row.source !== "turn/start"
    || !digest(row.parametersSha256) || !digest(row.promptSha256)
    || (row.modelEnvelopeSha256 != null && !digest(row.modelEnvelopeSha256))) return undefined;
  return { schema: row.schema, stage: row.stage, source: row.source, parametersSha256: row.parametersSha256,
    promptSha256: row.promptSha256, modelEnvelopeSha256: digest(row.modelEnvelopeSha256) ? row.modelEnvelopeSha256 : null };
}
