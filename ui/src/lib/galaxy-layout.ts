/** Identity, rather than status, determines position so updates do not shuffle work. */
export function galaxyPoint(id: string, radius: number, center = { x: 500, y: 300 }) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const slot = hash % 4096;
  const angle = slot * 2.399963229728653;
  const distance = radius * (0.25 + 0.75 * Math.sqrt(slot / 4095));
  return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance * 0.65 };
}
