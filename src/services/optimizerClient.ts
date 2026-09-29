import type { AlgoId, AlgoParams } from '../core/algorithms';
import type { SPMethod, SPParams, SPPath } from '../core/algorithms/spMetaheuristic';
import type { BenchmarkConfig, BenchmarkProgress, BenchmarkReport } from '../core/benchmark';
import type { RoadGraph } from '../core/graph';
import type { AlgoRunResult, DriveResult, ProgressPoint } from '../core/runner';
import type { EdgeWeights } from '../core/shortestPath';
import type { VRPInstance } from '../core/vrp';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

function spawn(): Worker {
  return new Worker(new URL('../worker/optimizer.worker.ts', import.meta.url), { type: 'module' });
}

export type Cancel = () => void;

function startWorker(req: WorkerRequest, onMessage: (m: WorkerResponse, stop: () => void) => void, onCrash: (msg: string) => void): Cancel {
  const w = spawn();
  let alive = true;
  const stop = () => {
    if (alive) {
      alive = false;
      w.terminate();
    }
  };
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    if (alive) onMessage(e.data, stop);
  };
  w.onerror = (e) => {
    e.preventDefault();
    if (alive) onCrash(e.message || 'Worker crashed');
    stop();
  };
  w.postMessage(req);
  return stop;
}

export interface VrpHandlers {
  onProgress?: (algo: AlgoId, point: ProgressPoint, routes?: number[][]) => void;
  onResult: (algo: AlgoId, result: AlgoRunResult) => void;
  onError?: (algo: AlgoId, message: string) => void;
  onAllDone?: () => void;
}

/** Runs each algorithm in its own Web Worker so they optimise in parallel and the UI stays live. */
export function runVrp(instance: VRPInstance, algos: AlgoId[], params: AlgoParams, delayMs: number, h: VrpHandlers): Cancel {
  let remaining = algos.length;
  const finishOne = () => {
    remaining--;
    if (remaining === 0) h.onAllDone?.();
  };
  const cancels = algos.map((algo) =>
    startWorker(
      { type: 'vrp', algo, instance, params, delayMs },
      (m, stop) => {
        if (m.type === 'vrp-progress') h.onProgress?.(algo, m.point, m.routes);
        else if (m.type === 'vrp-result') {
          h.onResult(algo, m.result);
          stop();
          finishOne();
        } else if (m.type === 'error') {
          h.onError?.(algo, m.message);
          stop();
          finishOne();
        }
      },
      (msg) => {
        h.onError?.(algo, msg);
        finishOne();
      },
    ),
  );
  return () => cancels.forEach((c) => c());
}

export interface BenchHandlers {
  onProgress: (p: BenchmarkProgress) => void;
  onResult: (r: BenchmarkReport) => void;
  onError: (message: string) => void;
}

export function runBenchmark(graph: RoadGraph, ew: EdgeWeights, depot: number, config: BenchmarkConfig, h: BenchHandlers): Cancel {
  return startWorker(
    { type: 'benchmark', graph, ew, depot, config },
    (m, stop) => {
      if (m.type === 'bench-progress') h.onProgress(m.progress);
      else if (m.type === 'bench-result') {
        h.onResult(m.report);
        stop();
      } else if (m.type === 'error') {
        h.onError(m.message);
        stop();
      }
    },
    h.onError,
  );
}

export interface SpHandlers {
  onProgress?: (method: SPMethod, point: ProgressPoint, path?: SPPath) => void;
  onResult: (method: SPMethod, result: DriveResult<SPPath>) => void;
  onError?: (method: SPMethod, message: string) => void;
}

export function runShortestPath(
  graph: RoadGraph,
  ew: EdgeWeights,
  source: number,
  target: number,
  methods: SPMethod[],
  params: SPParams,
  delayMs: number,
  h: SpHandlers,
): Cancel {
  const cancels = methods.map((method) =>
    startWorker(
      { type: 'sp', method, graph, ew, source, target, params, delayMs },
      (m, stop) => {
        if (m.type === 'sp-progress') h.onProgress?.(method, m.point, m.path);
        else if (m.type === 'sp-result') {
          h.onResult(method, m.result);
          stop();
        } else if (m.type === 'error') {
          h.onError?.(method, m.message);
          stop();
        }
      },
      (msg) => h.onError?.(method, msg),
    ),
  );
  return () => cancels.forEach((c) => c());
}
