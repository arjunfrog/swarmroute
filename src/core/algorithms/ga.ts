import { mulberry32, type RNG } from '../rng';
import { split, type Solution, type VRPInstance } from '../vrp';
import { randomTour, refine, seedTours } from './common';
import type { AlgoGenerator, AlgoParams } from './types';

interface Individual {
  tour: number[];
  sol: Solution;
}

/** Order crossover (OX1): keep a slice of parent A, fill the rest in parent B's order. */
function orderCrossover(a: number[], b: number[], rng: RNG, mark: Uint8Array): number[] {
  const n = a.length;
  let i = Math.floor(rng() * n);
  let j = Math.floor(rng() * n);
  if (i > j) [i, j] = [j, i];
  const child = new Array<number>(n);
  mark.fill(0);
  for (let k = i; k <= j; k++) {
    child[k] = a[k];
    mark[a[k]] = 1;
  }
  let pos = (j + 1) % n;
  for (let k = 0; k < n; k++) {
    const g = b[(j + 1 + k) % n];
    if (mark[g]) continue;
    child[pos] = g;
    pos = (pos + 1) % n;
  }
  return child;
}

function mutate(t: number[], rng: RNG, rate: number): void {
  const n = t.length;
  if (n < 2) return;
  if (rng() < rate) {
    let i = Math.floor(rng() * n);
    let j = Math.floor(rng() * n);
    if (i > j) [i, j] = [j, i];
    for (; i < j; i++, j--) [t[i], t[j]] = [t[j], t[i]];
  }
  if (rng() < rate * 0.5) {
    const i = Math.floor(rng() * n);
    const j = Math.floor(rng() * n);
    [t[i], t[j]] = [t[j], t[i]];
  }
}

/**
 * Genetic algorithm on giant-tour permutations: tournament selection, OX crossover,
 * inversion + swap mutation, elitism, same split decoder and Lamarckian local search on the
 * best offspring of each generation.
 */
export function* ga(inst: VRPInstance, p: AlgoParams): AlgoGenerator {
  const rng = mulberry32(p.seed * 3266489917 + 31);
  const n = inst.n;
  const M = Math.max(4, p.population);
  const T = p.iterations;
  const mark = new Uint8Array(n + 1);
  let evals = 0;

  let pop: Individual[] = [];
  const seeds = seedTours(inst, p);
  for (let i = 0; i < M; i++) {
    const tour = seeds[i] ?? randomTour(n, rng);
    pop.push({ tour, sol: split(tour, inst) });
    evals++;
  }
  pop.sort((a, b) => a.sol.fitness - b.sol.fitness);
  let best = pop[0].sol;

  const diversity = () => {
    const ref = pop[0].tour;
    let s = 0;
    for (const ind of pop) {
      let diff = 0;
      for (let k = 0; k < n; k++) if (ind.tour[k] !== ref[k]) diff++;
      s += diff / n;
    }
    return s / pop.length;
  };
  const meanFit = () => pop.reduce((s, x) => s + x.sol.fitness, 0) / pop.length;

  yield { iter: 0, evals, best: best.fitness, mean: meanFit(), diversity: diversity(), incumbent: best };

  const tournament = () => {
    let w = pop[Math.floor(rng() * pop.length)];
    for (let k = 1; k < p.tournament; k++) {
      const c = pop[Math.floor(rng() * pop.length)];
      if (c.sol.fitness < w.sol.fitness) w = c;
    }
    return w;
  };

  if (p.localSearch) {
    const r = refine(pop[0].sol, inst);
    if (r.sol.fitness < pop[0].sol.fitness) pop[0] = { tour: r.tour, sol: r.sol };
    best = pop[0].sol;
  }

  for (let t = 1; t <= T; t++) {
    const elites = pop.slice(0, Math.min(p.eliteCount, M));
    const offspring: Individual[] = [];
    let bo = 0;
    while (elites.length + offspring.length < M) {
      const a = tournament();
      const b = tournament();
      const tour = rng() < p.crossoverRate ? orderCrossover(a.tour, b.tour, rng, mark) : a.tour.slice();
      mutate(tour, rng, p.mutationRate);
      offspring.push({ tour, sol: split(tour, inst) });
      evals++;
      if (offspring[offspring.length - 1].sol.fitness < offspring[bo].sol.fitness) bo = offspring.length - 1;
    }
    // Lamarckian local search on the best offspring of the generation
    if (p.localSearch && t % p.lsEvery === 0 && offspring.length > 0) {
      const r = refine(offspring[bo].sol, inst);
      offspring[bo] = { tour: r.tour, sol: r.sol };
    }
    pop = elites.concat(offspring).sort((a, b) => a.sol.fitness - b.sol.fitness);
    if (pop[0].sol.fitness < best.fitness) best = pop[0].sol;

    yield { iter: t, evals, best: best.fitness, mean: meanFit(), diversity: diversity(), incumbent: best };
  }
  return best;
}
