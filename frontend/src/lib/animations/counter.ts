"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";

import { gsap } from "./gsap";
import { DURATION, EASE, prefersReducedMotion } from "./tokens";

/** Animates a numeric display counting up (or down) to `value` whenever
 * it changes, instead of just snapping to the new number -- "numbers
 * should feel important" (design bible #17/#37). Returns a ref for a
 * <span>; render `format(value)` as its initial children so SSR/no-JS
 * output is still correct, GSAP overwrites it client-side on mount and
 * on every later change.
 *
 * Counts from 0 under reduced motion too -- "instant" means no
 * animated transition, not literally skipping straight to the final
 * text without ever rendering it. */
export function useCountUp(value: number, format: (n: number) => string = (n) => Math.round(n).toString()) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const prev = useRef(0);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      if (prefersReducedMotion()) {
        el.textContent = format(value);
        prev.current = value;
        return;
      }

      const counter = { current: prev.current };
      gsap.to(counter, {
        current: value,
        duration: DURATION.cinematic,
        ease: EASE.out,
        onUpdate: () => {
          if (ref.current) ref.current.textContent = format(counter.current);
        },
        onComplete: () => {
          prev.current = value;
        },
      });
    },
    { dependencies: [value] }
  );

  return ref;
}
