/**
 * `@uniscenarios/sim-engine` — the deterministic scenario simulation engine
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
  resolveOverlappingControlLanes,
  type ControlBindingRepair,
} from './sim/signals.js';

export {
  simScenarioInputSchema,
  parseSimScenarioInput,
  safeParseSimScenarioInput,
  normalizeSimScenarioInput,
  resolvePhysicsConfig,
  ACTOR_KINDS,
  MOTION_PHYSICS_MODES,
  DEFAULT_MOTION_PHYSICS_MODE,
  DEFAULT_ACTOR_DIMS,
  CONTROL_INDICATIONS,
  isPedestrianLikeKind,
  isRoadActorKind,
  actorSchema,
  actorRulesSchema,
  arrivalSpecSchema,
  conditionSchema,
  dynamicsSchema,
  interactionSchema,
  laneRefSchema,
  occluderSchema,
  occlusionPairSchema,
  nearMissCriterionSchema,
  operationalConditionsSchema,
  motionPhysicsModeSchema,
  physicsConfigSchema,
  vehiclePhysicsProfileSchema,
  poseSchema,
  regionSchema,
  routeSpecSchema,
  roadControlSchema,
  signalProgramSchema,
  staticPropSchema,
  triggerSchema,
  verbSchema,
} from './schema/input.js';
export type {
  ActorKind,
  ActorRules,
  ArrivalPoint,
  ArrivalSpec,
  Condition,
  ControlIndication,
  Dims,
  Dynamics,
  Interaction,
  LaneChangeTarget,
  LaneRef,
  Occluder,
  OcclusionPair,
  NearMissCriterion,
  OperationalConditions,
  MotionPhysicsMode,
  PhysicsConfig,
  ResolvedPhysicsConfig,
  VehiclePhysicsProfile,
  Pose,
  Region,
  RoadControl,
  RouteSpec,
  ScenePoint,
  SignalProgram,
  SimActor,
  SimSchemaIssue,
  SimScenarioInput,
  SimScenarioInputSpec,
  SpeedTarget,
  StaticProp,
  Trigger,
  TurnRelation,
  VerbSpec,
} from './schema/input.js';
export { pruneDanglingAfterInteractions } from './schema/repair.js';
export type { RemovedDanglingInteraction } from './schema/repair.js';

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
  buildSeededPlacementRoute,
  buildDefaultPlacementRoute,
  Route,
  retargetToLane,
  retargetToNeighbour,
} from './map/route.js';
export type { PlacementRouteOptions, RouteLeg, RoutePose, RouteBuildError, SeededPlacementRouteOptions, SeededPlacementRouteResult } from './map/route.js';

/* ------------------------------------------------------------------ engine */
export { createFixedStepSimulation, runSimulation } from './sim/engine.js';
export type { StaticColliderClass, StaticMapCollider } from './sim/static-colliders.js';
export type { FixedStepSimulationProgress, FixedStepSimulationSession, RunOptions, SimResult } from './sim/engine.js';
export { evaluateCondition } from './sim/triggers.js';
export type { ConditionContext } from './sim/triggers.js';
export { buildOccluders, hasLineOfSight, blockingOccluder } from './sim/visibility.js';
export type { OccluderShape } from './sim/visibility.js';
export { SignalBook } from './sim/signals.js';
export type { SignalPhase, SignalState } from './sim/signals.js';
export {
  MOTION_LIMITS_BY_KIND,
  PEDESTRIAN_LIMITS,
  VEHICLE_LIMITS,
  limitsFor,
  gapScaleFor,
  requiredDecelFor,
} from './sim/controllers.js';
export type { MotionLimits } from './sim/controllers.js';
export { shapeValue, transitionDuration, transitionValue } from './sim/dynamics.js';
export {
  DynamicV1Backend,
  DYNAMIC_V1_DEFAULT_SUBSTEP_S,
  GENERIC_PASSENGER_CAR_PROFILE,
  resolveVehiclePhysicsProfile,
} from './sim/dynamic-v1.js';
export type { ResolvedVehiclePhysicsProfile } from './sim/dynamic-v1.js';
export type {
  MotionActorInitialization,
  MotionBackend,
  MotionIntent,
  MotionStepResult,
  PhysicsTelemetrySample,
  VehicleControl,
  VehicleMotionState,
} from './sim/motion-backend.js';
export { actorPhysicsBackend, actorPhysicsBackends, physicsBackendCounts } from './sim/physics-provenance.js';
export {
  alongRouteGapM,
  articulatedDoorObb,
  DOOR_MAX_OPEN_ANGLE_RAD,
  DOOR_OPEN_DURATION_S,
  isReverseMotion,
  headwayS,
  pairKey,
  readPair,
  readPathConflict,
  readStaticPathConflict,
  sweptObbTimeOfImpact,
} from './sim/pairs.js';
export type { DoorName, PairReadout, PathConflictReadout, SweptObbResult } from './sim/pairs.js';
export type { ActorRuntime, AxisId } from './sim/state.js';
export { axisOf } from './sim/state.js';

/* ------------------------------------------------------------------ solves */
export { solveArrival, applyArrivalSolution, resolveArrivalTriggers, ARRIVAL_TOLERANCE_M } from './solve/arrival.js';
export type { ArrivalSolution } from './solve/arrival.js';
export { solvePedestrianNearMiss } from './solve/pedestrian-near-miss.js';
export type { PedestrianNearMissRequest, PedestrianNearMissResult, PedestrianNearMissSolution, PedestrianNearMissDiagnostic, PedestrianNearMissIssueCode, NearMissPass, TimedTrajectoryPoint } from './solve/pedestrian-near-miss.js';
export { resolvePedestrianProjection } from './solve/pedestrian-projection.js';
export type { PedestrianProjection, PedestrianProjectionMovement, PedestrianProjectionSegment, PedestrianProjectionSegmentKind } from './solve/pedestrian-projection.js';
export { verifyNearMissOutcome } from './trace/near-miss.js';
export type { NearMissVerification } from './trace/near-miss.js';
export { checkFeasibility, COMFORT_DECEL_MPS2, HARD_DECEL_MPS2 } from './solve/guards.js';
export { actionAwareRunwayNeedM, nominalRun, nominalRunwayNeedM } from './solve/nominal.js';
export type { NominalActor, NominalProbe } from './solve/nominal.js';

/* ------------------------------------------------------------------- trace */
export {
  quantizeTrace,
  quantizeMetrics,
  traceToSceneFrame,
  TRACE_FORMAT_VERSION,
  LATERAL_OFFSET_TRACE_VERSION,
  READABLE_TRACE_FORMAT_VERSIONS,
  isReadableTraceFormatVersion,
  TRACE_PRECISION,
} from './trace/trace.js';
export type {
  ActorTrack,
  ActorPhysicsTrack,
  ActorPhysicsBackendProvenance,
  TraceActorMetadata,
  DeclaredOcclusionMetric,
  DeclaredOcclusionStatus,
  EpisodeMetrics,
  InvariantResidual,
  OccluderIneffective,
  MinTtcRecord,
  MinPathTtcRecord,
  MinPetRecord,
  CriticalitySamples,
  PairMinDistance,
  RevealToConflict,
  SceneTrace,
  SignalTrack,
  SimEvent,
  SimTrace,
  TraceHeader,
  PhysicsTraceProvenance,
} from './trace/trace.js';
export { encodeTraceGz, decodeTraceGz, serializeTrace, traceDigest } from './trace/gzip.js';
export { computeMetrics, criticalityWindow } from './trace/metrics.js';
export { MONITORED_PAIR_POLICY_VERSION, selectMetricPair } from './trace/monitored-pairs.js';
export type { MetricPairSelection, MonitoredPairPolicy } from './trace/monitored-pairs.js';
export {
  evaluateTrace,
  evaluateMetrics,
  criticalityMetricsInWindow,
  DEFAULT_MAX_DECEL_MPS2,
  DEFAULT_TRIVIAL_TTC_S,
} from './trace/evaluate.js';
export type {
  EvaluateFilters,
  RejectCode,
  RejectFinding,
  TraceEvaluation,
} from './trace/evaluate.js';
export {
  createBlindReviewPacket,
  evaluateIntentRubric,
  intentCriterionSchema,
  intentRubricSchema,
  summarizeBehavior,
} from './trace/intent-rubric.js';
export type {
  BehaviorSummary,
  BlindReviewPacket,
  CriterionStatus,
  CriterionVerdict,
  IntentCriterion,
  IntentCriterionInput,
  IntentEvaluation,
  IntentRubric,
  IntentRubricInput,
  TraceEvidence,
} from './trace/intent-rubric.js';

/* ------------------------------------------------------------------ errors */
export { SimEngineError, issue } from './errors.js';
export type { SimIssue, SimIssueCode, SimIssueSeverity } from './errors.js';

/* -------------------------------------------------------------------- util */
export { canonicalJson, contentHash, sha256 } from './core/hash.js';
export { Rng, normalizeSeed, seedFromString } from './core/rng.js';
export { obbOverlap, obbCorners } from './core/math.js';
export type { Obb, Vec2 } from './core/math.js';

/* ------------------------------------------------------ SUMO authored world */
export {
  buildSumoAuthoredOccupancies,
  buildSumoRoadOccupancyIndex,
  sumoAuthoredOccupanciesAt,
  sumoAuthoredOccupancySourcesAt,
} from './ambient/authored-occupancy.js';
export type {
  SumoAuthoredOccupancy,
  SumoAuthoredOccupancyKind,
  SumoAuthoredOccupancySource,
  SumoRoadOccupancyIndex,
} from './ambient/authored-occupancy.js';

/* ------------------------------------------------ physics validation */
export {
  PHYSICS_VALIDATION_CONTRACT_VERSION,
  PHYSICS_VALIDATION_GATES,
  report as physicsValidationReport,
  validateCollisionOnset,
  validateDeterminism as validatePhysicsDeterminism,
  validateFrictionCircle,
  validatePerformance as validatePhysicsPerformance,
  validateReferenceValue,
  validateStoppingDistanceMonotonicity,
  validateTimestepConvergence,
} from './validation/physics.js';
export type {
  FrictionObservation,
  ValidationFinding as PhysicsValidationFinding,
  ValidationReport as PhysicsValidationReport,
  VehicleObservation,
} from './validation/physics.js';

/* --------------------------------------------------------- ambient traffic */
export {
  ambientTrafficProfileSchema,
  applyAmbientTraffic,
  createAmbientCandidatePool,
  materializeAmbientCandidatePool,
  promoteAmbientActor,
  resolveAmbientTrafficProfile,
} from './ambient/traffic.js';
export type {
  AmbientActorProvenance,
  AmbientCandidate,
  AmbientCandidatePool,
  AmbientReservation,
  AmbientScreeningReason,
  AmbientTrafficOptions,
  AmbientTrafficProfile,
  AmbientTrafficProvenance,
  AmbientTrafficResult,
  ResolvedAmbientTrafficProfile,
} from './ambient/traffic.js';
export {
  buildSumoRouteDocument,
  sumoActorIdHash,
  sumoNetworkHeadingToScene,
  sumoNetworkToScene,
  sumoNumericSeed,
  sumoSceneHeadingToNetwork,
  sumoSceneToNetwork,
  sumoVehicleId,
  validateSumoNetworkManifest,
  validateSumoRuntimeManifest,
} from './ambient/sumo.js';
export type {
  SumoNetworkManifest,
  SumoNetworkPoint,
  SumoNetworkWorldTransform,
  SumoRouteDocumentOptions,
  SumoRuntimeManifest,
  SumoScenePoint,
} from './ambient/sumo.js';
export {
  DEFAULT_AMBIENT_ROBUSTNESS_CASES,
  evaluateAmbientRobustness,
} from './ambient/robustness.js';
export type {
  AmbientRobustnessCase,
  AmbientRobustnessCaseReport,
  AmbientRobustnessOptions,
  AmbientRobustnessReport,
} from './ambient/robustness.js';
