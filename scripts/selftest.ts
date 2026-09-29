/**
 * Correctness checks for the optimisation core (run with `npm test`):
 *  - Dijkstra and A* agree on every sampled origin–destination pair
 *  - every algorithm returns a valid solution (each customer once, capacity respected)
 *  - no metaheuristic beats the exact DP on small instances (it is a true lower bound)
 *  - the priority-encoded QPSO shortest path is valid and never beats Dijkstra
 */
import { ALGO_ORDER, ALGORITHMS, DEFAULT_PARAMS, isAvailable } from '../src/core/algorithms';
import { DEFAULT_SP_PARAMS, spMetaheuristic } from '../src/core/algorithms/spMetaheuristic';
import { DEFAULT_CITY, generateCity, nearestNode } from '../src/core/graph';
import { driveSync, runAlgorithmSync } from '../src/core/runner';
import { astar, DEFAULT_WEIGHTS, dijkstra, edgeWeights } from '../src/core/shortestPath';
import { computeTraffic, DEFAULT_TRAFFIC } from '../src/core/traffic';
import { autoCapacity, buildInstance, generateCustomers, validateSolution } from '../src/core/vrp';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.error('FAIL', msg);
  }
};

const graph = generateCity(DEFAULT_CITY);
const traffic = computeTraffic(graph, DEFAULT_TRAFFIC);
const ew = edgeWeights(graph, traffic, DEFAULT_WEIGHTS);
const depot = nearestNode(graph, graph.width / 2, graph.height / 2);
console.log(`city: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

for (let k = 0; k < 25; k++) {
  const s = (k * 37) % graph.nodes.length;
  const t = (k * 101 + 50) % graph.nodes.length;
  const d = dijkstra(graph, ew, s).cost[t];
  const a = astar(graph, ew, s, t).path.cost;
  check(Math.abs(d - a) < 1e-6, `A* (${a}) != Dijkstra (${d}) for ${s}->${t}`);
}

for (const n of [8, 10, 12, 40, 120]) {
  const { nodes, demand } = generateCustomers(graph, depot, n, 42 + n, [1, 10]);
  const vehicles = Math.ceil(n / 8);
  const { instance } = buildInstance(graph, ew, depot, nodes, demand, autoCapacity(demand, vehicles), vehicles);
  const results: Record<string, number> = {};
  for (const algo of ALGO_ORDER) {
    if (!isAvailable(algo, n)) continue;
    const r = runAlgorithmSync(algo, instance, { ...DEFAULT_PARAMS, iterations: n > 50 ? 120 : 150 });
    const err = validateSolution(r.result, instance);
    check(err === null, `${algo} n=${n}: ${err}`);
    check(Math.abs(r.result.fitness - r.history[r.history.length - 1].best) < 1e-6, `${algo} n=${n}: final fitness mismatch`);
    results[ALGORITHMS[algo].short] = r.result.fitness;
    results[`${ALGORITHMS[algo].short} ms`] = Math.round(r.timeMs);
  }
  if (results.Exact !== undefined) {
    for (const [k, v] of Object.entries(results)) {
      if (!k.endsWith('ms')) check(v >= results.Exact - 1e-6, `n=${n}: ${k} (${v}) beat exact (${results.Exact})`);
    }
  }
  console.log(`n=${n}`, Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Number(v.toFixed(2))])));
}

for (const [s, t] of [
  [0, graph.nodes.length - 1],
  [depot, 5],
]) {
  const opt = dijkstra(graph, ew, s).cost[t];
  for (const method of ['qpso', 'pso'] as const) {
    const r = driveSync(spMetaheuristic(graph, ew, s, t, method, DEFAULT_SP_PARAMS));
    const p = r.result;
    check(p.nodes[0] === s && p.nodes[p.nodes.length - 1] === t, `${method} path endpoints`);
    check(new Set(p.nodes).size === p.nodes.length, `${method} path repeats nodes`);
    check(p.cost >= opt - 1e-6, `${method} beat Dijkstra`);
    console.log(
      `SP ${s}->${t} ${method}: ${p.cost.toFixed(2)} vs opt ${opt.toFixed(2)} (gap ${(((p.cost - opt) / opt) * 100).toFixed(2)}%) ${Math.round(r.timeMs)}ms`,
    );
  }
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
