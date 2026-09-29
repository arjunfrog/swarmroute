import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePalette } from '../app/theme';

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
  emphasis?: boolean;
}

export interface ChartRef {
  name: string;
  color: string;
  value: number;
}

interface Props {
  series: ChartSeries[];
  refs?: ChartRef[];
  xLabel?: string;
  height?: number;
  yFormat?: (v: number) => string;
  logY?: boolean;
  step?: boolean;
  empty?: string;
  /** clamp the lower y bound (e.g. 0 for ratios) */
  yMin?: number;
}

function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const out: T[] = [];
  const step = (xs.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(xs[Math.round(i * step)]);
  return out;
}

export function LineSeriesChart({
  series,
  refs = [],
  xLabel,
  height = 260,
  yFormat,
  logY,
  step = true,
  empty = 'Nothing to show yet.',
  yMin,
}: Props) {
  const pal = usePalette();
  const INK = pal.ink;
  const tick = { fontSize: 11, fill: INK, fontFamily: 'DM Mono, monospace' };
  const visible = series.filter((s) => s.points.some((p) => Number.isFinite(p.y)));
  const rows = new Map<number, Record<string, number>>();
  for (const s of visible) {
    for (const p of downsample(s.points, 220)) {
      if (!Number.isFinite(p.y)) continue;
      const row = rows.get(p.x) ?? { x: p.x };
      row[s.id] = logY ? Math.max(p.y, 1e-3) : p.y;
      rows.set(p.x, row);
    }
  }
  const data = [...rows.values()].sort((a, b) => a.x - b.x);

  let lo = Infinity;
  let hi = -Infinity;
  for (const r of data) for (const s of visible) if (r[s.id] !== undefined) ((lo = Math.min(lo, r[s.id])), (hi = Math.max(hi, r[s.id])));
  // Reference lines far above the curves (e.g. a weak greedy baseline) would flatten them: name those below instead.
  const hasData = Number.isFinite(lo);
  const span = hasData ? Math.max(hi - lo, Math.abs(hi) * 0.02) : 0;
  const inRange = (v: number) => !hasData || (v >= lo - span * 2 && v <= hi + span * 0.6);
  const shownRefs = refs.filter((r) => Number.isFinite(r.value) && inRange(r.value));
  const offRefs = refs.filter((r) => Number.isFinite(r.value) && !inRange(r.value));
  for (const r of shownRefs) ((lo = Math.min(lo, r.value)), (hi = Math.max(hi, r.value)));
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.05 || 1;
  let yLo = lo - pad;
  if (yMin !== undefined) yLo = Math.max(yMin, yLo);
  const domain: [number, number] | [string, string] = logY ? ['auto', 'auto'] : [yLo, hi + pad];

  if (data.length === 0 && refs.length === 0) {
    return (
      <div className="grid place-items-center border-2 border-dashed border-rule px-6 text-center text-sm text-muted" style={{ height }}>
        {empty}
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={pal.rule} vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={tick}
            stroke={INK}
            strokeWidth={2}
            tickLine={false}
            label={xLabel ? { value: xLabel, position: 'insideBottomRight', offset: -2, fontSize: 11, fill: INK } : undefined}
          />
          <YAxis
            scale={logY ? 'log' : 'auto'}
            domain={domain}
            tick={tick}
            stroke={INK}
            strokeWidth={2}
            tickLine={false}
            width={56}
            allowDataOverflow={!logY}
            tickFormatter={(v: number) => (yFormat ? yFormat(v) : Number(v).toFixed(v >= 100 ? 0 : 1))}
          />
          <Tooltip
            contentStyle={{
              background: pal.paper,
              color: INK,
              border: `2px solid ${INK}`,
              borderRadius: 0,
              fontSize: 12,
              fontFamily: 'DM Mono, monospace',
            }}
            labelStyle={{ color: INK, fontWeight: 700 }}
            labelFormatter={(l) => `${xLabel ?? 'x'} ${l}`}
            formatter={(v) => (typeof v === 'number' ? (yFormat ? yFormat(v) : v.toFixed(2)) : String(v))}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: INK }} />
          {shownRefs.map((r) => (
            <ReferenceLine
              key={r.name}
              y={r.value}
              stroke={r.color}
              strokeWidth={2}
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
              label={{ value: r.name, fill: INK, fontSize: 11, position: 'insideTopRight' }}
            />
          ))}
          {visible.map((s) => (
            <Line
              key={s.id}
              type={step ? 'stepAfter' : 'linear'}
              dataKey={s.id}
              name={s.name}
              stroke={s.color}
              strokeWidth={s.emphasis ? 3.5 : 2}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              dot={!step && data.length <= 24 ? { r: 3, strokeWidth: 2, fill: pal.paper } : false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {offRefs.length > 0 && (
        <p className="pt-1 text-right text-xs text-muted">
          Off the chart:{' '}
          {offRefs.map((r, i) => (
            <span key={r.name}>
              {i > 0 && ', '}
              {r.name} at {yFormat ? yFormat(r.value) : r.value.toFixed(1)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
