import type { RoadGraph } from './graph';
import { mulberry32, randInt, shuffleInPlace } from './rng';
import { dijkstra, type EdgeWeights } from './shortestPath';

/**
 * Capacitated VRP instance reduced to a complete graph over {depot} ∪ customers.
 * Index 0 is the depot, 1..n are customers. Matrices are row-major (n+1)×(n+1).
 */
export interface VRPInstance {
  n: number;
  /** road-graph node id per index */
  nodes: number[];
  demand: number[];
  capacity: number;
  vehicles: number;
  /** generalized cost J between stops (shortest path under current traffic) */
  cost: Float64Array;
  time: Float64Array;
  dist: Float64Array;
  delay: Float64Array;
  /** penalty per vehicle above the fleet size (and per unit of overload) */
  fleetPenalty: number;
}

export interface Solution {
  /** each route lists customer indices (1..n); depot is implicit at both ends */
  routes: number[][];
  /** Σ route costs */
  cost: number;
  /** cost + constraint penalties — what the optimizers minimise */
  fitness: number;
  vehiclesUsed: number;
}

export interface RouteMetrics {
  stops: number[];
  load: number;
  cost: number;
  time: number;
  dist: number;
  delay: number;
}

export interface SolutionMetrics {
  cost: number;
  fitness: number;
  time: number;
  dist: number;
  delay: number;
  vehiclesUsed: number;
  routes: RouteMetrics[];
}

export function generateCustomers(
  graph: RoadGraph,
  depot: number,
  count: number,
  seed: number,
  demandRange: [number, number],
): { nodes: number[]; demand: number[] } {
  const rng = mulberry32(seed * 104729 + 3);
  const candidates = graph.nodes.map((n) => n.id).filter((id) => id !== depot);
  shuffleInPlace(candidates, rng);
  const nodes = candidates.slice(0, Math.min(count, candidates.length));
  const demand = nodes.map(() => randInt(rng, demandRange[0], demandRange[1]));
  return { nodes, demand };
}

/** Capacity that gives the fleet ~15% slack over total demand. */
export function autoCapacity(demand: number[], vehicles: number, slack = 1.15): number {
  const total = demand.reduce((s, d) => s + d, 0);
  const maxD = demand.reduce((m, d) => Math.max(m, d), 0);
  return Math.max(maxD, Math.ceil((total * slack) / Math.max(1, vehicles)));
}

export interface BuiltInstance {
  instance: VRPInstance;
  /** shortest-path tree (prevEdge) rooted at each stop — used to draw routes on real roads */
  trees: Int32Array[];
}

export function buildInstance(
  graph: RoadGraph,
  ew: EdgeWeights,
  depot: number,
  customers: number[],
  demand: number[],
  capacity: number,
  vehicles: number,
): BuiltInstance {
  const n = customers.length;
  const N = n + 1;
  const nodes = [depot, ...customers];
  const cost = new Float64Array(N * N);
  const time = new Float64Array(N * N);
  const dist = new Float64Array(N * N);
  const delay = new Float64Array(N * N);
  const trees: Int32Array[] = [];
  for (let i = 0; i < N; i++) {
    const t = dijkstra(graph, ew, nodes[i]);
    trees.push(t.prevEdge);
    for (let j = 0; j < N; j++) {
      const v = nodes[j];
      cost[i * N + j] = t.cost[v];
      time[i * N + j] = t.time[v];
      dist[i * N + j] = t.dist[v];
      delay[i * N + j] = t.delay[v];
    }
  }
  let maxRound = 0;
  for (let i = 1; i < N; i++) maxRound = Math.max(maxRound, cost[i] + cost[i * N]);
  const instance: VRPInstance = {
    n,
    nodes,
    demand: [0, ...demand],
    capacity,
    vehicles,
    cost,
    time,
    dist,
    delay,
    fleetPenalty: 2 * maxRound + 1,
  };
  return { instance, trees };
}

let splitV = new Float64Array(0);
let splitP = new Int32Array(0);

/**
 * Prins' optimal split: given a giant tour (permutation of customers), cut it into
 * capacity-feasible routes with minimum total cost via Bellman's recursion over an
 * auxiliary DAG. O(n·L) where L is the max customers per route. Capacity is therefore
 * always satisfied by construction; fleet size is handled with a penalty.
 */
export function split(tour: ArrayLike<number>, inst: VRPInstance): Solution {
  const n = tour.length;
  if (splitV.length < n + 1) {
    splitV = new Float64Array(n + 1);
    splitP = new Int32Array(n + 1);
  }
  const V = splitV;
  const P = splitP;
  const C = inst.cost;
  const N = inst.n + 1;
  const Q = inst.capacity;
  const q = inst.demand;
  V.fill(Infinity, 0, n + 1);
  V[0] = 0;
  for (let i = 0; i < n; i++) {
    const base = V[i];
    if (base === Infinity) continue;
    let load = 0;
    let cost = 0;
    for (let j = i + 1; j <= n; j++) {
      const c = tour[j - 1];
      load += q[c];
      if (load > Q && j > i + 1) break;
      if (j === i + 1) {
        cost = C[c] + C[c * N];
      } else {
        const p = tour[j - 2];
        cost += C[p * N + c] + C[c * N] - C[p * N];
      }
      const val = base + cost;
      if (val < V[j]) {
        V[j] = val;
        P[j] = i;
      }
    }
  }
  const routes: number[][] = [];
  let j = n;
  while (j > 0) {
    const i = P[j];
    const r: number[] = new Array(j - i);
    for (let k = i; k < j; k++) r[k - i] = tour[k];
    routes.push(r);
    j = i;
  }
  routes.reverse();
  const cost = V[n];
  const excess = Math.max(0, routes.length - inst.vehicles);
  return { routes, cost, fitness: cost + excess * inst.fleetPenalty, vehiclesUsed: routes.length };
}

export function evaluateRoutes(routes: number[][], inst: VRPInstance): Solution {
  const C = inst.cost;
  const N = inst.n + 1;
  const kept = routes.filter((r) => r.length > 0);
  let cost = 0;
  let overload = 0;
  for (const r of kept) {
    let prev = 0;
    let load = 0;
    for (const c of r) {
      cost += C[prev * N + c];
      load += inst.demand[c];
      prev = c;
    }
    cost += C[prev * N];
    overload += Math.max(0, load - inst.capacity);
  }
  const excess = Math.max(0, kept.length - inst.vehicles);
  return {
    routes: kept,
    cost,
    fitness: cost + (excess + overload) * inst.fleetPenalty,
    vehiclesUsed: kept.length,
  };
}

export function solutionMetrics(sol: Solution, inst: VRPInstance): SolutionMetrics {
  const N = inst.n + 1;
  const routes: RouteMetrics[] = sol.routes.map((r) => {
    let prev = 0;
    const m: RouteMetrics = { stops: r, load: 0, cost: 0, time: 0, dist: 0, delay: 0 };
    for (const c of [...r, 0]) {
      const k = prev * N + c;
      m.cost += inst.cost[k];
      m.time += inst.time[k];
      m.dist += inst.dist[k];
      m.delay += inst.delay[k];
      m.load += inst.demand[c];
      prev = c;
    }
    return m;
  });
  const sum = (f: (r: RouteMetrics) => number) => routes.reduce((s, r) => s + f(r), 0);
  return {
    cost: sol.cost,
    fitness: sol.fitness,
    time: sum((r) => r.time),
    dist: sum((r) => r.dist),
    delay: sum((r) => r.delay),
    vehiclesUsed: sol.vehiclesUsed,
    routes,
  };
}

/** True when every customer is served exactly once, capacity holds, and all indices are in range. */
export function validateSolution(sol: Solution, inst: VRPInstance): string | null {
  const seen = new Uint8Array(inst.n + 1);
  for (const r of sol.routes) {
    let load = 0;
    for (const c of r) {
      if (c < 1 || c > inst.n) return `customer index ${c} out of range`;
      if (seen[c]) return `customer ${c} visited twice`;
      seen[c] = 1;
      load += inst.demand[c];
    }
    if (load > inst.capacity) return `route overloaded (${load} > ${inst.capacity})`;
  }
  for (let c = 1; c <= inst.n; c++) if (!seen[c]) return `customer ${c} not visited`;
  return null;
}

export function tourFromRoutes(routes: number[][]): number[] {
  const t: number[] = [];
  for (const r of routes) for (const c of r) t.push(c);
  return t;
}

/** Random-key encoding: customer i gets key (rank + 0.5)/n so that argsort reproduces the tour. */
export function tourToKeys(tour: number[], n: number): Float64Array {
  const keys = new Float64Array(n);
  tour.forEach((c, rank) => {
    keys[c - 1] = (rank + 0.5) / n;
  });
  return keys;
}

/** Decodes a continuous position vector into a permutation by sorting (random-key decoding). */
export class KeyDecoder {
  private idx: number[];
  constructor(n: number) {
    this.idx = Array.from({ length: n }, (_, i) => i + 1);
  }
  /** Returned array is reused between calls — copy it if you need to keep it. */
  decode(keys: Float64Array): number[] {
    this.idx.sort((a, b) => keys[a - 1] - keys[b - 1]);
    return this.idx;
  }
}
