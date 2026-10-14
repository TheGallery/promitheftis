/** A random source: numbers from 0 up to but not including 1. */
export type Random = () => number;

/** Small deterministic random numbers: the same seed always gives the same run of numbers. */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from 0 up to but not including `n`. */
export function below(random: Random, n: number): number {
  return Math.min(n - 1, Math.floor(random() * n));
}

/** One of the entries, picked with `random`. */
export function pick<T>(random: Random, entries: readonly T[]): T {
  return entries[below(random, entries.length)] as T;
}
