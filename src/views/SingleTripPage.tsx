import { useEffect, useMemo, useRef, useState } from 'react';
import { nodePoints, type CityCtx } from '../app/context';
import { fmt, fmtMs, pct } from '../app/format';
import { usePalette } from '../app/theme';
import { DEFAULT_SP_PARAMS, type SPMethod, type SPParams, type SPPath } from '../core/algorithms/spMetaheuristic';
import { nearestNode } from '../core/graph';
import type { DriveResult, ProgressPoint } from '../core/runner';
import { astar, dijkstra, extractPath, pathFromEdges, type PathResult } from '../core/shortestPath';
import { LineSeriesChart } from '../components/LazyChart';
import { NetworkMap, type MapRoute } from '../components/NetworkMap';
import { Button, Check, Choice, Info, Slider, Swatch } from '../components/ui';
import { runShortestPath, type Cancel } from '../services/optimizerClient';

const METHOD_NAME: Record<SPMethod, string> = { qpso: 'QPSO', pso: 'Classic PSO' };

interface MetaRun {
  status: 'running' | 'done' | 'error';
  points: ProgressPoint[];
  path?: SPPath;
  final?: DriveResult<SPPath>;
}

export function SingleTripPage({ ctx }: { ctx: CityCtx }) {
  const { graph, ew, edgeTraffic, traffic, cityKey } = ctx;
  const pal = usePalette();
  const INK = pal.ink;
  const METHOD: Record<SPMethod, { name: string; color: string }> = {
    qpso: { name: METHOD_NAME.qpso, color: pal.algo.qpso },
    pso: { name: METHOD_NAME.pso, color: pal.algo.pso },
  };
  const [origin, setOrigin] = useState(() => nearestNode(graph, graph.width * 0.08, graph.height * 0.1));
  const [dest, setDest] = useState(() => nearestNode(graph, graph.width * 0.92, graph.height * 0.9));
  const [picking, setPicking] = useState<'origin' | 'destination'>('origin');
  const [params, setParams] = useState<SPParams>(DEFAULT_SP_PARAMS);
  const [runs, setRuns] = useState<Partial<Record<SPMethod, MetaRun>>>({});
  const [runKey, setRunKey] = useState('');
  const cancelRef = useRef<Cancel | null>(null);

  const lastCity = useRef(cityKey);
  useEffect(() => {
    if (lastCity.current === cityKey) return;
    lastCity.current = cityKey;
    setOrigin(nearestNode(graph, graph.width * 0.08, graph.height * 0.1));
    setDest(nearestNode(graph, graph.width * 0.92, graph.height * 0.9));
    setRuns({});
  }, [cityKey, graph]);

  const exact = useMemo(() => {
    // Repeat to get a stable timing (browser timers are coarse at sub-millisecond scale).
    const REPS = 25;
    let tree = dijkstra(graph, ew, origin, dest);
    const t0 = performance.now();
    for (let k = 0; k < REPS; k++) tree = dijkstra(graph, ew, origin, dest);
    const dMs = (performance.now() - t0) / REPS;
    const dPath = extractPath(graph, tree.prevEdge, origin, dest);
    let a = astar(graph, ew, origin, dest);
    const t1 = performance.now();
    for (let k = 0; k < REPS; k++) a = astar(graph, ew, origin, dest);
    const aMs = (performance.now() - t1) / REPS;
    return {
      dijkstra: { path: pathFromEdges(dPath.nodes, dPath.edges, ew), work: `${tree.settled} intersections checked`, ms: dMs },
      astar: { path: a.path, work: `${a.expanded} intersections checked`, ms: aMs },
    };
  }, [graph, ew, origin, dest]);

  const key = `${cityKey}|${origin}|${dest}`;
  const activeRuns = runKey === key ? runs : {};
  const running = Object.values(activeRuns).some((r) => r?.status === 'running');

  const run = () => {
    cancelRef.current?.();
    setRunKey(key);
    setRuns({ qpso: { status: 'running', points: [] }, pso: { status: 'running', points: [] } });
    cancelRef.current = runShortestPath(graph, ew, origin, dest, ['qpso', 'pso'], params, 15, {
      onProgress: (m, point, path) =>
        setRuns((prev) => ({ ...prev, [m]: { ...prev[m]!, points: [...(prev[m]?.points ?? []), point], path: path ?? prev[m]?.path } })),
      onResult: (m, final) => setRuns((prev) => ({ ...prev, [m]: { status: 'done', points: final.history, path: final.result, final } })),
      onError: (m) => setRuns((prev) => ({ ...prev, [m]: { ...prev[m]!, status: 'error' } })),
    });
  };
  useEffect(() => () => cancelRef.current?.(), []);

  const onNodeClick = (n: number) => {
    if (picking === 'origin') {
      if (n === dest) return;
      setOrigin(n);
      setPicking('destination');
    } else {
      if (n === origin) return;
      setDest(n);
      setPicking('origin');
    }
  };

  const opt = exact.dijkstra.path.cost;
  const metaPath = (m: SPMethod): PathResult | null => {
    const p = activeRuns[m]?.path;
    return p ? pathFromEdges(p.nodes, p.edges, ew) : null;
  };

  const routes: MapRoute[] = [
    {
      id: 'best',
      color: INK,
      points: nodePoints(graph, exact.dijkstra.path.nodes),
      nodes: exact.dijkstra.path.nodes,
      width: activeRuns.qpso ? 8 : 4,
      opacity: activeRuns.qpso ? 0.2 : 1,
      animate: !activeRuns.qpso,
    },
    ...(['pso', 'qpso'] as SPMethod[]).flatMap((m) => {
      const p = metaPath(m);
      return p
        ? [
            {
              id: m,
              color: METHOD[m].color,
              points: nodePoints(graph, p.nodes),
              nodes: p.nodes,
              width: m === 'qpso' ? 4 : 3,
              dashed: m === 'pso',
              animate: m === 'qpso',
            },
          ]
        : [];
    }),
  ];

  const rows = [
    {
      id: 'dijkstra',
      name: 'Dijkstra',
      note: 'Exact. Always finds the best route.',
      color: INK,
      path: exact.dijkstra.path,
      work: exact.dijkstra.work,
      ms: exact.dijkstra.ms,
    },
    {
      id: 'astar',
      name: 'A*',
      note: 'Exact, and checks fewer intersections.',
      color: pal.muted,
      path: exact.astar.path,
      work: exact.astar.work,
      ms: exact.astar.ms,
    },
    ...(['qpso', 'pso'] as SPMethod[]).map((m) => {
      const r = activeRuns[m];
      return {
        id: m,
        name: METHOD[m].name,
        note:
          r?.status === 'running'
            ? 'Searching'
            : r?.status === 'done'
              ? `Settled after ${r.final?.convergenceIter} round${r.final?.convergenceIter === 1 ? '' : 's'}`
              : 'Not run yet',
        color: METHOD[m].color,
        path: metaPath(m),
        work: r ? `${r.final?.evals ?? r.points[r.points.length - 1]?.evals ?? 0} routes tried` : '—',
        ms: r?.final?.timeMs,
      };
    }),
  ];

  const series = (['qpso', 'pso'] as SPMethod[])
    .filter((m) => activeRuns[m])
    .map((m) => ({
      id: m,
      name: METHOD[m].name,
      color: METHOD[m].color,
      emphasis: m === 'qpso',
      points: activeRuns[m]!.points.map((p) => ({ x: p.iter, y: p.best })),
    }));

  return (
    <>
      <section className="border-b-2 border-ink">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-8 border-ink p-6 sm:p-8 lg:border-r-2">
            <div>
              <h1 className="text-[clamp(2.75rem,4.1vw,4rem)] leading-[0.92] font-black tracking-[-0.035em]">
                <span className="block">One trip.</span>
                <span className="block">A to B.</span>
              </h1>
              <p className="mt-6 max-w-[40ch] text-lg leading-relaxed">
                For a single trip, exact methods like Dijkstra always find the best route. Here the quantum-inspired swarm is measured against that
                optimum.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-bold">
                Click the map to set
                <Info>Choose which point your next click on the map moves. After you place A, the next click places B.</Info>
              </div>
              <Choice<'origin' | 'destination'>
                label="Point to place"
                value={picking}
                onChange={setPicking}
                options={[
                  { value: 'origin', label: 'Start (A)' },
                  { value: 'destination', label: 'End (B)' },
                ]}
              />
            </div>
            <div className="space-y-5">
              <Slider
                label="Swarm size"
                info="How many candidate routes each swarm keeps at once."
                value={params.population}
                min={5}
                max={80}
                onChange={(population) => setParams({ ...params, population })}
              />
              <Slider
                label="Rounds"
                info="How many rounds of improvement each swarm gets."
                value={params.iterations}
                min={20}
                max={600}
                step={10}
                onChange={(iterations) => setParams({ ...params, iterations })}
              />
              <Check
                label="Quantum tunnelling"
                checked={params.tunneling}
                onChange={(tunneling) => setParams({ ...params, tunneling })}
                info="QPSO blocks part of its best route and searches for a way around it. It keeps the detour only if it is cheaper."
              />
              <Check
                label="Take shortcuts"
                checked={params.localSearch}
                onChange={(localSearch) => setParams({ ...params, localSearch })}
                info="After each round, replace any stretch of the route with a cheaper one- or two-road shortcut."
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={run} disabled={running}>
                {running ? 'Searching' : 'Race the swarms'}
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setOrigin(dest);
                  setDest(origin);
                }}
              >
                Swap A and B
              </Button>
            </div>
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-b-2 border-ink px-5 py-3 text-sm lg:border-t-0">
              <span className="font-bold">
                Best possible route: <span className="font-mono">{fmt(exact.dijkstra.path.time, 1)} min</span>,{' '}
                <span className="font-mono">{fmt(exact.dijkstra.path.dist, 2)} km</span>
              </span>
              <span className="text-muted">Click an intersection to move {picking === 'origin' ? 'A' : 'B'}</span>
            </div>
            <NetworkMap
              graph={graph}
              traffic={edgeTraffic}
              incidents={traffic.incidents}
              routes={routes}
              dimRoads
              markers={[
                { node: origin, kind: 'origin' },
                { node: dest, kind: 'destination' },
              ]}
              onNodeClick={onNodeClick}
              label="Map with the start and end of the trip"
            />
          </div>
        </div>
      </section>

      <section className="border-b-2 border-ink">
        <div className="mx-auto grid max-w-[1440px] gap-12 px-6 py-16 lg:grid-cols-2 lg:px-8">
          <div>
            <h2 className="text-[clamp(1.75rem,3vw,2.75rem)] leading-none font-black tracking-[-0.03em]">How close each method got</h2>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink text-left">
                    <th className="py-3 pr-4 font-bold">Method</th>
                    <th className="px-3 py-3 text-right font-bold">Score</th>
                    <th className="px-3 py-3 text-right font-bold">Time</th>
                    <th className="px-3 py-3 text-right font-bold">Gap</th>
                    <th className="px-3 py-3 font-bold">Work</th>
                    <th className="py-3 pl-3 text-right font-bold">Took</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-rule">
                      <td className="py-3 pr-4">
                        <span className="flex items-center gap-2.5 font-bold">
                          <Swatch color={r.color} />
                          {r.name}
                        </span>
                        <span className="mt-0.5 block pl-[22px] text-xs text-muted">{r.note}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{fmt(r.path?.cost, 2)}</td>
                      <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{r.path ? `${fmt(r.path.time, 1)} min` : '—'}</td>
                      <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{r.path ? pct(((r.path.cost - opt) / opt) * 100, 1) : '—'}</td>
                      <td className="px-3 py-3">{r.work}</td>
                      <td className="py-3 pl-3 text-right font-mono whitespace-nowrap">{fmtMs(r.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[clamp(1.75rem,3vw,2.75rem)] leading-none font-black tracking-[-0.03em]">Closing in</h2>
              <Info align="right">Best route cost found so far, round by round. The dashed line is the exact optimum from Dijkstra.</Info>
            </div>
            <div className="mt-8">
              <LineSeriesChart
                series={series}
                refs={[{ name: 'Best possible', color: INK, value: opt }]}
                xLabel="round"
                height={300}
                empty="Race the swarms to see them close in."
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
