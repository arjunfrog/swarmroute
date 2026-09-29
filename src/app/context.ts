import type { CityConfig, RoadGraph } from '../core/graph';
import type { EdgeWeights, ObjectiveWeights } from '../core/shortestPath';
import type { EdgeTraffic, TrafficState } from '../core/traffic';
import { extractPath } from '../core/shortestPath';
import type { VRPInstance } from '../core/vrp';

/** Shared road-network + traffic state passed from App to every view. */
export interface CityCtx {
  city: CityConfig;
  setCity: (c: CityConfig) => void;
  graph: RoadGraph;
  /** changes whenever the road network is regenerated */
  cityKey: string;
  depot: number;
  traffic: TrafficState;
  setTraffic: (t: TrafficState) => void;
  edgeTraffic: EdgeTraffic;
  ew: EdgeWeights;
  weights: ObjectiveWeights;
  setWeights: (w: ObjectiveWeights) => void;
  toggleIncident: (edgeId: number) => void;
}

/** Road-level geometry for a vehicle route (depot → stops → depot) following shortest paths. */
export function routeGeometry(
  graph: RoadGraph,
  trees: Int32Array[],
  inst: VRPInstance,
  route: number[],
): { points: [number, number][]; nodes: number[] } {
  const stops = [0, ...route, 0];
  const nodes: number[] = [];
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = stops[k];
    const b = stops[k + 1];
    const seg = extractPath(graph, trees[a], inst.nodes[a], inst.nodes[b]).nodes;
    seg.forEach((v, i) => {
      if (i === 0 && nodes.length > 0) return;
      nodes.push(v);
    });
  }
  return { points: nodePoints(graph, nodes), nodes };
}

export function nodePoints(graph: RoadGraph, nodes: number[]): [number, number][] {
  return nodes.map((v) => [graph.nodes[v].x, graph.nodes[v].y]);
}
