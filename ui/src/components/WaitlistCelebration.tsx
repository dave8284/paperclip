import { useEffect, useRef, useState } from "react";

const motionPreference = "(prefers-reduced-motion: reduce)";

/** A single decorative burst per mounted account, with no timer or frame loop. */
export function WaitlistCelebration({ enabled }: { enabled: boolean }) {
  const started = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPlaying(false);
      return;
    }
    if (started.current) return;
    started.current = true;
    // Missing motion preference support is treated conservatively.
    if (window.matchMedia?.(motionPreference).matches === false) setPlaying(true);
  }, [enabled]);

  useEffect(() => {
    if (!playing) return;
    const preference = window.matchMedia(motionPreference);
    const stopForReducedMotion = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener("change", stopForReducedMotion);
    stopForReducedMotion();
    return () => preference.removeEventListener("change", stopForReducedMotion);
  }, [playing]);

  if (!enabled || !playing) return null;
  return <div className="waitlist-celebration" aria-hidden="true" onAnimationEnd={event => {
    if (event.target === event.currentTarget) setPlaying(false);
  }}>
    {Array.from({ length: 24 }, (_, index) => <span className="waitlist-confetti" key={index} />)}
  </div>;
}
