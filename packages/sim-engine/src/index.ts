/**
 * `@scenario-studio/sim-engine` — the deterministic scenario simulation engine
 * (layer 3 of `docs/agent-authoring-architecture.md`).
 *
 * Pure TypeScript, zod for the input contract, no rendering dependency: the
 * editor preview and the headless CLI run *this* code, byte for byte.
 *
 * ```ts
 * const graph = buildLaneGraph(await loadTopologyIndex(url));
 * const input = parseSimScenarioInput(doc);
 * const { trace } = runSimulation(input, { graph });
 * const verdict = evaluateTrace(trace);
 * ```
 */

export { ENGINE_VERSION } from './version.js';

/* ------------------------------------------------------------- the contract */
export {
  simScenarioInputSchema,
  parseSimScenarioInput,
  safeParseSimScenarioInput,
  normalizeSimScenarioInput,
  actorSchema,
  actorRulesSchema,
  arrivalSpecSchema,
  conditionSchema,
  dynamicsSchema,
  interactionSchema,
  laneRefSchema,
  occluderSchema,
  poseSchema,
  regionSchema,
  routeSpecSchema,
  signalProgramSchema,
  triggerSchema,
  verbSchema,
} from './schema/input.js';
export type {
  ActorKind,
  ActorRules,
  ArrivalPoint,
  ArrivalSpec,
  Condition,
  Dims,
  Dynamics,
  Interaction,
  LaneChangeTarget,
  LaneRef,
  Occluder,
  Pose,
  Region,
  RouteSpec,
  ScenePoint,
  SignalProgram,
  SimActor,
  SimSchemaIssue,
  SimScenarioInput,
  SimScenarioInputSpec,
  SpeedTarget,
  Trigger,
  TurnRelation,
  VerbSpec,
} from './schema/input.js';

/* ------------------------------------------------------------------ frames */
export { localFromScene, toSceneXZ, sceneHeading } from './frames.js';
export type { SceneXZ } from './frames.js';

/* -------------------------------------------------------------------- maps */
export { buildLaneGraph, LaneGraph, ENDPOINT_TOL_M } from './map/lane-graph.js';
export type { DirectedLane, LaneGeometry } from './map/lane-graph.js';
export { pointOf } from './map/topology.js';
export type {
  LaneRsl,
  TopologyGate,
  TopologyIndex,
  TopologyJunction,
  TopologyLane,
} from './map/topology.js';
export {
  buildRoute,
  buildFollowRoute,
  buildLanePathRoute,
  Route,
  retargetToLane,
  retargetToNeighbour,
} from './map/route.js';
export type { RouteLeg, RoutePose, RouteBuildError } from './map/route.js';

/* ------------------------------------------------------------------ engine */
export { runSimulation } from './sim/engine.js';
export type { RunOptions, SimResult } from './sim/engine.js';
export { evaluateCondition } from './sim/triggers.js';
export type { ConditionContext } from './sim/triggers.js';
export { buildOccluders, hasLineOfSight, blockingOccluder } from './sim/visibility.js';
export type { OccluderShape } from './sim/visibility.js';
export { SignalBook } from './sim/signals.js';
export type { SignalPhase } from './sim/signals.js';
export {
  PEDESTRIAN_LIMITS,
  VEHICLE_LIMITS,
  gapScaleFor,
  requiredDecelFor,
} from './sim/controllers.js';
export type { MotionLimits } from './sim/controllers.js';
export { shapeValue, transitionDuration, transitionValue } from './sim/dynamics.js';
export { alongRouteGapM, headwayS, pairKey, readPair } from './sim/pairs.js';
export type { PairReadout } from './sim/pairs.js';
export type { ActorRuntime, AxisId } from './sim/state.js';
export { axisOf } from './sim/state.js';

/* ------------------------------------------------------------------ solves */
export { solveArrival, applyArrivalSolution, resolveArrivalTriggers, ARRIVAL_TOLERANCE_M } from './solve/arrival.js';
export type { ArrivalSolution } from './solve/arrival.js';
export { checkFeasibility, COMFORT_DECEL_MPS2, HARD_DECEL_MPS2 } from './solve/guards.js';
export { nominalRun, nominalRunwayNeedM } from './solve/nominal.js';
export type { NominalActor, NominalProbe } from './solve/nominal.js';

/* ------------------------------------------------------------------- trace */
export {
  quantizeTrace,
  traceToSceneFrame,
  TRACE_FORMAT_VERSION,
  TRACE_PRECISION,
} from './trace/trace.js';
export type {
  ActorTrack,
  EpisodeMetrics,
  InvariantResidual,
  MinTtcRecord,
  PairMinDistance,
  RevealToConflict,
  SceneTrace,
  SimEvent,
  SimTrace,
  TraceHeader,
} from './trace/trace.js';
export { encodeTraceGz, decodeTraceGz, serializeTrace, traceDigest } from './trace/gzip.js';
export { computeMetrics, criticalityWindow } from './trace/metrics.js';
export {
  evaluateTrace,
  evaluateMetrics,
  DEFAULT_MAX_DECEL_MPS2,
  DEFAULT_TRIVIAL_TTC_S,
} from './trace/evaluate.js';
export type {
  EvaluateFilters,
  RejectCode,
  RejectFinding,
  TraceEvaluation,
} from './trace/evaluate.js';

/* ------------------------------------------------------------------ errors */
export { SimEngineError, issue } from './errors.js';
export type { SimIssue, SimIssueCode, SimIssueSeverity } from './errors.js';

/* -------------------------------------------------------------------- util */
export { canonicalJson, contentHash, sha256 } from './core/hash.js';
export { Rng, normalizeSeed, seedFromString } from './core/rng.js';
export { obbOverlap, obbCorners } from './core/math.js';
export type { Obb, Vec2 } from './core/math.js';
