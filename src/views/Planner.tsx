import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { routeGeometry, type CityCtx } from '../app/context';
import { fmt, fmtMs, pct } from '../app/format';
import { ALGO_PLAIN, periodOfDay, scrollToId, usePalette, vanColor } from '../app/theme';
import { matchVanIds, type VanAssignment } from '../app/vans';
import { ALGO_ORDER, ALGORITHMS, DEFAULT_PARAMS, EXACT_MAX_N, isAvailable, type AlgoId, type AlgoParams } from '../core/algorithms';
import { clarkeWrightRoutes, nearestNeighbourRoutes } from '../core/algorithms/constructive';
import { CITY_SIZES } from '../core/graph';
import { mulberry32 } from '../core/rng';
import type { AlgoRunResult, ProgressPoint } from '../core/runner';
import { accidentRate, formatClock } from '../core/traffic';
import { autoCapacity, buildInstance, evaluateRoutes, generateCustomers, solutionMetrics, tourFromRoutes, type SolutionMetrics } from '../core/vrp';
import { LineSeriesChart } from '../components/LazyChart';
import { NetworkMap, type MapMarker, type MapRoute } from '../components/NetworkMap';
import { Bar, Button, Check, Choice, Info, NumberField, Slider, Swatch, TextButton } from '../components/ui';
import { runVrp, type Cancel } from '../services/optimizerClient';
import { ScaleTest } from './ScaleTest';

interface VrpConfig {
  customers: number;
  vehicles: number;
  capacityAuto: boolean;
  capacity: number;
  demandMin: number;
  demandMax: number;
  seed: number;
}

const DEFAULT_VRP: VrpConfig = { customers: 60, vehicles: 8, capacityAuto: true, capacity: 60, demandMin: 1, demandMax: 10, seed: 42 };

interface RunState {
  status: 'running' | 'done' | 'error' | 'stopped';
  points: ProgressPoint[];
  routes?: number[][];
  final?: AlgoRunResult;
  error?: string;
}

interface LiveEvent {
  id: number;
  clock: string;
  note: string;
  stale: number;
  updated: number;
  savingPct: number;
  ms: number;
}

/** Real milliseconds per 10 simulated minutes. */
const LIVE_TICK_MS = 4000;
/** A re-plan replaces the running plan only if it is at least this much better (avoids churn). */
const LIVE_MIN_GAIN = 0.005;
const LIVE_ITERATIONS = 40;
type SizeKey = keyof typeof CITY_SIZES;

export function Planner({ ctx, onAddCityData }: { ctx: CityCtx; onAddCityData: () => void }) {
  const { graph, depot, ew, edgeTraffic, traffic, setTraffic, cityKey, weights, setWeights, city, setCity } = ctx;
  const pal = usePalette();
  const [cfg, setCfg] = useState<VrpConfig>(DEFAULT_VRP);
  const [params, setParams] = useState<AlgoParams>(DEFAULT_PARAMS);
  const [selected, setSelected] = useState<AlgoId[]>(['qpso', 'pso', 'ga', 'sa', 'cw', 'nn']);
  const [animate, setAnimate] = useState(true);
  const [delayMs, setDelayMs] = useState(12);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const customers = useMemo(
    () => generateCustomers(graph, depot, cfg.customers, cfg.seed, [cfg.demandMin, cfg.demandMax]),
    [graph, depot, cfg.customers, cfg.seed, cfg.demandMin, cfg.demandMax],
  );
  const maxDemand = Math.max(...customers.demand);
  const capacity = cfg.capacityAuto ? autoCapacity(customers.demand, cfg.vehicles) : Math.max(cfg.capacity, maxDemand);
  const built = useMemo(
    () => buildInstance(graph, ew, depot, customers.nodes, customers.demand, capacity, cfg.vehicles),
    [graph, ew, depot, customers, capacity, cfg.vehicles],
  );
  const inst = built.instance;
  const totalDemand = customers.demand.reduce((s, d) => s + d, 0);
  const problemKey = `${cityKey}|${cfg.customers}|${cfg.seed}|${cfg.demandMin}|${cfg.demandMax}|${capacity}|${cfg.vehicles}`;

  // ---- optimisation runs -------------------------------------------------------------------
  const [runs, setRuns] = useState<{ key: string; byAlgo: Partial<Record<AlgoId, RunState>> }>({ key: '', byAlgo: {} });
  const byAlgo = runs.key === problemKey ? runs.byAlgo : {};
  const hasRuns = Object.keys(byAlgo).length > 0;
  const [focus, setFocus] = useState<AlgoId>('qpso');
  const [running, setRunning] = useState(false);
  const cancelRef = useRef<Cancel | null>(null);

  const updateRun = (key: string, algo: AlgoId, f: (r: RunState) => RunState) =>
    setRuns((prev) =>
      prev.key !== key ? prev : { key, byAlgo: { ...prev.byAlgo, [algo]: f(prev.byAlgo[algo] ?? { status: 'running', points: [] }) } },
    );

  const optimize = () => {
    cancelRef.current?.();
    stopLive();
    setSettingsOpen(false);
    const algos = selected.filter((a) => isAvailable(a, inst.n));
    if (!algos.length) return;
    const key = problemKey;
    setRuns({ key, byAlgo: Object.fromEntries(algos.map((a) => [a, { status: 'running', points: [] } as RunState])) });
    setRunning(true);
    setFocus(algos.includes('qpso') ? 'qpso' : algos[0]);
    cancelRef.current = runVrp(inst, algos, params, animate ? delayMs : 0, {
      onProgress: (algo, point, routes) => updateRun(key, algo, (r) => ({ ...r, points: [...r.points, point], routes: routes ?? r.routes })),
      onResult: (algo, final) => updateRun(key, algo, (r) => ({ ...r, status: 'done', final, points: final.history, routes: final.result.routes })),
      onError: (algo, error) => updateRun(key, algo, (r) => ({ ...r, status: 'error', error })),
      onAllDone: () => {
        setRunning(false);
        cancelRef.current = null;
      },
    });
  };

  const stop = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setRunning(false);
    setRuns((prev) => ({
      ...prev,
      byAlgo: Object.fromEntries(Object.entries(prev.byAlgo).map(([k, r]) => [k, r && r.status === 'running' ? { ...r, status: 'stopped' } : r])),
    }));
  };

  // ---- live traffic mode ---------------------------------------------------------------------
  const [live, setLive] = useState(false);
  const [livePlan, setLivePlan] = useState<number[][] | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const livePlanRef = useRef<number[][] | null>(null);
  const liveBusy = useRef(false);
  const liveDirty = useRef(false);
  const liveCancel = useRef<Cancel | null>(null);
  const liveTick = useRef(0);
  const liveIncidents = useRef(new Map<number, number>());
  const pendingNote = useRef('Plan adjusted to current traffic');
  const trafficRef = useRef(traffic);
  trafficRef.current = traffic;
  const edgeTrafficRef = useRef(edgeTraffic);
  edgeTrafficRef.current = edgeTraffic;
  const instRef = useRef(inst);
  instRef.current = inst;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  function stopLive() {
    setLive(false);
    liveCancel.current?.();
    liveCancel.current = null;
    liveBusy.current = false;
    liveDirty.current = false;
  }

  const reoptimize = () => {
    const plan = livePlanRef.current;
    if (!plan) return;
    const instance = instRef.current;
    const stale = evaluateRoutes(plan, instance);
    const clock = formatClock(trafficRef.current.hour);
    const note = pendingNote.current;
    liveBusy.current = true;
    liveCancel.current = runVrp(
      instance,
      ['qpso'],
      { ...paramsRef.current, iterations: LIVE_ITERATIONS, seed: liveTick.current + 1, initialTours: [tourFromRoutes(plan)] },
      0,
      {
        onResult: (_, res) => {
          const sol = res.result.fitness < stale.fitness * (1 - LIVE_MIN_GAIN) ? res.result : stale;
          livePlanRef.current = sol.routes;
          setLivePlan(sol.routes);
          setEvents((ev) =>
            [
              {
                id: Date.now() + Math.random(),
                clock,
                note,
                stale: stale.fitness,
                updated: sol.fitness,
                savingPct: ((stale.fitness - sol.fitness) / stale.fitness) * 100,
                ms: res.timeMs,
              },
              ...ev,
            ].slice(0, 60),
          );
          liveBusy.current = false;
          liveCancel.current = null;
          if (liveDirty.current) {
            liveDirty.current = false;
            reoptimize();
          }
        },
        onError: () => {
          liveBusy.current = false;
        },
      },
    );
  };

  const startLive = () => {
    cancelRef.current?.();
    setSettingsOpen(false);
    const focused = byAlgo[focus]?.routes;
    const plan = focused ?? clarkeWrightRoutes(inst);
    livePlanRef.current = plan;
    setLivePlan(plan);
    setEvents([]);
    pendingNote.current = focused ? `Vans leave with the ${ALGORITHMS[focus].short} plan` : 'Vans leave with a quick first plan';
    setLive(true);
  };

  // Simulation clock: +10 min per tick, traffic drifting smoothly, and accidents whose chance
  // grows with how busy the city is (rare at night, frequent at rush hour). Congested roads are
  // the likeliest place for one, and each clears after 30–60 simulated minutes.
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      const tick = ++liveTick.current;
      const rng = mulberry32(tick * 7919 + 13);
      const cur = trafficRef.current;
      const expired: number[] = [];
      for (const [e, until] of liveIncidents.current) {
        if (until <= tick) {
          expired.push(e);
          liveIncidents.current.delete(e);
        }
      }
      const incidents = cur.incidents.filter((e) => !expired.includes(e));
      const notes: string[] = [];
      if (rng() < accidentRate(cur)) {
        const vc = edgeTrafficRef.current.vc;
        let total = 0;
        for (const e of graph.edges) if (!incidents.includes(e.id)) total += vc[e.id] ** 3;
        let pick = rng() * total;
        const hit = graph.edges.find((e) => !incidents.includes(e.id) && (pick -= vc[e.id] ** 3) <= 0);
        if (hit) {
          incidents.push(hit.id);
          liveIncidents.current.set(hit.id, tick + 3 + Math.floor(rng() * 4));
          notes.push(`Accident on ${hit.kind === 'arterial' ? 'main road' : 'street'} ${hit.id}`);
        }
      }
      if (expired.length) notes.push(`${expired.length} road${expired.length > 1 ? 's' : ''} reopened`);
      pendingNote.current = notes.length ? notes.join(', ') : 'Traffic shifted';
      setTraffic({ ...cur, hour: (cur.hour + 1 / 6) % 24, noiseSeed: cur.noiseSeed + 0.25, incidents });
    }, LIVE_TICK_MS);
    return () => window.clearInterval(id);
  }, [live, graph, setTraffic]);

  // Every traffic change while live → warm-started QPSO re-optimisation of the current plan.
  useEffect(() => {
    if (!live) return;
    if (liveBusy.current) {
      liveDirty.current = true;
      return;
    }
    reoptimize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst, live]);

  useEffect(
    () => () => {
      cancelRef.current?.();
      liveCancel.current?.();
    },
    [],
  );

  useEffect(() => {
    if (live) stopLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemKey]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  // Sticky navigation appears once the hero has scrolled away.
  const heroRef = useRef<HTMLElement>(null);
  const [showNav, setShowNav] = useState(false);
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShowNav(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ---- derived display state -----------------------------------------------------------------
  const shownRoutes: number[][] | null = live && livePlan ? livePlan : (byAlgo[focus]?.routes ?? null);
  const shown = useMemo(() => (shownRoutes ? solutionMetrics(evaluateRoutes(shownRoutes, inst), inst) : null), [shownRoutes, inst]);
  // Each van keeps its id (colour, number) across re-plans by inheriting the route it overlaps most.
  const vanAssign = useRef<VanAssignment | null>(null);
  const vanIds = useMemo(() => {
    const list = shown?.routes.map((r) => r.stops) ?? [];
    const ids = matchVanIds(vanAssign.current, list);
    if (list.length) vanAssign.current = { routes: list, ids };
    return ids;
  }, [shown]);
  const nnBaseline = useMemo(() => evaluateRoutes(nearestNeighbourRoutes(inst), inst), [inst]);

  const mapRoutes: MapRoute[] = useMemo(
    () =>
      (shown?.routes ?? []).map((r, k) => ({
        id: `van-${vanIds[k]}`,
        color: vanColor(pal, vanIds[k]),
        ...routeGeometry(graph, built.trees, inst, r.stops),
        animate: true,
      })),
    [shown, vanIds, graph, built, inst, pal],
  );

  const markers: MapMarker[] = useMemo(() => {
    const color = new Map<number, string>();
    (shown?.routes ?? []).forEach((r, k) => r.stops.forEach((c) => color.set(c, vanColor(pal, vanIds[k]))));
    return [
      ...customers.nodes.map((node, i) => ({
        node,
        kind: 'customer' as const,
        color: color.get(i + 1),
        title: `Stop ${i + 1}: ${customers.demand[i]} parcel${customers.demand[i] > 1 ? 's' : ''}`,
      })),
      { node: depot, kind: 'depot' as const },
    ];
  }, [customers, depot, shown, vanIds, pal]);

  const tableRows = ALGO_ORDER.filter((a) => byAlgo[a]).map((a) => {
    const r = byAlgo[a]!;
    const m = r.routes ? solutionMetrics(evaluateRoutes(r.routes, inst), inst) : null;
    return { algo: a, run: r, metrics: m, iter: r.points[r.points.length - 1]?.iter ?? 0 };
  });
  const bestFit = Math.min(...tableRows.map((r) => r.metrics?.fitness ?? Infinity));
  const bestAlgo = tableRows.find((r) => r.metrics && Math.abs(r.metrics.fitness - bestFit) < 1e-6)?.algo;

  const convSeries = ALGO_ORDER.filter((a) => byAlgo[a] && ALGORITHMS[a].stochastic).map((a) => ({
    id: a,
    name: ALGORITHMS[a].short,
    color: pal.algo[a],
    emphasis: a === 'qpso',
    points: byAlgo[a]!.points.map((p) => ({ x: p.iter, y: p.best })),
  }));
  const convRefs = ALGO_ORDER.filter((a) => byAlgo[a]?.final && !ALGORITHMS[a].stochastic).map((a) => ({
    name: ALGORITHMS[a].short,
    color: pal.algo[a],
    value: byAlgo[a]!.final!.result.fitness,
  }));
  const divSeries = (['qpso', 'pso', 'ga'] as AlgoId[])
    .filter((a) => byAlgo[a]?.points.length)
    .map((a) => {
      const pts = byAlgo[a]!.points;
      const d0 = pts.find((p) => Number.isFinite(p.diversity) && p.diversity > 0)?.diversity ?? 1;
      return {
        id: a,
        name: ALGORITHMS[a].short,
        color: pal.algo[a],
        emphasis: a === 'qpso',
        points: pts.map((p) => ({ x: p.iter, y: p.diversity / d0 })),
      };
    });

  const qpsoIter = byAlgo.qpso?.points[byAlgo.qpso.points.length - 1]?.iter ?? 0;
  const lastEvent = events[0];
  const caption = live
    ? lastEvent
      ? `Live at ${lastEvent.clock}. ${lastEvent.note}: ${lastEvent.savingPct > 0.05 ? `re-planned, ${lastEvent.savingPct.toFixed(1)}% better.` : 'current plan still holds.'}`
      : `Live at ${formatClock(traffic.hour)}. Re-planning whenever traffic changes.`
    : running
      ? `Planning. Round ${qpsoIter} of ${params.iterations}.`
      : shown
        ? `Showing the ${ALGORITHMS[focus].name} plan${focus === bestAlgo ? ', the best one found' : ''}.`
        : 'No plan yet. Press Plan routes.';
  const status = live ? `Live ${formatClock(traffic.hour)}` : running ? `Round ${qpsoIter}/${params.iterations}` : hasRuns ? 'Done' : 'Ready';

  const scoreInfo = `Score = ${weights.alpha} × minutes driving + ${weights.beta} × km + ${weights.gamma} × minutes stuck in traffic. Lower is better.`;
  const toggleAlgo = (a: AlgoId) => setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  const citySize = (Object.keys(CITY_SIZES) as SizeKey[]).find((k) => CITY_SIZES[k].cols === city.cols) ?? 'medium';

  const planButton = running ? (
    <Button variant="dark" size="lg" onClick={stop}>
      Stop
    </Button>
  ) : (
    <Button size="lg" onClick={optimize}>
      {hasRuns ? 'Plan again' : 'Plan routes'}
    </Button>
  );

  return (
    <>
      {/* Sticky navigation, shown after the hero scrolls out of view */}
      <nav
        aria-label="Page sections"
        inert={!showNav}
        className={`fixed inset-x-0 top-0 z-30 border-b-2 border-ink bg-paper transition-transform ${showNav ? 'translate-y-0' : '-translate-y-full'}`}
      >
        <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-6 py-2.5 lg:px-8">
          <button type="button" onClick={() => window.scrollTo({ top: 0 })} className="text-lg font-black tracking-tight">
            SwarmRoute
          </button>
          <div className="hidden gap-5 text-sm md:flex">
            {[
              ['planner', 'Map'],
              ['results', 'Results'],
              ['vans', 'Vans'],
              ['scale', 'Scale test'],
            ].map(([id, label]) => (
              <TextButton key={id} onClick={() => scrollToId(id)} className="font-medium">
                {label}
              </TextButton>
            ))}
          </div>
          <span className="ml-auto font-mono text-xs">{status}</span>
          {running ? (
            <Button variant="dark" size="sm" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={optimize}>
              {hasRuns ? 'Plan again' : 'Plan routes'}
            </Button>
          )}
        </div>
      </nav>

      {/* Hero: the problem, three controls, the map */}
      <section ref={heroRef} id="planner" className="scroll-mt-14 border-b-2 border-ink">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[minmax(380px,480px)_minmax(0,1fr)]">
          <div className="relative flex flex-col gap-8 border-ink p-6 sm:p-8 lg:border-r-2">
            <div>
              <h1 className="text-[clamp(2.75rem,4.1vw,4rem)] leading-[0.92] font-black tracking-[-0.035em]">
                <span className="block">
                  {cfg.customers} stop{cfg.customers === 1 ? '' : 's'}.
                </span>
                <span className="block">
                  {cfg.vehicles} van{cfg.vehicles === 1 ? '' : 's'}.
                </span>
                <span className="block">{periodOfDay(traffic.hour)}.</span>
              </h1>
              <p className="mt-6 max-w-[40ch] text-lg leading-relaxed">
                SwarmRoute plans delivery routes around traffic. A quantum-inspired search races the classic methods on the same streets, and the best
                plan goes on the map.
              </p>
            </div>

            <div className="space-y-5">
              <Slider
                label="Time of day"
                info="Sets how busy the roads are. Main roads slow down in the morning rush (around 08:30) and the evening rush (around 18:00). At night they are clear."
                value={traffic.hour}
                min={0}
                max={23.75}
                step={0.25}
                format={formatClock}
                onChange={(hour) => setTraffic({ ...traffic, hour })}
              />
              <Slider
                label="Stops"
                info="How many delivery addresses the vans must visit. Every extra stop makes the puzzle much harder: 60 stops already have more possible orderings than there are atoms in the universe."
                value={cfg.customers}
                min={5}
                max={200}
                onChange={(customers) => setCfg({ ...cfg, customers })}
              />
              <Slider
                label="Vans"
                info="How many vans are available. Each van starts and ends at the depot (the black D square) and can only carry so many parcels."
                value={cfg.vehicles}
                min={1}
                max={30}
                onChange={(vehicles) => setCfg({ ...cfg, vehicles })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {planButton}
              {live ? (
                <Button variant="outline" size="lg" onClick={stopLive}>
                  Stop live traffic
                </Button>
              ) : (
                <Button variant="outline" size="lg" onClick={startLive} disabled={running}>
                  Simulate live traffic
                </Button>
              )}
              <Info label="What does live traffic do?">
                Moves the clock forward 10 minutes every few seconds, causes random accidents, and re-plans the routes each time. The log under the
                map shows how much each re-plan saved.
              </Info>
            </div>
            {hasRuns && !running && !live && (
              <TextButton onClick={() => scrollToId('results')} className="self-start">
                See how each method did
              </TextButton>
            )}

            <div className="mt-auto space-y-4 border-t-2 border-ink pt-5">
              <TextButton onClick={() => setSettingsOpen(true)} aria-expanded={settingsOpen} aria-controls="advanced-settings">
                Advanced settings
              </TextButton>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">This is a simulated city with {graph.nodes.length} intersections.</p>
                <Button variant="outline" size="sm" onClick={onAddCityData}>
                  Add your city data
                </Button>
              </div>
            </div>

            {settingsOpen && (
              <div id="advanced-settings" role="region" aria-label="Advanced settings" className="absolute inset-0 z-20 overflow-y-auto bg-paper">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-ink bg-paper px-6 py-4 sm:px-8">
                  <h2 className="text-2xl font-black tracking-tight">Advanced settings</h2>
                  <Button variant="dark" size="sm" onClick={() => setSettingsOpen(false)} autoFocus>
                    Close
                  </Button>
                </div>
                <div className="space-y-10 px-6 py-6 sm:px-8">
                  <SettingsGroup title="Traffic">
                    <Slider
                      label="Traffic level"
                      info="Scales traffic across the whole city. 1.00 is a normal day; above that is a heavier-than-usual day."
                      value={traffic.intensity}
                      min={0.5}
                      max={1.8}
                      step={0.05}
                      format={(v) => `×${v.toFixed(2)}`}
                      onChange={(intensity) => setTraffic({ ...traffic, intensity })}
                    />
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        Blocked roads: <span className="font-mono">{traffic.incidents.length}</span>
                      </span>
                      <TextButton disabled={!traffic.incidents.length} onClick={() => setTraffic({ ...traffic, incidents: [] })}>
                        Reopen all
                      </TextButton>
                    </div>
                    <p className="text-sm text-muted">Click any road on the map to block or reopen it.</p>
                  </SettingsGroup>

                  <SettingsGroup title="What matters most">
                    <Slider
                      label="Driving time"
                      info="How much each minute of driving adds to the score."
                      value={weights.alpha}
                      min={0}
                      max={2}
                      step={0.05}
                      format={(v) => v.toFixed(2)}
                      onChange={(alpha) => setWeights({ ...weights, alpha })}
                    />
                    <Slider
                      label="Distance"
                      info="How much each kilometre adds to the score. Think fuel and wear on the vans."
                      value={weights.beta}
                      min={0}
                      max={2}
                      step={0.05}
                      format={(v) => v.toFixed(2)}
                      onChange={(beta) => setWeights({ ...weights, beta })}
                    />
                    <Slider
                      label="Avoiding jams"
                      info="Extra penalty for every minute stuck in traffic. Raise it and routes steer around jammed roads, even if the trip gets longer."
                      value={weights.gamma}
                      min={0}
                      max={3}
                      step={0.05}
                      format={(v) => v.toFixed(2)}
                      onChange={(gamma) => setWeights({ ...weights, gamma })}
                    />
                  </SettingsGroup>

                  <SettingsGroup title="Vans and parcels">
                    <Check
                      label="Pick van size automatically"
                      checked={cfg.capacityAuto}
                      onChange={(capacityAuto) => setCfg({ ...cfg, capacityAuto, capacity })}
                      info="Sizes the vans so the whole fleet has about 15% spare room."
                    />
                    <Slider
                      label="Parcels per van"
                      info="How many parcels one van can carry."
                      value={capacity}
                      min={maxDemand}
                      max={400}
                      disabled={cfg.capacityAuto}
                      onChange={(c) => setCfg({ ...cfg, capacity: c })}
                    />
                    <NumberField
                      label="Smallest order (parcels)"
                      value={cfg.demandMin}
                      min={1}
                      max={cfg.demandMax}
                      onChange={(demandMin) => setCfg({ ...cfg, demandMin: Math.max(1, Math.min(demandMin, cfg.demandMax)) })}
                    />
                    <NumberField
                      label="Largest order (parcels)"
                      value={cfg.demandMax}
                      min={cfg.demandMin}
                      max={100}
                      onChange={(demandMax) => setCfg({ ...cfg, demandMax: Math.max(cfg.demandMin, Math.min(100, demandMax)) })}
                    />
                    <p className={`text-sm ${totalDemand > capacity * cfg.vehicles ? 'font-bold text-warn' : ''}`}>
                      {totalDemand} parcels to deliver, room for {capacity * cfg.vehicles}.
                      {totalDemand > capacity * cfg.vehicles && ' Not enough vans: plans that need more are penalised.'}
                    </p>
                    <TextButton onClick={() => setCfg({ ...cfg, seed: Math.floor(Math.random() * 9999) })}>Move the stops around</TextButton>
                  </SettingsGroup>

                  <SettingsGroup title="The search">
                    <Slider
                      label="Swarm size"
                      info="How many candidate plans each search keeps at once. Bigger explores more but takes longer."
                      value={params.population}
                      min={5}
                      max={80}
                      onChange={(population) => setParams({ ...params, population })}
                    />
                    <Slider
                      label="Rounds"
                      info="How many rounds of improvement each method gets. Every method gets the same budget, so the comparison is fair."
                      value={params.iterations}
                      min={20}
                      max={1000}
                      step={10}
                      onChange={(iterations) => setParams({ ...params, iterations })}
                    />
                    <Slider
                      label="Exploration at the start"
                      info="How far the quantum swarm jumps early on (the β coefficient). Higher means wider, more adventurous jumps."
                      value={params.betaStart}
                      min={0.3}
                      max={1.7}
                      step={0.05}
                      format={(v) => v.toFixed(2)}
                      onChange={(betaStart) => setParams({ ...params, betaStart })}
                    />
                    <Slider
                      label="Focus at the end"
                      info="How tightly the swarm closes in on its best plan by the last round. Lower means a tighter focus."
                      value={params.betaEnd}
                      min={0.05}
                      max={1.2}
                      step={0.05}
                      format={(v) => v.toFixed(2)}
                      onChange={(betaEnd) => setParams({ ...params, betaEnd })}
                    />
                    <Check
                      label="Quantum tunnelling"
                      checked={params.tunneling}
                      onChange={(tunneling) => setParams({ ...params, tunneling })}
                      info="Lets QPSO occasionally make a long jump away from its best plan, so it can escape dead ends."
                    />
                    <Check
                      label="Tidy up each round"
                      checked={params.localSearch}
                      onChange={(localSearch) => setParams({ ...params, localSearch })}
                      info="After each round, untangle routes that cross themselves and swap stops between vans when that helps."
                    />
                    <Check
                      label="Start from classic plans"
                      checked={params.heuristicInit}
                      onChange={(heuristicInit) => setParams({ ...params, heuristicInit })}
                      info="Give every search the Clarke–Wright and nearest-stop plans as starting points instead of starting from scratch."
                    />
                    <Check
                      label="Watch the search"
                      checked={animate}
                      onChange={setAnimate}
                      info="Slows the search down so you can see the routes improve on the map."
                    />
                    {animate && (
                      <Slider
                        label="Pause between rounds"
                        info="Longer pauses make the animation slower and easier to follow."
                        value={delayMs}
                        min={1}
                        max={60}
                        format={(v) => `${v} ms`}
                        onChange={setDelayMs}
                      />
                    )}
                    <NumberField label="Random seed" value={params.seed} onChange={(seed) => setParams({ ...params, seed })} />
                  </SettingsGroup>

                  <SettingsGroup title="Methods to compare">
                    {ALGO_ORDER.map((a) => (
                      <Check
                        key={a}
                        swatch={pal.algo[a]}
                        label={
                          a === 'exact'
                            ? `${ALGORITHMS[a].name} (up to ${EXACT_MAX_N} stops)`
                            : `${ALGORITHMS[a].name}${a === 'qpso' ? ', ours' : ''}`
                        }
                        checked={selected.includes(a)}
                        disabled={!isAvailable(a, inst.n)}
                        onChange={() => toggleAlgo(a)}
                        info={ALGORITHMS[a].description}
                      />
                    ))}
                  </SettingsGroup>

                  <SettingsGroup title="City">
                    <div className="flex items-center gap-3">
                      <Choice<SizeKey>
                        label="City size"
                        value={citySize}
                        onChange={(k) => setCity({ ...city, ...CITY_SIZES[k] })}
                        options={[
                          { value: 'small', label: 'Small' },
                          { value: 'medium', label: 'Medium' },
                          { value: 'large', label: 'Large' },
                        ]}
                      />
                      <Info>Size of the simulated street grid. Larger cities have more roads to choose from.</Info>
                    </div>
                    <TextButton onClick={() => setCity({ ...city, seed: Math.floor(Math.random() * 9999) })}>Generate a new city</TextButton>
                  </SettingsGroup>
                </div>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-b-2 border-ink px-5 py-3 text-sm lg:border-t-0">
              <span className="font-bold">{caption}</span>
              <span className="text-muted">Click a road to block it</span>
            </div>
            <NetworkMap
              graph={graph}
              traffic={edgeTraffic}
              incidents={traffic.incidents}
              routes={mapRoutes}
              markers={markers}
              dimRoads={mapRoutes.length > 0}
              onEdgeClick={ctx.toggleIncident}
              label={`Map of the simulated city with ${cfg.customers} stops and ${mapRoutes.length} van routes`}
            />
            <StatStrip shown={shown} vehicles={inst.vehicles} nnFitness={nnBaseline.fitness} />
            {live && <LiveLog events={events} />}
          </div>
        </div>
      </section>

      {/* Results: which method won, and how the searches converged */}
      <section id="results" className="scroll-mt-14 border-b-2 border-ink">
        <div className="mx-auto max-w-[1440px] px-6 py-16 lg:px-8 lg:py-20">
          <h2 className="text-[clamp(2rem,3.6vw,3.5rem)] leading-none font-black tracking-[-0.03em]">Which method planned it best</h2>
          <p className="mt-4 max-w-[62ch] text-lg">
            Every method gets the same number of attempts on the same streets. Lower scores are better. Click a row to put that plan on the map.
          </p>

          {tableRows.length === 0 ? (
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-2 border-ink p-8">
              <p className="text-lg">Nothing to compare yet. Plan the routes and the results land here.</p>
              {planButton}
            </div>
          ) : (
            <div className="mt-10 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink text-left">
                    <th className="py-3 pr-4 font-bold">Method</th>
                    <th className="px-3 py-3 text-right font-bold">
                      <span className="inline-flex items-center gap-2">
                        Score <Info align="right">{scoreInfo}</Info>
                      </span>
                    </th>
                    <th className="px-3 py-3 text-right font-bold">Driving time</th>
                    <th className="px-3 py-3 text-right font-bold">Distance</th>
                    <th className="px-3 py-3 text-right font-bold">Stuck in traffic</th>
                    <th className="px-3 py-3 text-right font-bold">Vans</th>
                    <th className="px-3 py-3 text-right font-bold">Compute time</th>
                    <th className="py-3 pl-3 text-right font-bold">Behind the best</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(({ algo, run, metrics, iter }) => {
                    const meta = ALGORITHMS[algo];
                    const isFocus = focus === algo && !live;
                    const total = meta.stochastic ? params.iterations : 1;
                    return (
                      <tr
                        key={algo}
                        onClick={() => {
                          if (live || !run.routes) return;
                          setFocus(algo);
                          scrollToId('planner');
                        }}
                        className={`cursor-pointer border-b border-rule ${isFocus ? 'bg-paper-2' : 'hover:bg-paper-2'}`}
                      >
                        <td className={`py-3 pr-4 ${isFocus ? 'border-l-4 border-l-accent pl-3' : 'pl-0'}`}>
                          <div className="flex items-center gap-2.5">
                            <Swatch color={pal.algo[algo]} />
                            <span className="font-bold">{meta.name}</span>
                            {algo === bestAlgo && run.status === 'done' && (
                              <span className="bg-accent px-1.5 py-0.5 text-xs font-bold text-on-accent">Best</span>
                            )}
                          </div>
                          <div className="mt-0.5 pl-[22px] text-xs text-muted">{ALGO_PLAIN[algo]}</div>
                          {run.status === 'running' && (
                            <div className="mt-2 max-w-[180px] pl-[22px]">
                              <Bar value={iter / total} color={pal.algo[algo]} />
                            </div>
                          )}
                          {run.status === 'error' && <div className="mt-1 pl-[22px] text-xs font-bold text-warn">Failed: {run.error}</div>}
                          {run.status === 'stopped' && <div className="mt-1 pl-[22px] text-xs text-muted">Stopped</div>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-base">{fmt(metrics?.fitness, 1)}</td>
                        <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{metrics ? `${fmt(metrics.time, 0)} min` : '—'}</td>
                        <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{metrics ? `${fmt(metrics.dist, 1)} km` : '—'}</td>
                        <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{metrics ? `${fmt(metrics.delay, 1)} min` : '—'}</td>
                        <td
                          className={`px-3 py-3 text-right font-mono ${metrics && metrics.vehiclesUsed > inst.vehicles ? 'font-bold text-warn' : ''}`}
                        >
                          {metrics ? `${metrics.vehiclesUsed}/${inst.vehicles}` : '—'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono whitespace-nowrap">
                          {fmtMs(run.final?.timeMs ?? run.points[run.points.length - 1]?.timeMs)}
                        </td>
                        <td className="py-3 pl-3 text-right font-mono whitespace-nowrap">
                          {metrics ? (Math.abs(metrics.fitness - bestFit) < 1e-6 ? '—' : pct(((metrics.fitness - bestFit) / bestFit) * 100)) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-14 grid gap-10 lg:grid-cols-2">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <h3 className="text-xl font-black tracking-tight">Best score, round by round</h3>
                <Info>
                  Each line is a method&apos;s best score so far. Lower is better. A line that drops early found good routes faster. Dashed lines are
                  the one-shot methods for comparison.
                </Info>
              </div>
              <LineSeriesChart
                series={convSeries}
                refs={convRefs}
                xLabel="round"
                height={280}
                empty="Plan the routes to see how each search improves."
              />
            </div>
            <div>
              <div className="mb-4 flex items-center gap-2">
                <h3 className="text-xl font-black tracking-tight">How widely each swarm searches</h3>
                <Info align="right">
                  How spread out each method&apos;s candidate plans are, relative to the start. QPSO spreads out first to explore, then closes in on
                  the best plan. Classic PSO and the genetic algorithm collapse early, which is how searches get stuck.
                </Info>
              </div>
              <LineSeriesChart
                series={divSeries}
                xLabel="round"
                height={280}
                yFormat={(v) => v.toFixed(1)}
                step={false}
                yMin={0}
                empty="Appears for QPSO, PSO and the genetic algorithm."
              />
            </div>
          </div>
        </div>
      </section>

      {/* Van by van (inverted section) */}
      <section id="vans" className="scroll-mt-14 border-b-2 border-ink bg-band text-band-ink">
        <div className="mx-auto max-w-[1440px] px-6 py-16 lg:px-8 lg:py-20">
          <h2 className="text-[clamp(2rem,3.6vw,3.5rem)] leading-none font-black tracking-[-0.03em]">Van by van</h2>
          <p className="mt-4 max-w-[62ch] text-lg text-band-ink/80">
            {shown
              ? `${shown.routes.length} vans leave the depot. Each carries at most ${capacity} parcels.`
              : 'Once there is a plan, every van’s stops, load and drive time show up here.'}
          </p>
          {shown && <VanGrid metrics={shown} ids={vanIds} capacity={capacity} />}
        </div>
      </section>

      <ScaleTest ctx={ctx} baseParams={params} />
    </>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-5">
      <legend className="mb-4 w-full border-b-2 border-ink pb-2 text-lg font-black tracking-tight">{title}</legend>
      {children}
    </fieldset>
  );
}

function StatStrip({ shown, vehicles, nnFitness }: { shown: SolutionMetrics | null; vehicles: number; nnFitness: number }) {
  const saving = shown ? ((shown.fitness - nnFitness) / nnFitness) * 100 : NaN;
  const cells = [
    { label: 'Driving time', value: shown ? fmt(shown.time, 0) : '—', unit: 'min' },
    { label: 'Distance', value: shown ? fmt(shown.dist, 1) : '—', unit: 'km' },
    { label: 'Vans used', value: shown ? `${shown.vehiclesUsed}/${vehicles}` : '—', unit: '' },
    {
      label: 'Versus nearest-stop plan',
      value: shown ? pct(saving) : '—',
      unit: '',
      info: 'Compared with the naive plan where each van always drives to the closest stop that still fits. Negative means better.',
      good: shown && saving < 0,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-0.5 border-t-2 border-ink bg-ink md:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-paper px-5 py-4">
          <div className="flex items-center gap-2 text-sm">
            {c.label}
            {c.info && <Info align="right">{c.info}</Info>}
          </div>
          <div className={`mt-2 font-mono text-[clamp(1.6rem,2.4vw,2.25rem)] leading-none font-medium ${c.good ? 'text-accent' : ''}`}>
            {c.value}
            {c.unit && shown && <span className="ml-1.5 text-sm">{c.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveLog({ events }: { events: LiveEvent[] }) {
  const saved = events.reduce((s, e) => s + (e.stale - e.updated), 0);
  return (
    <div className="border-t-2 border-ink px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">Re-plans</span>
        <span className="font-mono text-sm">
          {events.length ? `${saved.toFixed(1)} score points saved so far` : 'Waiting for the first traffic update'}
        </span>
      </div>
      <ul className="mt-2 text-sm">
        {events.slice(0, 5).map((e) => (
          <li key={e.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-baseline gap-3 border-t border-rule py-1.5">
            <span className="font-mono">{e.clock}</span>
            <span className="truncate">{e.note}</span>
            <span className={`font-mono ${e.savingPct > 0.05 ? 'font-bold text-accent' : 'text-muted'}`}>
              {e.savingPct > 0.05 ? `${e.savingPct.toFixed(1)}% better` : 'no change'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VanGrid({ metrics, ids, capacity }: { metrics: SolutionMetrics; ids: number[]; capacity: number }) {
  const pal = usePalette();
  const vans = metrics.routes.map((r, k) => ({ r, id: ids[k] ?? k })).sort((a, b) => a.id - b.id);
  return (
    <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {vans.map(({ r, id }) => {
        const color = vanColor(pal, id);
        return (
          <li key={id} className="border-2 border-band-ink p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5 text-lg font-black">
                <span className="h-4 w-4 border-2 border-band-ink" style={{ background: color }} />
                Van {id + 1}
              </span>
              <span className="text-sm">{r.stops.length} stops</span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Bar value={r.load / capacity} color={color} light />
              <span className="shrink-0 font-mono text-xs">
                {r.load}/{capacity}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-sm">
              <span>{r.time.toFixed(0)} min</span>
              <span>{r.dist.toFixed(1)} km</span>
              <span>+{r.delay.toFixed(0)} jam</span>
            </div>
            <p className="mt-3 line-clamp-2 font-mono text-xs text-band-ink/70" title={`Depot, ${r.stops.join(', ')}, depot`}>
              Depot, {r.stops.join(', ')}, depot
            </p>
          </li>
        );
      })}
    </ul>
  );
}
