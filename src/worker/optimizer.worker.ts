import { spMetaheuristic } from '../core/algorithms/spMetaheuristic';
import { benchmarkSuite } from '../core/benchmark';
import { driveAsync, runAlgorithm } from '../core/runner';
import type { WorkerRequest, WorkerResponse } from './protocol';

const ctx = self as unknown as {
  postMessage: (m: WorkerResponse) => void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

const post = (m: WorkerResponse) => ctx.postMessage(m);

/** Throttle progress messages: every iteration when animating, ~60 per run otherwise. */
function cadence(iterations: number, delayMs: number) {
  const progressEvery = delayMs > 0 ? 1 : Math.max(1, Math.floor(iterations / 60));
  const routeEvery = delayMs > 0 ? 2 : Math.max(1, Math.floor(iterations / 12));
  return { progressEvery, routeEvery };
}

ctx.onmessage = async (e) => {
  const req = e.data;
  try {
    if (req.type === 'vrp') {
      const { progressEvery, routeEvery } = cadence(req.params.iterations, req.delayMs);
      let lastRouteBest = Infinity;
      const result = await runAlgorithm(req.algo, req.instance, req.params, {
        delayMs: req.delayMs,
        onStep: (point, incumbent) => {
          if (point.iter % progressEvery !== 0) return;
          const sendRoutes = point.iter % routeEvery === 0 && incumbent.fitness < lastRouteBest;
          if (sendRoutes) lastRouteBest = incumbent.fitness;
          post({ type: 'vrp-progress', algo: req.algo, point, routes: sendRoutes ? incumbent.routes : undefined });
        },
      });
      post({ type: 'vrp-result', algo: req.algo, result });
    } else if (req.type === 'benchmark') {
      const gen = benchmarkSuite(req.graph, req.ew, req.depot, req.config);
      for (;;) {
        const r = gen.next();
        if (r.done) {
          post({ type: 'bench-result', report: r.value });
          break;
        }
        post({ type: 'bench-progress', progress: r.value });
      }
    } else if (req.type === 'sp') {
      const { progressEvery, routeEvery } = cadence(req.params.iterations, req.delayMs);
      let lastBest = Infinity;
      const result = await driveAsync(spMetaheuristic(req.graph, req.ew, req.source, req.target, req.method, req.params), {
        delayMs: req.delayMs,
        onStep: (point, incumbent) => {
          if (point.iter % progressEvery !== 0) return;
          const sendPath = point.iter % routeEvery === 0 && incumbent.cost < lastBest;
          if (sendPath) lastBest = incumbent.cost;
          post({ type: 'sp-progress', method: req.method, point, path: sendPath ? incumbent : undefined });
        },
      });
      post({ type: 'sp-result', method: req.method, result });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
