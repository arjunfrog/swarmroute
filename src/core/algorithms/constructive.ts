import { evaluateRoutes, type VRPInstance } from '../vrp';
import type { AlgoGenerator } from './types';

/** Nearest-neighbour heuristic: extend the current route to the closest unserved customer that fits. */
export function nearestNeighbourRoutes(inst: VRPInstance): number[][] {
  const C = inst.cost;
  const N = inst.n + 1;
  const served = new Uint8Array(N);
  const routes: number[][] = [];
  let remaining = inst.n;
  while (remaining > 0) {
    const route: number[] = [];
    let load = 0;
    let cur = 0;
    for (;;) {
      let best = -1;
      let bestC = Infinity;
      for (let c = 1; c < N; c++) {
        if (served[c] || load + inst.demand[c] > inst.capacity) continue;
        if (C[cur * N + c] < bestC) {
          bestC = C[cur * N + c];
          best = c;
        }
      }
      if (best < 0) break;
      served[best] = 1;
      remaining--;
      route.push(best);
      load += inst.demand[best];
      cur = best;
    }
    if (route.length === 0) break;
    routes.push(route);
  }
  return routes;
}

export function* nearestNeighbour(inst: VRPInstance): AlgoGenerator {
  const sol = evaluateRoutes(nearestNeighbourRoutes(inst), inst);
  yield { iter: 0, evals: 1, best: sol.fitness, mean: NaN, diversity: NaN, incumbent: sol };
  return sol;
}

/**
 * Clarke–Wright savings (parallel version): start with one route per customer and merge route
 * ends in decreasing order of savings s_ij = c_i0 + c_0j − c_ij while capacity allows.
 */
export function clarkeWrightRoutes(inst: VRPInstance): number[][] {
  const C = inst.cost;
  const N = inst.n + 1;
  const n = inst.n;
  const routes: (number[] | null)[] = [null];
  const routeOf = new Int32Array(N);
  const load: number[] = [0];
  for (let c = 1; c <= n; c++) {
    routes.push([c]);
    routeOf[c] = c;
    load.push(inst.demand[c]);
  }
  const savings: { i: number; j: number; s: number }[] = [];
  for (let i = 1; i <= n; i++) {
    for (let j = i + 1; j <= n; j++) {
      savings.push({ i, j, s: C[i * N] + C[j] - C[i * N + j] });
    }
  }
  savings.sort((a, b) => b.s - a.s);
  for (const { i, j, s } of savings) {
    if (s <= 0) break;
    const ra = routeOf[i];
    const rb = routeOf[j];
    if (ra === rb || load[ra] + load[rb] > inst.capacity) continue;
    const A = routes[ra]!;
    const B = routes[rb]!;
    const iFirst = A[0] === i;
    const iLast = A[A.length - 1] === i;
    const jFirst = B[0] === j;
    const jLast = B[B.length - 1] === j;
    let merged: number[] | null = null;
    if (iLast && jFirst) merged = A.concat(B);
    else if (iFirst && jLast) merged = B.concat(A);
    else if (iFirst && jFirst) merged = A.slice().reverse().concat(B);
    else if (iLast && jLast) merged = A.concat(B.slice().reverse());
    if (!merged) continue;
    routes[ra] = merged;
    routes[rb] = null;
    load[ra] += load[rb];
    for (const c of merged) routeOf[c] = ra;
  }
  return routes.filter((r): r is number[] => r !== null);
}

export function* clarkeWright(inst: VRPInstance): AlgoGenerator {
  const sol = evaluateRoutes(clarkeWrightRoutes(inst), inst);
  yield { iter: 0, evals: 1, best: sol.fitness, mean: NaN, diversity: NaN, incumbent: sol };
  return sol;
}
