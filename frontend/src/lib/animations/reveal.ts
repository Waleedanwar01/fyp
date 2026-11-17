"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";

import { gsap, ScrollTrigger } from "./gsap";
import { DURATION, EASE, prefersReducedMotion } from "./tokens";

type RevealOptions = {
  y?: number;
  stagger?: number;
  delay?: number;
};

/** Fade + rise entrance for a container's direct children (cards, list
 * rows, section blocks) -- the one generic "this just appeared" reveal
 * used across the app instead of ad-hoc opacity/transform CSS per
 * component (design bible #4/#16). Re-runs whenever `deps` changes, so
 * it can be re-triggered once real content (e.g. fetched cards) replaces
 * a loading skeleton -- pass `[]` for a plain mount-once reveal.
 *
 * Instant, motion-free under prefers-reduced-motion: content still
 * needs to end up visible, it just never animates there.
 */
export function useRevealChildren<T extends HTMLElement>(
  { y = 16, stagger = 0.08, delay = 0 }: RevealOptions = {},
  deps: unknown[] = []
) {
  const containerRef = useRef<T | null>(null);

  useGSAP(
    () => {
      const container = containerRef.current;
      if (!container) return;
      const children = Array.from(container.children);
      if (children.length === 0) return;

      if (prefersReducedMotion()) {
        gsap.set(children, { opacity: 1, y: 0 });
        return;
      }

      gsap.fromTo(
        children,
        { opacity: 0, y },
        { opacity: 1, y: 0, duration: DURATION.normal, ease: EASE.out, stagger, delay }
      );
    },
    { scope: containerRef, dependencies: deps }
  );

  return containerRef;
}

/** Same fade + rise reveal, but triggered by scroll position (GSAP
 * ScrollTrigger) instead of mount/dependency change -- for a long page
 * where a section is far below the fold and should animate in as the
 * user scrolls to it, not all at once on first paint. `start` is a
 * standard ScrollTrigger position string; the default fires once the
 * section is 80% of the way up the viewport (i.e. just as it starts
 * becoming visible), and never re-fires once played. */
export function useScrollReveal<T extends HTMLElement>({
  y = 24,
  stagger = 0.1,
  start = "top 80%",
}: RevealOptions & { start?: string } = {}) {
  const containerRef = useRef<T | null>(null);

  useGSAP(
    () => {
      const container = containerRef.current;
      if (!container) return;
      const children = Array.from(container.children);
      if (children.length === 0) return;

      if (prefersReducedMotion()) {
        gsap.set(children, { opacity: 1, y: 0 });
        return;
      }

      gsap.fromTo(
        children,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: DURATION.normal,
          ease: EASE.out,
          stagger,
          scrollTrigger: { trigger: container, start, toggleActions: "play none none none" },
        }
      );

      return () => {
        ScrollTrigger.getAll().forEach((st) => {
          if (st.trigger === container) st.kill();
        });
      };
    },
    { scope: containerRef }
  );

  return containerRef;
}
