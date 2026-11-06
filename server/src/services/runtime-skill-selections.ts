import { AGENTOS_CAPABILITY_SKILL_PREFIX } from "@paperclipai/shared";

export function skillVersionSelectionMap(
  entries: Array<{ key: string; versionId: string | null }>,
  options: { versionPinsEnabled?: boolean } = {},
) {
  const versionPinsEnabled = options.versionPinsEnabled ?? true;
  return new Map(entries.map((entry) => [entry.key,
    versionPinsEnabled || entry.key.startsWith(AGENTOS_CAPABILITY_SKILL_PREFIX) ? entry.versionId : null] as const));
}
