/**
 * The deterministic fixed-step simulation loop.
 *
 * ## Tick order (this *is* the determinism contract)
 *
 * 1. Detect OBB overlaps → the tick's collision set.
 * 2. Evaluate triggers in **sorted interaction-id order**; fire, preempt, skip.
 * 3. Evaluate `until` conditions; release axes.
 * 4. **Plan** every actor from the same frozen snapshot (sorted actor-id order).
 * 5. **Apply** all plans.
 * 6. Retire actors that ran out of route.
 * 7. Record the tick when `t ≥ 0`.
 *
 * Planning and applying are separate passes so no actor ever reads a neighbour
 * that has already stepped — the result is independent of actor declaration
 * order, which `determinism.test.ts` proves by permuting the input.
 *
 * Time is computed as `(i - warmupTicks) * dt` from an integer index rather
 * than accumulated, so `t = 0` is exact and floating-point drift cannot shift a
 * trigger by a tick.
 */

import { obbCorners, obbOverlap, normalizeAngle, type Obb, type Vec2 } from '../core/math.js';
import { contentHash } from '../core/hash.js';
import { Rng } from '../core/rng.js';
import { localFromScene } from '../frames.js';
import { issue, SimEngineError, type SimIssue } from '../errors.js';
import type { LaneGraph } from '../map/lane-graph.js';
import {
  buildRoute,
  retargetToLane,
  retargetToNeighbour,
  Route,
  type RoutePose,
} from '../map/route.js';
import {
  normalizeSimScenarioInput,
  resolvePhysicsConfig,
  isPedestrianLikeKind,
  isRoadActorKind,
  type Interaction,
  type SimActor,
  type SimScenarioInput,
  type ResolvedPhysicsConfig,
  type StaticProp,
  type TurnRelation,
} from '../schema/input.js';
import { ENGINE_VERSION } from '../version.js';
import {
  cruiseSpeed,
  distanceToStopLine,
  findLeader,
  governorCap,
  headingWithSlip,
  lateralStep,
  limitsFor,
  longitudinalAccel,
  desiredGapM,
} from './controllers.js';
import { transitionDuration } from './dynamics.js';
import { ACTOR_PHYSICS_PROFILES, DynamicV1Backend, DYNAMIC_V1_DEFAULT_SUBSTEP_S } from './dynamic-v1.js';
import type { MotionBackend, PhysicsTelemetrySample } from './motion-backend.js';
import { actorPhysicsBackends } from './physics-provenance.js';
import {
  articulatedDoorObb,
  alongRouteGapM,
  DOOR_OPEN_DURATION_S,
  isReverseMotion,
  pairKey,
  sweptObbTimeOfImpact,
  type DoorName,
} from './pairs.js';
import { SignalBook } from './signals.js';
import { spatialCandidatePairs, type SpatialBounds } from './spatial.js';
import {
  axisOf,
  type ActorRuntime,
  type AxisId,
  type LateralCommand,
  type LongitudinalCommand,
  type WorldState,
} from './state.js';
import { makeTriggerRuntime, shouldFire, type ConditionContext, type TriggerRuntime } from './triggers.js';
import { evaluateCondition } from './triggers.js';
import { buildOccluders, hasLineOfSight, type OccluderShape } from './visibility.js';
import { TRACE_FORMAT_VERSION, type ActorTrack, type SignalTrack, type SimEvent, type SimTrace } from '../trace/trace.js';
import { computeMetrics, type MetricAccumulator, newMetricAccumulator, observeTick } from '../trace/metrics.js';
import { checkFeasibility } from '../solve/guards.js';
import { resolveArrivalTriggers, type ArrivalSolution } from '../solve/arrival.js';
import type { StaticMapCollider } from './static-colliders.js';

export interface RunOptions {
  readonly graph: LaneGraph;
  /** Deterministic low-complexity collision proxies extracted from the map. */
  readonly staticColliders?: readonly StaticMapCollider[];
  /**
   * `throw` (default) aborts on any error-severity feasibility issue, `collect`
   * runs anyway and returns them, `skip` does not check.
   */
  readonly guards?: 'throw' | 'collect' | 'skip';
  /** Pre-solve `arrival` triggers into fixed times + spawn-s offsets. */
  readonly resolveArrival?: boolean;
  /**
   * Include negative warm-up samples in trace tracks. Metrics and authored
   * triggers remain scoped to the recorded clip; this is intended for exact
   * interchange replay, where ASAM time zero is the start of warm-up.
   */
  readonly includeWarmupTrace?: boolean;
}

export interface SimResult {
  readonly trace: SimTrace;
  readonly issues: SimIssue[];
  readonly arrival: ArrivalSolution[];
}

export interface FixedStepSimulationProgress extends SimResult {
  readonly done: boolean;
  readonly recordedUntil: number | null;
}

/**
 * A resumable view of the canonical fixed-step engine. Interactive consumers
 * may yield between batches without changing tick order or numerical results.
 * Calling `advance` after completion is safe and returns the completed trace.
 */
export interface FixedStepSimulationSession {
  readonly done: boolean;
  advance(maxTicks?: number): FixedStepSimulationProgress;
}

/** Moving actors this close to the end are clamped to the terminal pose. */
const ROUTE_END_SLACK_M = 0.01;
/** Lookahead used for the stop-line search and the crossing-conflict scan. */
const LOOKAHEAD_M = 80;
/** Conflict scan: samples per actor, and the spacing between them. */
const CONFLICT_SAMPLES = 14;
const CONFLICT_STEP_M = 5;
/** Two future paths closer than this count as crossing. */
const CONFLICT_RADIUS_M = 2.5;
/** Arrival-time separation below which a yielding actor gives way. */
const CONFLICT_WINDOW_S = 2.5;
/** Below this heading difference two actors are following, not crossing. */
const CONFLICT_MIN_ANGLE_RAD = 0.4;
/** Uniform-grid size; larger than ordinary road-user footprints and one tick's motion. */
const COLLISION_GRID_CELL_M = 20;

function collisionGridCells(bounds: Omit<SpatialBounds, 'id'> | SpatialBounds): string[] {
  const x0 = Math.floor(bounds.minX / COLLISION_GRID_CELL_M);
  const x1 = Math.floor(bounds.maxX / COLLISION_GRID_CELL_M);
  const y0 = Math.floor(bounds.minY / COLLISION_GRID_CELL_M);
  const y1 = Math.floor(bounds.maxY / COLLISION_GRID_CELL_M);
  const cells: string[] = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) cells.push(`${x},${y}`);
  return cells;
}
/** Future-path bounds are up to ~65 m long; this keeps most roads in a few cells. */
const CONFLICT_GRID_CELL_M = 40;

interface Plan {
  readonly actor: ActorRuntime;
  speed: number;
  accel: number;
  routeS: number;
  lateralOffset: number;
  lateralRate: number;
  position: Vec2;
  heading: number;
  requiredDecel: number;
  retire: boolean;
  /** Completed lane change: swap the route after the apply pass. */
  swap: { route: Route; s: number; separationM: number; targetRsl: string | null } | null;
}

interface CollisionSnapshot {
  readonly shapes: ReadonlyMap<string, Obb>;
  readonly live: boolean;
}

interface StaticCollisionShape {
  /** Namespaced collision id; concrete author identity is retained in prop metadata. */
  readonly id: string;
  readonly obb: Obb;
}

interface DoorRuntime {
  readonly actorId: string;
  readonly name: DoorName;
  from: number;
  target: number;
  startedT: number;
  durationS: number;
  transitioning: boolean;
}

export function runSimulation(input: SimScenarioInput, opts: RunOptions): SimResult {
  const sim = new Simulation(input, opts);
  return sim.run();
}

export function createFixedStepSimulation(
  input: SimScenarioInput,
  opts: RunOptions,
): FixedStepSimulationSession {
  return new Simulation(input, opts);
}

class Simulation {
  private readonly graph: LaneGraph;
  private readonly dt: number;
  private readonly warmupTicks: number;
  private readonly clipTicks: number;
  private readonly actors: ActorRuntime[] = [];
  private readonly byId = new Map<string, ActorRuntime>();
  private readonly triggers: TriggerRuntime[] = [];
  private readonly triggerById = new Map<string, TriggerRuntime>();
  private readonly signals: SignalBook;
  private readonly occluders: OccluderShape[];
  private readonly actorOccluderIds: ReadonlySet<string>;
  private readonly collidableProps: StaticCollisionShape[];
  private readonly staticCollisionGrid = new Map<string, StaticCollisionShape[]>();
  private readonly attachedPropsByActor = new Map<string, StaticProp[]>();
  private readonly attachedOccluderIds: ReadonlySet<string>;
  private readonly events: SimEvent[] = [];
  private readonly issues: SimIssue[] = [];
  private readonly tracks = new Map<string, ActorTrack>();
  private readonly signalTracks = new Map<string, SignalTrack>();
  private readonly tArray: number[] = [];
  private readonly metrics: MetricAccumulator;
  private readonly rng: Rng;
  private readonly resolvedInput: SimScenarioInput;
  private readonly physicsConfig: ResolvedPhysicsConfig;
  private readonly dynamicBackend: DynamicV1Backend | null;
  private readonly motionBackend: MotionBackend | null;
  private readonly dynamicActorIds = new Set<string>();
  private readonly physicsTelemetry = new Map<string, PhysicsTelemetrySample>();
  private readonly arrivalSolutions: ArrivalSolution[];
  /** Preserve the authored-only engine path byte-for-byte unless ambient traffic exists. */
  private readonly hasAmbientTraffic: boolean;
  private world: WorldState;
  private conflictSamples = new Map<string, Vec2[]>();
  private conflictCandidates = new Map<string, ActorRuntime[]>();
  private collisionSnapshots = new Map<string, CollisionSnapshot>();
  private previousCollisionT: number | null = null;
  private readonly doors = new Map<string, DoorRuntime>();
  private nextTick = 0;
  private finished = false;

  constructor(rawInput: SimScenarioInput, private readonly opts: RunOptions) {
    this.graph = opts.graph;

    const normalized = normalizeSimScenarioInput(rawInput);
    const arrivalResult =
      opts.resolveArrival === false
        ? { input: normalized, solutions: [] as ArrivalSolution[], issues: [] as SimIssue[] }
        : resolveArrivalTriggers(normalized, this.graph);
    this.resolvedInput = arrivalResult.input;
    this.arrivalSolutions = arrivalResult.solutions;
    this.issues.push(...arrivalResult.issues);

    const input = this.resolvedInput;
    this.physicsConfig = resolvePhysicsConfig(input);
    this.dynamicBackend = new DynamicV1Backend(this.physicsConfig.substepS ?? DYNAMIC_V1_DEFAULT_SUBSTEP_S);
    this.motionBackend = this.dynamicBackend;
    this.dt = input.dt;
    this.warmupTicks = Math.round(input.warmupSeconds / input.dt);
    this.clipTicks = Math.round(input.clipSeconds / input.dt);
    this.rng = new Rng(input.seed);
    this.signals = new SignalBook(input.signalPrograms, input.warmupSeconds, input.roadControls);
    for (const id of this.signals.ids()) this.signalTracks.set(id, { phase: [] });
    this.attachedOccluderIds = new Set(
      input.props
        .filter((prop) => prop.attachment && input.occluders.some((occluder) => occluder.id === prop.id))
        .map((prop) => prop.id),
    );
    this.occluders = buildOccluders(input.occluders.filter((occluder) => !this.attachedOccluderIds.has(occluder.id)));
    this.actorOccluderIds = new Set(
      input.occlusionPairs
        .map((pair) => pair.occluderId)
        .filter((id): id is string => id?.startsWith('actor:') === true)
        .map((id) => id.slice('actor:'.length)),
    );
    this.collidableProps = input.props
      .filter((prop) => prop.collidable && !prop.attachment)
      .map((prop) => ({
        id: `prop:${prop.id}`,
        obb: {
          center: localFromScene(prop.pose),
          lengthM: prop.dims.l * prop.scale,
          widthM: prop.dims.w * prop.scale,
          headingRad: prop.pose.headingRad,
        },
      }));
    for (const collider of [...(opts.staticColliders ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      this.collidableProps.push({
        id: `map:${collider.id}`,
        obb: {
          center: localFromScene(collider.obb.center),
          lengthM: collider.obb.lengthM,
          widthM: collider.obb.widthM,
          headingRad: collider.obb.headingRad,
        },
      });
    }
    for (const shape of this.collidableProps) {
      const corners = obbCorners(shape.obb);
      const minX = Math.min(...corners.map((point) => point.x));
      const maxX = Math.max(...corners.map((point) => point.x));
      const minY = Math.min(...corners.map((point) => point.y));
      const maxY = Math.max(...corners.map((point) => point.y));
      for (const cell of collisionGridCells({ minX, maxX, minY, maxY })) {
        const bucket = this.staticCollisionGrid.get(cell) ?? [];
        bucket.push(shape);
        this.staticCollisionGrid.set(cell, bucket);
      }
    }
    for (const bucket of this.staticCollisionGrid.values()) bucket.sort((a, b) => a.id.localeCompare(b.id));
    for (const prop of input.props) {
      if (!prop.attachment) continue;
      const bucket = this.attachedPropsByActor.get(prop.attachment.actorId) ?? [];
      bucket.push(prop);
      bucket.sort((a, b) => a.id.localeCompare(b.id));
      this.attachedPropsByActor.set(prop.attachment.actorId, bucket);
    }

    const guardMode = opts.guards ?? 'throw';
    if (guardMode !== 'skip') {
      const found = checkFeasibility(input, this.graph);
      this.issues.push(...found);
      if (guardMode === 'throw') {
        const errors = found.filter((i) => i.severity === 'error');
        if (errors.length > 0) {
          throw new SimEngineError(
            `scenario is infeasible: ${errors.map((e) => e.code).join(', ')}`,
            errors,
          );
        }
      }
    }

    this.hasAmbientTraffic = input.actors.some((actor) => actor.tags.includes('ambient'));
    for (const spec of [...input.actors].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const rt = this.buildActor(spec);
      this.actors.push(rt);
      this.byId.set(rt.id, rt);
      if (this.motionBackend && !rt.static && rt.kind !== 'static_object') {
        this.dynamicActorIds.add(rt.id);
        this.motionBackend.register({
          actorId: rt.id,
          kind: rt.kind,
          dimensions: { l: rt.dims.l, w: rt.dims.w },
          motionDirection: isReverseMotion(rt) ? -1 : 1,
          state: {
            x: rt.position.x,
            y: rt.position.y,
            yawRad: rt.headingRad,
            longitudinalVelocityMps: rt.speedMps,
          },
          profile: this.physicsConfig.vehicleProfiles?.[rt.id],
        });
      }
      this.tracks.set(rt.id, {
        x: [],
        y: [],
        headingRad: [],
        speedMps: [],
        motionDirection: [],
        laneRsl: [],
        s: [],
        present: [],
        ...(this.dynamicActorIds.has(rt.id) ? {
          physics: {
            vxBodyMps: [],
            vyBodyMps: [],
            yawRateRadps: [],
            steerRad: [],
            wheelAngularSpeedRadps: [],
            tireUtilization: [],
            frontNormalForceN: [],
            rearNormalForceN: [],
            collisionImpulseNs: [],
            collisionCount: [],
          },
        } : {}),
      });
    }
    for (const it of [...input.interactions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const tr = makeTriggerRuntime(it);
      this.triggers.push(tr);
      this.triggerById.set(it.id, tr);
    }

    this.metrics = newMetricAccumulator(
      this.actors.map((a) => a.id),
      input.occlusionPairs,
      input.metricSubject ?? null,
    );
    this.world = {
      t: -input.warmupSeconds,
      dt: this.dt,
      actors: this.actors,
      byId: this.byId,
      activeCollisions: new Set(),
    };
  }

  /* ------------------------------------------------------------ actor setup */

  private buildActor(spec: SimActor): ActorRuntime {
    const built = buildRoute(this.graph, spec.behavior.route);
    if (!built.ok) {
      throw new SimEngineError(built.error.reason, [
        issue(built.error.code, `actors.${spec.id}.behavior.route`, built.error.reason, built.error.detail),
      ]);
    }
    const route = built.route;
    const posePoint = localFromScene(spec.initial.pose);

    // The authored scene transform is the t=0 source of truth. Lane metadata
    // may be stale after an editor move, so it can validate the route but may
    // never relocate the visible actor when Play starts.
    const projectedSpawn = route.projectPoint(posePoint);
    let routeS = projectedSpawn.s;
    let lateral = route.lateralOffsetAt(projectedSpawn.s, posePoint);
    const laneRef = spec.initial.laneRef;
    if (laneRef) {
      const s = route.sOfLaneStorage(laneRef.rsl, laneRef.s);
      if (s === null) {
        this.issues.push(
          issue(
            'spawn_lane_not_on_route',
            `actors.${spec.id}.initial.laneRef`,
            `lane ${laneRef.rsl} is not on the actor's route; falling back to projecting the pose`,
            { rsl: laneRef.rsl },
            'warning',
          ),
        );
      } else {
        const declared = route.pointWithOffset(s, laneRef.tFrac * route.widthAt(s));
        const mismatchM = Math.hypot(declared.x - posePoint.x, declared.y - posePoint.y);
        if (mismatchM > 0.25) {
          this.issues.push(issue(
            'spawn_lane_pose_mismatch',
            `actors.${spec.id}.initial`,
            `authored pose and lane station differ by ${mismatchM.toFixed(2)} m; the authored pose is preserved and lane progress is reprojected`,
            { rsl: laneRef.rsl, authoredS: laneRef.s, projectedS: routeS, mismatchM },
            'warning',
          ));
        }
      }
    }

    const rules = { ...spec.behavior.rules };
    const rt: ActorRuntime = {
      id: spec.id,
      kind: spec.kind,
      dims: spec.dims,
      tags: spec.tags,
      static: spec.static,
      rules,
      driver: this.driverProfile(spec, rules.aggression),
      cruiseSpeedMps: 0,
      cruiseOverrideMps: spec.behavior.cruiseSpeedMps === undefined
        ? null
        : spec.behavior.cruiseSpeedMps * this.resolvedInput.operationalConditions.effects.trafficSpeedFactor,
      route,
      routeS,
      remainingTurns:
        spec.behavior.route.kind === 'follow' ? [...spec.behavior.route.turns] : ([] as TurnRelation[]),
      speedMps: spec.static ? 0 : spec.initial.speedMps,
      accelMps2: 0,
      lateralOffsetM: lateral,
      lateralRateMps: 0,
      position: posePoint,
      headingRad: normalizeAngle(spec.initial.pose.headingRad),
      present: spec.presentAtStart,
      retired: false,
      longCmd: null,
      latCmd: null,
      untilByAxis: new Map(),
      stateKeys: new Map(),
      roadControlStates: new Map(),
      standstillSinceS: null,
      requiredDecelMax: 0,
      crashDisabledAtS: null,
      crashDisabledReason: null,
    };
    rt.cruiseSpeedMps = spec.static ? 0 : cruiseSpeed(rt, this.speedLimitAt(rt));
    return rt;
  }

  /** Seeded, actor-local variation used by the lightweight preview driver.
   * It is independent of actor declaration order and never reads wall time. */
  private driverProfile(spec: SimActor, aggression: number): NonNullable<ActorRuntime['driver']> {
    if (!isRoadActorKind(spec.kind) || !this.hasAmbientTraffic) {
      return {
        naturalistic: false,
        desiredSpeedFactor: 1, timeHeadwayS: 1, minimumGapM: 1,
        accelScale: 1, comfortBrakeScale: 1, reactionTimeS: 0,
        startDelayS: 0,
      };
    }
    const random = this.rng.fork(`driver:${spec.id}`);
    return {
      naturalistic: true,
      desiredSpeedFactor: random.range(0.9, 1.02) + aggression * 0.06,
      timeHeadwayS: random.range(1.15, 1.75) - aggression * 0.35,
      minimumGapM: random.range(2, 3),
      accelScale: random.range(0.75, 1.05) + aggression * 0.1,
      comfortBrakeScale: random.range(0.85, 1.1),
      reactionTimeS: Math.max(0.25, random.range(0.4, 0.8) - aggression * 0.1),
      startDelayS: random.range(0.25, 0.65),
    };
  }

  private speedLimitAt(a: ActorRuntime): number {
    const pose = a.route.poseAt(a.routeS);
    const factor = this.resolvedInput.operationalConditions.effects.trafficSpeedFactor;
    if (!pose.rsl) return (isPedestrianLikeKind(a.kind) ? 1.4 : 13.4) * factor;
    const g = this.graph.geometry(pose.rsl);
    return (g ? g.speedLimitMps : 13.4) * factor;
  }

  /** Preview-speed cap from upcoming route curvature. This is deliberately a
   * small controller calculation, not a second trajectory planner: dynamic-v1
   * still owns steering/yaw and the authored route remains authoritative. */
  private curvatureSpeedCap(a: ActorRuntime, freeFlowMps: number): number {
    if (this.physicsConfig.mode !== 'dynamic-v1' || a.route.isFreeform) return freeFlowMps;
    const horizonEnd = a.routeS + 30;
    const hasUpcomingTurn = a.route.legs.some((leg) => {
      if (leg.sStart > horizonEnd) return false;
      if (leg.sStart + leg.lengthM < a.routeS) return false;
      return leg.turnRelation !== null && leg.turnRelation !== 'Straight';
    });
    if (!hasUpcomingTurn) return freeFlowMps;
    const here = a.route.poseAt(a.routeS).headingRad;
    let cap = freeFlowMps;
    // Two look-ahead horizons catch both the connector itself and the braking
    // approach without turning a 32-car preview into a route-resampling job.
    for (const distanceM of [10, 22]) {
      const ahead = a.route.poseAt(Math.min(a.route.lengthM, a.routeS + distanceM)).headingRad;
      const curvature = Math.abs(normalizeAngle(ahead - here)) / distanceM;
      if (curvature > 1e-4) cap = Math.min(cap, Math.sqrt(2.4 / curvature));
    }
    return Math.max(2.2, cap);
  }

  /* -------------------------------------------------------------- main loop */

  run(): SimResult {
    const result = this.advance(Number.POSITIVE_INFINITY);
    return { trace: result.trace, issues: result.issues, arrival: result.arrival };
  }

  get done(): boolean {
    return this.finished;
  }

  advance(maxTicks = 1): FixedStepSimulationProgress {
    const budget = Number.isFinite(maxTicks) ? Math.max(0, Math.floor(maxTicks)) : Number.MAX_SAFE_INTEGER;
    const total = this.warmupTicks + this.clipTicks;
    let advanced = 0;
    while (!this.finished && this.nextTick <= total && advanced < budget) {
      const i = this.nextTick++;
      const t = (i - this.warmupTicks) * this.dt;
      this.world = { ...this.world, t };
      this.updateDoorTransitions(t);
      const collisions = this.detectCollisions(t);
      if (t >= 0) {
        this.evaluateTriggers(t, collisions);
        this.evaluateUntil(t, collisions);
      }
      if (t >= 0 || this.opts.includeWarmupTrace === true) {
        // Record the state *at* `t`, before this tick's integration step, so
        // the sample at `t = 0` is exactly the prologue's final state. Warm-up
        // samples are tracks only: they must not alter recorded-clip metrics.
        this.record(t, collisions, t >= 0);
      }
      if (i < total) {
        const plans = this.planAll(t);
        this.applyAll(plans, t);
      } else {
        this.finishNeverFired();
        this.finished = true;
      }
      advanced += 1;
    }
    return {
      trace: this.buildTrace(),
      issues: this.issues,
      arrival: this.arrivalSolutions,
      done: this.finished,
      recordedUntil: this.tArray.length > 0 ? this.tArray[this.tArray.length - 1]! : null,
    };
  }

  /* ------------------------------------------------------------- collisions */

  private obbOf(a: ActorRuntime): Obb {
    return { center: a.position, lengthM: a.dims.l, widthM: a.dims.w, headingRad: a.headingRad };
  }

  private doorOpenness(door: DoorRuntime, t: number): number {
    if (!door.transitioning || door.durationS <= 0) return door.target;
    const u = Math.max(0, Math.min(1, (t - door.startedT) / door.durationS));
    return door.from + (door.target - door.from) * u;
  }

  private collisionShapes(a: ActorRuntime, t: number): Map<string, Obb> {
    const shapes = new Map<string, Obb>([['body', this.obbOf(a)]]);
    for (const name of ['left', 'right', 'rear'] as const) {
      const door = this.doors.get(`${a.id}|${name}`);
      if (!door) continue;
      const openness = this.doorOpenness(door, t);
      if (openness <= 1e-9 && !door.transitioning) continue;
      shapes.set(`door:${name}`, articulatedDoorObb(a, name, openness));
    }
    for (const prop of this.attachedPropsByActor.get(a.id) ?? []) {
      if (!prop.collidable) continue;
      shapes.set(`prop:${prop.id}`, this.attachedPropObb(a, prop));
    }
    return shapes;
  }

  private attachedPropObb(a: ActorRuntime, prop: StaticProp): Obb {
    const attachment = prop.attachment!;
    const cos = Math.cos(a.headingRad);
    const sin = Math.sin(a.headingRad);
    return {
      center: {
        x: a.position.x + cos * attachment.longitudinalM - sin * attachment.lateralM,
        y: a.position.y + sin * attachment.longitudinalM + cos * attachment.lateralM,
      },
      lengthM: prop.dims.l * prop.scale,
      widthM: prop.dims.w * prop.scale,
      headingRad: normalizeAngle(a.headingRad + attachment.headingOffsetRad),
    };
  }

  private updateDoorTransitions(t: number): void {
    for (const key of [...this.doors.keys()].sort()) {
      const door = this.doors.get(key)!;
      if (!door.transitioning || t < door.startedT + door.durationS) continue;
      door.from = door.target;
      door.transitioning = false;
      const actor = this.byId.get(door.actorId);
      if (!actor) continue;
      const value = door.target > 0 ? 'open' : 'closed';
      actor.stateKeys.set(`doors.${door.name}`, value);
      if (t >= 0) {
        this.events.push({ t, kind: 'state_set', actorId: actor.id, key: `doors.${door.name}`, value });
      }
    }
  }

  private occludersForTick(): readonly OccluderShape[] {
    const actorOccluders = this.actors.filter((a) =>
      (a.static || this.actorOccluderIds.has(a.id)) && a.present && !a.retired
    );
    const dynamic = actorOccluders
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((a) => {
        const obb = this.obbOf(a);
        return {
          id: `actor:${a.id}`,
          obb,
          heightM: a.dims.h,
          corners: obbCorners(obb),
        } satisfies OccluderShape;
      });
    const attached = [...this.attachedPropsByActor.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([actorId, props]) => {
        const carrier = this.byId.get(actorId);
        if (!carrier?.present || carrier.retired) return [];
        return props
          .filter((prop) => this.attachedOccluderIds.has(prop.id))
          .map((prop) => {
            const obb = this.attachedPropObb(carrier, prop);
            return {
              id: prop.id,
              obb,
              heightM: prop.dims.h * prop.scale,
              corners: obbCorners(obb),
            } satisfies OccluderShape;
          });
      });
    return [...this.occluders, ...dynamic, ...attached];
  }

  private detectCollisions(t: number): Set<string> {
    const live = this.actors.filter((a) => a.present && !a.retired);
    const detected = new Set<string>();
    const overlappingNow = new Set<string>();
    const contacts: Array<{ t: number; a: string; b: string; key: string; colliderA: string; colliderB: string }> = [];
    const currentShapes = new Map(live.map((actor) => [actor.id, this.collisionShapes(actor, t)]));
    const candidatePairs: Array<readonly [ActorRuntime, ActorRuntime]> = [];
    if (this.hasAmbientTraffic) {
      const bounds = live.map((actor) => this.sweptBounds(
        actor.id,
        currentShapes.get(actor.id)!,
        this.collisionSnapshots.get(actor.id)?.shapes,
      ));
      for (const pair of spatialCandidatePairs(bounds, COLLISION_GRID_CELL_M)) {
        const a = this.byId.get(pair.a);
        const b = this.byId.get(pair.b);
        if (a && b) candidatePairs.push([a, b]);
      }
    } else {
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) candidatePairs.push([live[i]!, live[j]!]);
      }
    }
    for (const [a, b] of candidatePairs) {
        const key = pairKey(a.id, b.id);
        const currentShapesA = currentShapes.get(a.id)!;
        const currentShapesB = currentShapes.get(b.id)!;
        let currentOverlap = false;
        let contactT: number | null = null;
        let colliderA = 'body';
        let colliderB = 'body';
        for (const [shapeA, currentA] of currentShapesA) {
          for (const [shapeB, currentB] of currentShapesB) {
            if (obbOverlap(currentA, currentB)) {
              currentOverlap = true;
              contactT = t;
              colliderA = shapeA;
              colliderB = shapeB;
            }
          }
        }
        if (currentOverlap) overlappingNow.add(key);
        const previousA = this.collisionSnapshots.get(a.id);
        const previousB = this.collisionSnapshots.get(b.id);
        if (
          this.previousCollisionT !== null &&
          previousA?.live &&
          previousB?.live
        ) {
          for (const [shapeA, currentA] of currentShapesA) {
            const priorA = previousA.shapes.get(shapeA);
            if (!priorA) continue;
            for (const [shapeB, currentB] of currentShapesB) {
              const priorB = previousB.shapes.get(shapeB);
              if (!priorB) continue;
              const hit = sweptObbTimeOfImpact(priorA, currentA, priorB, currentB);
              if (!hit) continue;
              const sweptT = this.previousCollisionT + (t - this.previousCollisionT) * hit.toi;
              if (contactT === null || sweptT < contactT) {
                contactT = sweptT;
                colliderA = shapeA;
                colliderB = shapeB;
              }
            }
          }
        }

        // A swept contact wholly inside the warm-up must not satisfy a
        // collision trigger at t=0. A box still overlapping at t=0 does.
        if (currentOverlap || (contactT !== null && (t < 0 || contactT >= 0))) detected.add(key);
        if (
          contactT !== null &&
          contactT >= 0 &&
          !this.world.activeCollisions.has(key)
        ) {
          const lo = a.id < b.id ? a.id : b.id;
          const hi = a.id < b.id ? b.id : a.id;
          contacts.push({
            t: contactT,
            a: lo,
            b: hi,
            key,
            colliderA: a.id < b.id ? colliderA : colliderB,
            colliderB: a.id < b.id ? colliderB : colliderA,
          });
        }
    }

    // Fixed props have no actor track, but authored collidable geometry still
    // participates in the same continuous collision pipeline. The `prop:`
    // namespace keeps condition/event ids unambiguous beside actor ids.
    for (const actor of live) {
      const actorShapes = currentShapes.get(actor.id)!;
      const previous = this.collisionSnapshots.get(actor.id);
      for (const prop of this.staticCollisionCandidates(actor.id, actorShapes, previous?.shapes)) {
        const key = pairKey(actor.id, prop.id);
        let currentOverlap = false;
        let contactT: number | null = null;
        let colliderActor = 'body';
        for (const [shapeName, current] of actorShapes) {
          if (obbOverlap(current, prop.obb)) {
            currentOverlap = true;
            contactT = t;
            colliderActor = shapeName;
          }
          const prior = previous?.shapes.get(shapeName);
          if (this.previousCollisionT === null || !previous?.live || !prior) continue;
          const hit = sweptObbTimeOfImpact(prior, current, prop.obb, prop.obb);
          if (!hit) continue;
          const sweptT = this.previousCollisionT + (t - this.previousCollisionT) * hit.toi;
          if (contactT === null || sweptT < contactT) {
            contactT = sweptT;
            colliderActor = shapeName;
          }
        }
        if (currentOverlap) overlappingNow.add(key);
        if (currentOverlap || (contactT !== null && (t < 0 || contactT >= 0))) detected.add(key);
        if (contactT !== null && contactT >= 0 && !this.world.activeCollisions.has(key)) {
          const actorFirst = actor.id < prop.id;
          contacts.push({
            t: contactT,
            a: actorFirst ? actor.id : prop.id,
            b: actorFirst ? prop.id : actor.id,
            key,
            colliderA: actorFirst ? colliderActor : 'static',
            colliderB: actorFirst ? 'static' : colliderActor,
          });
        }
      }
    }

    // Sub-tick contact times can differ within one integration interval. Sort
    // them explicitly so event order remains independent of actor declaration.
    contacts.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
    for (const contact of contacts) {
      const detail = contact.colliderA === 'body' && contact.colliderB === 'body'
        ? {}
        : { colliderA: contact.colliderA, colliderB: contact.colliderB };
      this.events.push({ t: contact.t, kind: 'collision', a: contact.a, b: contact.b, ...detail });
      this.metrics.collisions.push({ t: contact.t, a: contact.a, b: contact.b, ...detail });
      for (const [actorId, otherId] of [[contact.a, contact.b], [contact.b, contact.a]] as const) {
        const actor = this.byId.get(actorId);
        if (!actor || actor.static || actor.crashDisabledAtS != null) continue;
        actor.crashDisabledAtS = contact.t;
        actor.crashDisabledReason = `material-collision:${otherId}`;
        actor.longCmd = null;
        actor.latCmd = null;
        actor.untilByAxis.clear();
        this.events.push({ t: contact.t, kind: 'crash_disabled', actorId, otherId, reason: 'material-collision' });
      }
    }

    this.world.activeCollisions.clear();
    for (const k of [...overlappingNow].sort()) this.world.activeCollisions.add(k);
    this.collisionSnapshots = new Map(
      this.actors.map((a) => [
        a.id,
        { shapes: this.collisionShapes(a, t), live: a.present && !a.retired } satisfies CollisionSnapshot,
      ]),
    );
    this.previousCollisionT = t;
    return detected;
  }

  private staticCollisionCandidates(
    actorId: string,
    current: ReadonlyMap<string, Obb>,
    previous: ReadonlyMap<string, Obb> | undefined,
  ): readonly StaticCollisionShape[] {
    const bounds = this.sweptBounds(actorId, current, previous);
    const found = new Map<string, StaticCollisionShape>();
    for (const cell of collisionGridCells(bounds)) {
      for (const shape of this.staticCollisionGrid.get(cell) ?? []) found.set(shape.id, shape);
    }
    return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Conservative AABB for all translation and rotation between two ticks. */
  private sweptBounds(
    id: string,
    current: ReadonlyMap<string, Obb>,
    previous: ReadonlyMap<string, Obb> | undefined,
  ): SpatialBounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const shapes of previous ? [current, previous] : [current]) {
      for (const shape of shapes.values()) {
        // A rotating OBB never leaves its circumscribed circle. Expanding each
        // endpoint circle also encloses every linearly interpolated centre.
        const radius = Math.hypot(shape.lengthM, shape.widthM) / 2;
        minX = Math.min(minX, shape.center.x - radius);
        minY = Math.min(minY, shape.center.y - radius);
        maxX = Math.max(maxX, shape.center.x + radius);
        maxY = Math.max(maxY, shape.center.y + radius);
      }
    }
    return { id, minX, minY, maxX, maxY };
  }

  /* --------------------------------------------------------------- triggers */

  private conditionContext(t: number, collisions: ReadonlySet<string>): ConditionContext {
    return {
      t,
      world: { ...this.world, t },
      signals: this.signals,
      occluders: this.occludersForTick(),
      collisions,
      visibilityRangeM: this.resolvedInput.operationalConditions.effects.visibilityRangeM,
    };
  }

  private evaluateTriggers(t: number, collisions: ReadonlySet<string>): void {
    const ctx = this.conditionContext(t, collisions);
    for (const tr of this.triggers) {
      if (tr.status !== 'pending') continue;
      const verdict = shouldFire(ctx, tr, this.triggerById);
      if (verdict.skip) {
        tr.status = 'skipped';
        this.events.push({
          t,
          kind: 'trigger_skipped',
          interactionId: tr.interaction.id,
          actorId: tr.interaction.actorId,
          reason: tr.interaction.trigger.kind === 'when' ? 'byLatest_elapsed' : 'dependency_skipped',
        });
        this.metrics.triggerNeverFired.push(tr.interaction.id);
        continue;
      }
      if (!verdict.fire) continue;
      const targetActor = this.byId.get(tr.interaction.actorId);
      if (targetActor?.crashDisabledAtS != null) {
        tr.status = 'skipped';
        this.events.push({
          t,
          kind: 'trigger_skipped',
          interactionId: tr.interaction.id,
          actorId: tr.interaction.actorId,
          reason: 'actor-crash-disabled',
        });
        this.metrics.triggerNeverFired.push(tr.interaction.id);
        continue;
      }
      tr.status = 'fired';
      tr.firedAt = t;
      tr.forced = verdict.forced;
      this.events.push({
        t,
        kind: 'trigger_fired',
        interactionId: tr.interaction.id,
        actorId: tr.interaction.actorId,
        verb: tr.interaction.verb,
        forced: verdict.forced,
      });
      this.applyInteraction(tr.interaction, t);
    }
  }

  private evaluateUntil(t: number, collisions: ReadonlySet<string>): void {
    const ctx = this.conditionContext(t, collisions);
    for (const a of this.actors) {
      if (a.untilByAxis.size === 0) continue;
      for (const axis of [...a.untilByAxis.keys()].sort()) {
        const entry = a.untilByAxis.get(axis)!;
        if (!evaluateCondition(ctx, entry.condition)) continue;
        a.untilByAxis.delete(axis);
        this.releaseAxis(a, axis, t, entry.interactionId, 'until');
      }
    }
  }

  private releaseAxis(
    a: ActorRuntime,
    axis: AxisId,
    t: number,
    interactionId: string,
    reason: 'until' | 'complete',
  ): void {
    if (axis === 'longitudinal') a.longCmd = null;
    else if (axis === 'lateral') a.latCmd = null;
    this.events.push({ t, kind: 'released', actorId: a.id, axis, interactionId, reason });
  }

  /* ----------------------------------------------------- verb → controller */

  private applyInteraction(it: Interaction, t: number): void {
    const a = this.byId.get(it.actorId);
    if (!a) return;
    if (a.crashDisabledAtS != null) {
      this.events.push({ t, kind: 'trigger_skipped', interactionId: it.id, actorId: a.id, reason: 'actor-crash-disabled' });
      return;
    }
    const axis = axisOf(it);
    this.preempt(a, axis, it, t);

    switch (it.verb) {
      case 'speed': {
        const target = this.resolveSpeedTarget(a, it);
        const duration = transitionDuration(it.dynamics, target - a.speedMps, Math.max(a.speedMps, 0.1));
        const cmd: LongitudinalCommand = {
          kind: 'speed',
          interactionId: it.id,
          firedAt: t,
          dynamics: it.dynamics,
          v0: a.speedMps,
          duration,
          target,
          speedTarget: it,
        };
        a.longCmd = cmd;
        break;
      }
      case 'gap': {
        const leaderId = it.target.actorId;
        const leader = this.byId.get(leaderId);
        const gapNow = leader ? (alongRouteGapM(a, leader) ?? 0) : 0;
        const gapTarget = desiredGapM(a, it.value, it.mode, true);
        const duration = transitionDuration(it.dynamics, gapTarget - gapNow, Math.max(a.speedMps, 0.1));
        const cmd: LongitudinalCommand = {
          kind: 'gap',
          interactionId: it.id,
          firedAt: t,
          dynamics: it.dynamics,
          v0: gapNow,
          duration,
          target: gapTarget,
          gap: { actorId: leaderId, value: it.value, mode: it.mode },
        };
        a.longCmd = cmd;
        break;
      }
      case 'changeLane': {
        const cmd = this.startLaneChange(a, it, t);
        if (cmd) a.latCmd = cmd;
        break;
      }
      case 'laneOffset': {
        const width = a.route.widthAt(a.routeS);
        const to = it.target.mode === 'meters' ? it.target.value : it.target.value * width;
        const duration = transitionDuration(it.dynamics, to - a.lateralOffsetM, Math.max(a.speedMps, 0.1));
        const cmd: LateralCommand = {
          kind: 'laneOffset',
          interactionId: it.id,
          firedAt: t,
          dynamics: it.dynamics,
          from: a.lateralOffsetM,
          to,
          duration,
          remaining: 0,
          done: false,
        };
        a.latCmd = cmd;
        break;
      }
      case 'route': {
        const built = buildRoute(this.graph, it.target);
        if (!built.ok) {
          this.issues.push(
            issue('route_disconnected', `interactions.${it.id}.target`, built.error.reason, built.error.detail, 'warning'),
          );
          break;
        }
        const proj = built.route.projectPoint(a.position);
        a.route = built.route;
        a.routeS = proj.s;
        a.lateralOffsetM = built.route.lateralOffsetAt(proj.s, a.position);
        a.remainingTurns = it.target.kind === 'follow' ? [...it.target.turns] : [];
        // Re-routing is an explicit new motion path. An actor that reached its
        // previous route end must be allowed to move again (rollback, rebound,
        // multi-leg pedestrian motion) without a fake despawn/respawn cycle.
        a.retired = false;
        break;
      }
      case 'exist': {
        const present = it.target.state === 'present';
        if (present !== a.present) {
          a.present = present;
          if (present) {
            a.retired = false;
            this.events.push({ t, kind: 'spawn', actorId: a.id });
          } else {
            this.events.push({ t, kind: 'despawn', actorId: a.id, reason: 'interaction' });
          }
        }
        break;
      }
      case 'set': {
        const { key, value } = it.target;
        a.stateKeys.set(key, value);
        const forcedSignal = /^signal:(.+)\.phase$/.exec(key);
        const forcedControl = /^control:(.+)\.indication$/.exec(key);
        if (
          (forcedSignal || forcedControl) &&
          typeof value === 'string'
        ) {
          this.signals.setOverride((forcedSignal ?? forcedControl)![1]!, value as import('../schema/input.js').ControlIndication);
        }
        this.applyStateKey(a, key, value, t);
        this.events.push({ t, kind: 'state_set', actorId: a.id, key, value });
        break;
      }
    }

    if (it.until) a.untilByAxis.set(axis, { interactionId: it.id, condition: it.until });
    else a.untilByAxis.delete(axis);
  }

  private preempt(a: ActorRuntime, axis: AxisId, it: Interaction, t: number): void {
    const previous =
      axis === 'longitudinal' ? a.longCmd?.interactionId : axis === 'lateral' ? a.latCmd?.interactionId : undefined;
    if (previous !== undefined && previous !== it.id) {
      this.events.push({
        t,
        kind: 'preemption',
        actorId: a.id,
        axis,
        byInteractionId: it.id,
        preemptedInteractionId: previous,
      });
    }
  }

  private applyStateKey(a: ActorRuntime, key: string, value: boolean | number | string, t: number): void {
    const doorMatch = /^doors\.(left|right|rear)$/.exec(key);
    if (doorMatch) this.applyDoorState(a, doorMatch[1] as DoorName, value, t);
    switch (key) {
      case 'rules.obeySignals':
        a.rules = { ...a.rules, obeySignals: Boolean(value) };
        break;
      case 'rules.yield':
        a.rules = { ...a.rules, yield: Boolean(value) };
        break;
      case 'rules.yieldToVehicles':
        a.rules = { ...a.rules, yieldToVehicles: Boolean(value) };
        break;
      case 'rules.yieldToPedestrians':
        a.rules = { ...a.rules, yieldToPedestrians: Boolean(value) };
        break;
      case 'rules.collisionAvoidance':
        a.rules = { ...a.rules, collisionAvoidance: Boolean(value) };
        break;
      case 'rules.aggression':
        if (typeof value === 'number') a.rules = { ...a.rules, aggression: value };
        break;
      case 'rules.speedFactor':
        if (typeof value === 'number') {
          a.rules = { ...a.rules, speedFactor: value };
          a.cruiseSpeedMps = cruiseSpeed(a, this.speedLimitAt(a));
        }
        break;
      default:
        // `lights.*`, `audio.*`, `doors.*`, `pose.*`, `env.*`, `signal:*.phase` are
        // recorded state only — the renderer and exporter read them back out of
        // the event log; no controller consumes them yet.
        break;
    }
  }

  private applyDoorState(a: ActorRuntime, name: DoorName, value: boolean | number | string, t: number): void {
    const key = `${a.id}|${name}`;
    const existing = this.doors.get(key);
    const current = existing ? this.doorOpenness(existing, t) : 0;
    let target: number;
    let transitioning = false;
    if (value === 'opening') {
      target = 1;
      transitioning = true;
    } else if (value === 'closing') {
      target = 0;
      transitioning = true;
    } else if (value === 'open' || value === true) {
      target = 1;
    } else if (typeof value === 'number') {
      target = Math.max(0, Math.min(1, value));
    } else {
      target = 0;
    }
    this.doors.set(key, {
      actorId: a.id,
      name,
      from: current,
      target,
      startedT: t,
      durationS: transitioning ? DOOR_OPEN_DURATION_S * Math.abs(target - current) : 0,
      transitioning,
    });

    // Collision snapshots are captured before triggers. Seed the closed/current
    // hinge pose at the trigger instant so next tick's sweep includes the
    // entire opening arc instead of treating the door as newly teleported.
    const snapshot = this.collisionSnapshots.get(a.id);
    if (snapshot?.live && !snapshot.shapes.has(`door:${name}`)) {
      const shapes = new Map(snapshot.shapes);
      shapes.set(`door:${name}`, articulatedDoorObb(a, name, current));
      this.collisionSnapshots.set(a.id, { ...snapshot, shapes });
    }
  }

  private resolveSpeedTarget(a: ActorRuntime, it: Interaction & { verb: 'speed' }): number {
    const limit = this.speedLimitAt(a);
    switch (it.target.mode) {
      case 'absolute':
        return it.target.value;
      case 'delta':
        return Math.max(0, a.speedMps + it.target.value);
      case 'factor':
        return Math.max(0, a.speedMps * it.target.value);
      case 'stop':
        return 0;
      case 'match': {
        const other = this.byId.get(it.target.actorId);
        return Math.max(0, (other?.speedMps ?? cruiseSpeed(a, limit)) + it.target.offsetMps);
      }
    }
  }

  private startLaneChange(
    a: ActorRuntime,
    it: Interaction & { verb: 'changeLane' },
    t: number,
  ): LateralCommand | null {
    const target = it.target;
    let retarget: { route: Route; s: number; separationM: number; targetRsl: string | null } | null = null;
    let side: 'left' | 'right' | undefined;
    let legal = true;

    if (target.mode === 'left' || target.mode === 'right') {
      side = target.mode;
      // Legality hook: illegal changes are rejected rather than silently taken,
      // so a generated scenario cannot hide a lane-marking violation.
      const r = retargetToNeighbour(this.graph, a.route, a.routeS, side, {
        legalOnly: true,
        remainingTurns: a.remainingTurns,
      });
      if (r) retarget = { route: r.route, s: r.s, separationM: r.separationM, targetRsl: r.targetRsl };
      else legal = false;
    } else if (target.mode === 'lane') {
      const currentRsl = a.route.poseAt(a.routeS).rsl;
      // A second true changeLane may abort an in-progress incursion by naming
      // the actor's still-active source lane. The route swap has not happened
      // yet, so a generic retarget-to-same-lane reports zero separation and
      // leaves the vehicle stranded across the boundary. Treat this as the
      // inverse lateral manoeuvre back to the source centre while retaining
      // the source route; completion still uses the ordinary route hand-off.
      if (
        currentRsl === target.rsl &&
        a.latCmd?.kind === 'changeLane' &&
        !a.latCmd.done &&
        Math.abs(a.lateralOffsetM) > 1e-3
      ) {
        retarget = {
          route: a.route,
          s: a.routeS,
          separationM: -a.lateralOffsetM,
          targetRsl: target.rsl,
        };
      } else {
        const r = retargetToLane(this.graph, a.route, a.routeS, target.rsl, {
          remainingTurns: a.remainingTurns,
        });
        if (
          r &&
          a.latCmd?.kind === 'changeLane' &&
          !a.latCmd.done &&
          Math.abs(r.separationM) <= 0.1 &&
          Math.abs(a.lateralOffsetM) > 1e-3
        ) {
          // The authored source lane may name an upstream RSL while the actor
          // has already advanced onto its directed successor. A zero-separation
          // retarget still means "abort to this source route", not "hold the
          // current partial offset".
          retarget = {
            route: a.route,
            s: a.routeS,
            separationM: -a.lateralOffsetM,
            targetRsl: currentRsl,
          };
        } else if (r) {
          retarget = { route: r.route, s: r.s, separationM: r.separationM, targetRsl: target.rsl };
        }
        else legal = false;
      }
    } else {
      const other = this.byId.get(target.actorId);
      const rsl = other ? other.route.poseAt(other.routeS).rsl : null;
      if (rsl) {
        const r = retargetToLane(this.graph, a.route, a.routeS, rsl, { remainingTurns: a.remainingTurns });
        if (r) retarget = { route: r.route, s: r.s, separationM: r.separationM, targetRsl: rsl };
      }
      if (!retarget) legal = false;
    }

    if (!retarget) {
      this.events.push({
        t,
        kind: 'lane_change_rejected',
        actorId: a.id,
        interactionId: it.id,
        reason: legal ? 'no_target_lane' : 'illegal_or_missing_neighbour',
      });
      this.issues.push(
        issue(
          'lane_change_illegal',
          `interactions.${it.id}.target`,
          `no legal lane-change target for ${a.id} at t=${t.toFixed(2)}`,
          { actorId: a.id, mode: target.mode },
          'warning',
        ),
      );
      return null;
    }

    const to = a.lateralOffsetM + retarget.separationM;
    const duration = transitionDuration(it.dynamics, retarget.separationM, Math.max(a.speedMps, 0.1));
    return {
      kind: 'changeLane',
      interactionId: it.id,
      firedAt: t,
      dynamics: it.dynamics,
      from: a.lateralOffsetM,
      to,
      duration,
      pending: retarget,
      remaining: target.mode === 'left' || target.mode === 'right' ? target.count - 1 : 0,
      side,
      done: false,
    };
  }

  /* ------------------------------------------------------------- stepping */

  private planAll(t: number): Plan[] {
    this.buildConflictSamples();
    const plans: Plan[] = [];
    for (const a of this.actors) {
      plans.push(this.planActor(a, t));
    }
    return plans;
  }

  /** All-way-stop arbitration: first complete arrival wins; actor id is the
   * stable same-tick tie break. Only one movement enters during the short
   * intersection-clearance window. */
  private canReleaseStop(controlId: string, coordinationId: string, actorId: string, t: number): boolean {
    const coordinatedControlIds = new Set(
      this.signals.stopLines
        .filter((line) => line.kind === 'stop' && line.coordinationId === coordinationId)
        .map((line) => line.controlId),
    );
    for (const actor of this.actors) {
      if (actor.id === actorId) continue;
      for (const id of coordinatedControlIds) {
        const state = actor.roadControlStates.get(id);
        if (state?.releasedAtS !== null && state?.releasedAtS !== undefined && t - state.releasedAtS < 2.5) {
          return false;
        }
      }
    }
    const waiting = this.actors
      .flatMap((actor) => [...coordinatedControlIds].map((id) => ({ actor, id, state: actor.roadControlStates.get(id) })))
      .filter((entry) => entry.state?.arrivedAtS !== null && entry.state?.arrivedAtS !== undefined && !entry.state.released)
      .sort((a, b) =>
        a.state!.arrivedAtS! - b.state!.arrivedAtS!
        || a.actor.id.localeCompare(b.actor.id)
        || a.id.localeCompare(b.id),
      );
    return waiting.length === 0 || (waiting[0]!.actor.id === actorId && waiting[0]!.id === controlId);
  }

  private buildConflictSamples(): void {
    this.conflictSamples.clear();
    this.conflictCandidates.clear();
    for (const a of this.actors) {
      if (!a.present || a.retired) continue;
      const pts: Vec2[] = [];
      for (let i = 0; i < CONFLICT_SAMPLES; i++) {
        const s = a.routeS + i * CONFLICT_STEP_M;
        if (s > a.route.lengthM) break;
        pts.push(a.route.pointWithOffset(s, a.lateralOffsetM));
      }
      this.conflictSamples.set(a.id, pts);
    }
    if (!this.hasAmbientTraffic) return;

    const bounds: SpatialBounds[] = [];
    for (const [id, points] of this.conflictSamples) {
      if (points.length === 0) continue;
      bounds.push({
        id,
        minX: Math.min(...points.map((point) => point.x)) - CONFLICT_RADIUS_M,
        minY: Math.min(...points.map((point) => point.y)) - CONFLICT_RADIUS_M,
        maxX: Math.max(...points.map((point) => point.x)) + CONFLICT_RADIUS_M,
        maxY: Math.max(...points.map((point) => point.y)) + CONFLICT_RADIUS_M,
      });
    }
    for (const pair of spatialCandidatePairs(bounds, CONFLICT_GRID_CELL_M)) {
      const a = this.byId.get(pair.a);
      const b = this.byId.get(pair.b);
      if (!a || !b) continue;
      const forA = this.conflictCandidates.get(a.id);
      if (forA) forA.push(b);
      else this.conflictCandidates.set(a.id, [b]);
      const forB = this.conflictCandidates.get(b.id);
      if (forB) forB.push(a);
      else this.conflictCandidates.set(b.id, [a]);
    }
  }

  /**
   * Crossing-path conflict: the nearest point where two future paths pass
   * within `CONFLICT_RADIUS_M`, when the other actor gets there first and the
   * arrival times are within `CONFLICT_WINDOW_S`.
   *
   * This is a coarse stand-in for a real junction conflict-point table (which
   * lives in `map-intel`'s `conflictPairs`). It is enough to make `rules.yield`
   * behave sensibly at intersections without importing that index.
   */
  private findConflict(a: ActorRuntime): { distM: number; deltaT: number; otherKind: ActorRuntime['kind'] } | null {
    const mine = this.conflictSamples.get(a.id);
    if (!mine || a.speedMps < 0.2) return null;
    let best: { distM: number; deltaT: number; otherKind: ActorRuntime['kind'] } | null = null;
    const candidates = this.hasAmbientTraffic
      ? (this.conflictCandidates.get(a.id) ?? [])
      : this.actors;
    const aIsAmbient = a.tags.includes('ambient');
    for (const b of candidates) {
      if (b.id === a.id || !b.present || b.retired) continue;
      const bIsAmbient = b.tags.includes('ambient');
      // Authored choreography always owns crossing priority over generated
      // background traffic. Rear-end following remains handled independently.
      if (!aIsAmbient && bIsAmbient) continue;
      // Roughly parallel travel is car-following, not a crossing conflict — the
      // leader term already owns it, and double-counting it would leave a
      // steady-state gap error.
      if (Math.abs(normalizeAngle(b.headingRad - a.headingRad)) < CONFLICT_MIN_ANGLE_RAD) continue;
      const theirs = this.conflictSamples.get(b.id);
      if (!theirs) continue;
      for (let i = 1; i < mine.length; i++) {
        const p = mine[i]!;
        for (let j = 0; j < theirs.length; j++) {
          const q = theirs[j]!;
          if (Math.abs(p.x - q.x) > CONFLICT_RADIUS_M || Math.abs(p.y - q.y) > CONFLICT_RADIUS_M) continue;
          if (Math.hypot(p.x - q.x, p.y - q.y) > CONFLICT_RADIUS_M) continue;
          const myDist = i * CONFLICT_STEP_M;
          const theirDist = j * CONFLICT_STEP_M;
          const myT = myDist / Math.max(a.speedMps, 0.2);
          const theirT = theirDist / Math.max(b.speedMps, 0.2);
          const authoredHasPriority = aIsAmbient && !bIsAmbient;
          if (!authoredHasPriority && theirT >= myT) continue;
          const delta = authoredHasPriority ? Math.abs(myT - theirT) : myT - theirT;
          if (delta > CONFLICT_WINDOW_S) continue;
          if (best === null || myDist < best.distM) {
            best = { distM: myDist, deltaT: delta, otherKind: b.kind };
          }
          break;
        }
        if (best) break;
      }
    }
    return best;
  }

  private planActor(a: ActorRuntime, t: number): Plan {
    const plan: Plan = {
      actor: a,
      speed: a.speedMps,
      accel: 0,
      routeS: a.routeS,
      lateralOffset: a.lateralOffsetM,
      lateralRate: a.lateralRateMps,
      position: a.position,
      heading: a.headingRad,
      requiredDecel: 0,
      retire: false,
      swap: null,
    };
    if (!a.present || a.retired) return plan;
    if (a.static) {
      plan.speed = 0;
      plan.accel = 0;
      plan.routeS = a.routeS;
      plan.lateralOffset = a.lateralOffsetM;
      plan.lateralRate = 0;
      plan.position = a.position;
      plan.heading = a.headingRad;
      return plan;
    }

    if (a.crashDisabledAtS != null) {
      const frictionScale = this.resolvedInput.operationalConditions.effects.frictionScale;
      const emergencyDecel = Math.min(limitsFor(a).brakeHard * frictionScale, Math.max(0, a.speedMps / this.dt));
      const speed = Math.max(0, a.speedMps - emergencyDecel * this.dt);
      plan.accel = -emergencyDecel;
      plan.speed = speed;
      plan.routeS = a.routeS;
      if (this.motionBackend && this.dynamicActorIds.has(a.id)) {
        const result = this.motionBackend.step(a.id, {
          motionDirection: isReverseMotion(a) ? -1 : 1,
          targetSpeedMps: 0,
          targetAccelerationMps2: -emergencyDecel,
          previewPoint: { x: a.position.x + Math.cos(a.headingRad), y: a.position.y + Math.sin(a.headingRad) },
          previewHeadingRad: a.headingRad,
        }, this.dt, frictionScale);
        plan.speed = Math.abs(result.state.longitudinalVelocityMps);
        plan.accel = result.state.longitudinalAccelerationMps2 * (isReverseMotion(a) ? -1 : 1);
        plan.position = { x: result.state.x, y: result.state.y };
        plan.heading = result.state.yawRad;
        const projected = a.route.projectPoint(plan.position);
        plan.routeS = projected.s;
        plan.lateralOffset = a.route.lateralOffsetAt(projected.s, plan.position);
        plan.lateralRate = result.state.lateralVelocityMps;
        this.physicsTelemetry.set(a.id, result.telemetry);
      }
      return plan;
    }

    const lim = limitsFor(a);
    const limit = this.curvatureSpeedCap(a, this.speedLimitAt(a));

    // Re-resolve dynamic longitudinal targets (match / gap follow a moving ref).
    if (a.longCmd?.kind === 'speed' && a.longCmd.speedTarget?.target.mode === 'match') {
      a.longCmd.target = this.resolveSpeedTarget(a, a.longCmd.speedTarget);
    }
    if (a.longCmd?.kind === 'gap' && a.longCmd.gap) {
      a.longCmd.target = desiredGapM(a, a.longCmd.gap.value, a.longCmd.gap.mode, true);
    }

    const commandedLeader =
      a.longCmd?.kind === 'gap' && a.longCmd.gap ? this.leaderFromId(a, a.longCmd.gap.actorId) : null;
    const nearestLeader = findLeader(a, this.actors);
    let accel = longitudinalAccel({
      actor: a,
      t,
      dt: this.dt,
      laneSpeedLimitMps: limit,
      leader: commandedLeader ?? nearestLeader,
    });

    const stopLineDist = distanceToStopLine(
      a, this.signals, t, LOOKAHEAD_M, nearestLeader,
      (controlId, coordinationId, actorId, at) => this.canReleaseStop(controlId, coordinationId, actorId, at),
    );
    const conflict = this.findConflict(a);
    const gov = governorCap(a, nearestLeader, stopLineDist, conflict);
    if (gov.accelCap < accel) accel = gov.accelCap;
    const frictionScale = this.resolvedInput.operationalConditions.effects.frictionScale;
    accel = Math.max(accel, -lim.brakeHard * frictionScale);
    plan.requiredDecel = gov.requiredDecel;

    let speed = a.speedMps + accel * this.dt;
    if (speed < 0) {
      speed = 0;
      accel = -a.speedMps / this.dt;
    }
    plan.accel = accel;
    plan.speed = speed;
    plan.routeS = a.routeS + speed * this.dt;

    const lat = lateralStep(a, t, this.dt);
    plan.lateralOffset = lat.offset;
    plan.lateralRate = lat.rate;
    if (a.latCmd?.kind === 'changeLane' && lat.complete && !a.latCmd.done) {
      plan.swap = a.latCmd.pending ?? null;
    }

    if (this.motionBackend && this.dynamicActorIds.has(a.id)) {
      const previewS = Math.min(
        a.route.lengthM,
        a.routeS + Math.max(5, Math.abs(a.speedMps) * 0.8),
      );
      const previewPose = a.route.poseAt(previewS);
      const result = this.motionBackend.step(a.id, {
        motionDirection: isReverseMotion(a) ? -1 : 1,
        targetSpeedMps: speed,
        targetAccelerationMps2: accel,
        previewPoint: a.route.pointWithOffset(previewS, plan.lateralOffset),
        previewHeadingRad: previewPose.headingRad,
      }, this.dt, frictionScale);
      const projected = a.route.projectPoint({ x: result.state.x, y: result.state.y });
      const projectedOffset = a.route.lateralOffsetAt(projected.s, {
        x: result.state.x,
        y: result.state.y,
      });
      const allowedCenterOffsetM = Math.max(0.2, a.route.widthAt(projected.s) / 2 - a.dims.w / 2 + 0.25);
      if (!a.tags.includes('motion:off-road') && Math.abs(projectedOffset) > allowedCenterOffsetM) {
        // Never publish the first off-corridor integration. Hold the last valid
        // map pose and retire this generated actor; a later population refresh
        // may replace it from a new connected candidate. Authored off-road and
        // wrong-way edge cases remain explicit opt-in intent.
        plan.speed = 0;
        plan.accel = -a.speedMps / this.dt;
        plan.routeS = a.routeS;
        plan.lateralOffset = a.lateralOffsetM;
        plan.lateralRate = 0;
        plan.position = a.position;
        plan.heading = a.headingRad;
        plan.retire = true;
        this.events.push({
          t,
          kind: 'road_departure_prevented',
          actorId: a.id,
          laneRsl: a.route.poseAt(a.routeS).rsl,
          lateralErrorM: Math.abs(projectedOffset),
          allowedCenterOffsetM,
        });
        return plan;
      }
      plan.speed = Math.abs(result.state.longitudinalVelocityMps);
      plan.accel = result.state.longitudinalAccelerationMps2 * (isReverseMotion(a) ? -1 : 1);
      plan.routeS = projected.s;
      plan.lateralOffset = projectedOffset;
      plan.lateralRate = result.state.lateralVelocityMps;
      plan.position = { x: result.state.x, y: result.state.y };
      plan.heading = result.state.yawRad;
      this.physicsTelemetry.set(a.id, result.telemetry);
      // The kinematic profile's duration is a target schedule, not permission
      // to teleport a force-based car onto the adjacent route. Keep tracking
      // after the schedule ends and hand routes off only once the body reaches
      // the requested lateral position.
      if (plan.swap && a.latCmd && Math.abs(plan.lateralOffset - a.latCmd.to) > 0.15) {
        plan.swap = null;
      }
    }

    if (plan.routeS >= a.route.lengthM - ROUTE_END_SLACK_M) {
      plan.routeS = a.route.lengthM;
      // A route is a motion path, not an implicit lifecycle instruction. Hold
      // every semantic class at its terminal pose for truthful aftermath
      // evidence; only an explicit exist(absent) interaction may despawn it.
      plan.accel = -a.speedMps / this.dt;
      plan.speed = 0;
      plan.lateralRate = 0;
      plan.retire = true;
      // The force solver can cross the terminal station within its final
      // synchronized tick. Retiring the actor must snap the rendered body to
      // the route endpoint just as the kinematic backend does, rather than
      // freezing a small dynamic overshoot forever.
      const terminalPose = a.route.poseAt(plan.routeS);
      plan.position = a.route.pointWithOffset(plan.routeS, plan.lateralOffset);
      plan.heading = normalizeAngle(
        headingWithSlip(terminalPose.headingRad, 0, 0) + (isReverseMotion(a) ? Math.PI : 0),
      );
    }

    if (!this.dynamicActorIds.has(a.id)) {
      const pose: RoutePose = a.route.poseAt(plan.routeS);
      plan.position = a.route.pointWithOffset(plan.routeS, plan.lateralOffset);
      plan.heading = normalizeAngle(
        headingWithSlip(pose.headingRad, plan.lateralRate, plan.speed) + (isReverseMotion(a) ? Math.PI : 0),
      );
    }
    return plan;
  }

  private leaderFromId(a: ActorRuntime, id: string): { gapM: number; speedMps: number } | null {
    const b = this.byId.get(id);
    if (!b || !b.present || b.retired) return null;
    const gap = alongRouteGapM(a, b);
    if (gap === null) return null;
    return { gapM: Math.max(gap, 0.05), speedMps: b.speedMps };
  }

  private applyAll(plans: readonly Plan[], t: number): void {
    for (const plan of plans) {
      const a = plan.actor;
      if (!a.present || a.retired) continue;
      a.speedMps = plan.speed;
      a.accelMps2 = plan.accel;
      a.routeS = plan.routeS;
      a.lateralOffsetM = plan.lateralOffset;
      a.lateralRateMps = plan.lateralRate;
      a.position = plan.position;
      a.headingRad = plan.heading;
      if (t >= 0) a.requiredDecelMax = Math.max(a.requiredDecelMax, plan.requiredDecel);

      if (a.speedMps < 0.05) {
        if (a.standstillSinceS === null) a.standstillSinceS = t;
      } else {
        a.standstillSinceS = null;
      }

      if (plan.swap && a.latCmd) {
        const cmd = a.latCmd;
        const fromRsl = a.route.poseAt(a.routeS).rsl;
        // `pending.s` is the target-route station at the *start* of the
        // manoeuvre.  Reusing it at completion teleports a moving actor back
        // to that old station, which can manufacture an overlap/contact at a
        // perfectly continuous lane change.  Project the completed world pose
        // onto the target route instead, preserving the travelled station and
        // any residual lateral offset through the route hand-off.
        const completedPosition = a.position;
        const projected = plan.swap.route.projectPoint(completedPosition);
        a.route = plan.swap.route;
        a.routeS = projected.s;
        a.lateralOffsetM = a.route.lateralOffsetAt(projected.s, completedPosition);
        a.position = a.route.pointWithOffset(a.routeS, a.lateralOffsetM);
        this.events.push({
          t,
          kind: 'lane_change',
          actorId: a.id,
          fromRsl,
          toRsl: plan.swap.targetRsl,
          legal: true,
        });
        if (cmd.remaining > 0 && cmd.side) {
          const next = retargetToNeighbour(this.graph, a.route, a.routeS, cmd.side, {
            legalOnly: true,
            remainingTurns: a.remainingTurns,
          });
          if (next) {
            a.latCmd = {
              ...cmd,
              firedAt: t,
              from: a.lateralOffsetM,
              to: a.lateralOffsetM + next.separationM,
              duration: transitionDuration(cmd.dynamics, next.separationM, Math.max(a.speedMps, 0.1)),
              pending: { route: next.route, s: next.s, separationM: next.separationM, targetRsl: next.targetRsl },
              remaining: cmd.remaining - 1,
              done: false,
            };
            continue;
          }
        }
        a.latCmd = null;
        this.releaseAxis(a, 'lateral', t, cmd.interactionId, 'complete');
      }

      if (plan.retire) {
        a.retired = true;
      }
    }
    this.resolveDynamicContacts();
  }

  /** Resolve all moving bodies together. Only explicit fixed/static actors,
   * props, and map proxies have infinite mass. */
  private resolveDynamicContacts(): void {
    if (!this.dynamicBackend) return;
    const activeActors = this.actors
      .filter((actor) => this.dynamicActorIds.has(actor.id) && actor.present && !actor.retired);
    const active = new Set(activeActors.map((actor) => actor.id));
    const nearbyStatics = new Map<string, StaticCollisionShape>();
    for (const actor of activeActors) {
      const current = this.collisionShapes(actor, this.world.t);
      for (const shape of this.staticCollisionCandidates(
        actor.id,
        current,
        this.collisionSnapshots.get(actor.id)?.shapes,
      )) nearbyStatics.set(shape.id, shape);
    }
    const fixedActors = this.actors
      .filter((actor) => !this.dynamicActorIds.has(actor.id) && actor.present && !actor.retired)
      .map((actor) => {
        const direction = isReverseMotion(actor) ? -1 : 1;
        return {
          id: actor.id,
          obb: this.obbOf(actor),
          velocity: {
            x: Math.cos(actor.headingRad) * actor.speedMps * direction,
            y: Math.sin(actor.headingRad) * actor.speedMps * direction,
          },
        };
      });
    this.dynamicBackend.resolveCollisions(
      active,
      [
        ...[...nearbyStatics.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((shape) => ({ id: shape.id, obb: shape.obb })),
        ...fixedActors,
      ],
      this.dt,
    );
    for (const actor of this.actors) {
      if (!active.has(actor.id)) continue;
      const state = this.dynamicBackend.state(actor.id)!;
      actor.position = { x: state.x, y: state.y };
      actor.headingRad = state.yawRad;
      actor.speedMps = Math.abs(state.longitudinalVelocityMps);
      actor.lateralRateMps = state.lateralVelocityMps;
      const projected = actor.route.projectPoint(actor.position);
      actor.routeS = projected.s;
      actor.lateralOffsetM = actor.route.lateralOffsetAt(projected.s, actor.position);
      const telemetry = this.dynamicBackend.telemetry(actor.id);
      if (telemetry) this.physicsTelemetry.set(actor.id, telemetry);
    }
  }

  /* --------------------------------------------------------------- output */

  private record(t: number, collisions: ReadonlySet<string>, observeMetrics: boolean): void {
    this.tArray.push(t);
    for (const id of this.signals.ids()) {
      const phase = this.signals.phaseAt(id, t);
      if (phase) this.signalTracks.get(id)!.phase.push(phase);
    }
    for (const a of this.actors) {
      const track = this.tracks.get(a.id)!;
      const pose = a.route.poseAt(a.routeS);
      track.x.push(a.position.x);
      track.y.push(a.position.y);
      track.headingRad.push(a.headingRad);
      track.speedMps.push(a.speedMps);
      track.motionDirection!.push(isReverseMotion(a) ? -1 : 1);
      track.laneRsl.push(pose.rsl);
      track.s.push(a.routeS);
      // `retired` means motion/interaction has finished. Pedestrians remain
      // visibly present at their terminal pose until an explicit despawn.
      track.present.push(a.present ? 1 : 0);
      if (track.physics) {
        const state = this.motionBackend?.state(a.id);
        const telemetry = this.physicsTelemetry.get(a.id) ?? this.motionBackend?.telemetry(a.id);
        track.physics.vxBodyMps.push(state?.longitudinalVelocityMps ?? 0);
        track.physics.vyBodyMps.push(state?.lateralVelocityMps ?? 0);
        track.physics.yawRateRadps.push(state?.yawRateRadps ?? 0);
        track.physics.steerRad.push(state?.steerRad ?? 0);
        track.physics.wheelAngularSpeedRadps.push(state?.wheelAngularSpeedRadps ?? 0);
        track.physics.tireUtilization.push(telemetry?.tireUtilization ?? 0);
        track.physics.frontNormalForceN.push(telemetry?.frontNormalForceN ?? 0);
        track.physics.rearNormalForceN.push(telemetry?.rearNormalForceN ?? 0);
        track.physics.collisionImpulseNs.push(telemetry?.collisionImpulseNs ?? 0);
        track.physics.collisionCount.push(telemetry?.collisionCount ?? 0);
      }
    }
    if (observeMetrics) {
      observeTick(
        this.metrics,
        t,
        this.actors,
        collisions,
        this.occludersForTick(),
        this.resolvedInput.operationalConditions.effects.visibilityRangeM,
        new Map(this.actors
          .filter((actor) => actor.static)
          .map((actor) => [actor.id, this.collisionShapes(actor, t)])),
      );
    }
  }

  private finishNeverFired(): void {
    for (const tr of this.triggers) {
      if (tr.status === 'pending') {
        tr.status = 'skipped';
        this.metrics.triggerNeverFired.push(tr.interaction.id);
      }
    }
    this.metrics.triggerNeverFired.sort();
  }

  private buildTrace(): SimTrace {
    const input = this.resolvedInput;
    const actorIds = this.actors.map((a) => a.id);
    const actorMetadata = Object.fromEntries(
      [...this.actors]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((a) => [a.id, {
          kind: a.kind,
          dims: { ...a.dims },
          static: a.static,
          tags: [...a.tags],
        }]),
    );
    const propMetadata = Object.fromEntries(
      input.props.map((prop) => [
        prop.id,
        { ...prop, dims: { ...prop.dims }, pose: { ...prop.pose } },
      ]),
    );
    const actors: Record<string, ActorTrack> = {};
    for (const id of [...actorIds].sort()) actors[id] = this.tracks.get(id)!;
    const signals: Record<string, SignalTrack> = {};
    for (const id of this.signals.ids()) signals[id] = this.signalTracks.get(id)!;
    for (const a of this.actors) {
      this.metrics.requiredDecelMax[a.id] = a.requiredDecelMax;
    }
    return {
      header: {
        traceVersion: TRACE_FORMAT_VERSION,
        engineVersion: ENGINE_VERSION,
        inputHash: contentHash(input),
        seed: input.seed,
        mapId: input.mapId,
        engineGraphDigest: this.graph.topologyDigest,
        topologyDigest: this.graph.topologyDigest,
        dt: this.dt,
        clipSeconds: input.clipSeconds,
        warmupSeconds: input.warmupSeconds,
        frame: 'xodr-local',
        actorIds: [...actorIds].sort(),
        actorMetadata,
        propMetadata,
        metricSubject: input.metricSubject ?? null,
        operationalConditions: input.operationalConditions,
        physics: {
          mode: this.physicsConfig.mode,
          solver: 'uniscenarios-sim-engine',
          solverVersion: ENGINE_VERSION,
          substepS: this.motionBackend?.substepS ?? this.dt,
          vehicleProfileDigest: this.physicsConfig.vehicleProfiles
            ? contentHash(this.physicsConfig.vehicleProfiles)
            : null,
          resolvedProfileDigest: contentHash({
            version: 1,
            profiles: ACTOR_PHYSICS_PROFILES,
            overrides: this.physicsConfig.vehicleProfiles ?? {},
          }),
          actorBackends: actorPhysicsBackends(this.actors, this.physicsConfig),
          crashes: Object.fromEntries(this.actors
            .filter((actor) => actor.crashDisabledAtS != null)
            .map((actor) => {
              const otherId = actor.crashDisabledReason?.slice('material-collision:'.length) ?? 'unknown';
              return [actor.id, { t: actor.crashDisabledAtS!, otherId, reason: 'material-collision' as const }];
            })),
        },
      },
      ticks: { t: this.tArray, actors, signals },
      events: this.events,
      metrics: computeMetrics(this.metrics, input.clipSeconds),
    };
  }
}

/** Line-of-sight helper re-exported for callers building occlusion UIs. */
export { hasLineOfSight };
