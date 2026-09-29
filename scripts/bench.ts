/**
 * Headless benchmark (same code the Benchmark Lab tab runs in a Web Worker).
 *
 *   npm run bench                         # default sizes 10,25,50,100 × 3 runs
 *   npm run bench -- --sizes 10,50,200 --runs 5 --hour 18 --out results.json
 */
import { writeFileSync } from 'node:fs';
import { ALGO_ORDER, ALGORITHMS, DEFAULT_PARAMS } from '../src/core/algorithms';
import { benchmarkSuite, reportToCsv } from '../src/core/benchmark';
import { DEFAULT_CITY, generateCity, nearestNode } from '../src/core/graph';
import { DEFAULT_WEIGHTS, edgeWeights } from '../src/core/shortestPath';
import { computeTraffic, DEFAULT_TRAFFIC, travelTimeIndex } from '../src/core/traffic';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const sizes = arg('sizes', '10,25,50,100').split(',').map(Number);
const runs = Number(arg('runs', '3'));
const hour = Number(arg('hour', String(DEFAULT_TRAFFIC.hour)));
const iterations = Number(arg('iterations', String(DEFAULT_PARAMS.iterations)));
const out = arg('out', '');

const graph = generateCity(DEFAULT_CITY);
const traffic = computeTraffic(graph, { ...DEFAULT_TRAFFIC, hour });
const ew = edgeWeights(graph, traffic, DEFAULT_WEIGHTS);
const depot = nearestNode(graph, graph.width / 2, graph.height / 2);

console.log(
  `Network: ${graph.nodes.length} intersections, ${graph.edges.length} road segments · hour ${hour} · TTI ${travelTimeIndex(traffic).toFixed(2)}`,
);

const gen = benchmarkSuite(graph, ew, depot, {
  sizes,
  runs,
  algos: ALGO_ORDER,
  customersPerVehicle: 8,
  seed: 42,
  demandRange: [1, 10],
  params: { ...DEFAULT_PARAMS, iterations },
});

let r = gen.next();
while (!r.done) {
  process.stderr.write(`\r[${r.value.done}/${r.value.total}] ${r.value.label}          `);
  r = gen.next();
}
process.stderr.write('\n');
const report = r.value;

for (const n of sizes) {
  const rows = report.rows.filter((x) => x.n === n).sort((a, b) => a.mean - b.mean);
  if (!rows.length) continue;
  console.log(`\nn = ${n} customers · ${rows[0].vehicles} vehicles · Q = ${rows[0].capacity} · reference: ${rows[0].reference}`);
  console.table(
    rows.map((x) => ({
      algorithm: ALGORITHMS[x.algo].name,
      'mean J': x.mean.toFixed(2),
      '± std': x.std.toFixed(2),
      best: x.best.toFixed(2),
      'gap %': x.gapPct.toFixed(2),
      'time ms': x.meanTimeMs.toFixed(1),
      'conv iter': x.meanConvIter.toFixed(0),
      vehicles: `${x.meanVehicles.toFixed(1)}/${x.vehicles}`,
      invalid: x.invalid,
    })),
  );
}
console.log(`\nTotal ${(report.totalTimeMs / 1000).toFixed(1)} s`);

if (out) {
  writeFileSync(out, out.endsWith('.csv') ? reportToCsv(report) : JSON.stringify(report, null, 2));
  console.log(`Saved ${out}`);
}
