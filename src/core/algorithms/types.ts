import type { Solution } from '../vrp';

export type AlgoId = 'qpso' | 'pso' | 'ga' | 'sa' | 'cw' | 'nn' | 'exact';

export interface AlgoMeta {
  id: AlgoId;
  name: string;
  short: string;
  stochastic: boolean;
  description: string;
  /** largest customer count the method can handle (exact DP only) */
  maxN?: number;
}

export interface AlgoParams {
  seed: number;
  population: number;
  iterations: number;
  /** hybrid local search (2-opt + relocate + swap) applied to each iteration's best candidate */
  localSearch: boolean;
  lsEvery: number;
  /** QPSO contraction–expansion coefficient, linearly annealed betaStart → betaEnd */
  betaStart: number;
  betaEnd: number;
  /** QPSO Cauchy tunnelling mutation of gbest each iteration */
  tunneling: boolean;
  /** fraction of keys perturbed by a tunnelling mutation */
  tunnelRate: number;
  /** PSO inertia weight, linearly annealed */
  inertiaStart: number;
  inertiaEnd: number;
  c1: number;
  c2: number;
  vmax: number;
  /** GA */
  crossoverRate: number;
  mutationRate: number;
  eliteCount: number;
  tournament: number;
  /** seed the population with Clarke–Wright and nearest-neighbour tours */
  heuristicInit: boolean;
  /** warm-start tours (giant-tour permutations), e.g. the previous plan during live re-optimisation */
  initialTours?: number[][];
}

export const DEFAULT_PARAMS: AlgoParams = {
  seed: 1,
  population: 30,
  iterations: 200,
  localSearch: true,
  lsEvery: 1,
  heuristicInit: true,
  betaStart: 1.0,
  betaEnd: 0.5,
  tunneling: true,
  tunnelRate: 0.05,
  inertiaStart: 0.9,
  inertiaEnd: 0.4,
  c1: 2.0,
  c2: 2.0,
  vmax: 0.2,
  crossoverRate: 0.9,
  mutationRate: 0.2,
  eliteCount: 2,
  tournament: 3,
};

/** One optimizer step, yielded by every algorithm generator. */
export interface StepUpdate<S = Solution> {
  iter: number;
  evals: number;
  /** best fitness so far */
  best: number;
  /** mean fitness of the current population (NaN when not applicable) */
  mean: number;
  /** population diversity (NaN when not applicable) */
  diversity: number;
  incumbent: S;
}

export type AlgoGenerator = Generator<StepUpdate, Solution, void>;
