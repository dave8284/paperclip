import { agentAvatarUrl as nativeAvatarUrl } from "@paperclipai/shared";

/** Saved identities and custom uploads stay native; the default visual is our orb. */
export const agentAvatarUrl: typeof nativeAvatarUrl = (appearance, size, scale, pose, muted = false, background) => {
  if (appearance.customAvatarAssetId) return nativeAvatarUrl(appearance, size, scale, pose, muted, background);
  return `/agentos-orbs/${encodeURIComponent(muted ? "muted-dream" : appearance.paletteId)}.svg`;
};
