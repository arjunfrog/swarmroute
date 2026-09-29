# SwarmRoute: quantum-inspired traffic route optimisation

A complete browser platform for **dynamic vehicle routing under traffic**, built around a
**Hybrid Quantum-behaved Particle Swarm Optimiser (QPSO)** and benchmarked against classical
metaheuristics, constructive heuristics and exact methods.

Everything runs client-side. The optimisers run in Web Workers, one per algorithm, so they
execute in parallel and the UI stays responsive.

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # type-check + production build into dist/
npm run preview        # serve the production build locally
npm test               # correctness checks for the optimisation core
npm run bench          # headless benchmark (see flags below)
npm run format         # Prettier
```

## What’s in the app

One page, built to be read top to bottom:

- **Planner (first screen):** the problem in one headline ("60 stops. 8 vans. Morning rush."), three sliders (time of day, stops, vans), **Plan routes**, **Simulate live traffic**, and the map with four key numbers underneath. Every slider has an (i) that explains it. Everything else sits in the **Advanced settings** drawer.
- **Scroll down:** the results table and convergence charts, then the van-by-van breakdown, then the **scale test** (the benchmark across problem sizes, with CSV/JSON export).
- **Footer:** _How it works_ (the full mathematical formulation) and _Single-trip routing_ (Dijkstra and A* against the QPSO and PSO swarms), plus **Add your city data**, a placeholder panel for loading real road networks, traffic feeds and deliveries. It is intentionally not wired up yet.

**Live traffic mode** advances the clock 10 minutes every 4 seconds. Traffic drifts gradually, and accidents become more likely as the roads get busier (rare at night, frequent at rush hour), mostly on already-congested roads. They clear after 30–60 simulated minutes. After each change a warm-started QPSO re-plans, and the new plan is adopted only if it is at least 0.5% better. Each van keeps its colour and number across re-plans. Vans drive continuously and switch to a new route at the next intersection it shares with their current one; until then their current path is shown dashed.

Click any road on the map to block it. Changing the time of day, traffic level or objective weights re-prices the network immediately.

## How it works

1. **Network model**: a jittered street grid with arterials, diagonals and congestion hotspots
   (`src/core/graph.ts`). Travel times follow the BPR function `t = t0·(1 + 0.15·(v/c)^4)`, where the
   volume/capacity ratio depends on time of day, demand intensity, noise and incidents
   (`src/core/traffic.ts`).
2. **Objective**: `J = α·time + β·distance + γ·congestion-delay` per edge. Stop-to-stop costs come
   from Dijkstra on that weight (`src/core/shortestPath.ts`, `src/core/vrp.ts`).
3. **Encoding and constraints**: particles are random-key vectors, argsort → giant tour →
   **Prins’ optimal split** into capacity-feasible routes. Capacity is always satisfied by the decoder;
   fleet size is handled by a penalty.
4. **Hybrid QPSO** (`src/core/algorithms/qpso.ts`):
   - delta-potential-well sampling `x = p ± β·|mbest − x|·ln(1/u)` with β annealed 1.0 → 0.5
   - Lamarckian local search (2-opt, relocate, swap) on each iteration’s best particle
   - Cauchy **quantum-tunnelling mutation** of gbest to escape local optima
   - optional seeding with Clarke–Wright / nearest-neighbour tours
5. **Baselines** use the same encoding, decoder, local search and evaluation budget
   (`population × iterations`), so the comparison is fair: inertia-weight PSO, a permutation GA
   (OX + inversion), simulated annealing, Clarke–Wright savings, nearest neighbour, and an **exact
   Held–Karp + set-partition DP** (`O(n²2ⁿ + n·3ⁿ)`, n ≤ 12) that gives true optimality gaps.

## Headless benchmark

```bash
npm run bench -- --sizes 10,25,50,100,200 --runs 5 --hour 18 --out results.csv
```

Sample output from `npm run bench -- --sizes 10,25,50,100,200 --runs 3 --iterations 150`
(medium city, AM peak 08:30, TTI 1.26). Each cell is the mean gap and the mean runtime:

| n   | Hybrid QPSO         | Classical PSO   | GA             | SA             | Clarke–Wright |
| --- | ------------------- | --------------- | -------------- | -------------- | ------------- |
| 10  | **0.00 %** · 7 ms   | 0.00 % · 3 ms   | 0.75 % · 3 ms  | 0.00 % · 2 ms  | 1.13 %        |
| 25  | **0.00 %** · 18 ms  | 0.00 % · 10 ms  | 2.96 % · 4 ms  | 0.00 % · 4 ms  | 7.88 %        |
| 50  | **0.29 %** · 44 ms  | 0.56 % · 31 ms  | 4.01 % · 9 ms  | 4.68 % · 11 ms | 6.76 %        |
| 100 | **0.24 %** · 124 ms | 3.38 % · 91 ms  | 3.38 % · 19 ms | 5.50 % · 24 ms | 5.50 %        |
| 200 | **0.19 %** · 368 ms | 1.47 % · 268 ms | 1.43 % · 48 ms | 2.61 % · 70 ms | 2.61 %        |

QPSO costs roughly 1.4× the runtime of PSO. The extra time goes to its tunnelling step
(one more decode and local search per iteration).

(Gap = mean objective relative to the exact optimum for n ≤ 12, otherwise relative to the best
solution found by any method.)

## Deploying to Vercel

The repo is ready to import as-is: `vercel.json` pins the build.

1. Push the repo to GitHub, then in Vercel choose **Add New → Project** and import it. No environment variables are needed.
2. Vercel reads `vercel.json`: framework **Vite**, install `npm ci` (exactly what `package-lock.json` pins, including the Linux builds of the native Rolldown, Tailwind and TypeScript binaries), build `npm run build`, output `dist`.
3. Node comes from `engines` in `package.json` (`>=22.12`, required by Vite 8).

What the config adds:

- Hashed files under `/assets/` are cached for a year (`immutable`); `index.html` is always revalidated, so a new deploy shows up immediately.
- Basic security headers (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`).
- A catch-all rewrite to `index.html`, so any unknown path still opens the app (pages use `#/` hash routes).

Bundle notes: the first load is the app, React and the CSS (≈ 100 KB gzipped). Recharts loads right after the first paint, KaTeX and the single-trip page load only when opened, and each optimiser runs in its own Web Worker chunk.

## Project layout

```
src/core/            optimisation engine (framework-free: runs in the browser, workers and Node)
  graph.ts           city generator
  traffic.ts         time-of-day demand, BPR travel times, smooth noise, accident rate
  shortestPath.ts    Dijkstra, A*, generalised edge cost
  vrp.ts             instance building, split decoder, evaluation, validation
  localSearch.ts     2-opt, relocate, swap
  algorithms/        qpso, pso, ga, sa, constructive (CW, NN), exact DP, spMetaheuristic (path QPSO/PSO)
  runner.ts          generator driver: timing, convergence history, animation delay
  benchmark.ts       benchmark suite + CSV export
src/worker/          Web Worker entry + message protocol
src/services/        worker client (one worker per algorithm)
src/app/             theme (palette, dark mode), shared city context, stable van ids, formatting
src/views/           Planner (landing page), ScaleTest, SingleTripPage, ModelPage
src/components/      map (SVG) + van animation, lazy-loaded charts, UI primitives, city-data dialog
scripts/             selftest.ts, bench.ts (Node, via tsx)
vercel.json          deployment config
```

The UI is React + Tailwind v4 + Recharts + KaTeX, styled in a brutalist, typographic look with Archivo and DM Mono, in light and dark themes (toggle in the header, remembered per browser). Every colour is a CSS variable in `src/index.css`: UI tokens live in `@theme` and are overridden under `[data-theme="dark"]`, and map and chart colours are read into JavaScript by `src/app/theme.ts`. Restyling never touches `src/core`.
