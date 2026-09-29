import type { RoadGraph } from './graph';
import { MinHeap } from './heap';
import type { EdgeTraffic } from './traffic';

/** Weights of the generalized cost J = α·time + β·distance + γ·congestion delay. */
export interface ObjectiveWeights {
  alpha: number;
  beta: number;
  gamma: number;
}

export const DEFAULT_WEIGHTS: ObjectiveWeights = { alpha: 1, beta: 0.5, gamma: 0.5 };

export interface EdgeWeights {
  /** generalized cost per edge */
  cost: Float64Array;
  /** congested travel time, minutes */
  time: Float64Array;
  /** km */
  length: Float64Array;
  /** congestion delay (time − free-flow time), minutes */
  delay: Float64Array;
  weights: ObjectiveWeights;
  maxSpeed: number;
}

export function edgeWeights(graph: RoadGraph, traffic: EdgeTraffic, w: ObjectiveWeights): EdgeWeights {
  const m = graph.edges.length;
  const cost = new Float64Array(m);
  const time = new Float64Array(m);
  const length = new Float64Array(m);
  const delay = new Float64Array(m);
  for (const e of graph.edges) {
    const t = traffic.time[e.id];
    const d = t - traffic.freeTime[e.id];
    time[e.id] = t;
    length[e.id] = e.length;
    delay[e.id] = d;
    cost[e.id] = w.alpha * t + w.beta * e.length + w.gamma * d;
  }
  return { cost, time, length, delay, weights: w, maxSpeed: graph.maxSpeed };
}

export interface ShortestPathTree {
  source: number;
  cost: Float64Array;
  time: Float64Array;
  dist: Float64Array;
  delay: Float64Array;
  prevEdge: Int32Array;
  settled: number;
}

/** Dijkstra with a binary heap, O((V+E) log V). Accumulates time / distance / delay along the tree. */
export function dijkstra(graph: RoadGraph, ew: EdgeWeights, source: number, target = -1): ShortestPathTree {
  const V = graph.nodes.length;
  const cost = new Float64Array(V).fill(Infinity);
  const time = new Float64Array(V);
  const dist = new Float64Array(V);
  const delay = new Float64Array(V);
  const prevEdge = new Int32Array(V).fill(-1);
  const done = new Uint8Array(V);
  const heap = new MinHeap();
  cost[source] = 0;
  heap.push(0, source);
  let settled = 0;
  while (heap.size() > 0) {
    const d = heap.peekKey();
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    settled++;
    if (u === target) break;
    for (const a of graph.adj[u]) {
      if (done[a.to]) continue;
      const nd = d + ew.cost[a.edge];
      if (nd < cost[a.to]) {
        cost[a.to] = nd;
        time[a.to] = time[u] + ew.time[a.edge];
        dist[a.to] = dist[u] + ew.length[a.edge];
        delay[a.to] = delay[u] + ew.delay[a.edge];
        prevEdge[a.to] = a.edge;
        heap.push(nd, a.to);
      }
    }
  }
  return { source, cost, time, dist, delay, prevEdge, settled };
}

export interface PathResult {
  nodes: number[];
  edges: number[];
  cost: number;
  time: number;
  dist: number;
  delay: number;
}

export function extractPath(graph: RoadGraph, prevEdge: Int32Array, source: number, target: number): { nodes: number[]; edges: number[] } {
  const nodes = [target];
  const edges: number[] = [];
  let v = target;
  let guard = 0;
  while (v !== source) {
    const e = prevEdge[v];
    if (e < 0 || guard++ > graph.nodes.length) return { nodes: [], edges: [] };
    edges.push(e);
    const ed = graph.edges[e];
    v = ed.u === v ? ed.v : ed.u;
    nodes.push(v);
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges };
}

export function pathFromEdges(nodes: number[], edges: number[], ew: EdgeWeights): PathResult {
  let cost = 0;
  let time = 0;
  let dist = 0;
  let delay = 0;
  for (const e of edges) {
    cost += ew.cost[e];
    time += ew.time[e];
    dist += ew.length[e];
    delay += ew.delay[e];
  }
  return { nodes, edges, cost, time, dist, delay };
}

/** Admissible straight-line lower bound on the generalized cost from v to t. */
export function makeHeuristic(graph: RoadGraph, ew: EdgeWeights, target: number): (v: number) => number {
  const t = graph.nodes[target];
  const w = ew.weights;
  return (v: number) => {
    const n = graph.nodes[v];
    const d = Math.hypot(n.x - t.x, n.y - t.y);
    return w.alpha * ((d / ew.maxSpeed) * 60) + w.beta * d;
  };
}

/** A* search with the admissible Euclidean heuristic above (optimal, expands fewer nodes than Dijkstra). */
export function astar(graph: RoadGraph, ew: EdgeWeights, source: number, target: number): { path: PathResult; expanded: number } {
  const V = graph.nodes.length;
  const g = new Float64Array(V).fill(Infinity);
  const prevEdge = new Int32Array(V).fill(-1);
  const closed = new Uint8Array(V);
  const h = makeHeuristic(graph, ew, target);
  const heap = new MinHeap();
  g[source] = 0;
  heap.push(h(source), source);
  let expanded = 0;
  while (heap.size() > 0) {
    const u = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    expanded++;
    if (u === target) break;
    for (const a of graph.adj[u]) {
      if (closed[a.to]) continue;
      const ng = g[u] + ew.cost[a.edge];
      if (ng < g[a.to]) {
        g[a.to] = ng;
        prevEdge[a.to] = a.edge;
        heap.push(ng + h(a.to), a.to);
      }
    }
  }
  const { nodes, edges } = extractPath(graph, prevEdge, source, target);
  return { path: pathFromEdges(nodes, edges, ew), expanded };
}
