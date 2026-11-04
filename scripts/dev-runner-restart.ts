/** A missing probe identity is not evidence that an accepted restart is stale. */
export function devRestartIdentityStatus(
  health: { serverInfo?: { processStartedAt?: unknown } } | null,
  expectedIdentity: string | null | undefined,
): "current" | "stale" | "unavailable" {
  if (!expectedIdentity) return "current";
  const observed = health?.serverInfo?.processStartedAt;
  if (typeof observed !== "string" || !observed) return "unavailable";
  return observed === expectedIdentity ? "current" : "stale";
}
