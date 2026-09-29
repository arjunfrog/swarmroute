import { mulberry32, type RNG } from '../rng';
import { split, type VRPInstance } from '../vrp';
import { randomTour, refine, seedTours } from './common';
import type { AlgoGenerator, AlgoParams } from './types';

type Move = { kind: 0 | 1 | 2; i: number; j: number };

function reverse(t: number[], i: number, j: number) {
  for (; i < j; i++, j--) [t[i], t[j]] = [t[j], t[i]];
}

function applyMove(t: number[], m: Move) {
  if (m.kind === 0) reverse(t, m.i, m.j);
  else if (m.kind === 1) [t[m.i], t[m.j]] = [t[m.j], t[m.i]];
  else t.splice(m.j, 0, t.splice(m.i, 1)[0]);
}

function undoMove(t: number[], m: Move) {
  if (m.kind === 0) reverse(t, m.i, m.j);
  else if (m.kind === 1) [t[m.i], t[m.j]] = [t[m.j], t[m.i]];
  else t.splice(m.i, 0, t.splice(m.j, 1)[0]);
}

function randomMove(n: number, rng: RNG): Move {
  const r = rng();
  let i = Math.floor(rng() * n);
  let j = Math.floor(rng() * n);
  if (r < 0.6) {
    if (i > j) [i, j] = [j, i];
    return { kind: 0, i, j };
  }
  return { kind: r < 0.8 ? 1 : 2, i, j };
}

/**
 * Simulated annealing on the giant tour (inversion / swap / insertion moves, optimal split
 * decoding). Given the same evaluation budget as the population methods (population × iterations);
 * one reported "iteration" = `population` evaluations so convergence curves share an x-axis.
 */
export function* sa(inst: VRPInstance, p: AlgoParams): AlgoGenerator {
  const rng = mulberry32(p.seed * 374761393 + 47);
  const n = inst.n;
  const block = Math.max(1, p.population);
  const T = p.iterations;
  const budget = block * T;
  const seeds = seedTours(inst, p);
  let tour = randomTour(n, rng);
  let cur = split(tour, inst);
  for (const s of seeds) {
    const sol = split(s, inst);
    if (sol.fitness < cur.fitness) {
      tour = s;
      cur = sol;
    }
  }
  let best = cur;
  let evals = 1;

  // Initial temperature: accept an average uphill move with probability 0.5.
  let upSum = 0;
  let upCount = 0;
  for (let k = 0; k < 40 && n > 1; k++) {
    const m = randomMove(n, rng);
    applyMove(tour, m);
    const s = split(tour, inst);
    evals++;
    undoMove(tour, m);
    if (s.fitness > cur.fitness) {
      upSum += s.fitness - cur.fitness;
      upCount++;
    }
  }
  const T0 = upCount ? upSum / upCount / Math.LN2 : 1;
  const Tend = T0 * 1e-3;
  const cooling = Math.pow(Tend / T0, 1 / budget);
  let temp = T0;

  yield { iter: 0, evals, best: best.fitness, mean: cur.fitness, diversity: NaN, incumbent: best };

  for (let t = 1; t <= T; t++) {
    for (let k = 0; k < block && n > 1; k++) {
      const m = randomMove(n, rng);
      applyMove(tour, m);
      const s = split(tour, inst);
      evals++;
      const delta = s.fitness - cur.fitness;
      if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
        cur = s;
        if (cur.fitness < best.fitness) best = cur;
      } else {
        undoMove(tour, m);
      }
      temp *= cooling;
    }
    // Local search on the current state once per block — same LS budget as the population methods.
    if (p.localSearch && t % p.lsEvery === 0) {
      const r = refine(cur, inst);
      if (r.sol.fitness < cur.fitness - 1e-9) {
        cur = r.sol;
        tour = r.tour;
        if (cur.fitness < best.fitness) best = cur;
      }
    }
    yield { iter: t, evals, best: best.fitness, mean: cur.fitness, diversity: NaN, incumbent: best };
  }
  return best;
}
