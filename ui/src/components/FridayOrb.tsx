import { useEffect, useRef } from "react";
import { drawFridayOrb, orbPoints, type FridayOrbState } from "@/lib/friday-orb";

export function FridayOrb({ state, label, onActivate, disabled = false, compact = false, decorative = false }: {
  state: FridayOrbState; label: string; onActivate?: () => void; disabled?: boolean; compact?: boolean; decorative?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<(() => void) | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const points = orbPoints();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, elapsed = 0, size = 0;
    const paint = () => {
      const style = getComputedStyle(element);
      drawFridayOrb(ctx, points, size, elapsed, stateRef.current,
        style.getPropertyValue("--friday-orb-ink").trim(),
        style.getPropertyValue("--friday-orb-glow").trim(), media.matches);
    };
    const draw = (now: number) => {
      if (document.hidden || !size) { frame = 0; return; }
      if (now - last >= 32) {
        elapsed += Math.min((now - last) / 1000, 0.05); last = now; paint();
      }
      frame = media.matches ? 0 : requestAnimationFrame(draw);
    };
    const restart = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (!document.hidden && size) { paint(); if (!media.matches) frame = requestAnimationFrame(draw); }
    };
    const resize = () => {
      size = element.getBoundingClientRect().width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = size * dpr; element.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); restart();
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    document.addEventListener("visibilitychange", restart);
    media.addEventListener("change", restart);
    redraw.current = restart;
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); redraw.current = null;
      document.removeEventListener("visibilitychange", restart); media.removeEventListener("change", restart);
    };
  }, []);
  useEffect(() => { redraw.current?.(); }, [state]);
  if (decorative) return <span className="friday-orb" data-state={state} data-compact={compact} aria-hidden="true"><canvas ref={canvas} /><span className="friday-orb-fallback" /></span>;
  return <button type="button" className="friday-orb" data-state={state} data-compact={compact} onClick={onActivate} disabled={disabled || !onActivate} aria-label={label} title={label}>
    <canvas ref={canvas} aria-hidden="true" />
    <span className="friday-orb-fallback" aria-hidden="true" />
  </button>;
}
