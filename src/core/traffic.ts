import type { RoadGraph } from './graph';
import { hashNoise } from './rng';

export interface TrafficState {
  /** time of day, hours in [0, 24) */
  hour: number;
  /** global demand multiplier */
  intensity: number;
  /**
   * Seed for per-road random fluctuations. Fractional values blend smoothly between the
   * neighbouring integer seeds, so live mode can drift traffic gradually instead of re-rolling it.
   */
  noiseSeed: number;
  /** edge ids with an active incident (accident / closure lane) */
  incidents: number[];
}

export const DEFAULT_TRAFFIC: TrafficState = { hour: 8.5, intensity: 1, noiseSeed: 1, incidents: [] };

/** Bureau of Public Roads volume-delay function parameters. */
export const BPR_ALPHA = 0.15;
export const BPR_BETA = 4;
export const INCIDENT_LOAD = 1.6;

export interface EdgeTraffic {
  /** volume / capacity ratio */
  vc: Float64Array;
  /** free-flow travel time, minutes */
  freeTime: Float64Array;
  /** congested travel time, minutes (BPR) */
  time: Float64Array;
}

/** Demand multiplier over the day: low at night, AM peak ~08:30, lunch bump, PM peak ~18:00. */
export function timeOfDayProfile(hour: number): number {
  const g = (mu: number, s: number) => Math.exp(-((hour - mu) ** 2) / (2 * s * s));
  return 0.35 + 0.85 * g(8.5, 1.1) + 0.45 * g(13, 2.2) + 0.95 * g(18, 1.4);
}

/** Per-road noise in [-1, 1] that varies continuously with a fractional seed. */
export function smoothNoise(seed: number, index: number): number {
  const lo = Math.floor(seed);
  const t = seed - lo;
  if (t === 0) return hashNoise(lo, index);
  const w = t * t * (3 - 2 * t);
  return (1 - w) * hashNoise(lo, index) + w * hashNoise(lo + 1, index);
}

/** Expected accidents per 10 simulated minutes: rare on empty night roads, frequent at rush hour. */
export function accidentRate(state: TrafficState): number {
  const load = timeOfDayProfile(state.hour) * state.intensity;
  return Math.min(0.75, Math.max(0.01, 0.6 * (load - 0.35)));
}

export function bprTime(freeTime: number, vc: number): number {
  return freeTime * (1 + BPR_ALPHA * Math.pow(vc, BPR_BETA));
}

export function computeTraffic(graph: RoadGraph, state: TrafficState): EdgeTraffic {
  const m = graph.edges.length;
  const vc = new Float64Array(m);
  const freeTime = new Float64Array(m);
  const time = new Float64Array(m);
  const lambda = timeOfDayProfile(state.hour) * state.intensity;
  const incidents = new Set(state.incidents);
  for (const e of graph.edges) {
    let r = e.baseLoad * lambda * (1 + 0.18 * smoothNoise(state.noiseSeed, e.id));
    if (incidents.has(e.id)) r += INCIDENT_LOAD;
    r = Math.min(3, Math.max(0.02, r));
    vc[e.id] = r;
    freeTime[e.id] = (e.length / e.speed) * 60;
    time[e.id] = bprTime(freeTime[e.id], r);
  }
  return { vc, freeTime, time };
}

/** Travel Time Index: congested network travel time over free-flow travel time. */
export function travelTimeIndex(t: EdgeTraffic): number {
  let a = 0;
  let b = 0;
  for (let i = 0; i < t.time.length; i++) {
    a += t.time[i];
    b += t.freeTime[i];
  }
  return b > 0 ? a / b : 1;
}

export function formatClock(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
