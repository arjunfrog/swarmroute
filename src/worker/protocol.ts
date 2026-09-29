import type { AlgoId, AlgoParams } from '../core/algorithms';
import type { SPMethod, SPParams, SPPath } from '../core/algorithms/spMetaheuristic';
import type { BenchmarkConfig, BenchmarkProgress, BenchmarkReport } from '../core/benchmark';
import type { RoadGraph } from '../core/graph';
import type { AlgoRunResult, DriveResult, ProgressPoint } from '../core/runner';
import type { EdgeWeights } from '../core/shortestPath';
import type { VRPInstance } from '../core/vrp';

export type WorkerRequest =
  | { type: 'vrp'; algo: AlgoId; instance: VRPInstance; params: AlgoParams; delayMs: number }
  | { type: 'benchmark'; graph: RoadGraph; ew: EdgeWeights; depot: number; config: BenchmarkConfig }
  | { type: 'sp'; method: SPMethod; graph: RoadGraph; ew: EdgeWeights; source: number; target: number; params: SPParams; delayMs: number };

export type WorkerResponse =
  | { type: 'vrp-progress'; algo: AlgoId; point: ProgressPoint; routes?: number[][] }
  | { type: 'vrp-result'; algo: AlgoId; result: AlgoRunResult }
  | { type: 'bench-progress'; progress: BenchmarkProgress }
  | { type: 'bench-result'; report: BenchmarkReport }
  | { type: 'sp-progress'; method: SPMethod; point: ProgressPoint; path?: SPPath }
  | { type: 'sp-result'; method: SPMethod; result: DriveResult<SPPath> }
  | { type: 'error'; message: string };
