import { mulberry32 } from '../rng';
import { KeyDecoder, split, tourToKeys, type Solution, type VRPInstance } from '../vrp';
import { centroid, lamarckian, linear, randomKeys, refine, seedTours, swarmDiversity } from './common';
import type { AlgoGenerator, AlgoParams } from './types';

/**
 * Quantum-behaved Particle Swarm Optimisation (Sun, Feng & Xu, 2004) for the CVRP.
 *
 * Each particle lives in a delta potential well centred on a local attractor p_i. Its position is
 * sampled from the collapsed wave function instead of being pushed by a velocity:
 *
 *   mbest   = (1/M) Σ_i pbest_i                         (mean best position)
 *   p_i,d   = φ·pbest_i,d + (1−φ)·gbest_d,   φ ~ U(0,1)
 *   x_i,d   = p_i,d ± β·|mbest_d − x_i,d|·ln(1/u),  u ~ U(0,1)
 *
 * β (contraction–expansion) is annealed from betaStart to betaEnd: large β → wide quantum jumps
 * (exploration), small β → the well contracts around the attractor (exploitation).
 * Positions are continuous random keys decoded to a giant tour by argsort, then split optimally
 * into capacity-feasible routes. In hybrid mode the best particle of each iteration is refined by
 * local search and the improved tour is written back into its position (Lamarckian learning), so
 * the quantum sampling acts as recombination + adaptive perturbation around local optima.
 * A Cauchy "tunnelling" mutation of gbest each iteration adds heavy-tailed jumps that let the
 * incumbent escape its basin of attraction (QPSO with mutation, cf. Liu et al. 2006).
 */
export function* qpso(inst: VRPInstance, p: AlgoParams): AlgoGenerator {
  const rng = mulberry32(p.seed * 2654435761 + 11);
  const n = inst.n;
  const M = Math.max(2, p.population);
  const T = p.iterations;
  const decoder = new KeyDecoder(n);

  const X: Float64Array[] = [];
  const P: Float64Array[] = [];
  const pFit = new Float64Array(M);
  const mbest = new Float64Array(n);
  let gIdx = 0;
  let gBest: Solution | null = null;
  let evals = 0;

  let sum = 0;
  const seeds = seedTours(inst, p);
  for (let i = 0; i < M; i++) {
    const seedTour = seeds[i];
    const x = seedTour ? tourToKeys(seedTour, n) : randomKeys(n, rng);
    X.push(x);
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
  yield { iter: 0, evals, best: best.fitness, mean: sum / M, diversity: swarmDiversity(X, centroid(X, mbest)), incumbent: best };

  for (let t = 1; t <= T; t++) {
    const beta = linear(p.betaStart, p.betaEnd, t, T);
    centroid(P, mbest);
    const G = P[gIdx];
    sum = 0;
    let ib = 0;
    let ibSol: Solution | null = null;
    for (let i = 0; i < M; i++) {
      const x = X[i];
      const pb = P[i];
      for (let d = 0; d < n; d++) {
        const phi = rng();
        const attractor = phi * pb[d] + (1 - phi) * G[d];
        const u = 1 - rng();
        const L = beta * Math.abs(mbest[d] - x[d]) * Math.log(1 / u);
        let v = rng() < 0.5 ? attractor + L : attractor - L;
        if (v < -2) v = -2;
        else if (v > 3) v = 3;
        x[d] = v;
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

    if (p.tunneling) {
      // Cauchy "quantum tunnelling" mutation of gbest: heavy-tailed jumps on a few keys let the
      // incumbent escape its basin; accepted only if the (locally refined) result is better.
      const trial = Float64Array.from(P[gIdx]);
      const k = Math.max(2, Math.round(p.tunnelRate * n));
      const scale = 3 / n;
      for (let m = 0; m < k; m++) {
        const d = Math.floor(rng() * n);
        trial[d] += scale * Math.tan(Math.PI * (rng() - 0.5));
      }
      let sol = split(decoder.decode(trial), inst);
      evals++;
      let keys: Float64Array = trial;
      if (p.localSearch) {
        const r = refine(sol, inst);
        sol = r.sol;
        keys = tourToKeys(r.tour, n);
      }
      if (sol.fitness < best.fitness - 1e-9) {
        best = sol;
        P[gIdx].set(keys);
        pFit[gIdx] = sol.fitness;
      }
    }

    yield { iter: t, evals, best: best.fitness, mean: sum / M, diversity: swarmDiversity(X, mbest), incumbent: best };
  }
  return best;
}
