import { memo, useMemo } from 'react';
import { prefersReducedMotion, trafficColor, TRAFFIC_LEGEND, useTheme, type Palette } from '../app/theme';
import type { RoadGraph } from '../core/graph';
import type { EdgeTraffic } from '../core/traffic';
import { VanLayer } from './VanLayer';

export interface MapRoute {
  id: string;
  color: string;
  points: [number, number][];
  /** road-graph node per point: lets vans merge onto a new route at a shared intersection */
  nodes?: number[];
  width?: number;
  dashed?: boolean;
  animate?: boolean;
  opacity?: number;
}

export interface MapMarker {
  node: number;
  kind: 'depot' | 'customer' | 'origin' | 'destination';
  color?: string;
  title?: string;
}

interface Props {
  graph: RoadGraph;
  traffic: EdgeTraffic;
  incidents: number[];
  routes?: MapRoute[];
  markers?: MapMarker[];
  onEdgeClick?: (edge: number) => void;
  onNodeClick?: (node: number) => void;
  dimRoads?: boolean;
  label?: string;
}

const PAD = 0.35;

const RoadLayer = memo(function RoadLayer({
  graph,
  traffic,
  dim,
  palette,
}: {
  graph: RoadGraph;
  traffic: EdgeTraffic;
  /** road opacity: 1, or lower to fade roads behind a plan */
  dim: number;
  palette: Palette;
}) {
  return (
    <g opacity={dim}>
      {graph.edges.map((e) => {
        const a = graph.nodes[e.u];
        const b = graph.nodes[e.v];
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={trafficColor(palette, traffic.vc[e.id])}
            strokeWidth={e.kind === 'arterial' ? 3.4 : 1.8}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
});

export function NetworkMap({
  graph,
  traffic,
  incidents,
  routes = [],
  markers = [],
  onEdgeClick,
  onNodeClick,
  dimRoads,
  label = 'City road map',
}: Props) {
  const { palette: p, mode } = useTheme();
  // Roads fade behind a plan so routes stand out; dark mode keeps a little more road to stay legible.
  const roadOpacity = dimRoads ? (mode === 'dark' ? 0.55 : 0.42) : 1;
  const viewBox = `${-PAD} ${-PAD} ${graph.width + 2 * PAD} ${graph.height + 2 * PAD}`;
  const incidentSet = useMemo(() => new Set(incidents), [incidents]);
  const still = prefersReducedMotion();
  const drawn = routes.filter((r) => r.points.length >= 2);

  return (
    <div className="relative bg-paper">
      <svg viewBox={viewBox} className="block h-auto w-full select-none" preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
        <RoadLayer graph={graph} traffic={traffic} dim={roadOpacity} palette={p} />

        {/* Route lines, each with a paper-coloured halo so crossings stay readable */}
        {drawn.map((r) => {
          const pts = r.points.map((q) => `${q[0]},${q[1]}`).join(' ');
          const w = r.width ?? 4;
          return (
            <g key={r.id} opacity={r.opacity ?? 1}>
              <polyline points={pts} fill="none" stroke={p.paper} strokeWidth={w + 3.5} strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
              <polyline
                points={pts}
                fill="none"
                stroke={r.color}
                strokeWidth={w}
                strokeLinejoin="miter"
                strokeDasharray={r.dashed ? '7 5' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {incidents.map((id) => {
          const e = graph.edges[id];
          if (!e) return null;
          const a = graph.nodes[e.u];
          const b = graph.nodes[e.v];
          return (
            <g key={`inc-${id}`} transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}>
              <title>Blocked road</title>
              <rect
                x={-0.17}
                y={-0.17}
                width={0.34}
                height={0.34}
                fill={p.incident}
                stroke={p.ink}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              <text y={0.08} textAnchor="middle" fontSize={0.24} fontWeight={900} fill="#ffffff">
                !
              </text>
            </g>
          );
        })}

        {markers.map((m, i) => {
          const n = graph.nodes[m.node];
          if (!n) return null;
          if (m.kind === 'customer') {
            return (
              <rect
                key={`m${i}`}
                x={n.x - 0.1}
                y={n.y - 0.1}
                width={0.2}
                height={0.2}
                fill={m.color ?? p.paper}
                stroke={p.ink}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              >
                <title>{m.title}</title>
              </rect>
            );
          }
          const letter = m.kind === 'depot' ? 'D' : m.kind === 'origin' ? 'A' : 'B';
          const fill = m.kind === 'origin' ? p.accent : p.ink;
          const text = m.kind === 'origin' ? p.onAccent : p.paper;
          return (
            <g key={`m${i}`} transform={`translate(${n.x} ${n.y})`}>
              <title>
                {m.title ?? (m.kind === 'depot' ? 'Depot: every van starts and ends here' : m.kind === 'origin' ? 'Start (A)' : 'End (B)')}
              </title>
              <rect x={-0.22} y={-0.22} width={0.44} height={0.44} fill={fill} stroke={p.ink} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <text y={0.1} textAnchor="middle" fontSize={0.28} fontWeight={900} fill={text}>
                {letter}
              </text>
            </g>
          );
        })}

        {onEdgeClick && (
          <g>
            {graph.edges.map((e) => {
              const a = graph.nodes[e.u];
              const b = graph.nodes[e.v];
              return (
                <line
                  key={`hit-${e.id}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={10}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer hover:stroke-ink/40"
                  onClick={() => onEdgeClick(e.id)}
                >
                  <title>
                    {`${e.kind === 'arterial' ? 'Main road' : 'Street'}, ${e.length.toFixed(2)} km. Takes ${traffic.time[e.id].toFixed(1)} min now (${traffic.freeTime[e.id].toFixed(1)} min when empty). ${
                      incidentSet.has(e.id) ? 'Blocked. Click to reopen.' : 'Click to block this road.'
                    }`}
                  </title>
                </line>
              );
            })}
          </g>
        )}

        {onNodeClick && (
          <g>
            {graph.nodes.map((n) => (
              <rect
                key={`nh-${n.id}`}
                x={n.x - 0.14}
                y={n.y - 0.14}
                width={0.28}
                height={0.28}
                fill="transparent"
                className="cursor-crosshair hover:fill-ink/30"
                onClick={() => onNodeClick(n.id)}
              >
                <title>{`Intersection ${n.id}`}</title>
              </rect>
            ))}
          </g>
        )}

        {/* Moving vans: always the top layer, and they never intercept clicks */}
        {!still && <VanLayer routes={drawn} ink={p.ink} />}
      </svg>
      <TrafficLegend palette={p} />
    </div>
  );
}

/** Overlaid in the map's corner on wide screens; on phones it sits in a strip under the map so it never hides roads. */
function TrafficLegend({ palette }: { palette: Palette }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-ink px-4 py-2 text-xs sm:pointer-events-none sm:absolute sm:bottom-3 sm:left-3 sm:block sm:border-2 sm:px-3 sm:py-2 sm:bg-paper">
      <div className="font-bold sm:mb-1.5">Traffic</div>
      <div className="flex flex-wrap gap-3">
        {TRAFFIC_LEGEND.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-3 w-5 border border-ink" style={{ background: trafficColor(palette, s.vc) }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
