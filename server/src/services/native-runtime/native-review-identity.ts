const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** The status committer owns this identity. Request keys distinguish explicit
 * attention requests; the historical default review has no request key. */
export function nativeReviewInteractionKey(decisionId: string, requestKey?: string) {
  return `native-review:${decisionId}${requestKey ? `:${requestKey}` : ""}`;
}

/** Match the exact persisted creation effect, not a user-controlled prefix.
 * The ordinal is the committer's one-based materialized effect position. */
export function nativeReviewCreationEffect(decisionId: string, decisionJson: unknown, idempotencyKey: string | null) {
  const effects = record(decisionJson).effects;
  if (!Array.isArray(effects)) return null;
  const matches = effects.flatMap((value, index) => {
    const effect = record(value);
    if (effect.kind !== "bind_reviewer" || (effect.requestKey !== undefined && typeof effect.requestKey !== "string")
      || idempotencyKey !== nativeReviewInteractionKey(decisionId, effect.requestKey as string | undefined)
      || (effect.ownerAgentId != null && typeof effect.ownerAgentId !== "string")
      || (effect.ownerUserId != null && typeof effect.ownerUserId !== "string")) return [];
    return [{ ordinal: index + 1, ownerAgentId: effect.ownerAgentId ?? null, ownerUserId: effect.ownerUserId ?? null }];
  });
  return matches.length === 1 ? matches[0]! : null;
}
