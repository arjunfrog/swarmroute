import type { RoadGraph } from '../graph';
import { mulberry32 } from '../rng';
import type { EdgeWeights } from '../shortestPath';
import { centroid, linear, swarmDiversity } from './common';
import type { StepUpdate } from './types';

export interface SPParams {
  seed: number;
  population: number;
  iterations: number;
  betaStart: number;
  betaEnd: number;
  inertiaStart: number;
  inertiaEnd: number;
  c1: number;
  c2: number;
  vmax: number;
  localSearch: boolean;
  /** QPSO tunnelling: block a segment of the best path and re-decode (accept if cheaper) */
  tunneling: boolean;
}

export const DEFAULT_SP_PARAMS: SPParams = {
  seed: 1,
  population: 30,
  iterations: 150,
  betaStart: 1.0,
  betaEnd: 0.5,
  inertiaStart: 0.9,
  inertiaEnd: 0.4,
  c1: 2,
  c2: 2,
  vmax: 0.2,
  localSearch: true,
  tunneling: true,
};

export interface SPPath {
  nodes: number[];
  edges: number[];
  cost: number;
}

export type SPMethod = 'qpso' | 'pso';

/**
 * Priority-based path decoding (Gen, Cheng & Wang, 1997): starting at s, repeatedly step to the
 * unvisited neighbour with the highest priority, backtracking from dead ends, until t is reached.
 * Every priority vector therefore maps to a simple, valid s–t path.
 */
class PathDecoder {
  private stamp = 0;
  private visit: Int32Array;
  constructor(
    private graph: RoadGraph,
    private ew: EdgeWeights,
    private s: number,
    private t: number,
  ) {
    this.visit = new Int32Array(graph.nodes.length);
  }

  decode(prio: Float64Array): SPPath {
    const { adj } = this.graph;
    const visit = this.visit;
    const stamp = ++this.stamp;
    const nodes = [this.s];
    const edges: number[] = [];
    visit[this.s] = stamp;
    while (nodes.length > 0) {
      const cur = nodes[nodes.length - 1];
      if (cur === this.t) break;
      let best = -1;
      let bestE = -1;
      let bp = -Infinity;
      for (const a of adj[cur]) {
        if (visit[a.to] !== stamp && prio[a.to] > bp) {
          bp = prio[a.to];
          best = a.to;
          bestE = a.edge;
        }
      }
      if (best < 0) {
        nodes.pop();
        edges.pop();
        continue;
      }
      visit[best] = stamp;
      nodes.push(best);
      edges.push(bestE);
    }
    if (nodes.length === 0) return { nodes, edges, cost: Infinity };
    let cost = 0;
    for (const e of edges) cost += this.ew.cost[e];
    return { nodes, edges, cost };
  }
}

/** Shortcut local search: replace a path segment by a cheaper 1- or 2-edge bypass. */
function shortcut(path: SPPath, graph: RoadGraph, ew: EdgeWeights): SPPath {
  let nodes = path.nodes.slice();
  let edges = path.edges.slice();
  let improved = true;
  while (improved) {
    improved = false;
    const pos = new Map<number, number>();
    nodes.forEach((v, i) => pos.set(v, i));
    const prefix = [0];
    for (const e of edges) prefix.push(prefix[prefix.length - 1] + ew.cost[e]);
    outer: for (let i = 0; i < nodes.length - 2; i++) {
      for (const a of graph.adj[nodes[i]]) {
        const j = pos.get(a.to);
        if (j !== undefined) {
          if (j > i + 1 && ew.cost[a.edge] < prefix[j] - prefix[i] - 1e-9) {
            nodes = [...nodes.slice(0, i + 1), ...nodes.slice(j)];
            edges = [...edges.slice(0, i), a.edge, ...edges.slice(j)];
            improved = true;
            break outer;
          }
          continue;
        }
        for (const b of graph.adj[a.to]) {
          const k = pos.get(b.to);
          if (k === undefined || k <= i + 1) continue;
          const bypass = ew.cost[a.edge] + ew.cost[b.edge];
          if (bypass < prefix[k] - prefix[i] - 1e-9) {
            nodes = [...nodes.slice(0, i + 1), a.to, ...nodes.slice(k)];
            edges = [...edges.slice(0, i), a.edge, b.edge, ...edges.slice(k)];
            improved = true;
            break outer;
          }
        }
      }
    }
  }
  let cost = 0;
  for (const e of edges) cost += ew.cost[e];
  return { nodes, edges, cost };
}

/** Encode a path so that priority decoding reproduces it exactly (decreasing priorities along it). */
function encodePath(path: SPPath, base: Float64Array, out: Float64Array) {
  let max = -Infinity;
  for (let i = 0; i < base.length; i++) {
    out[i] = base[i];
    if (base[i] > max) max = base[i];
  }
  const L = path.nodes.length;
  path.nodes.forEach((v, k) => {
    out[v] = max + 0.01 + 0.001 * (L - k);
  });
}

/**
 * QPSO / PSO over node-priority vectors for the single-pair shortest path problem.
 * Half the swarm is initialised with a goal-directed bias (priority ∝ closeness to t) mixed with
 * noise, giving a spread from pure random walks to greedy best-first paths.
 */
export function* spMetaheuristic(
  graph: RoadGraph,
  ew: EdgeWeights,
  s: number,
  t: number,
  method: SPMethod,
  p: SPParams,
): Generator<StepUpdate<SPPath>, SPPath, void> {
  const rng = mulberry32(p.seed * 2654435761 + (method === 'qpso' ? 101 : 202));
  const V = graph.nodes.length;
  const M = Math.max(2, p.population);
  const T = p.iterations;
  const decoder = new PathDecoder(graph, ew, s, t);
  const target = graph.nodes[t];
  let maxD = 0;
  const closeness = new Float64Array(V);
  for (const n of graph.nodes) maxD = Math.max(maxD, Math.hypot(n.x - target.x, n.y - target.y));
  for (const n of graph.nodes) closeness[n.id] = 1 - Math.hypot(n.x - target.x, n.y - target.y) / (maxD || 1);

  const X: Float64Array[] = [];
  const Vel: Float64Array[] = [];
  const P: Float64Array[] = [];
  const pCost = new Float64Array(M);
  const center = new Float64Array(V);
  let gIdx = 0;
  let best: SPPath = { nodes: [], edges: [], cost: Infinity };
  let evals = 0;
  let sum = 0;

  for (let i = 0; i < M; i++) {
    const w = i < M / 2 ? (i / Math.max(1, M / 2 - 1)) * 0.9 : 0;
    const x = new Float64Array(V);
    const v = new Float64Array(V);
    for (let d = 0; d < V; d++) {
      x[d] = w * closeness[d] + (1 - w) * rng();
      v[d] = (rng() * 2 - 1) * p.vmax;
    }
    X.push(x);
    Vel.push(v);
    P.push(Float64Array.from(x));
    const path = decoder.decode(x);
    evals++;
    pCost[i] = path.cost;
    sum += path.cost;
    if (path.cost < best.cost) {
      best = path;
      gIdx = i;
    }
  }
  yield { iter: 0, evals, best: best.cost, mean: sum / M, diversity: swarmDiversity(X, centroid(X, center)), incumbent: best };

  for (let it = 1; it <= T; it++) {
    const G = P[gIdx];
    if (method === 'qpso') centroid(P, center);
    const beta = linear(p.betaStart, p.betaEnd, it, T);
    const w = linear(p.inertiaStart, p.inertiaEnd, it, T);
    sum = 0;
    for (let i = 0; i < M; i++) {
      const x = X[i];
      const pb = P[i];
      if (method === 'qpso') {
        for (let d = 0; d < V; d++) {
          const phi = rng();
          const attractor = phi * pb[d] + (1 - phi) * G[d];
          const L = beta * Math.abs(center[d] - x[d]) * Math.log(1 / (1 - rng()));
          x[d] = rng() < 0.5 ? attractor + L : attractor - L;
        }
      } else {
        const v = Vel[i];
        for (let d = 0; d < V; d++) {
          let nv = w * v[d] + p.c1 * rng() * (pb[d] - x[d]) + p.c2 * rng() * (G[d] - x[d]);
          if (nv > p.vmax) nv = p.vmax;
          else if (nv < -p.vmax) nv = -p.vmax;
          v[d] = nv;
          x[d] += nv;
        }
      }
      const path = decoder.decode(x);
      evals++;
      sum += path.cost;
      if (path.cost < pCost[i]) {
        pCost[i] = path.cost;
        pb.set(x);
        if (path.cost < best.cost) {
          best = path;
          gIdx = i;
        }
      }
    }
    if (p.localSearch) {
      const improved = shortcut(best, graph, ew);
      if (improved.cost < best.cost - 1e-9) {
        best = improved;
        encodePath(improved, P[gIdx], P[gIdx]);
        pCost[gIdx] = improved.cost;
      }
    }
    if (method === 'qpso' && p.tunneling && best.nodes.length > 2) {
      // Block a random contiguous segment of the best path (1 … ~20% of its length) and re-decode:
      // the particle "tunnels" around the barrier and may land in a cheaper corridor.
      const trial = Float64Array.from(P[gIdx]);
      const inner = best.nodes.length - 2;
      const len = 1 + Math.floor(rng() * Math.max(1, Math.round(inner * 0.2)));
      const start = 1 + Math.floor(rng() * Math.max(1, inner - len + 1));
      for (let m = start; m < Math.min(start + len, best.nodes.length - 1); m++) trial[best.nodes[m]] = -10;
      let path = decoder.decode(trial);
      evals++;
      if (p.localSearch) path = shortcut(path, graph, ew);
      if (path.cost < best.cost - 1e-9) {
        best = path;
        encodePath(path, P[gIdx], P[gIdx]);
        pCost[gIdx] = path.cost;
      }
    }
    if (method === 'pso') centroid(X, center);
    yield { iter: it, evals, best: best.cost, mean: sum / M, diversity: swarmDiversity(X, center), incumbent: best };
  }
  return best;
}
