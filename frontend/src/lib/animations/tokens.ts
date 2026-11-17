/** RankLens motion tokens -- the single source of truth for animation timing
 * and easing, so every GSAP call reaches for the same handful of values
 * instead of a new ad-hoc duration per component (design bible #48).
 *
 * Durations in seconds (GSAP's native unit), grouped by the bible's three
 * named tiers:
 *   fast       150-250ms -- hover/focus/micro-interactions
 *   normal     300-500ms -- most UI transitions (reveals, panel open/close)
 *   cinematic  600-1200ms -- major moments only (hero entrances, page-level
 *              transitions) -- never the default, always a deliberate choice.
 */
export const DURATION = {
  fast: 0.2,
  normal: 0.4,
  cinematic: 0.9,
} as const;

/** Named eases -- "expensive, controlled, cinematic" (bible #5), not the
 * bouncy/elastic defaults GSAP ships with. power-family curves only. */
export const EASE = {
  out: "power3.out",
  inOut: "power2.inOut",
  cinematic: "power4.out",
} as const;

/** True when the user has asked the OS for reduced motion. Every reveal/
 * counter/transition utility in this folder checks this before animating
 * -- SSR-safe (false on the server; the real value only exists in a
 * browser). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
