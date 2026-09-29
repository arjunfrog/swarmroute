import { createAlgorithm, type AlgoId, type AlgoParams, type StepUpdate } from './algorithms';
import type { Solution, VRPInstance } from './vrp';

export interface ProgressPoint {
  iter: number;
  evals: number;
  best: number;
  mean: number;
  diversity: number;
  /** cumulative compute time (animation delays excluded) */
  timeMs: number;
}

export interface DriveResult<R> {
  result: R;
  history: ProgressPoint[];
  timeMs: number;
  evals: number;
  iterations: number;
  /** first iteration whose best is within 1% of the final best */
  convergenceIter: number;
  convergenceTimeMs: number;
}

export interface AlgoRunResult extends DriveResult<Solution> {
  algo: AlgoId;
}

export interface DriveOptions<S> {
  /** artificial pause between iterations so the UI can animate convergence */
  delayMs?: number;
  onStep?: (point: ProgressPoint, incumbent: S) => void;
}

const now = () => performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toPoint<S>(u: StepUpdate<S>, timeMs: number): ProgressPoint {
  return { iter: u.iter, evals: u.evals, best: u.best, mean: u.mean, diversity: u.diversity, timeMs };
}

function finish<R>(result: R, history: ProgressPoint[], timeMs: number): DriveResult<R> {
  const last = history[history.length - 1];
  const final = last?.best ?? Infinity;
  const threshold = final + Math.abs(final) * 0.01;
  const conv = history.find((h) => h.best <= threshold) ?? last;
  return {
    result,
    history,
    timeMs,
    evals: last?.evals ?? 0,
    iterations: last?.iter ?? 0,
    convergenceIter: conv?.iter ?? 0,
    convergenceTimeMs: conv?.timeMs ?? 0,
  };
}

export function driveSync<S, R extends object>(gen: Generator<StepUpdate<S>, R, void>): DriveResult<R> {
  const history: ProgressPoint[] = [];
  let t = 0;
  for (;;) {
    const t0 = now();
    const r = gen.next();
    t += now() - t0;
    if (r.done) return finish(r.value, history, t);
    history.push(toPoint(r.value, t));
  }
}

export async function driveAsync<S, R extends object>(gen: Generator<StepUpdate<S>, R, void>, opts: DriveOptions<S> = {}): Promise<DriveResult<R>> {
  const history: ProgressPoint[] = [];
  let t = 0;
  for (;;) {
    const t0 = now();
    const r = gen.next();
    t += now() - t0;
    if (r.done) return finish(r.value, history, t);
    const point = toPoint(r.value, t);
    history.push(point);
    opts.onStep?.(point, r.value.incumbent);
    if (opts.delayMs && opts.delayMs > 0) await sleep(opts.delayMs);
  }
}

export function runAlgorithmSync(algo: AlgoId, inst: VRPInstance, params: AlgoParams): AlgoRunResult {
  return { algo, ...driveSync(createAlgorithm(algo, inst, params)) };
}

export async function runAlgorithm(algo: AlgoId, inst: VRPInstance, params: AlgoParams, opts: DriveOptions<Solution> = {}): Promise<AlgoRunResult> {
  return { algo, ...(await driveAsync(createAlgorithm(algo, inst, params), opts)) };
}
