import { useEffect, useRef } from "react";
import { drawFridayOrb, orbPoints } from "@/lib/friday-orb";

const points = orbPoints(840);
const painters = new Set<(time: number) => void>();
let animation = 0, lastPaint = 0;
function tick(time: number) {
  if (time - lastPaint >= 40) { for (const paint of painters) paint(time); lastPaint = time; }
  animation = painters.size ? requestAnimationFrame(tick) : 0;
}
/** One capped animation clock for all visible running employees. */
function subscribe(paint: (time: number) => void) {
  painters.add(paint);
  if (!animation) animation = requestAnimationFrame(tick);
  return () => { painters.delete(paint); if (!painters.size) { cancelAnimationFrame(animation); animation = 0; lastPaint = 0; } };
}

/** Friday's particle renderer, tinted by the employee's declared role.
 * Particles form one employee glyph; separate solid nodes represent records. */
export function AgentMapSphere({ x, y, size = 92, running = false, quiet = false }: {
  x: number; y: number; size?: number; running?: boolean; quiet?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * scale); canvas.height = Math.round(size * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let visible = true;
    let unsubscribe = () => {};
    const styles = getComputedStyle(canvas);
    const ink = styles.getPropertyValue("--agentos-role-ink").trim() || styles.color;
    const glow = styles.getPropertyValue("--graph-orb").trim() || ink;
    const paint = (now: number) => {
      const reduced = !!motion?.matches || quiet || document.hidden || !running || !visible;
      drawFridayOrb(context, points, size, reduced ? 0 : now / 1000, running ? "thinking" : "idle", ink, glow, reduced);
    };
    const restart = () => {
      unsubscribe(); unsubscribe = () => {};
      paint(performance.now());
      if (running && visible && !quiet && !document.hidden && !motion?.matches) unsubscribe = subscribe(paint);
    };
    restart();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); restart(); });
    observer?.observe(canvas);
    motion?.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    return () => { unsubscribe(); observer?.disconnect(); motion?.removeEventListener("change", restart); document.removeEventListener("visibilitychange", restart); };
  }, [size, running, quiet]);
  return <foreignObject x={x - size / 2} y={y - size / 2} width={size} height={size} className="agentos-map-orb-frame" aria-hidden="true">
    <canvas ref={ref} className="agentos-map-orb-canvas" data-running={running} />
  </foreignObject>;
}
