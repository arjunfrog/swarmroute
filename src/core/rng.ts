export type RNG = () => number;

/** Small, fast, seedable PRNG (mulberry32). Every stochastic component takes a seed so runs are reproducible. */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: RNG, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function shuffleInPlace<T>(arr: T[], rng: RNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Deterministic value in [-1, 1] for (seed, index) — used for per-road traffic fluctuations. */
export function hashNoise(seed: number, index: number): number {
  let h = Math.imul(seed ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(index + 1, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}
