import type { FridayOrbPose } from "./friday-orb";

/** Landing decoration only. Pointer input starts a bounded animation; idle,
 * offscreen, touch and reduced-motion presentations never keep a frame loop. */
export function observeFridayOrbPointer(element: HTMLCanvasElement, paint: (pose?: FridayOrbPose) => void) {
  const surface = element.parentElement ?? element;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  let visible = true;
  let frame = 0;
  let started = 0;
  let previous: { x: number; y: number } | undefined;
  let pose: FridayOrbPose | undefined;
  let duration = 0;
  let hoverPulse: Animation | undefined;
  const allowed = () => !document.hidden && visible && !reduced.matches && fine.matches;
  const acceptsPointer = (event: PointerEvent) => !event.pointerType || event.pointerType === "mouse" || event.pointerType === "pen";
  const pulse = () => {
    if (hoverPulse || !allowed() || typeof surface.animate !== "function") return;
    const style = getComputedStyle(element);
    const scale = Number.parseFloat(style.getPropertyValue("--friday-pointer-hover-scale"));
    const duration = Number.parseFloat(style.getPropertyValue("--friday-pointer-hover-duration-ms"));
    const iterations = Number.parseFloat(style.getPropertyValue("--friday-pointer-hover-cycles"));
    const easing = style.getPropertyValue("--motion-ease-standard").trim();
    if (![scale, duration, iterations].every(Number.isFinite) || !(scale > 1 && duration > 0 && iterations > 0) || !easing) return;
    // Native finite animation returns to neutral even when the pointer stays
    // centered. It creates no JS timer or idle frame loop.
    hoverPulse = surface.animate([
      { transform: "scale(1)" },
      { transform: `scale(${scale})` },
      { transform: "scale(1)" },
    ], { duration, iterations, easing });
    hoverPulse.onfinish = () => { hoverPulse = undefined; };
  };
  const leave = () => {
    surface.removeAttribute("data-pointer-hovered");
    if (hoverPulse) { hoverPulse.onfinish = null; hoverPulse.cancel(); hoverPulse = undefined; }
  };
  const enter = (event: PointerEvent) => {
    if (allowed() && acceptsPointer(event)) { surface.setAttribute("data-pointer-hovered", "true"); pulse(); }
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = undefined;
    pose = undefined;
    leave();
    paint();
  };
  const animate = (now: number) => {
    frame = 0;
    if (!allowed() || !pose) { stop(); return; }
    const progress = Math.min(1, Math.max(0, (now - started) / duration));
    const remaining = (1 - progress) ** 2;
    paint({
      yaw: pose.yaw * remaining,
      pitch: pose.pitch * remaining,
      roll: pose.roll * remaining,
      pulse: pose.pulse * (1 + Math.sin(progress * Math.PI * 2)) / 2 * remaining,
      twist: pose.twist * remaining,
    });
    if (progress < 1) frame = requestAnimationFrame(animate);
    else pose = undefined;
  };
  const move = (event: PointerEvent) => {
    if (!allowed() || !acceptsPointer(event)) return;
    if (surface.hasAttribute("data-pointer-hovered")) pulse();
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const style = getComputedStyle(element);
    const token = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
    duration = token("--friday-pointer-settle-ms");
    if (duration <= 0) return;
    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    const x = clamp((event.clientX - bounds.left - bounds.width / 2) / bounds.width);
    const y = clamp((event.clientY - bounds.top - bounds.height / 2) / bounds.height);
    const dx = previous ? clamp((event.clientX - previous.x) / bounds.width) : 0;
    const dy = previous ? clamp((event.clientY - previous.y) / bounds.height) : 0;
    previous = { x: event.clientX, y: event.clientY };
    pose = {
      yaw: (x + dx) * token("--friday-pointer-yaw"),
      pitch: (y + dy) * token("--friday-pointer-pitch"),
      roll: (dx - dy) * token("--friday-pointer-roll"),
      pulse: Math.min(1, Math.hypot(dx, dy) + Math.abs(x * y)) * token("--friday-pointer-pulse"),
      twist: (dx + dy) * token("--friday-pointer-twist"),
    };
    started = performance.now();
    if (!frame) frame = requestAnimationFrame(animate);
  };
  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (!visible) stop();
  });
  observer?.observe(element);
  surface.addEventListener("pointerenter", enter);
  surface.addEventListener("pointerleave", stop);
  window.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("visibilitychange", stop);
  document.documentElement.addEventListener("pointerleave", stop);
  reduced.addEventListener("change", stop);
  fine.addEventListener("change", stop);
  return {
    redraw: () => paint(pose),
    dispose: () => {
      cancelAnimationFrame(frame);
      leave();
      observer?.disconnect();
      surface.removeEventListener("pointerenter", enter);
      surface.removeEventListener("pointerleave", stop);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", stop);
      document.documentElement.removeEventListener("pointerleave", stop);
      reduced.removeEventListener("change", stop);
      fine.removeEventListener("change", stop);
    },
  };
}
