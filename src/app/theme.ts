import { createContext, useContext } from 'react';
import type { AlgoId } from '../core/algorithms';

export type ThemeMode = 'light' | 'dark';

/** Resolved colours for SVG and chart drawing (Tailwind classes use the same CSS variables directly). */
export interface Palette {
  paper: string;
  paper2: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  onAccent: string;
  band: string;
  bandInk: string;
  incident: string;
  traffic: string[];
  vans: string[];
  algo: Record<AlgoId, string>;
}

const ALGO_IDS: AlgoId[] = ['qpso', 'pso', 'ga', 'sa', 'cw', 'nn', 'exact'];
export const THEME_STORAGE_KEY = 'swarmroute-theme';

/** Reads the palette from the CSS variables of the active [data-theme] (see src/index.css). */
export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    paper: v('--color-paper', '#f4ecda'),
    paper2: v('--color-paper-2', '#e1e0d2'),
    ink: v('--color-ink', '#111111'),
    muted: v('--color-muted', '#5b5b53'),
    rule: v('--color-rule', '#b8b7aa'),
    accent: v('--color-accent', '#17693b'),
    onAccent: v('--color-on-accent', '#f7f7ef'),
    band: v('--color-band', '#123824'),
    bandInk: v('--color-band-ink', '#f0efe6'),
    incident: v('--incident', '#d3322a'),
    traffic: Array.from({ length: 6 }, (_, i) => v(`--traffic-${i}`, '#888888')),
    vans: Array.from({ length: 16 }, (_, i) => v(`--van-${i}`, '#555555')),
    algo: Object.fromEntries(ALGO_IDS.map((a) => [a, v(`--algo-${a}`, '#555555')])) as Record<AlgoId, string>,
  };
}

/** Congestion colour for a volume/capacity ratio. */
export function trafficColor(p: Palette, vc: number): string {
  if (vc < 0.55) return p.traffic[0];
  if (vc < 0.8) return p.traffic[1];
  if (vc < 1.0) return p.traffic[2];
  if (vc < 1.25) return p.traffic[3];
  if (vc < 1.6) return p.traffic[4];
  return p.traffic[5];
}

export const vanColor = (p: Palette, k: number) => p.vans[k % p.vans.length];

export interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
  palette: Palette;
}

export const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside ThemeContext');
  return t;
}

export const usePalette = () => useTheme().palette;

/** One-line, jargon-free description of each method for the results table. */
export const ALGO_PLAIN: Record<AlgoId, string> = {
  qpso: 'Quantum-inspired swarm. Our method.',
  pso: 'Classic particle swarm',
  ga: 'Evolution-style search',
  sa: 'Search that cools down over time',
  cw: 'Classic rule of thumb: merge the best pairs',
  nn: 'Always drive to the nearest stop',
  exact: 'Checks every option. Tiny problems only.',
};

export const TRAFFIC_LEGEND = [
  { label: 'Free', vc: 0.4 },
  { label: 'Busy', vc: 0.9 },
  { label: 'Slow', vc: 1.1 },
  { label: 'Jammed', vc: 1.4 },
];

export function periodOfDay(hour: number): string {
  if (hour < 5) return 'Night';
  if (hour < 7) return 'Early morning';
  if (hour < 10.5) return 'Morning rush';
  if (hour < 15) return 'Midday';
  if (hour < 16) return 'Afternoon';
  if (hour < 20) return 'Evening rush';
  if (hour < 22) return 'Evening';
  return 'Night';
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
