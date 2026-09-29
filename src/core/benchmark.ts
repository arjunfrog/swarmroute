import { ALGORITHMS, isAvailable, type AlgoId, type AlgoParams } from './algorithms';
import type { RoadGraph } from './graph';
import { runAlgorithmSync, type AlgoRunResult } from './runner';
import type { EdgeWeights } from './shortestPath';
import { autoCapacity, buildInstance, generateCustomers, validateSolution } from './vrp';

export interface BenchmarkConfig {
  sizes: number[];
  runs: number;
  algos: AlgoId[];
  customersPerVehicle: number;
  seed: number;
  demandRange: [number, number];
  params: AlgoParams;
}

export interface BenchmarkRow {
  n: number;
  vehicles: number;
  capacity: number;
  algo: AlgoId;
  runs: number;
  mean: number;
  std: number;
  best: number;
  worst: number;
  meanTimeMs: number;
  meanConvIter: number;
  meanConvTimeMs: number;
  meanEvals: number;
  /** mean gap to the reference (exact optimum if available, else best-known), % */
  gapPct: number;
  bestGapPct: number;
  reference: 'exact' | 'best-known';
  referenceValue: number;
  meanVehicles: number;
  /** runs whose solution uses more vehicles than the fleet (penalised) */
  overFleet: number;
  invalid: number;
}

export interface ConvergenceSeries {
  algo: AlgoId;
  points: { iter: number; best: number }[];
}

export interface BenchmarkReport {
  config: BenchmarkConfig;
  rows: BenchmarkRow[];
  convergence: { n: number; series: ConvergenceSeries[] }[];
  generatedAt: string;
  totalTimeMs: number;
}

export interface BenchmarkProgress {
  done: number;
  total: number;
  label: string;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const out: T[] = [];
  const step = (xs.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(xs[Math.round(i * step)]);
  return out;
}

/**
 * Systematic benchmark: for each problem size, generate an instance on the current road network
 * and traffic, run every algorithm `runs` times (deterministic methods once) with distinct seeds,
 * and report mean ± std, best, runtime, convergence iteration and gap to the reference solution.
 */
export function* benchmarkSuite(
  graph: RoadGraph,
  ew: EdgeWeights,
  depot: number,
  cfg: BenchmarkConfig,
): Generator<BenchmarkProgress, BenchmarkReport, void> {
  const t0 = performance.now();
  const plan = cfg.sizes.flatMap((n) =>
    cfg.algos.filter((a) => isAvailable(a, n)).map((a) => ({ n, algo: a, runs: ALGORITHMS[a].stochastic ? cfg.runs : 1 })),
  );
  const total = plan.reduce((s, p) => s + p.runs, 0);
  let done = 0;
  const rows: BenchmarkRow[] = [];
  const convergence: BenchmarkReport['convergence'] = [];

  for (const n of cfg.sizes) {
    const { nodes, demand } = generateCustomers(graph, depot, n, cfg.seed + n, cfg.demandRange);
    const vehicles = Math.max(1, Math.ceil(n / cfg.customersPerVehicle));
    const capacity = autoCapacity(demand, vehicles);
    const { instance } = buildInstance(graph, ew, depot, nodes, demand, capacity, vehicles);
    const results = new Map<AlgoId, AlgoRunResult[]>();

    for (const item of plan.filter((p) => p.n === n)) {
      const list: AlgoRunResult[] = [];
      for (let r = 0; r < item.runs; r++) {
        yield { done, total, label: `n=${n} · ${ALGORITHMS[item.algo].short} · run ${r + 1}/${item.runs}` };
        list.push(runAlgorithmSync(item.algo, instance, { ...cfg.params, seed: cfg.seed * 1000 + r * 7919 + n }));
        done++;
      }
      results.set(item.algo, list);
    }

    const exactRes = results.get('exact')?.[0];
    let refValue = Infinity;
    for (const list of results.values()) for (const r of list) refValue = Math.min(refValue, r.result.fitness);
    const reference: BenchmarkRow['reference'] = exactRes ? 'exact' : 'best-known';
    if (exactRes) refValue = exactRes.result.fitness;
    const gap = (v: number) => {
      const g = refValue > 0 ? ((v - refValue) / refValue) * 100 : 0;
      return Math.abs(g) < 1e-6 ? 0 : g;
    };

    const series: ConvergenceSeries[] = [];
    for (const [algo, list] of results) {
      const fits = list.map((r) => r.result.fitness);
      rows.push({
        n,
        vehicles,
        capacity,
        algo,
        runs: list.length,
        mean: mean(fits),
        std: std(fits),
        best: Math.min(...fits),
        worst: Math.max(...fits),
        meanTimeMs: mean(list.map((r) => r.timeMs)),
        meanConvIter: mean(list.map((r) => r.convergenceIter)),
        meanConvTimeMs: mean(list.map((r) => r.convergenceTimeMs)),
        meanEvals: mean(list.map((r) => r.evals)),
        gapPct: gap(mean(fits)),
        bestGapPct: gap(Math.min(...fits)),
        reference,
        referenceValue: refValue,
        meanVehicles: mean(list.map((r) => r.result.vehiclesUsed)),
        overFleet: list.filter((r) => r.result.vehiclesUsed > vehicles).length,
        invalid: list.filter((r) => validateSolution(r.result, instance) !== null).length,
      });
      if (ALGORITHMS[algo].stochastic) {
        series.push({ algo, points: downsample(list[0].history, 120).map((h) => ({ iter: h.iter, best: h.best })) });
      }
    }
    convergence.push({ n, series });
  }

  return { config: cfg, rows, convergence, generatedAt: new Date().toISOString(), totalTimeMs: performance.now() - t0 };
}

export function reportToCsv(report: BenchmarkReport): string {
  const head = [
    'n',
    'vehicles',
    'capacity',
    'algorithm',
    'runs',
    'mean',
    'std',
    'best',
    'worst',
    'gap_pct',
    'best_gap_pct',
    'reference',
    'mean_time_ms',
    'mean_conv_iter',
    'mean_evals',
    'mean_vehicles',
    'over_fleet',
    'invalid',
  ];
  const lines = report.rows.map((r) =>
    [
      r.n,
      r.vehicles,
      r.capacity,
      ALGORITHMS[r.algo].name,
      r.runs,
      r.mean.toFixed(3),
      r.std.toFixed(3),
      r.best.toFixed(3),
      r.worst.toFixed(3),
      r.gapPct.toFixed(3),
      r.bestGapPct.toFixed(3),
      r.reference,
      r.meanTimeMs.toFixed(2),
      r.meanConvIter.toFixed(1),
      r.meanEvals.toFixed(0),
      r.meanVehicles.toFixed(2),
      r.overFleet,
      r.invalid,
    ].join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
