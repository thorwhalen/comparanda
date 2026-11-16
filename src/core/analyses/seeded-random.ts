/**
 * A small seeded generator (mulberry32), for `rankShare`'s default: uniform in [0, 1), reproducible from a whole-number
 * seed. Internal to the analyses (not re-exported): a caller who wants another generator hands `rankShare` its own
 * `random`.
 */
/** A small seeded generator (mulberry32): uniform in [0, 1), reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
