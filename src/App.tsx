import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { CityCtx } from './app/context';
import { readPalette, THEME_STORAGE_KEY, ThemeContext, type ThemeMode, type ThemeState } from './app/theme';
import { CityDataDialog } from './components/CityDataDialog';
import { Button, TextButton } from './components/ui';
import { DEFAULT_CITY, generateCity, nearestNode, type CityConfig } from './core/graph';
import { DEFAULT_WEIGHTS, edgeWeights, type ObjectiveWeights } from './core/shortestPath';
import { computeTraffic, DEFAULT_TRAFFIC, type TrafficState } from './core/traffic';
import { Planner } from './views/Planner';

// Secondary pages (reached from the footer) load on demand; KaTeX only ships with the math page.
const ModelPage = lazy(() => import('./views/ModelPage').then((m) => ({ default: m.ModelPage })));
const SingleTripPage = lazy(() => import('./views/SingleTripPage').then((m) => ({ default: m.SingleTripPage })));

type Page = 'planner' | 'math' | 'single-trip';

function readPage(): Page {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h === 'math' || h === 'single-trip' ? h : 'planner';
}

export default function App() {
  const [page, setPage] = useState<Page>(readPage);
  const [cityDataOpen, setCityDataOpen] = useState(false);
  const [city, setCityState] = useState<CityConfig>(DEFAULT_CITY);
  const [traffic, setTraffic] = useState<TrafficState>(DEFAULT_TRAFFIC);
  const [weights, setWeights] = useState<ObjectiveWeights>(DEFAULT_WEIGHTS);
  const [mode, setMode] = useState<ThemeMode>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const [palette, setPalette] = useState(readPalette);

  // Apply the theme before paint, remember it, and re-read the palette the map and charts draw with.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
    const p = readPalette();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.paper);
    setPalette(p);
  }, [mode]);
  const theme: ThemeState = useMemo(() => ({ mode, palette, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }), [mode, palette]);

  useEffect(() => {
    const onHash = () => {
      setPage(readPage());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const graph = useMemo(() => generateCity(city), [city]);
  const depot = useMemo(() => nearestNode(graph, graph.width * 0.5, graph.height * 0.5), [graph]);
  const edgeTraffic = useMemo(() => computeTraffic(graph, traffic), [graph, traffic]);
  const ew = useMemo(() => edgeWeights(graph, edgeTraffic, weights), [graph, edgeTraffic, weights]);
  const cityKey = `${city.seed}-${city.cols}x${city.rows}`;

  const setCity = useCallback((c: CityConfig) => {
    setCityState(c);
    setTraffic((t) => ({ ...t, incidents: [] }));
  }, []);

  const toggleIncident = useCallback(
    (edgeId: number) =>
      setTraffic((t) => ({ ...t, incidents: t.incidents.includes(edgeId) ? t.incidents.filter((e) => e !== edgeId) : [...t.incidents, edgeId] })),
    [],
  );

  const ctx: CityCtx = { city, setCity, graph, cityKey, depot, traffic, setTraffic, edgeTraffic, ew, weights, setWeights, toggleIncident };
  const openCityData = useCallback(() => setCityDataOpen(true), []);
  const closeCityData = useCallback(() => setCityDataOpen(false), []);

  return (
    <ThemeContext.Provider value={theme}>
      <div className="min-h-screen bg-paper text-ink">
        <header className="border-b-2 border-ink">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4 lg:px-8">
            <a href="#/" className="flex items-baseline gap-4">
              <span className="text-2xl font-black tracking-[-0.03em]">SwarmRoute</span>
              <span className="hidden text-sm sm:inline">Delivery routes that work around traffic</span>
            </a>
            <div className="flex items-center gap-5">
              {page !== 'planner' && (
                <a href="#/" className="font-bold underline decoration-2 underline-offset-4 hover:text-accent">
                  Back to the planner
                </a>
              )}
              <Button variant="outline" size="sm" aria-pressed={mode === 'dark'} onClick={theme.toggle}>
                {mode === 'dark' ? 'Light mode' : 'Dark mode'}
              </Button>
            </div>
          </div>
        </header>

        <main>
          {/* The planner stays mounted so its results survive a visit to the other pages. */}
          <div hidden={page !== 'planner'}>
            <Planner ctx={ctx} onAddCityData={openCityData} />
          </div>
          <Suspense fallback={<p className="mx-auto max-w-[1440px] px-6 py-16 text-lg lg:px-8">Loading…</p>}>
            {page === 'math' && <ModelPage />}
            {page === 'single-trip' && <SingleTripPage ctx={ctx} />}
          </Suspense>
        </main>

        <footer className="bg-band text-band-ink">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-6 py-16 lg:grid-cols-[1.2fr_1fr] lg:px-8 lg:py-20">
            <div>
              <p className="text-[clamp(3rem,7vw,6rem)] leading-[0.85] font-black tracking-[-0.04em]">SwarmRoute</p>
              <p className="mt-6 max-w-[44ch] text-lg leading-relaxed">
                Quantum-inspired route planning for city delivery fleets. The city and its traffic are simulated. Every plan and number on this page
                is computed live in your browser.
              </p>
            </div>
            <div className="grid gap-10 sm:grid-cols-2">
              <div>
                <h2 className="font-black">Go deeper</h2>
                <ul className="mt-4 space-y-3">
                  <li>
                    <a href="#/math" className="underline decoration-2 underline-offset-4 hover:text-highlight">
                      How it works: the model and the math
                    </a>
                  </li>
                  <li>
                    <a href="#/single-trip" className="underline decoration-2 underline-offset-4 hover:text-highlight">
                      Single-trip routing, A to B
                    </a>
                  </li>
                  <li>
                    <a href="#/" className="underline decoration-2 underline-offset-4 hover:text-highlight">
                      The route planner
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <h2 className="font-black">Your data</h2>
                <ul className="mt-4 space-y-3">
                  <li>
                    <TextButton onClick={openCityData} className="font-normal hover:text-highlight">
                      Add your city data
                    </TextButton>
                  </li>
                  <li className="text-band-ink/80">
                    Run the benchmark without the browser: <code className="font-mono text-sm text-band-ink">npm run bench</code>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </footer>

        <CityDataDialog open={cityDataOpen} onClose={closeCityData} />
      </div>
    </ThemeContext.Provider>
  );
}
