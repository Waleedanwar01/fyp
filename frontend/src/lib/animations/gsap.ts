/** Central GSAP import + plugin registration -- every component that
 * animates imports gsap/ScrollTrigger from here, not directly from the
 * "gsap" package, so registration only ever happens in one place
 * (design bible #4: "do not scatter random GSAP code across every
 * component"). Registering a plugin twice is harmless in GSAP, but
 * importing ScrollTrigger at all touches `window` at module-eval time
 * on some bundler configs -- guarding it here keeps this SSR-safe
 * without every call site needing to remember to. */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };
