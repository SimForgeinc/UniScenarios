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
  type Interaction,
  type SimActor,
  type SimScenarioInput,
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
import { alongRouteGapM, pairKey, readPair } from './pairs.js';
import { SignalBook } from './signals.js';
import {
  axisOf,
  actorRadius,
  type ActorRuntime,
  type AxisId,
  type LateralCommand,
  type LongitudinalCommand,
  type WorldState,
} from './state.js';
import { makeTriggerRuntime, shouldFire, type ConditionContext, type TriggerRuntime } from './triggers.js';
import { evaluateCondition } from './triggers.js';
import { buildOccluders, hasLineOfSight, type OccluderShape } from './visibility.js';
import type { ActorTrack, SimEvent, SimTrace } from '../trace/trace.js';
import { computeMetrics, type MetricAccumulator, newMetricAccumulator, observeTick } from '../trace/metrics.js';
import { checkFeasibility } from '../solve/guards.js';
import { resolveArrivalTriggers, type ArrivalSolution } from '../solve/arrival.js';

export interface RunOptions {
  readonly graph: LaneGraph;
  /**
   * `throw` (default) aborts on any error-severity feasibility issue, `collect`
   * runs anyway and returns them, `skip` does not check.
   */
  readonly guards?: 'throw' | 'collect' | 'skip';
  /** Pre-solve `arrival` triggers into fixed times + spawn-s offsets. */
  readonly resolveArrival?: boolean;
}

export interface SimResult {
  readonly trace: SimTrace;
  readonly issues: SimIssue[];
  readonly arrival: ArrivalSolution[];
}

/** Actors this far past the end of their route are retired. */
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

export function runSimulation(input: SimScenarioInput, opts: RunOptions): SimResult {
  const sim = new Simulation(input, opts);
  return sim.run();
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
  private readonly events: SimEvent[] = [];
  private readonly issues: SimIssue[] = [];
  private readonly tracks = new Map<string, ActorTrack>();
  private readonly tArray: number[] = [];
  private readonly metrics: MetricAccumulator;
  private readonly rng: Rng;
  private readonly resolvedInput: SimScenarioInput;
  private readonly arrivalSolutions: ArrivalSolution[];
  private world: WorldState;
  private conflictSamples = new Map<string, Vec2[]>();

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
    this.dt = input.dt;
    this.warmupTicks = Math.round(input.warmupSeconds / input.dt);
    this.clipTicks = Math.round(input.clipSeconds / input.dt);
    this.rng = new Rng(input.seed);
    this.signals = new SignalBook(input.signalPrograms, input.warmupSeconds);
    this.occluders = buildOccluders(input.occluders);

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

    for (const spec of [...input.actors].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const rt = this.buildActor(spec);
      this.actors.push(rt);
      this.byId.set(rt.id, rt);
      this.tracks.set(rt.id, {
        x: [],
        y: [],
        headingRad: [],
        speedMps: [],
        laneRsl: [],
        s: [],
        present: [],
      });
    }

    for (const it of [...input.interactions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const tr = makeTriggerRuntime(it);
      this.triggers.push(tr);
      this.triggerById.set(it.id, tr);
    }

    this.metrics = newMetricAccumulator(this.actors.map((a) => a.id), input.occlusionPairs);
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

    let routeS: number;
    let lateral: number;
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
        const proj = route.projectPoint(posePoint);
        routeS = proj.s;
        lateral = route.lateralOffsetAt(proj.s, posePoint);
      } else {
        routeS = s;
        lateral = laneRef.tFrac * route.widthAt(s);
      }
    } else {
      const proj = route.projectPoint(posePoint);
      routeS = proj.s;
      lateral = route.lateralOffsetAt(proj.s, posePoint);
    }

    const pose = route.poseAt(routeS);
    const rules = { ...spec.behavior.rules };
    const rt: ActorRuntime = {
      id: spec.id,
      kind: spec.kind,
      dims: spec.dims,
      tags: spec.tags,
      static: spec.static,
      rules,
      cruiseSpeedMps: 0,
      cruiseOverrideMps: spec.behavior.cruiseSpeedMps ?? null,
      route,
      routeS,
      remainingTurns:
        spec.behavior.route.kind === 'follow' ? [...spec.behavior.route.turns] : ([] as TurnRelation[]),
      speedMps: spec.static ? 0 : spec.initial.speedMps,
      accelMps2: 0,
      lateralOffsetM: lateral,
      lateralRateMps: 0,
      position: route.pointWithOffset(routeS, lateral),
      headingRad: pose.headingRad,
      present: spec.presentAtStart,
      retired: false,
      longCmd: null,
      latCmd: null,
      untilByAxis: new Map(),
      stateKeys: new Map(),
      standstillSinceS: null,
      requiredDecelMax: 0,
    };
    rt.cruiseSpeedMps = spec.static ? 0 : cruiseSpeed(rt, this.speedLimitAt(rt));
    return rt;
  }

  private speedLimitAt(a: ActorRuntime): number {
    const pose = a.route.poseAt(a.routeS);
    if (!pose.rsl) return a.kind === 'pedestrian' ? 1.4 : 13.4;
    const g = this.graph.geometry(pose.rsl);
    return g ? g.speedLimitMps : 13.4;
  }

  /* -------------------------------------------------------------- main loop */

  run(): SimResult {
    const total = this.warmupTicks + this.clipTicks;
    for (let i = 0; i <= total; i++) {
      const t = (i - this.warmupTicks) * this.dt;
      this.world = { ...this.world, t };
      const collisions = this.detectCollisions(t);
      if (t >= 0) {
        this.evaluateTriggers(t, collisions);
        this.evaluateUntil(t, collisions);
        // Record the state *at* `t`, before this tick's integration step, so
        // the sample at `t = 0` is exactly the prologue's final state.
        this.record(t, collisions);
      }
      if (i === total) break;
      const plans = this.planAll(t);
      this.applyAll(plans, t);
    }
    this.finishNeverFired();
    return {
      trace: this.buildTrace(),
      issues: this.issues,
      arrival: this.arrivalSolutions,
    };
  }

  /* ------------------------------------------------------------- collisions */

  private obbOf(a: ActorRuntime): Obb {
    return { center: a.position, lengthM: a.dims.l, widthM: a.dims.w, headingRad: a.headingRad };
  }

  private occludersForTick(): readonly OccluderShape[] {
    const staticActors = this.actors.filter((a) => a.static && a.present && !a.retired);
    if (staticActors.length === 0) return this.occluders;
    const dynamic = staticActors
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
    return [...this.occluders, ...dynamic];
  }

  private detectCollisions(t: number): Set<string> {
    const live = this.actors.filter((a) => a.present && !a.retired);
    const set = new Set<string>();
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!;
        const b = live[j]!;
        // Cheap circle reject before the SAT test.
        const r = actorRadius(a) + actorRadius(b);
        if (readPair(a, b).centerDistM > r) continue;
        if (!obbOverlap(this.obbOf(a), this.obbOf(b))) continue;
        const key = pairKey(a.id, b.id);
        set.add(key);
        if (!this.world.activeCollisions.has(key) && t >= 0) {
          this.events.push({ t, kind: 'collision', a: a.id < b.id ? a.id : b.id, b: a.id < b.id ? b.id : a.id });
          this.metrics.collisions.push({ t, a: a.id < b.id ? a.id : b.id, b: a.id < b.id ? b.id : a.id });
        }
      }
    }
    this.world.activeCollisions.clear();
    for (const k of [...set].sort()) this.world.activeCollisions.add(k);
    return set;
  }

  /* --------------------------------------------------------------- triggers */

  private conditionContext(t: number, collisions: ReadonlySet<string>): ConditionContext {
    return {
      t,
      world: { ...this.world, t },
      signals: this.signals,
      occluders: this.occludersForTick(),
      collisions,
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
        this.applyStateKey(a, key, value);
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

  private applyStateKey(a: ActorRuntime, key: string, value: boolean | number | string): void {
    switch (key) {
      case 'rules.obeySignals':
        a.rules = { ...a.rules, obeySignals: Boolean(value) };
        break;
      case 'rules.yield':
        a.rules = { ...a.rules, yield: Boolean(value) };
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
        // `lights.*`, `doors.*`, `pose.*`, `env.*`, `signal:*.phase` are
        // recorded state only — the renderer and exporter read them back out of
        // the event log; no controller consumes them yet.
        break;
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
      const r = retargetToLane(this.graph, a.route, a.routeS, target.rsl, {
        remainingTurns: a.remainingTurns,
      });
      if (r) retarget = { route: r.route, s: r.s, separationM: r.separationM, targetRsl: target.rsl };
      else legal = false;
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

  private buildConflictSamples(): void {
    this.conflictSamples.clear();
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
  private findConflict(a: ActorRuntime): { distM: number; deltaT: number } | null {
    const mine = this.conflictSamples.get(a.id);
    if (!mine || a.speedMps < 0.2) return null;
    let best: { distM: number; deltaT: number } | null = null;
    for (const b of this.actors) {
      if (b.id === a.id || !b.present || b.retired) continue;
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
          if (theirT >= myT) continue;
          const delta = myT - theirT;
          if (delta > CONFLICT_WINDOW_S) continue;
          if (best === null || myDist < best.distM) best = { distM: myDist, deltaT: delta };
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

    const lim = limitsFor(a);
    const limit = this.speedLimitAt(a);

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

    const stopLineDist = distanceToStopLine(a, this.signals, t, LOOKAHEAD_M);
    const conflict = this.findConflict(a);
    const gov = governorCap(a, nearestLeader, stopLineDist, conflict);
    if (gov.accelCap < accel) accel = gov.accelCap;
    accel = Math.max(accel, -lim.brakeHard);
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

    if (plan.routeS >= a.route.lengthM - ROUTE_END_SLACK_M) {
      plan.routeS = a.route.lengthM;
      plan.retire = true;
    }

    const pose: RoutePose = a.route.poseAt(plan.routeS);
    plan.position = a.route.pointWithOffset(plan.routeS, plan.lateralOffset);
    plan.heading = normalizeAngle(headingWithSlip(pose.headingRad, plan.lateralRate, plan.speed));
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
        a.route = plan.swap.route;
        a.routeS = plan.swap.s;
        a.lateralOffsetM -= plan.swap.separationM;
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
        a.present = false;
        this.events.push({ t, kind: 'despawn', actorId: a.id, reason: 'route_end' });
      }
    }
  }

  /* --------------------------------------------------------------- output */

  private record(t: number, collisions: ReadonlySet<string>): void {
    this.tArray.push(t);
    for (const a of this.actors) {
      const track = this.tracks.get(a.id)!;
      const pose = a.route.poseAt(a.routeS);
      track.x.push(a.position.x);
      track.y.push(a.position.y);
      track.headingRad.push(a.headingRad);
      track.speedMps.push(a.speedMps);
      track.laneRsl.push(pose.rsl);
      track.s.push(a.routeS);
      track.present.push(a.present && !a.retired ? 1 : 0);
    }
    observeTick(this.metrics, t, this.actors, collisions, this.occludersForTick());
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
    const actors: Record<string, ActorTrack> = {};
    for (const id of [...actorIds].sort()) actors[id] = this.tracks.get(id)!;
    for (const a of this.actors) {
      this.metrics.requiredDecelMax[a.id] = a.requiredDecelMax;
    }
    return {
      header: {
        traceVersion: 1,
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
        metricSubject: input.metricSubject ?? null,
      },
      ticks: { t: this.tArray, actors },
      events: this.events,
      metrics: computeMetrics(this.metrics, input.clipSeconds),
    };
  }
}

/** Line-of-sight helper re-exported for callers building occlusion UIs. */
export { hasLineOfSight };
