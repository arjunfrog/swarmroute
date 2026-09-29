import { mulberry32 } from '../rng';
import { KeyDecoder, split, tourToKeys, type Solution, type VRPInstance } from '../vrp';
import { centroid, lamarckian, linear, randomKeys, seedTours, swarmDiversity } from './common';
import type { AlgoGenerator, AlgoParams } from './types';

/**
 * Standard inertia-weight PSO (Shi & Eberhart, 1998) with the same random-key encoding, split
 * decoder and hybrid local search as QPSO — the direct classical counterpart for comparison.
 *
 *   v ← w·v + c1·r1·(pbest − x) + c2·r2·(gbest − x),   |v| ≤ vmax
 *   x ← x + v
 */
export function* pso(inst: VRPInstance, p: AlgoParams): AlgoGenerator {
  const rng = mulberry32(p.seed * 2246822519 + 23);
  const n = inst.n;
  const M = Math.max(2, p.population);
  const T = p.iterations;
  const decoder = new KeyDecoder(n);

  const X: Float64Array[] = [];
  const Vel: Float64Array[] = [];
  const P: Float64Array[] = [];
  const pFit = new Float64Array(M);
  const center = new Float64Array(n);
  let gIdx = 0;
  let gBest: Solution | null = null;
  let evals = 0;
  let sum = 0;
  const seeds = seedTours(inst, p);
  for (let i = 0; i < M; i++) {
    const seedTour = seeds[i];
    const x = seedTour ? tourToKeys(seedTour, n) : randomKeys(n, rng);
    const v = new Float64Array(n);
    for (let d = 0; d < n; d++) v[d] = (rng() * 2 - 1) * p.vmax;
    X.push(x);
    Vel.push(v);
    P.push(Float64Array.from(x));
    const sol = split(decoder.decode(x), inst);
    evals++;
    pFit[i] = sol.fitness;
    sum += sol.fitness;
    if (!gBest || sol.fitness < gBest.fitness) {
      gBest = sol;
      gIdx = i;
    }
  }
  let best = gBest!;
  if (p.localSearch) best = lamarckian(best, X[gIdx], P[gIdx], pFit, gIdx, inst);
  yield { iter: 0, evals, best: best.fitness, mean: sum / M, diversity: swarmDiversity(X, centroid(X, center)), incumbent: best };

  for (let t = 1; t <= T; t++) {
    const w = linear(p.inertiaStart, p.inertiaEnd, t, T);
    const G = P[gIdx];
    sum = 0;
    let ib = 0;
    let ibSol: Solution | null = null;
    for (let i = 0; i < M; i++) {
      const x = X[i];
      const v = Vel[i];
      const pb = P[i];
      for (let d = 0; d < n; d++) {
        let nv = w * v[d] + p.c1 * rng() * (pb[d] - x[d]) + p.c2 * rng() * (G[d] - x[d]);
        if (nv > p.vmax) nv = p.vmax;
        else if (nv < -p.vmax) nv = -p.vmax;
        v[d] = nv;
        x[d] += nv;
      }
      const sol = split(decoder.decode(x), inst);
      evals++;
      sum += sol.fitness;
      if (!ibSol || sol.fitness < ibSol.fitness) {
        ibSol = sol;
        ib = i;
      }
      if (sol.fitness < pFit[i]) {
        pFit[i] = sol.fitness;
        pb.set(x);
        if (sol.fitness < best.fitness) {
          best = sol;
          gIdx = i;
        }
      }
    }

    if (p.localSearch && t % p.lsEvery === 0) {
      const r = lamarckian(ibSol!, X[ib], P[ib], pFit, ib, inst);
      if (r.fitness < best.fitness) {
        best = r;
        gIdx = ib;
      }
    }

    yield { iter: t, evals, best: best.fitness, mean: sum / M, diversity: swarmDiversity(X, centroid(X, center)), incumbent: best };
  }
  return best;
}
