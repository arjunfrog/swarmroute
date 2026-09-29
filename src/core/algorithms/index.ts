import type { VRPInstance } from '../vrp';
import { clarkeWright, nearestNeighbour } from './constructive';
import { exact, EXACT_MAX_N } from './exact';
import { ga } from './ga';
import { pso } from './pso';
import { qpso } from './qpso';
import { sa } from './sa';
import type { AlgoGenerator, AlgoId, AlgoMeta, AlgoParams } from './types';

export * from './types';
export { EXACT_MAX_N };

export const ALGORITHMS: Record<AlgoId, AlgoMeta> = {
  qpso: {
    id: 'qpso',
    name: 'Hybrid QPSO',
    short: 'QPSO',
    stochastic: true,
    description:
      'Quantum-behaved PSO: particles sampled from a delta potential well around a local attractor, random-key encoding + optimal split + local search.',
  },
  pso: {
    id: 'pso',
    name: 'Classical PSO',
    short: 'PSO',
    stochastic: true,
    description: 'Inertia-weight particle swarm with velocity updates — same encoding, decoder and local search as QPSO.',
  },
  ga: {
    id: 'ga',
    name: 'Genetic Algorithm',
    short: 'GA',
    stochastic: true,
    description: 'Permutation GA with tournament selection, order crossover, inversion/swap mutation and elitism.',
  },
  sa: {
    id: 'sa',
    name: 'Simulated Annealing',
    short: 'SA',
    stochastic: true,
    description: 'Single-solution annealing with inversion / swap / insertion moves under a geometric cooling schedule.',
  },
  cw: {
    id: 'cw',
    name: 'Clarke–Wright Savings',
    short: 'CW',
    stochastic: false,
    description: 'Classical constructive heuristic that merges routes by decreasing savings.',
  },
  nn: {
    id: 'nn',
    name: 'Nearest Neighbour',
    short: 'NN',
    stochastic: false,
    description: 'Greedy baseline: always drive to the closest unserved customer that still fits.',
  },
  exact: {
    id: 'exact',
    name: 'Exact DP (Held–Karp)',
    short: 'Exact',
    stochastic: false,
    maxN: EXACT_MAX_N,
    description: `Provably optimal dynamic programme (Held–Karp + set partitioning). Exponential: n ≤ ${EXACT_MAX_N}.`,
  },
};

export const ALGO_ORDER: AlgoId[] = ['qpso', 'pso', 'ga', 'sa', 'cw', 'nn', 'exact'];

export function createAlgorithm(id: AlgoId, inst: VRPInstance, params: AlgoParams): AlgoGenerator {
  switch (id) {
    case 'qpso':
      return qpso(inst, params);
    case 'pso':
      return pso(inst, params);
    case 'ga':
      return ga(inst, params);
    case 'sa':
      return sa(inst, params);
    case 'cw':
      return clarkeWright(inst);
    case 'nn':
      return nearestNeighbour(inst);
    case 'exact':
      return exact(inst);
  }
}

export function isAvailable(id: AlgoId, n: number): boolean {
  const max = ALGORITHMS[id].maxN;
  return max === undefined || n <= max;
}
