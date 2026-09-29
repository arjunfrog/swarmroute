import { lazy, Suspense, type ComponentProps } from 'react';
import type { LineSeriesChart as ChartImpl } from './Charts';

// Recharts is the heaviest dependency and every chart sits below the fold, so it loads in its own
// chunk after the first paint instead of delaying the map and controls.
const Chart = lazy(() => import('./Charts').then((m) => ({ default: m.LineSeriesChart })));

export function LineSeriesChart(props: ComponentProps<typeof ChartImpl>) {
  return (
    <Suspense fallback={<div aria-hidden="true" style={{ height: props.height ?? 260 }} />}>
      <Chart {...props} />
    </Suspense>
  );
}
