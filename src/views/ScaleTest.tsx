import { useEffect, useMemo, useRef, useState } from 'react';
import type { CityCtx } from '../app/context';
import { downloadFile, fmt, fmtMs } from '../app/format';
import { ALGO_ORDER, ALGORITHMS, EXACT_MAX_N, type AlgoId, type AlgoParams } from '../core/algorithms';
import { reportToCsv, type BenchmarkProgress, type BenchmarkReport } from '../core/benchmark';
import { usePalette } from '../app/theme';
import { LineSeriesChart } from '../components/LazyChart';
import { Bar, Button, Info, Swatch, TextButton } from '../components/ui';
import { runBenchmark, type Cancel } from '../services/optimizerClient';

const SIZE_OPTIONS = [10, 25, 50, 100, 150, 200];
const RUN_OPTIONS = [1, 3, 5, 10];

/** The benchmark suite as one quiet section: pick sizes, run, read the verdict. */
export function ScaleTest({ ctx, baseParams }: { ctx: CityCtx; baseParams: AlgoParams }) {
  const { graph, ew, depot } = ctx;
  const pal = usePalette();
  const [sizes, setSizes] = useState<number[]>([10, 25, 50, 100]);
  const [runs, setRuns] = useState(3);
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null);
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<Cancel | null>(null);
  const running = progress !== null;

  const start = () => {
    cancelRef.current?.();
    setError(null);
    setProgress({ done: 0, total: 1, label: 'Preparing problems' });
    cancelRef.current = runBenchmark(
      graph,
      ew,
      depot,
      {
        sizes: [...sizes].sort((a, b) => a - b),
        runs,
        algos: ALGO_ORDER,
        customersPerVehicle: 8,
        seed: 42,
        demandRange: [1, 10],
        params: { ...baseParams, iterations: 150, initialTours: undefined },
      },
      {
        onProgress: setProgress,
        onResult: (r) => {
          setReport(r);
          setProgress(null);
          cancelRef.current = null;
        },
        onError: (m) => {
          setError(m);
          setProgress(null);
        },
      },
    );
  };
  const cancel = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setProgress(null);
  };
  useEffect(() => () => cancelRef.current?.(), []);

  const verdict = useMemo(() => {
    if (!report) return null;
    let qpsoWins = 0;
    for (const n of report.config.sizes) {
      const rs = report.rows.filter((r) => r.n === n);
      const best = Math.min(...rs.map((r) => r.mean));
      if (rs.some((r) => r.algo === 'qpso' && r.mean <= best + 1e-9)) qpsoWins++;
    }
    const q = report.rows.filter((r) => r.algo === 'qpso');
    const avgGap = q.reduce((s, r) => s + r.gapPct, 0) / Math.max(1, q.length);
    return { qpsoWins, sizes: report.config.sizes.length, avgGap };
  }, [report]);

  const series = (key: 'gapPct' | 'meanTimeMs', algos: AlgoId[]) =>
    report
      ? algos
          .map((a) => ({
            id: a,
            name: ALGORITHMS[a].short,
            color: pal.algo[a],
            emphasis: a === 'qpso',
            points: report.rows
              .filter((r) => r.algo === a)
              .map((r) => ({ x: r.n, y: key === 'meanTimeMs' ? Math.max(r.meanTimeMs, 0.01) : r.gapPct })),
          }))
          .filter((s) => s.points.length > 0)
      : [];

  return (
    <section id="scale" className="scroll-mt-14 border-b-2 border-ink">
      <div className="mx-auto max-w-[1440px] px-6 py-16 lg:px-8 lg:py-20">
        <h2 className="text-[clamp(2rem,3.6vw,3.5rem)] leading-none font-black tracking-[-0.03em]">Does it hold up at 200 stops?</h2>
        <p className="mt-4 max-w-[62ch] text-lg">
          The scale test runs every method several times on bigger and bigger delivery problems, on the streets and traffic above. For up to{' '}
          {EXACT_MAX_N} stops we also compute the provably best plan, so the gaps are exact.
        </p>

        <div className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-6 border-2 border-ink p-6">
          <div>
            <div className="mb-2 flex items-center gap-2 font-bold">
              Problem sizes <Info>Number of stops in each test problem. Bigger problems take longer.</Info>
            </div>
            <div role="group" aria-label="Problem sizes" className="flex flex-wrap gap-2">
              {SIZE_OPTIONS.map((n) => {
                const on = sizes.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSizes((s) => (on ? s.filter((x) => x !== n) : [...s, n]))}
                    className={`border-2 border-ink px-3 py-1.5 font-mono text-sm ${on ? 'bg-ink text-paper' : 'hover:bg-paper-2'}`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 font-bold">
              Runs per method <Info>Random methods can land on different answers. More runs give a fairer average.</Info>
            </div>
            <div role="group" aria-label="Runs per method" className="inline-flex border-2 border-ink">
              {RUN_OPTIONS.map((r, i) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={runs === r}
                  onClick={() => setRuns(r)}
                  className={`px-3 py-1.5 font-mono text-sm ${i > 0 ? 'border-l-2 border-ink' : ''} ${runs === r ? 'bg-ink text-paper' : 'hover:bg-paper-2'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {running ? (
              <Button variant="dark" onClick={cancel}>
                Cancel
              </Button>
            ) : (
              <Button onClick={start} disabled={!sizes.length}>
                Run scale test
              </Button>
            )}
          </div>
          {running && progress && (
            <div className="w-full">
              <div className="mb-2 flex justify-between text-sm">
                <span>{progress.label}</span>
                <span className="font-mono">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <Bar value={progress.done / Math.max(1, progress.total)} />
            </div>
          )}
        </div>
        {error && <p className="mt-4 border-2 border-warn p-4 font-bold text-warn">The scale test stopped: {error}</p>}

        {report && verdict && (
          <>
            <p className="mt-14 max-w-[36ch] text-[clamp(1.75rem,3vw,2.75rem)] leading-tight font-black tracking-[-0.02em]">
              QPSO had the best average plan at {verdict.qpsoWins} of {verdict.sizes} sizes.
            </p>
            <p className="mt-3 text-lg">
              On average it landed <span className="font-mono">{verdict.avgGap.toFixed(2)}%</span> from the best plan anyone found.
            </p>

            <div className="mt-12 grid gap-10 lg:grid-cols-2">
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <h3 className="text-xl font-black tracking-tight">Distance from the best plan</h3>
                  <Info>
                    Average gap to the best known plan, in percent. For small problems the reference is the provably best plan. Nearest-stop is left
                    off because it sits far above (20–50%).
                  </Info>
                </div>
                <LineSeriesChart
                  series={series('gapPct', ['qpso', 'pso', 'ga', 'sa', 'cw'])}
                  xLabel="stops"
                  height={260}
                  step={false}
                  yMin={0}
                  yFormat={(v) => `${v.toFixed(1)}%`}
                />
              </div>
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <h3 className="text-xl font-black tracking-tight">Compute time</h3>
                  <Info align="right">
                    Average time per run in milliseconds, on a log scale. The exact method blows up so fast it only runs on tiny problems.
                  </Info>
                </div>
                <LineSeriesChart
                  series={series('meanTimeMs', ['qpso', 'pso', 'ga', 'sa', 'exact'])}
                  xLabel="stops"
                  height={260}
                  step={false}
                  logY
                  yFormat={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(2))}
                />
              </div>
            </div>

            <div className="mt-12 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink text-left">
                    <th className="py-3 pr-4 font-bold">Stops</th>
                    <th className="px-3 py-3 font-bold">Method</th>
                    <th className="px-3 py-3 text-right font-bold">Average score</th>
                    <th className="px-3 py-3 text-right font-bold">Spread</th>
                    <th className="px-3 py-3 text-right font-bold">Gap</th>
                    <th className="py-3 pl-3 text-right font-bold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {report.config.sizes.map((n) =>
                    report.rows
                      .filter((r) => r.n === n)
                      .sort((a, b) => (Math.abs(a.mean - b.mean) < 1e-6 ? ALGO_ORDER.indexOf(a.algo) - ALGO_ORDER.indexOf(b.algo) : a.mean - b.mean))
                      .map((r, i) => (
                        <tr key={`${n}-${r.algo}`} className={`border-b border-rule ${i === 0 ? 'bg-paper-2' : ''}`}>
                          <td className="py-2 pr-4 font-mono">{i === 0 ? n : ''}</td>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2.5">
                              <Swatch color={pal.algo[r.algo]} />
                              <span className={i === 0 ? 'font-bold' : ''}>{ALGORITHMS[r.algo].name}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{fmt(r.mean, 2)}</td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">±{fmt(r.std, 2)}</td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{r.gapPct.toFixed(2)}%</td>
                          <td className="py-2 pl-3 text-right font-mono whitespace-nowrap">{fmtMs(r.meanTimeMs)}</td>
                        </tr>
                      )),
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex flex-wrap gap-6">
              <TextButton onClick={() => downloadFile(`swarmroute-scale-test-${Date.now()}.csv`, reportToCsv(report), 'text/csv')}>
                Download results (CSV)
              </TextButton>
              <TextButton onClick={() => downloadFile(`swarmroute-scale-test-${Date.now()}.json`, JSON.stringify(report, null, 2))}>
                Download results (JSON)
              </TextButton>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
