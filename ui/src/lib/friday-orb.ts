/** Original point-cloud renderer. Coordinates are normalized; size and palette
 * come from the UI token layer. This is a presence indicator, not a work map. */
export type FridayOrbState = "idle" | "listening" | "thinking" | "speaking" | "waiting" | "offline";
export interface OrbPoint { x: number; y: number; z: number; band: number }
/** Optional decorative pose; voice/run state remains the renderer's authority. */
export interface FridayOrbPose { yaw: number; pitch: number; roll: number; pulse: number; twist: number }
export function orbPoints(count = 840): OrbPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (index + 0.5) * 2 / count;
    const radius = Math.sqrt(1 - y * y);
    const theta = index * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius, band: Math.floor((y + 1) * 5) };
  });
}

export function drawFridayOrb(ctx: CanvasRenderingContext2D, points: OrbPoint[], size: number, time: number, state: FridayOrbState, ink: string, glow: string, reduced: boolean, pose?: FridayOrbPose) {
  ctx.clearRect(0, 0, size, size);
  const t = reduced ? 0 : time;
  const working = state === "thinking";
  const vocal = state === "speaking" || state === "listening";
  const breath = 1 + Math.sin(t * (vocal ? 3.2 : 0.9)) * (vocal ? 0.045 : 0.012);
  const motion = reduced ? undefined : pose;
  const radius = size * 0.31 * breath * (1 + (motion?.pulse ?? 0));
  const center = size / 2;
  // Tint only the sphere's interior. A gradient beyond the particle boundary
  // reads as a dark shadow, especially on the white workspace and map.
  ctx.fillStyle = glow; ctx.globalAlpha = state === "offline" ? 0.015 : 0.045;
  ctx.beginPath(); ctx.arc(center, center, radius * 0.98, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = ink;
  const tilt = -0.22 + (motion?.pitch ?? 0);
  const roll = motion?.roll ?? 0;
  const projected = points.map(point => {
    // Successive latitude bands turn while a real run is executing. No timer
    // claims that a task or an operation completed.
    const step = working ? Math.sin(t * 1.3 + point.band * 0.62) * 0.45 : 0;
    const angle = t * (working ? 0.23 : 0.055) + step + (motion?.yaw ?? 0) + Math.sin(point.y * Math.PI) * (motion?.twist ?? 0);
    const x = point.x * Math.cos(angle) - point.z * Math.sin(angle);
    const z = point.x * Math.sin(angle) + point.z * Math.cos(angle);
    const y = point.y * Math.cos(tilt) - z * Math.sin(tilt);
    const depth = point.y * Math.sin(tilt) + z * Math.cos(tilt);
    const wave = vocal ? Math.sin(point.y * 10 + t * 4) * 0.018 : 0;
    const perspective = 2.8 / (2.8 - depth * 0.35);
    return { x: center + (x * Math.cos(roll) - y * Math.sin(roll)) * radius * perspective * (1 + wave), y: center + (x * Math.sin(roll) + y * Math.cos(roll)) * radius * perspective * (1 + wave), depth };
  }).sort((a, b) => a.depth - b.depth);
  for (const point of projected) {
    ctx.globalAlpha = (0.15 + (point.depth + 1) * 0.38) * (state === "offline" ? 0.45 : 1);
    ctx.beginPath(); ctx.arc(point.x, point.y, size * (0.0015 + (point.depth + 1) * 0.0009), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
