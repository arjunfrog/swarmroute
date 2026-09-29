import { evaluateRoutes, type Solution, type VRPInstance } from './vrp';

const EPS = 1e-9;

/** Intra-route 2-opt (segment reversal) until no improving move remains. Mutates `route`. */
export function twoOptRoute(route: number[], inst: VRPInstance): boolean {
  const m = route.length;
  if (m < 3) return false;
  const C = inst.cost;
  const N = inst.n + 1;
  const ext = [0, ...route, 0];
  let improvedAny = false;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < ext.length - 3; i++) {
      const a = ext[i];
      let b = ext[i + 1];
      let cab = C[a * N + b];
      for (let j = i + 2; j < ext.length - 1; j++) {
        const c = ext[j];
        const d = ext[j + 1];
        const delta = C[a * N + c] + C[b * N + d] - cab - C[c * N + d];
        if (delta < -EPS) {
          for (let lo = i + 1, hi = j; lo < hi; lo++, hi--) {
            const t = ext[lo];
            ext[lo] = ext[hi];
            ext[hi] = t;
          }
          improved = improvedAny = true;
          b = ext[i + 1];
          cab = C[a * N + b];
        }
      }
    }
  }
  if (improvedAny) for (let k = 0; k < m; k++) route[k] = ext[k + 1];
  return improvedAny;
}

/** Inter-route relocate: move one customer to the cheapest feasible position in another route. */
function relocatePass(routes: number[][], loads: number[], inst: VRPInstance): boolean {
  const C = inst.cost;
  const N = inst.n + 1;
  const q = inst.demand;
  const Q = inst.capacity;
  let improved = false;
  for (let ra = 0; ra < routes.length; ra++) {
    const A = routes[ra];
    for (let pa = 0; pa < A.length; pa++) {
      const c = A[pa];
      const prev = pa === 0 ? 0 : A[pa - 1];
      const next = pa === A.length - 1 ? 0 : A[pa + 1];
      const gain = C[prev * N + c] + C[c * N + next] - C[prev * N + next];
      let bestDelta = -EPS;
      let bestR = -1;
      let bestPos = -1;
      for (let rb = 0; rb < routes.length; rb++) {
        if (rb === ra || loads[rb] + q[c] > Q) continue;
        const B = routes[rb];
        for (let pb = 0; pb <= B.length; pb++) {
          const x = pb === 0 ? 0 : B[pb - 1];
          const y = pb === B.length ? 0 : B[pb];
          const delta = C[x * N + c] + C[c * N + y] - C[x * N + y] - gain;
          if (delta < bestDelta) {
            bestDelta = delta;
            bestR = rb;
            bestPos = pb;
          }
        }
      }
      if (bestR >= 0) {
        A.splice(pa, 1);
        routes[bestR].splice(bestPos, 0, c);
        loads[ra] -= q[c];
        loads[bestR] += q[c];
        improved = true;
        pa--;
      }
    }
  }
  for (let r = routes.length - 1; r >= 0; r--) {
    if (routes[r].length === 0) {
      routes.splice(r, 1);
      loads.splice(r, 1);
    }
  }
  return improved;
}

/** Inter-route swap: exchange two customers between routes when capacity allows and cost drops. */
function swapPass(routes: number[][], loads: number[], inst: VRPInstance): boolean {
  const C = inst.cost;
  const N = inst.n + 1;
  const q = inst.demand;
  const Q = inst.capacity;
  let improved = false;
  for (let ra = 0; ra < routes.length; ra++) {
    const A = routes[ra];
    for (let pa = 0; pa < A.length; pa++) {
      const c = A[pa];
      const pA = pa === 0 ? 0 : A[pa - 1];
      const nA = pa === A.length - 1 ? 0 : A[pa + 1];
      const removeA = C[pA * N + c] + C[c * N + nA];
      search: for (let rb = ra + 1; rb < routes.length; rb++) {
        const B = routes[rb];
        for (let pb = 0; pb < B.length; pb++) {
          const d = B[pb];
          if (loads[ra] - q[c] + q[d] > Q || loads[rb] - q[d] + q[c] > Q) continue;
          const pB = pb === 0 ? 0 : B[pb - 1];
          const nB = pb === B.length - 1 ? 0 : B[pb + 1];
          const delta = C[pA * N + d] + C[d * N + nA] - removeA + C[pB * N + c] + C[c * N + nB] - C[pB * N + d] - C[d * N + nB];
          if (delta < -EPS) {
            A[pa] = d;
            B[pb] = c;
            loads[ra] += q[d] - q[c];
            loads[rb] += q[c] - q[d];
            improved = true;
            break search;
          }
        }
      }
    }
  }
  return improved;
}

/**
 * Local search used by the hybrid metaheuristics: 2-opt within routes, then relocate and swap
 * between routes, repeated until a local optimum (or `maxRounds`). Returns a new solution.
 */
export function improveSolution(input: number[][], inst: VRPInstance, maxRounds = 30): Solution {
  const routes = input.map((r) => r.slice());
  const loads = routes.map((r) => r.reduce((s, c) => s + inst.demand[c], 0));
  for (let round = 0; round < maxRounds; round++) {
    let imp = false;
    for (const r of routes) if (twoOptRoute(r, inst)) imp = true;
    if (relocatePass(routes, loads, inst)) imp = true;
    if (swapPass(routes, loads, inst)) imp = true;
    if (!imp) break;
  }
  return evaluateRoutes(routes, inst);
}
