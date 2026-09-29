import { improveSolution } from '../localSearch';
import { clarkeWrightRoutes, nearestNeighbourRoutes } from './constructive';
import type { AlgoParams } from './types';
import type { RNG } from '../rng';
import { shuffleInPlace } from '../rng';
import { split, tourFromRoutes, tourToKeys, type Solution, type VRPInstance } from '../vrp';

export function randomTour(n: number, rng: RNG): number[] {
  return shuffleInPlace(
    Array.from({ length: n }, (_, i) => i + 1),
    rng,
  );
}

export function randomKeys(n: number, rng: RNG): Float64Array {
  const x = new Float64Array(n);
  for (let d = 0; d < n; d++) x[d] = rng();
  return x;
}

/**
 * Apply local search to a solution, then re-split its giant tour (the optimal split can only
 * improve on the partition local search produced). Returns the better result and its tour.
 */
export function refine(sol: Solution, inst: VRPInstance): { sol: Solution; tour: number[] } {
  const ls = improveSolution(sol.routes, inst);
  const tour = tourFromRoutes(ls.routes);
  const re = split(tour, inst);
  return { sol: re.fitness < ls.fitness ? re : ls, tour };
}

/** Root-mean-square distance of positions from their centroid — a standard swarm diversity measure. */
export function swarmDiversity(X: Float64Array[], center: Float64Array): number {
  const n = center.length;
  let total = 0;
  for (const x of X) {
    let s = 0;
    for (let d = 0; d < n; d++) {
      const diff = x[d] - center[d];
      s += diff * diff;
    }
    total += Math.sqrt(s / n);
  }
  return total / X.length;
}

export function centroid(X: Float64Array[], out: Float64Array): Float64Array {
  out.fill(0);
  for (const x of X) for (let d = 0; d < out.length; d++) out[d] += x[d];
  for (let d = 0; d < out.length; d++) out[d] /= X.length;
  return out;
}

export function linear(start: number, end: number, t: number, T: number): number {
  return T <= 1 ? end : start + ((end - start) * (t - 1)) / (T - 1);
}

/**
 * Lamarckian learning for key-based swarms: refine particle i's solution by local search and
 * write the improved tour back into its position (and personal best when it improves).
 */
export function lamarckian(sol: Solution, x: Float64Array, pb: Float64Array, pFit: Float64Array, i: number, inst: VRPInstance): Solution {
  const r = refine(sol, inst);
  const keys = tourToKeys(r.tour, inst.n);
  x.set(keys);
  if (r.sol.fitness < pFit[i]) {
    pFit[i] = r.sol.fitness;
    pb.set(keys);
  }
  return r.sol;
}

/**
 * Tours used to seed the initial population: explicit warm-start tours (live re-optimisation) first,
 * then — with hybrid initialisation — the Clarke–Wright and nearest-neighbour solutions.
 */
export function seedTours(inst: VRPInstance, p: AlgoParams): number[][] {
  const tours = p.initialTours ? p.initialTours.map((t) => t.slice()) : [];
  if (p.heuristicInit) {
    tours.push(tourFromRoutes(clarkeWrightRoutes(inst)), tourFromRoutes(nearestNeighbourRoutes(inst)));
  }
  return tours;
}
