import { useEffect, useRef, useState } from 'react';
import type { MapRoute } from './NetworkMap';

/** Map units (km) a van covers per real second. */
const SPEED = 0.9;
/** Arrow pointing along +x, rotated to the direction of travel. */
const VAN_SHAPE = 'M0.17 0 L-0.12 0.13 L-0.05 0 L-0.12 -0.13 Z';

interface Geom {
  pts: [number, number][];
  nodes?: number[];
  cum: number[];
  len: number;
  key: string;
}

interface Van {
  path: Geom;
  /** distance travelled along `path` */
  s: number;
  /** a newer route, adopted at the next intersection it shares with the current one */
  pending: Geom | null;
}

function makeGeom(r: MapRoute): Geom {
  const cum = [0];
  for (let i = 1; i < r.points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]));
  }
  const key = r.nodes ? r.nodes.join(',') : r.points.map((p) => `${p[0].toFixed(4)}:${p[1].toFixed(4)}`).join(';');
  return { pts: r.points, nodes: r.nodes, cum, len: cum[cum.length - 1], key };
}

/** First vertex strictly ahead of distance s. */
function nextVertex(g: Geom, s: number): number {
  for (let i = 1; i < g.cum.length; i++) if (g.cum[i] > s + 1e-12) return i;
  return g.cum.length - 1;
}

/** Where on `next` a van standing at vertex i of `cur` can continue, or -1 if that corner isn't on the new route. */
function mergeIndex(cur: Geom, i: number, next: Geom): number {
  const frac = cur.len > 0 ? cur.cum[i] / cur.len : 0;
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < next.pts.length - 1; k++) {
    const same =
      cur.nodes && next.nodes
        ? cur.nodes[i] === next.nodes[k]
        : Math.abs(cur.pts[i][0] - next.pts[k][0]) < 1e-9 && Math.abs(cur.pts[i][1] - next.pts[k][1]) < 1e-9;
    if (!same) continue;
    const d = Math.abs((next.len > 0 ? next.cum[k] / next.len : 0) - frac);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Moves a van ds along its route; returns true if it switched onto its pending route. */
function advance(v: Van, ds: number): boolean {
  let switched = false;
  for (let guard = 0; ds > 0 && guard < 2000; guard++) {
    const g = v.path;
    if (g.len <= 0) return switched;
    const i = nextVertex(g, v.s);
    const gap = g.cum[i] - v.s;
    if (ds < gap) {
      v.s += ds;
      return switched;
    }
    ds -= gap;
    v.s = g.cum[i];
    if (i === g.pts.length - 1) {
      // Back at the depot: begin the next loop, on the new plan if one is waiting.
      if (v.pending) {
        v.path = v.pending;
        v.pending = null;
        switched = true;
      }
      v.s = 0;
      continue;
    }
    // At a corner: take the new route from here if this corner is on it.
    if (v.pending) {
      const k = mergeIndex(g, i, v.pending);
      if (k >= 0) {
        v.path = v.pending;
        v.pending = null;
        v.s = v.path.cum[k];
        switched = true;
      }
    }
  }
  return switched;
}

function pose(g: Geom, s: number): string {
  const n = g.pts.length;
  let i = 0;
  while (i < n - 2 && g.cum[i + 1] <= s) i++;
  // skip zero-length segments so the heading stays defined
  let j = i + 1;
  while (j < n - 1 && g.cum[j] - g.cum[i] < 1e-9) j++;
  const [x0, y0] = g.pts[i];
  const [x1, y1] = g.pts[j];
  const seg = g.cum[j] - g.cum[i];
  const t = seg > 0 ? Math.min(1, Math.max(0, (s - g.cum[i]) / seg)) : 0;
  const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  return `translate(${x0 + (x1 - x0) * t} ${y0 + (y1 - y0) * t}) rotate(${angle})`;
}

/**
 * Vans that drive their routes continuously. When the plan changes, a van keeps its position and
 * finishes the stretch it is on; it turns onto the new route at the next intersection both routes
 * share (or at the depot), and until then its current path is drawn dashed.
 */
export function VanLayer({ routes, ink }: { routes: MapRoute[]; ink: string }) {
  const vans = useRef(new Map<string, Van>());
  const els = useRef(new Map<string, SVGPathElement>());
  const [shown, setShown] = useState<{ id: string; color: string }[]>([]);
  const [pending, setPending] = useState<Record<string, [number, number][]>>({});

  useEffect(() => {
    const live: { id: string; color: string }[] = [];
    const waiting: Record<string, [number, number][]> = {};
    for (const r of routes) {
      if (!r.animate || r.points.length < 2) continue;
      live.push({ id: r.id, color: r.color });
      const g = makeGeom(r);
      const v = vans.current.get(r.id);
      if (!v) {
        vans.current.set(r.id, { path: g, s: 0, pending: null });
        continue;
      }
      if (v.path.key === g.key) {
        v.pending = null;
        continue;
      }
      if (v.pending?.key !== g.key) v.pending = g;
      waiting[r.id] = v.path.pts;
    }
    const ids = new Set(live.map((l) => l.id));
    for (const id of [...vans.current.keys()]) if (!ids.has(id)) vans.current.delete(id);
    setShown(live);
    setPending(waiting);
  }, [routes]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let switched: string[] | null = null;
      for (const [id, v] of vans.current) {
        if (advance(v, dt * SPEED)) (switched ??= []).push(id);
        els.current.get(id)?.setAttribute('transform', pose(v.path, v.s));
      }
      if (switched) {
        const done = switched;
        setPending((prev) => {
          const next = { ...prev };
          for (const id of done) delete next[id];
          return next;
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const colorOf = new Map(shown.map((s) => [s.id, s.color]));
  return (
    <g pointerEvents="none">
      {Object.entries(pending).map(([id, pts]) => (
        <polyline
          key={`was-${id}`}
          points={pts.map((q) => `${q[0]},${q[1]}`).join(' ')}
          fill="none"
          stroke={colorOf.get(id) ?? ink}
          strokeWidth={2}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {shown.map(({ id, color }) => {
        const v = vans.current.get(id);
        return (
          <path
            key={id}
            ref={(el) => {
              if (el) els.current.set(id, el);
              else els.current.delete(id);
            }}
            d={VAN_SHAPE}
            transform={v ? pose(v.path, v.s) : undefined}
            fill={color}
            stroke={ink}
            strokeWidth={1.75}
            strokeLinejoin="miter"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
