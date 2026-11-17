"use client";

import { useEffect } from "react";
import Lenis from "lenis";

import { gsap, ScrollTrigger, prefersReducedMotion } from "@/lib/animations";

/** Momentum-based scrolling for the marketing page -- native
 * `scroll-behavior: smooth` only smooths anchor-link jumps, not the feel
 * of everyday wheel/trackpad scrolling, so this wires up Lenis instead
 * and ties it into GSAP's own ticker so every ScrollTrigger-driven
 * reveal already on this page (useScrollReveal, the stats count-up,
 * etc) keeps firing at the right scroll position instead of drifting
 * out of sync with Lenis's virtualized scroll.
 *
 * Renders nothing -- scoped to just this page via where it's mounted
 * (page.tsx), not the whole app, since the authenticated dashboard
 * wasn't part of this request. Does nothing under
 * prefers-reduced-motion: inertia scrolling is exactly the kind of
 * motion that setting exists to suppress. */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)),
    });

    lenis.on("scroll", ScrollTrigger.update);

    const update = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);

    // In-page nav/footer links (`#pricing`, etc) jump natively by
    // default, which fights Lenis's own virtualized position -- routing
    // them through lenis.scrollTo keeps every scroll on this page, not
    // just the wheel, running through the one smoothed system.
    const handleClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest('a[href^="#"]');
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;

      event.preventDefault();
      const sticky = document.querySelector(".sticky");
      const offset = sticky ? -(sticky.getBoundingClientRect().height + 16) : -16;
      lenis.scrollTo(target as HTMLElement, { offset });
    };
    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("click", handleClick);
      gsap.ticker.remove(update);
      lenis.destroy();
    };
  }, []);

  return null;
}
