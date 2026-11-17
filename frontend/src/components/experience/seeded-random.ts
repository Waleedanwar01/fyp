/** Deterministic pseudo-random generator (mulberry32) for one-time 3D
 * layout generation (particle positions/orbits) inside useMemo.
 *
 * Math.random() is non-deterministic, which modern React's purity rules
 * flag even inside useMemo -- React only treats useMemo as a
 * *performance* hint, not a guarantee the factory runs exactly once
 * (concurrent rendering can call it speculatively more than once per
 * commit). A seeded generator is a pure function (same seed -> same
 * output every time), which is what the rule actually wants, while
 * still producing visually-random-looking layouts. */
export function seededRandom(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
