import { useEffect, useRef, useState } from "react";

import { money } from "./api";

/**
 * The total, tweened rather than swapped.
 *
 * $71.00 → $0.00 is the moment the whole product exists to produce, so the
 * number counts down through the intervening values and lands with a scale
 * pulse, and the amount saved surfaces briefly underneath.
 */
export default function Total({
  cents,
  hasUnverified,
}: {
  cents: number;
  hasUnverified: boolean;
}) {
  const [shown, setShown] = useState(cents);
  const [landing, setLanding] = useState(false);
  const [delta, setDelta] = useState<number | null>(null);
  const previous = useRef(cents);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = previous.current;
    const to = cents;
    previous.current = cents;

    if (from === to) {
      setShown(to);
      return;
    }

    if (to < from) {
      setDelta(from - to);
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setShown(to);
      return;
    }

    const duration = 750;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      // Ease out cubic: fast departure, gentle landing.
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(from + (to - from) * eased));

      if (progress < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        setLanding(true);
        window.setTimeout(() => setLanding(false), 520);
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, [cents]);

  useEffect(() => {
    if (delta === null) return;
    const timer = window.setTimeout(() => setDelta(null), 2500);
    return () => window.clearTimeout(timer);
  }, [delta]);

  return (
    <div className="total">
      <div className="label">What this client still owes</div>
      <div
        className={[
          "total-figure",
          "mono",
          shown === 0 ? "total-figure--zero" : "",
          landing ? "total-figure--landing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-live="polite"
      >
        {money(shown)}
      </div>

      {delta !== null ? (
        <div className="total-delta total-delta--show">− {money(delta)} cleared</div>
      ) : null}

      {hasUnverified ? (
        <div className="total-note">Plus one fee the state does not publish</div>
      ) : null}
    </div>
  );
}
