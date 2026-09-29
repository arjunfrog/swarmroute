import { evaluateRoutes, type VRPInstance } from '../vrp';
import type { AlgoGenerator } from './types';

export const EXACT_MAX_N = 12;

/**
 * Exact CVRP by dynamic programming (for small n):
 *  1. Held–Karp over subsets: tsp(S) = cheapest depot → S → depot tour, for every capacity-feasible S.  O(n²·2ⁿ)
 *  2. Set-partition DP: f_k(S) = min over R ⊆ S containing min(S) of f_{k−1}(S∖R) + tsp(R).               O(n·3ⁿ)
 * The optimum minimises cost + fleet penalty over the number of routes k, i.e. the same objective
 * the metaheuristics optimise, so the gap to it is a true optimality gap.
 */
export function* exact(inst: VRPInstance): AlgoGenerator {
  const n = inst.n;
  if (n > EXACT_MAX_N) throw new Error(`Exact DP is limited to n ≤ ${EXACT_MAX_N} customers (got ${n}).`);
  const C = inst.cost;
  const N = n + 1;
  const S = 1 << n;
  const full = S - 1;
  const Q = inst.capacity;

  const dem = new Float64Array(S);
  for (let m = 1; m < S; m++) {
    const low = m & -m;
    dem[m] = dem[m ^ low] + inst.demand[31 - Math.clz32(low) + 1];
  }

  const hk = new Float64Array(S * n).fill(Infinity);
  const hkPrev = new Int8Array(S * n).fill(-1);
  for (let j = 0; j < n; j++) {
    if (inst.demand[j + 1] <= Q) hk[(1 << j) * n + j] = C[j + 1];
  }
  const tsp = new Float64Array(S).fill(Infinity);
  const tspEnd = new Int8Array(S).fill(-1);
  for (let m = 1; m < S; m++) {
    if (dem[m] > Q) continue;
    for (let j = 0; j < n; j++) {
      if (!(m & (1 << j))) continue;
      const val = hk[m * n + j];
      if (val === Infinity) continue;
      const close = val + C[(j + 1) * N];
      if (close < tsp[m]) {
        tsp[m] = close;
        tspEnd[m] = j;
      }
      for (let k = 0; k < n; k++) {
        if (m & (1 << k)) continue;
        const nm = m | (1 << k);
        if (dem[nm] > Q) continue;
        const cand = val + C[(j + 1) * N + k + 1];
        if (cand < hk[nm * n + k]) {
          hk[nm * n + k] = cand;
          hkPrev[nm * n + k] = j;
        }
      }
    }
  }

  const maxK = n;
  const f = new Float64Array((maxK + 1) * S).fill(Infinity);
  const choice = new Int32Array((maxK + 1) * S);
  f[0] = 0;
  let bestFit = Infinity;
  let bestK = -1;
  for (let k = 1; k <= maxK; k++) {
    const cur = k * S;
    const prev = (k - 1) * S;
    for (let m = 1; m < S; m++) {
      const low = m & -m;
      const rest = m ^ low;
      let bestVal = Infinity;
      let bestSub = 0;
      for (let s = rest; ; s = (s - 1) & rest) {
        const sub = s | low;
        const t = tsp[sub];
        if (t !== Infinity) {
          const val = f[prev + (m ^ sub)] + t;
          if (val < bestVal) {
            bestVal = val;
            bestSub = sub;
          }
        }
        if (s === 0) break;
      }
      f[cur + m] = bestVal;
      choice[cur + m] = bestSub;
    }
    const fit = f[cur + full] + Math.max(0, k - inst.vehicles) * inst.fleetPenalty;
    if (fit < bestFit) {
      bestFit = fit;
      bestK = k;
    }
  }

  const routes: number[][] = [];
  let m = full;
  for (let k = bestK; k > 0 && m; k--) {
    const sub = choice[k * S + m];
    const seq: number[] = [];
    let j = tspEnd[sub];
    let mm = sub;
    while (j >= 0) {
      seq.push(j + 1);
      const pj = hkPrev[mm * n + j];
      mm ^= 1 << j;
      j = pj;
    }
    routes.push(seq.reverse());
    m ^= sub;
  }
  const sol = evaluateRoutes(routes, inst);
  yield { iter: 0, evals: 1, best: sol.fitness, mean: NaN, diversity: NaN, incumbent: sol };
  return sol;
}
