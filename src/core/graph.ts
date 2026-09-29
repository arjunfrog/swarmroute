import { mulberry32 } from './rng';

export type RoadKind = 'arterial' | 'street';

export interface RoadNode {
  id: number;
  x: number;
  y: number;
}

export interface RoadEdge {
  id: number;
  u: number;
  v: number;
  /** length in km */
  length: number;
  /** free-flow speed in km/h */
  speed: number;
  /** hourly capacity in vehicles */
  capacity: number;
  kind: RoadKind;
  /** off-peak volume/capacity ratio before time-of-day scaling */
  baseLoad: number;
}

export interface Adjacent {
  to: number;
  edge: number;
}

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
  adj: Adjacent[][];
  /** extent in km */
  width: number;
  height: number;
  maxSpeed: number;
}

export interface CityConfig {
  seed: number;
  cols: number;
  rows: number;
  /** block size in km */
  spacing: number;
}

export const CITY_SIZES = {
  small: { cols: 16, rows: 11 },
  medium: { cols: 22, rows: 15 },
  large: { cols: 30, rows: 20 },
} as const;

export const DEFAULT_CITY: CityConfig = { seed: 7, ...CITY_SIZES.medium, spacing: 0.5 };

class DisjointSet {
  private parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]];
      a = this.parent[a];
    }
    return a;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

/**
 * Synthetic city: a jittered street grid with an arterial every 4th row/column,
 * a few diagonal shortcuts, randomly removed streets (connectivity preserved),
 * and congestion hotspots (a CBD plus two secondary centres) that raise baseline load.
 */
export function generateCity(cfg: CityConfig): RoadGraph {
  const rng = mulberry32(cfg.seed * 7919 + 17);
  const { cols, rows, spacing } = cfg;
  const jitter = spacing * 0.22;
  const nodes: RoadNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        id: r * cols + c,
        x: spacing * (c + 0.5) + (rng() * 2 - 1) * jitter,
        y: spacing * (r + 0.5) + (rng() * 2 - 1) * jitter,
      });
    }
  }
  const width = spacing * cols;
  const height = spacing * rows;
  const id = (r: number, c: number) => r * cols + c;
  const arterialRow = (r: number) => r % 4 === 2;
  const arterialCol = (c: number) => c % 4 === 2;

  const cands: { u: number; v: number; kind: RoadKind }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) cands.push({ u: id(r, c), v: id(r, c + 1), kind: arterialRow(r) ? 'arterial' : 'street' });
      if (r + 1 < rows) cands.push({ u: id(r, c), v: id(r + 1, c), kind: arterialCol(c) ? 'arterial' : 'street' });
      if (r + 1 < rows && c + 1 < cols && rng() < 0.07) {
        if (rng() < 0.5) cands.push({ u: id(r, c), v: id(r + 1, c + 1), kind: 'street' });
        else cands.push({ u: id(r, c + 1), v: id(r + 1, c), kind: 'street' });
      }
    }
  }

  // Thin out ~16% of streets, then re-add any removed street needed to keep the network connected.
  const keep = cands.map((e) => e.kind === 'arterial' || rng() > 0.16);
  const ds = new DisjointSet(nodes.length);
  cands.forEach((e, i) => {
    if (keep[i]) ds.union(e.u, e.v);
  });
  cands.forEach((e, i) => {
    if (!keep[i] && ds.union(e.u, e.v)) keep[i] = true;
  });

  const span = Math.min(width, height);
  const hotspots = [
    { x: width * (0.42 + rng() * 0.16), y: height * (0.42 + rng() * 0.16), w: 0.7, s: span * 0.24 },
    { x: width * (0.12 + rng() * 0.25), y: height * (0.15 + rng() * 0.3), w: 0.45, s: span * 0.16 },
    { x: width * (0.62 + rng() * 0.28), y: height * (0.55 + rng() * 0.3), w: 0.45, s: span * 0.16 },
  ];

  const edges: RoadEdge[] = [];
  cands.forEach((e, i) => {
    if (!keep[i]) return;
    const a = nodes[e.u];
    const b = nodes[e.v];
    const euclid = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let hot = 0;
    for (const h of hotspots) hot += h.w * Math.exp(-((mx - h.x) ** 2 + (my - h.y) ** 2) / (2 * h.s * h.s));
    const arterial = e.kind === 'arterial';
    edges.push({
      id: edges.length,
      u: e.u,
      v: e.v,
      length: euclid * (1 + rng() * 0.06),
      speed: arterial ? 50 + rng() * 10 : 25 + rng() * 10,
      capacity: arterial ? 1800 : 700,
      kind: e.kind,
      baseLoad: (arterial ? 0.6 : 0.4) + hot + rng() * 0.2,
    });
  });

  const adj: Adjacent[][] = nodes.map(() => []);
  let maxSpeed = 0;
  for (const e of edges) {
    adj[e.u].push({ to: e.v, edge: e.id });
    adj[e.v].push({ to: e.u, edge: e.id });
    maxSpeed = Math.max(maxSpeed, e.speed);
  }
  return { nodes, edges, adj, width, height, maxSpeed };
}

export function nearestNode(graph: RoadGraph, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const d = (n.x - x) ** 2 + (n.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}
