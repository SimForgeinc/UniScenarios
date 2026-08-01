/**
 * The materializer: `template × site × draw → SimScenarioInput`.
 *
 * This is the one piece of the stack that did not exist before the CLI. Every
 * package below it is deliberately incomplete on its own — the matcher does the
 * *structural* pass and stops, the engine takes a fully-resolved document and
 * refuses anything less — and this module is the join.
 *
 * ## The pipeline
 *
 * ```
 * 1. PARAMS    per-cell seed = sha256(templateId|paramsVersion|siteId|drawIndex)
 *              → xoshiro128**, one forked stream per declaration
 * 2. FRAME     the site's AnchorFrame reference path is rebuilt as a sim-engine
 *              Route, which is what turns frame `s` into a world point
 * 3. ROLES     each FeatureBinding becomes a concrete actor: route from the
 *              binding's lane chain, spawn by *projecting the frame point onto
 *              that route* (not by re-deriving arc length), speeds and offsets
 *              from expressions evaluated in the role's own lane scope
 * 4. TIMELINE  v2 interactions → engine interactions, verb by verb; `set rules.*`
 *              at t ≤ 0 folds into the actor's initial rules so the arrival
 *              solve sees the behaviour it will actually run with
 * 5. ARRIVAL   every `conflicting_gate` role carrying `arriveAtConflict` is
 *              back-solved with `sim-engine`'s bisection on spawn `s`, aimed at
 *              the matcher's precomputed conflict point
 * 6. GUARDS    `checkFeasibility` — runway, decel budget, spawn overlap,
 *              route connectivity — reported as structured findings
 * ```
 *
 * ## Why projection rather than arithmetic
 *
 * A role's pose is `(k, s)` in the anchor frame. The obvious way to place it is
 * to add up lane lengths until `s` is consumed. That is wrong for every role
 * that is not on the reference lane: `k = +1` and `opposing` lanes have their
 * own arc-length origins, and the two packages measure lane length from
 * slightly different polylines. So the frame `s` is resolved to a **world
 * point** on the reference route, and that point is projected onto the actor's
 * own route. Cross-sections stay aligned by construction, and the two packages
 * only have to agree about geometry, never about bookkeeping.
 */

import {
  DEFAULT_ACTOR_DIMS,
  evaluateExpr,
  isExpr,
  rolePose,
  type Expr,
  type ExprScope,
  type Interaction as V2Interaction,
  type NumberOrExpr,
  type ScenarioTemplateV2,
  type SignalRef,
  type Condition as V2Condition,
  type PointRef,
  type PropPlacement,
  type FramePose,
  type RoleBinding as V2Role,
  type Trigger as V2Trigger,
} from '@uniscenarios/scenario-model';
import {
  MATCH_SEMANTICS_VERSION,
  type FeatureBinding,
  type MatchedSite,
} from '@uniscenarios/anchor-matcher';
import {
  ENGINE_VERSION,
  Route,
  buildLanePathRoute,
  contentHash,
  checkFeasibility,
  parseSimScenarioInput,
  normalizeSimScenarioInput,
  safeParseSimScenarioInput,
  solveArrival,
  applyArrivalSolution,
  resolveArrivalTriggers,
  toSceneXZ,
  type ArrivalSolution,
  type Condition as SimCondition,
  type Interaction as SimInteraction,
  type LaneGraph,
  type Occluder,
  type OcclusionPair,
  type SimActor,
  type SimIssue,
  type SimScenarioInput,
  type Trigger as SimTrigger,
} from '@uniscenarios/sim-engine';

import { CliError } from './errors.js';
import type { MapBundle } from './maps.js';
import { paramsVersion, resolveParams, templateId, type ParamDraw } from './params.js';
import { propDims } from './prop-dims.js';
import { buildSiteSignalPlan, type SiteSignalPlan } from './map-signals.js';

const KPH_TO_MPS = 1 / 3.6;

/** The full replay key: everything an instance needs to be re-derived exactly. */
export interface ReplayKey {
  readonly templateId: string;
  readonly templateVersion: number;
  /** Content hash of the whole authored template — the version field alone lies. */
  readonly templateDigest: string;
  readonly mapId: string;
  /** Matcher/map-intel digest used to derive the site id. */
  readonly matcherIndexDigest: string;
  /** Engine lane-graph digest written into traces. */
  readonly engineGraphDigest: string;
  readonly siteId: string;
  readonly matcherVersion: string;
  readonly solverVersion: string;
  readonly paramSeed: string;
  readonly drawIndex: number;
}

export interface InstanceManifest {
  readonly kind: 'scenario-instance-manifest';
  readonly manifestVersion: 1;
  readonly replayKey: ReplayKey;
  readonly instanceId: string;
  readonly archetype: string | null;
  readonly negativeControl: boolean;
  readonly metricSubject: string | null;
  readonly site: {
    readonly siteId: string;
    readonly score: number;
    readonly verdict: string;
    readonly originFeatureId: string;
    readonly entryLaneRsl: string;
    readonly egoTurn: string | null;
    readonly degradationSummary: string;
    readonly matchedReasons: string[];
  };
  readonly params: {
    readonly values: Record<string, number>;
    readonly categorical: Record<string, string>;
    readonly rejectedConstraints: string[];
  };
  readonly actors: Array<{
    readonly id: string;
    readonly roleKind: string;
    readonly laneRsl: string | null;
    readonly spawnS: number;
    readonly initialSpeedMps: number;
    readonly bindingStatus: string;
  }>;
  readonly arrival: ArrivalSolution[];
  /** `sha256(canonicalJson(parsedInput))` — matches `trace.header.inputHash`. */
  readonly inputHash: string;
  readonly feasible: boolean;
  readonly issues: SimIssue[];
  /** Anything the materializer could not express, with a reason. */
  readonly notes: Array<{ path: string; reason: string }>;
}

export interface MaterializeResult {
  readonly input: SimScenarioInput;
  readonly manifest: InstanceManifest;
}

export interface MaterializeOptions {
  readonly drawIndex?: number;
  /** Overrides the derived per-cell seed. `--seed` on the command line. */
  readonly seed?: string | undefined;
}

interface Note {
  path: string;
  reason: string;
}

/* ------------------------------------------------------------------ scopes */

function laneScope(bundle: MapBundle, laneRsl: string | undefined): ExprScope['lane'] {
  const lane = laneRsl ? bundle.index.lanes[laneRsl] : undefined;
  return {
    speedLimitKph: lane?.speedLimitKph,
    widthM: lane?.representativeWidthM,
  };
}

function junctionScope(bundle: MapBundle, site: MatchedSite): ExprScope['junction'] {
  const id = site.frame.origin.mapFeatureId.startsWith('junction:')
    ? site.frame.origin.mapFeatureId.slice('junction:'.length)
    : null;
  const descriptor = id ? bundle.index.junctionDescriptors[id] : undefined;
  return { sizeM: descriptor?.sizeM };
}

/* ------------------------------------------------------------------ routes */

/**
 * Build a sim-engine route from a matcher lane chain.
 *
 * The two packages verify lane adjacency with different tolerances, so a chain
 * the matcher accepted can fail here. Rather than reject the whole site we keep
 * the longest connectable run that still contains `mustInclude` — the actor
 * gets a shorter route, the runway guard reports it, and the failure surfaces
 * as a measurable finding instead of an unbindable template.
 */
function routeFromChain(
  graph: LaneGraph,
  lanes: readonly string[],
  mustInclude: string | undefined,
  notes: Note[],
  path: string,
): Route | null {
  if (lanes.length === 0) return null;
  const full = buildLanePathRoute(graph, lanes);
  if (full.ok) return full.route;

  const anchorIndex = mustInclude ? lanes.indexOf(mustInclude) : 0;
  const pivot = anchorIndex >= 0 ? anchorIndex : 0;
  let best: Route | null = null;
  let bestLen = 0;
  for (let from = 0; from <= pivot; from += 1) {
    for (let to = lanes.length; to > pivot; to -= 1) {
      const slice = lanes.slice(from, to);
      if (slice.length === 0) continue;
      const built = buildLanePathRoute(graph, slice);
      if (built.ok && built.route.lengthM > bestLen) {
        best = built.route;
        bestLen = built.route.lengthM;
      }
    }
  }
  if (best) {
    notes.push({
      path,
      reason: `lane chain was not connectable end to end for the engine; kept the longest connectable run (${bestLen.toFixed(1)} m of ${lanes.length} lanes)`,
    });
    return best;
  }
  notes.push({ path, reason: `no connectable lane chain: ${full.error.reason}` });
  return null;
}

/**
 * Extend a lane chain **backwards** until the route actually contains `target`.
 *
 * The matcher builds a role's lane chain from the role's `dsM`, and `dsM` is
 * whatever the adapter could evaluate *statically*. A portable template writes
 * its spawn as `-(0.8 * lane.speedLimitKph / 3.6) * 8` — a site-dependent
 * expression, indeterminate before a site exists — so the structural pass sees
 * `0` and hands back a chain that starts at the stop line. Placing the actor at
 * the real, site-evaluated `s` then projects onto a route that does not reach
 * that far back, and `projectPoint` silently clamps to the route start: the ego
 * spawns *past* the junction it was supposed to approach, and every downstream
 * number is quietly wrong.
 *
 * So the materializer checks its own work: if the target point projects onto an
 * endpoint of the route rather than into its interior, the chain is too short
 * and gets a predecessor prepended, up to `MAX_BACKWARD_STEPS` times.
 */
const MAX_BACKWARD_STEPS = 12;
/** A projection this close to either end of a route is a clamp, not a hit. */
const ENDPOINT_CLAMP_M = 1;

function coverTarget(
  bundle: MapBundle,
  lanes: readonly string[],
  target: { x: number; y: number },
): { lanes: string[]; route: Route } | null {
  let current = [...lanes];
  let route: Route | null = null;
  for (let step = 0; step <= MAX_BACKWARD_STEPS; step += 1) {
    const built = buildLanePathRoute(bundle.graph, current);
    if (!built.ok) break;
    route = built.route;
    const projection = route.projectPoint(target);
    if (
      projection.s > ENDPOINT_CLAMP_M &&
      projection.s < route.lengthM - ENDPOINT_CLAMP_M
    ) {
      return { lanes: current, route };
    }
    // Prepend the geometrically-verified predecessor closest to our entry.
    const head = current[0] as string;
    const lane = bundle.index.lanes[head];
    if (!lane) break;
    const options = lane.predecessors
      .filter((rsl) => !current.includes(rsl) && bundle.index.lanes[rsl]?.laneType === 'driving')
      .sort();
    if (options.length === 0) break;
    const entry = lane.polyline[0];
    const best = options
      .map((rsl) => {
        const other = bundle.index.lanes[rsl];
        const exit = other?.polyline[other.polyline.length - 1];
        const gap =
          entry && exit ? Math.hypot(exit.x - entry.x, exit.y - entry.y) : Number.POSITIVE_INFINITY;
        return { rsl, gap };
      })
      .sort((a, b) => a.gap - b.gap || (a.rsl < b.rsl ? -1 : 1))[0];
    if (!best || !Number.isFinite(best.gap)) break;
    current = [best.rsl, ...current];
  }
  return route ? { lanes: current, route } : null;
}

/**
 * Walk successors until `needM` metres of route exist past `fromS`.
 *
 * The matcher stops walking at its own run-up constant (150 m) because it only
 * needs enough road to place a role and to score a corridor. A 20-second clip at
 * 55 kph covers 305 m, so a route that ends where the matcher stopped looking
 * makes `runway_insufficient` fire on a site that is perfectly fine — the road
 * carries on, nobody walked it. Extending here (deterministically: straightest
 * continuation, ties broken by `rsl`) is the materializer's job, because it is
 * the only layer that knows both the clip length and the actor's speed.
 */
function extendChainForward(
  graph: LaneGraph,
  lanes: readonly string[],
  route: Route,
  fromS: number,
  needM: number,
): string[] {
  let have = route.lengthM - fromS;
  if (have >= needM || route.legs.length === 0) return [...lanes];
  const out = [...lanes];
  const seen = new Set(out);
  let current = route.legs[route.legs.length - 1] as { rsl: string; reversed: boolean };
  for (let step = 0; step < 64 && have < needM; step += 1) {
    const options = graph
      .successors(current)
      .filter((next) => !seen.has(next.rsl) && graph.geometry(next.rsl));
    if (options.length === 0) break;
    const exitHeading = graph.sampleDirected(current, graph.lengthOf(current.rsl)).headingRad;
    const straightness = (candidate: { rsl: string; reversed: boolean }): number => {
      const entry = graph.sampleDirected(candidate, 0).headingRad;
      const d = Math.abs(Math.atan2(Math.sin(entry - exitHeading), Math.cos(entry - exitHeading)));
      return d;
    };
    options.sort((a, b) => straightness(a) - straightness(b) || (a.rsl < b.rsl ? -1 : 1));
    const next = options[0] as { rsl: string; reversed: boolean };
    out.push(next.rsl);
    seen.add(next.rsl);
    have += graph.lengthOf(next.rsl);
    current = next;
  }
  return out;
}

/* ------------------------------------------------------------ verb helpers */

function evalNum(
  value: NumberOrExpr | undefined,
  scope: ExprScope,
  path: string,
  fallback?: number,
): number {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new CliError('missing_value', 'a required numeric value is absent', { path });
  }
  try {
    return evaluateExpr(value as Expr | number, scope);
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new CliError('expression_unresolvable', `${error instanceof Error ? error.message : String(error)}`, {
      path,
      detail: { expression: isExpr(value) ? 'expr' : String(value) },
    });
  }
}

function evalTFrac(
  value: NumberOrExpr | undefined,
  scope: ExprScope,
  path: string,
  fallback = 0,
): number {
  const t = evalNum(value, scope, path, fallback);
  if (!Number.isFinite(t)) return fallback;
  return Math.max(-1, Math.min(1, t));
}

const CMP: Record<string, 'lte' | 'gte'> = { '<': 'lte', '<=': 'lte', '>': 'gte', '>=': 'gte' };

/* ------------------------------------------------------------- the builder */

class Materializer {
  private readonly notes: Note[] = [];
  private readonly actors: SimActor[] = [];
  private readonly interactions: SimInteraction[] = [];
  private readonly occluders: Occluder[] = [];
  private readonly occlusionPairs: OcclusionPair[] = [];
  private readonly bindingByRole = new Map<string, FeatureBinding>();
  private readonly roleById = new Map<string, V2Role>();
  private readonly routeByRole = new Map<string, Route>();
  private readonly laneByRole = new Map<string, string | undefined>();
  private readonly spawnSByRole = new Map<string, number>();
  private readonly scopeByRole = new Map<string, ExprScope>();
  private readonly initialRules = new Map<string, Record<string, boolean | number>>();
  private readonly foldedInteractions = new Set<string>();
  private readonly foldedTriggerStart = new Map<string, number>();
  private signalPlan: SiteSignalPlan | null = null;
  private refRoute: Route | null = null;

  constructor(
    private readonly template: ScenarioTemplateV2,
    private readonly bundle: MapBundle,
    private readonly site: MatchedSite,
    private readonly draw: ParamDraw,
  ) {
    for (const binding of site.bindings) this.bindingByRole.set(binding.role, binding);
    for (const role of template.roles) this.roleById.set(role.id, role);
  }

  private baseScope(laneRsl?: string): ExprScope {
    return {
      params: this.draw.values,
      clip: { seconds: this.template.choreography.clipSeconds },
      lane: laneScope(this.bundle, laneRsl ?? this.site.frame.entryLaneRsl),
      junction: junctionScope(this.bundle, this.site),
    };
  }

  /** Optional role-local frame origin supplied through the v2 extension seam. */
  private placementFeatureOffset(roleId: string, path: string): number {
    const raw = this.roleById.get(roleId)?.extensions?.['placementFeature'];
    if (raw === undefined) return 0;
    if (typeof raw !== 'string') {
      this.notes.push({ path, reason: 'placementFeature must be a feature id string; using frame origin' });
      return 0;
    }
    const match = this.site.featureMatches[raw];
    if (!match) {
      this.notes.push({ path, reason: `placementFeature "${raw}" is not bound at this site; using frame origin` });
      return 0;
    }
    return match.s;
  }

  /** Frame arc length → world point on the reference path. */
  private framePoint(s: number): { x: number; y: number; headingRad: number } {
    const route = this.refRoute;
    if (!route) throw new CliError('reference_route_unbuildable', 'the site has no drivable reference path', {
      path: `site.${this.site.siteId}`,
    });
    const pose = route.poseAt(s - this.site.frame.sRange[0]);
    return { ...pose.point, headingRad: pose.headingRad };
  }

  /** Resolve a full frame pose, including laneOffset and tFrac, into xodr-local metres. */
  private framePosePoint(
    pose: FramePose,
    scope: ExprScope,
    path: string,
    frameSOffset = 0,
  ): { x: number; y: number; headingRad: number } {
    const frameS = frameSOffset + evalNum(pose.s, scope, `${path}.s`, 0);
    const center = this.framePoint(frameS);
    let route = this.refRoute;
    if (!route) throw new CliError('reference_route_unbuildable', 'the site has no drivable reference path', { path });
    let routeS = frameS - this.site.frame.sRange[0];
    if (pose.laneOffset !== 0) {
      const semanticRoute = [...this.routeByRole.entries()]
        .filter(([roleId, candidate]) => {
          const role = this.roleById.get(roleId);
          return !candidate.isFreeform && role !== undefined && rolePose(role)?.laneOffset === pose.laneOffset;
        })
        .map(([, candidate]) => candidate)
        .sort((a, b) => a.projectPoint(center).d - b.projectPoint(center).d)[0];
      const rsl = this.site.frame.lateralLanes[pose.laneOffset];
      if (semanticRoute) {
        route = semanticRoute;
        routeS = route.projectPoint({ x: center.x, y: center.y }).s;
      } else if (!rsl) {
        this.notes.push({ path: `${path}.laneOffset`, reason: `no lane at k = ${pose.laneOffset}; using the reference lane` });
      } else {
        const built = routeFromChain(this.bundle.graph, [rsl], rsl, this.notes, `${path}.laneOffset`);
        if (built) {
          route = built;
          routeS = built.projectPoint({ x: center.x, y: center.y }).s;
        }
      }
    }
    const laneWidth = route.widthAt(routeS) ?? this.bundle.index.lanes[this.site.frame.entryLaneRsl]?.representativeWidthM ?? 3.5;
    const at = route.poseAt(routeS);
    const tFrac = evalTFrac(pose.tFrac, scope, `${path}.tFrac`, 0);
    const lateral = tFrac * laneWidth;
    return {
      x: at.point.x - Math.sin(at.headingRad) * lateral,
      y: at.point.y + Math.cos(at.headingRad) * lateral,
      headingRad: at.headingRad + pose.headingOffsetRad,
    };
  }

  private buildReferenceRoute(): void {
    const lanes = this.site.frame.referencePath.map((span) => span.laneRsl);
    this.refRoute = routeFromChain(
      this.bundle.graph,
      lanes,
      this.site.frame.entryLaneRsl,
      this.notes,
      'site.frame.referencePath',
    );
    if (!this.refRoute) {
      throw new CliError('reference_route_unbuildable', 'the site reference path is not drivable', {
        path: 'site.frame.referencePath',
        detail: { lanes },
      });
    }
  }

  /* --------------------------------------------------------------- actors */

  private buildActors(): void {
    for (const role of this.template.roles) {
      const binding = this.bindingByRole.get(role.id);
      if (!binding) {
        this.notes.push({ path: `roles.${role.id}`, reason: 'no matcher binding for this role' });
        continue;
      }
      if (binding.status === 'dropped') {
        this.notes.push({
          path: `roles.${role.id}`,
          reason: `role dropped by the matcher: ${binding.notes.join('; ')}`,
        });
        continue;
      }
      if (binding.status === 'failed') {
        if (role.essentiality === 'required') {
          throw new CliError('role_unbound', `required role "${role.id}" did not bind at this site`, {
            path: `roles.${role.id}`,
            detail: { notes: binding.notes },
            exitCode: 2,
          });
        }
        this.notes.push({
          path: `roles.${role.id}`,
          reason: `role unbound and dropped (${role.essentiality}): ${binding.notes.join('; ')}`,
        });
        continue;
      }
      const actor = this.buildActor(role, binding);
      if (actor) this.actors.push(actor);
    }
    if (this.actors.length === 0) {
      throw new CliError('no_actors', 'no role produced an actor at this site', {
        path: 'roles',
        exitCode: 2,
      });
    }
  }

  private buildActor(role: V2Role, binding: FeatureBinding): SimActor | null {
    const path = `roles.${role.id}`;
    const scope = this.baseScope(binding.laneRsl);
    this.scopeByRole.set(role.id, scope);

    const dims = role.actor.dims ?? DEFAULT_ACTOR_DIMS[role.actor.class];
    // The engine has two motion classes. Wheeled VRUs travel far closer to a
    // vehicle's speed envelope than to a walker's, so only genuine walkers (and
    // animals) get the pedestrian limits.
    const kind: SimActor['kind'] =
      role.actor.class === 'pedestrian' || role.actor.class === 'animal' ? 'pedestrian' : 'vehicle';

    let route: Route | null = null;
    let spawnS = 0;
    let tFrac = 0;
    let headingOffset = 0;

    const spawnPolyline = this.spawnRoutePolylineFor(role.id);

    if (role.kind === 'on_crossing') {
      const built = this.crossingRoute(role, binding, path);
      if (!built) return null;
      route = built.route;
      spawnS = built.startS;
    } else if (spawnPolyline) {
      // A `route` set at or before `t = 0` is not an event, it is the actor's
      // path — and it has to be the actor's *initial* route, because that is
      // the only thing the arrival solver can slide a spawn along. A dart-out
      // pedestrian whose crossing path arrives as a timeline entry would be
      // unsolvable: the solver would back-solve along the kerb lane instead.
      route = spawnPolyline;
      spawnS = 0;
    } else {
      // An actor on the reference lane drives the reference path, and the
      // reference path is the one chain guaranteed to span the whole frame.
      // The matcher's own chain for such a role starts at the *statically*
      // evaluated `s`, which is 0 whenever the spawn is a site-dependent
      // expression — using it would drop the entire approach.
      const onReferencePath =
        binding.laneRsl !== undefined &&
        this.site.frame.referencePath.some((span) => span.laneRsl === binding.laneRsl);
      const seed = onReferencePath
        ? this.site.frame.referencePath.map((span) => span.laneRsl)
        : (binding.routeLaneChain ?? (binding.laneRsl ? [binding.laneRsl] : []));
      route = routeFromChain(
        this.bundle.graph,
        seed,
        binding.laneRsl,
        this.notes,
        `${path}.route`,
      );
      if (!route) {
        if (role.essentiality === 'required') {
          throw new CliError('route_unbuildable', `required role "${role.id}" has no drivable route`, {
            path,
            exitCode: 2,
          });
        }
        return null;
      }
      if (role.kind === 'conflicting_gate') {
        // The arrival solver owns this actor's longitudinal placement; it starts
        // at the head of its run-up so the bisection has the whole route to work
        // with.
        spawnS = 0;
      } else {
        const pose = rolePose(role);
        const frameS = pose
          ? this.placementFeatureOffset(role.id, `${path}.extensions.placementFeature`) +
            evalNum(pose.s, scope, `${path}.pose.s`, 0)
          : (binding.pose?.s ?? 0);
        const frameAt = this.framePoint(frameS);
        const covered = coverTarget(
          this.bundle,
          route.legs.map((leg) => leg.rsl),
          { x: frameAt.x, y: frameAt.y },
        );
        if (covered && covered.lanes.length > route.legs.length) {
          this.notes.push({
            path: `${path}.route`,
            reason: `lane chain extended upstream by ${covered.lanes.length - route.legs.length} lane(s) to reach the site-evaluated spawn at frame s=${frameS.toFixed(1)} m`,
          });
          route = covered.route;
        }
        spawnS = route.projectPoint({ x: frameAt.x, y: frameAt.y }).s;
        if (spawnS <= ENDPOINT_CLAMP_M) {
          this.notes.push({
            path: `${path}.pose.s`,
            reason: `frame s=${frameS.toFixed(1)} m is upstream of every drivable lane at this site; the spawn was clamped to the start of the route`,
          });
        }
        tFrac = pose ? evalTFrac(pose.tFrac, scope, `${path}.pose.tFrac`, 0) : (binding.pose?.tFrac ?? 0);
        headingOffset = pose?.headingOffsetRad ?? binding.pose?.headingOffsetRad ?? 0;
      }
    }

    const speedForRunway = Math.max(
      1,
      evalNum(role.initialSpeedKph, scope, `${path}.initialSpeedKph`, 0) * KPH_TO_MPS,
    );
    if (!route.isFreeform) {
      // 1.6× the nominal distance: the clip's own length, plus the unrecorded
      // warm-up the actor also drives, plus headroom for the cruise governor
      // overshooting the authored speed.
      const needM =
        speedForRunway *
        (this.template.choreography.clipSeconds + this.template.choreography.warmupSeconds) *
        1.6;
      const extended = extendChainForward(
        this.bundle.graph,
        route.legs.map((leg) => leg.rsl),
        route,
        spawnS,
        needM,
      );
      if (extended.length > route.legs.length) {
        const rebuilt = buildLanePathRoute(this.bundle.graph, extended);
        if (rebuilt.ok) route = rebuilt.route;
      }
    }

    const routePose = route.poseAt(spawnS);
    const lateralM = tFrac * route.widthAt(spawnS);
    const point = route.pointWithOffset(spawnS, lateralM);
    const scene = toSceneXZ(point);
    const speedMps = Math.max(
      0,
      evalNum(role.initialSpeedKph, scope, `${path}.initialSpeedKph`, 0) * KPH_TO_MPS,
    );

    this.routeByRole.set(role.id, route);
    this.laneByRole.set(role.id, routePose.rsl ?? binding.laneRsl);
    this.spawnSByRole.set(role.id, spawnS);

    const laneRef = routePose.rsl
      ? { rsl: routePose.rsl, s: routePose.storageS, tFrac }
      : undefined;

    return parseActor({
      id: role.id,
      kind,
      dims: { l: dims.length, w: dims.width, h: dims.height },
      initial: {
        ...(laneRef ? { laneRef } : {}),
        pose: { x: scene.x, z: scene.z, headingRad: routePose.headingRad + headingOffset },
        speedMps,
      },
      behavior: {
        rules: this.rulesFor(role.id),
        route: route.isFreeform
          ? { kind: 'polyline', points: polylinePointsOf(route) }
          : { kind: 'lanePath', lanes: route.legs.map((leg) => leg.rsl) },
        // Without this the actor accelerates to `speedFactor × limit` and the
        // author's `initialSpeedKph` is a transient, which silently rewrites
        // every arrival solve.
        ...(speedMps > 0 ? { cruiseSpeedMps: speedMps } : {}),
      },
      presentAtStart: true,
      static: role.actor.static || role.actor.class === 'static_object',
      tags: [
        `role:${role.id}`,
        `class:${role.actor.class}`,
        `binding:${role.kind}`,
        ...(role.actor.catalogId ? [`catalog:${role.actor.catalogId}`] : []),
      ],
    });
  }

  /**
   * A pedestrian crossing is a freeform path, not a lane chain: it runs
   * *across* the carriageway. The path is built from the crossing's anchor
   * point, perpendicular to the reference heading, spanning the full
   * cross-section plus a kerb allowance at each end.
   */
  private crossingRoute(
    role: Extract<V2Role, { kind: 'on_crossing' }>,
    binding: FeatureBinding,
    path: string,
  ): { route: Route; startS: number } | null {
    const frameS = binding.pose?.s ?? 0;
    const at = this.framePoint(frameS);
    const laneRsl = binding.laneRsl ?? this.site.frame.entryLaneRsl;
    const lane = this.bundle.index.lanes[laneRsl];
    const width = lane?.representativeWidthM ?? 3.5;
    const sameDir = Object.keys(this.site.frame.lateralLanes).length;
    const opposing = this.site.frame.opposingLanes.length;
    const spanM = Math.max(6, width * (sameDir + opposing)) + 3;

    // `+n` is left of travel; `near_to_far` walks from the right kerb across.
    const nx = -Math.sin(at.headingRad);
    const ny = Math.cos(at.headingRad);
    const sign = role.direction === 'near_to_far' ? 1 : -1;
    const half = spanM / 2;
    const from = { x: at.x - nx * half * sign, y: at.y - ny * half * sign };
    const to = { x: at.x + nx * half * sign, y: at.y + ny * half * sign };
    const built = buildRouteFromPoints([from, to]);
    if (!built) {
      this.notes.push({ path, reason: 'could not build a crossing path' });
      return null;
    }
    return { route: built, startS: role.startFrac * built.lengthM };
  }

  /**
   * The polyline an actor's `route` interaction lays down at `t ≤ 0`, if any.
   *
   * Folded into the spawn route (and the interaction dropped) for the reason in
   * `buildActor`. Only the *first* such interaction is folded; a second one is
   * a genuine mid-clip re-route and stays on the timeline.
   */
  private spawnRoutePolylineFor(roleId: string): Route | null {
    for (const it of this.template.choreography.interactions) {
      if (it.verb !== 'route' || it.actor !== roleId) continue;
      if (it.trigger.kind !== 'at' || it.target.mode !== 'polyline') continue;
      const scope = this.baseScope();
      const t = evalNum(it.trigger.t, scope, `choreography.${it.id}.trigger.t`, 0);
      if (t > 0) continue;
      const frameSOffset = this.placementFeatureOffset(roleId, `roles.${roleId}.extensions.placementFeature`);
      const points: Array<{ x: number; y: number }> = [];
      for (let idx = 0; idx < it.target.points.length; idx += 1) {
        const p = it.target.points[idx]!;
        const at = this.framePosePoint(p, scope, `choreography.${it.id}.target.points.${idx}`, frameSOffset);
        points.push({ x: at.x, y: at.y });
      }
      const route = buildRouteFromPoints(points);
      if (!route) continue;
      this.foldedInteractions.add(it.id);
      this.foldedTriggerStart.set(it.id, t);
      this.notes.push({
        path: `choreography.interactions.${it.id}`,
        reason: `route(polyline) at t=${t} folded into ${roleId}'s spawn route (${route.lengthM.toFixed(1)} m), so the arrival solver can place the actor along it`,
      });
      return route;
    }
    return null;
  }

  /** Initial `rules`, after folding `set rules.*` interactions at `t ≤ 0`. */
  private rulesFor(roleId: string): Record<string, boolean | number> {
    return this.initialRules.get(roleId) ?? {};
  }

  private foldInitialRules(): void {
    for (const interaction of this.template.choreography.interactions) {
      if (interaction.verb !== 'set') continue;
      if (interaction.trigger.kind !== 'at') continue;
      const scope = this.scopeByRole.get(interaction.actor) ?? this.baseScope();
      const t = evalNum(interaction.trigger.t, scope, `choreography.${interaction.id}.trigger.t`, 0);
      if (t > 0) continue;
      const mapped = mapSetKey(interaction.target.key);
      if (!mapped || !mapped.startsWith('rules.')) continue;
      const bucket = this.initialRules.get(interaction.actor) ?? {};
      const key = mapped.slice('rules.'.length);
      const value = interaction.target.value;
      if (typeof value === 'boolean' || typeof value === 'number') {
        bucket[key] = value;
        this.initialRules.set(interaction.actor, bucket);
        this.foldedInteractions.add(interaction.id);
        this.foldedTriggerStart.set(interaction.id, t);
      }
    }
  }

  /* ----------------------------------------------------------- the timeline */

  private buildInteractions(): void {
    for (const interaction of this.template.choreography.interactions) {
      if (this.foldedInteractions.has(interaction.id)) continue;
      const built = this.buildInteraction(interaction);
      if (built) this.interactions.push(built);
    }
  }

  private buildInteraction(it: V2Interaction): SimInteraction | null {
    const path = `choreography.interactions.${it.id}`;
    if (it.actor !== '@world' && !this.actors.some((a) => a.id === it.actor)) {
      this.notes.push({ path, reason: `actor "${it.actor}" is not present at this site; interaction dropped` });
      return null;
    }
    const scope = this.scopeByRole.get(it.actor) ?? this.baseScope();
    const trigger = this.buildTrigger(
      it.trigger,
      scope,
      `${path}.trigger`,
      this.placementFeatureOffset(it.actor, `roles.${it.actor}.extensions.placementFeature`),
    );
    if (!trigger) return null;

    const until = it.until
      ? it.until.kind === 'when'
        ? this.buildCondition(it.until.condition, scope, `${path}.until.condition`)
        : (this.notes.push({
            path: `${path}.until`,
            reason: `the engine releases an axis on a condition; an "${it.until.kind}" until is not expressible and was dropped`,
          }),
          undefined)
      : undefined;

    const base = {
      id: it.id,
      // Engine interactions remain actor-addressed; world state uses the first
      // concrete actor as an event carrier while the key itself is global.
      actorId: it.actor === '@world' ? this.actors[0]!.id : it.actor,
      trigger,
      ...(until ? { until } : {}),
    };

    const dyn = (
      dynamics: { shape: string; constraint: string; value: NumberOrExpr } | undefined,
    ): { shape: string; constraint: string; value: number } => {
      if (!dynamics) {
        throw new CliError('dynamics_required', `${it.verb} requires dynamics`, {
          path: `${path}.dynamics`,
          exitCode: 2,
        });
      }
      return {
        shape: dynamics.shape,
        constraint: dynamics.constraint,
        value: evalNum(dynamics.value, scope, `${path}.dynamics.value`),
      };
    };

    switch (it.verb) {
      case 'speed': {
        const t = it.target;
        let target: unknown;
        switch (t.mode) {
          case 'absolute':
            target = { mode: 'absolute', value: Math.max(0, evalNum(t.valueKph, scope, `${path}.target.valueKph`) * KPH_TO_MPS) };
            break;
          case 'delta':
            target = { mode: 'delta', value: evalNum(t.deltaKph, scope, `${path}.target.deltaKph`) * KPH_TO_MPS };
            break;
          case 'factor':
            target = { mode: 'factor', value: Math.max(0, evalNum(t.factor, scope, `${path}.target.factor`)) };
            break;
          case 'match':
            target = {
              mode: 'match',
              actorId: t.role,
              offsetMps: evalNum(t.offsetKph, scope, `${path}.target.offsetKph`, 0) * KPH_TO_MPS,
            };
            break;
          case 'stop':
            target = { mode: 'stop' };
            break;
          case 'resume':
            this.notes.push({
              path,
              reason: 'speed(resume) has no engine counterpart (axis release does the same job); interaction dropped',
            });
            return null;
        }
        return parseInteraction({ ...base, verb: 'speed', target, dynamics: dyn(it.dynamics) });
      }
      case 'gap':
        return parseInteraction({
          ...base,
          verb: 'gap',
          target: { actorId: it.target.role },
          value: Math.max(0.01, evalNum(it.target.value, scope, `${path}.target.value`)),
          mode: it.target.unit,
          dynamics: dyn(it.dynamics),
        });
      case 'changeLane': {
        const t = it.target;
        let target: unknown;
        if (t.mode === 'relative') {
          if (t.dk === 0) {
            this.notes.push({ path, reason: 'changeLane with dk = 0 is a no-op; interaction dropped' });
            return null;
          }
          target = { mode: t.dk > 0 ? 'left' : 'right', count: Math.abs(t.dk) };
        } else if (t.mode === 'absolute') {
          const rsl = this.site.frame.lateralLanes[t.k];
          if (!rsl) {
            this.notes.push({ path, reason: `no lane at k = ${t.k} at this site; interaction dropped` });
            return null;
          }
          target = { mode: 'lane', rsl };
        } else {
          target = { mode: 'actorLane', actorId: t.role };
        }
        return parseInteraction({ ...base, verb: 'changeLane', target, dynamics: dyn(it.dynamics) });
      }
      case 'laneOffset':
        return parseInteraction({
          ...base,
          verb: 'laneOffset',
          target: { mode: 'fraction', value: evalNum(it.target.tFrac, scope, `${path}.target.tFrac`) },
          dynamics: dyn(it.dynamics),
        });
      case 'route': {
        const t = it.target;
        if (t.mode === 'polyline') {
          const points = t.points.map((p, idx) => {
            const at = this.framePosePoint(p, scope, `${path}.target.points.${idx}`);
            const scene = toSceneXZ({ x: at.x, y: at.y });
            return { x: scene.x, z: scene.z };
          });
          return parseInteraction({ ...base, verb: 'route', target: { kind: 'polyline', points } });
        }
        this.notes.push({
          path,
          reason: `route(${t.mode}) is fixed by the role binding's lane chain at instantiation time; the timeline entry is redundant and was dropped`,
        });
        return null;
      }
      case 'exist':
        return parseInteraction({ ...base, verb: 'exist', target: { state: it.target.state } });
      case 'set': {
        const signalKey = /^signal:(.+)\.phase$/.exec(it.target.key);
        const signalProgram = signalKey
          ? this.resolveSignalProgram({ handle: signalKey[1]! }, `${path}.target`)
          : null;
        const key = signalKey
          ? (signalProgram ? `signal:${signalProgram}.phase` : null)
          : mapSetKey(it.target.key);
        if (!key) {
          this.notes.push({
            path: `${path}.target.key`,
            reason: `set key "${it.target.key}" has no engine counterpart; interaction dropped`,
          });
          return null;
        }
        return parseInteraction({ ...base, verb: 'set', target: { key, value: it.target.value } });
      }
    }
  }

  private buildTrigger(
    trigger: V2Trigger,
    scope: ExprScope,
    path: string,
    frameSOffset = 0,
  ): SimTrigger | null {
    switch (trigger.kind) {
      case 'at':
        return { kind: 'at', t: evalNum(trigger.t, scope, `${path}.t`) };
      case 'after': {
        if (trigger.event === 'end') {
          this.notes.push({
            path,
            reason: 'after(..., event: end) measures from the start in the engine',
          });
        }
        const delayS = Math.max(0, evalNum(trigger.delayS, scope, `${path}.delayS`, 0));
        const foldedAt = this.foldedTriggerStart.get(trigger.of);
        if (foldedAt !== undefined) {
          this.notes.push({
            path,
            reason: `after(${trigger.of}) references an interaction folded into initial state; materialized as at(${(foldedAt + delayS).toFixed(3)})`,
          });
          return { kind: 'at', t: foldedAt + delayS };
        }
        return {
          kind: 'after',
          interactionId: trigger.of,
          delayS,
        };
      }
      case 'when': {
        const condition = this.buildCondition(trigger.condition, scope, `${path}.condition`);
        if (!condition) return null;
        if (trigger.byLatest === undefined) {
          throw new CliError('bylatest_required', 'when() requires byLatest', {
            path: `${path}.byLatest`,
            exitCode: 2,
          });
        }
        return {
          kind: 'when',
          condition,
          byLatest: evalNum(trigger.byLatest, scope, `${path}.byLatest`),
          ifNever: trigger.ifNever,
        };
      }
      case 'arrival': {
        const at = this.arrivalPoint(trigger.at, scope, `${path}.at`, frameSOffset);
        if (!at) return null;
        const ttc = trigger.ttc === undefined ? undefined : evalNum(trigger.ttc, scope, `${path}.ttc`);
        const deltaT =
          trigger.deltaT === undefined ? undefined : evalNum(trigger.deltaT, scope, `${path}.deltaT`);
        return {
          kind: 'arrival',
          arrival: {
            of: trigger.of,
            at,
            syncWith: trigger.syncWith,
            ...(ttc === undefined ? {} : { ttc }),
            ...(deltaT === undefined ? {} : { deltaT }),
          },
        };
      }
    }
  }

  private arrivalPoint(
    ref: PointRef,
    scope: ExprScope,
    path: string,
    frameSOffset = 0,
  ): { kind: 'point'; at: { x: number; z: number }; referenceFrame?: { stations: Array<{ rsl: string; s: number }> } } | null {
    const world = this.pointOf(ref, scope, path, frameSOffset);
    if (!world) return null;
    const scene = toSceneXZ(world);
    const base = { kind: 'point' as const, at: { x: scene.x, z: scene.z } };
    if ('pose' in ref && this.refRoute) {
      const frameS = frameSOffset + evalNum(ref.pose.s, scope, `${path}.pose.s`, 0);
      const frameCenter = this.framePoint(frameS);
      const stations = new Map<string, number>();

      // These are not nearest-road guesses: every route here already belongs
      // to a role bound into this anchor frame. Projecting the frame centre onto
      // those known routes records the equivalent longitudinal cross-section
      // for each lane. The engine can then solve by exact lane identity while a
      // freeform crossing route still has to pass geometrically through `at`.
      for (const route of [this.refRoute, ...this.routeByRole.values()]) {
        if (route.isFreeform) continue;
        const projected = route.projectPoint({ x: frameCenter.x, y: frameCenter.y });
        const pose = route.poseAt(projected.s);
        if (pose.rsl && !stations.has(pose.rsl)) stations.set(pose.rsl, pose.storageS);
      }
      if (stations.size > 0) {
        return {
          ...base,
          referenceFrame: {
            stations: [...stations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rsl, s]) => ({ rsl, s })),
          },
        };
      }
    }
    return base;
  }

  /** Resolve a `PointRef` into an xodr-local point, where that is possible. */
  private pointOf(
    ref: PointRef,
    scope: ExprScope,
    path: string,
    frameSOffset = 0,
  ): { x: number; y: number } | null {
    if ('pose' in ref) {
      const at = this.framePosePoint(ref.pose, scope, `${path}.pose`, frameSOffset);
      return { x: at.x, y: at.y };
    }
    if ('feature' in ref) {
      const match = this.site.featureMatches[ref.feature];
      if (!match) {
        this.notes.push({ path, reason: `feature "${ref.feature}" is not bound at this site` });
        return null;
      }
      if (match.mapFeatureId.startsWith('junction:')) {
        // The conflict point of whichever conflicting role uses this feature is
        // a far better aim point than the junction centroid: it is where the
        // paths actually cross.
        for (const binding of this.site.bindings) {
          if (binding.conflict && this.roleById.get(binding.role)?.kind === 'conflicting_gate') {
            const role = this.roleById.get(binding.role) as Extract<V2Role, { kind: 'conflicting_gate' }>;
            if (role.feature === ref.feature) return binding.conflict.point;
          }
        }
      }
      const at = this.framePoint(match.s);
      return { x: at.x, y: at.y };
    }
    this.notes.push({
      path,
      reason: 'a point measured against a moving role is not expressible as a fixed arrival point',
    });
    return null;
  }

  private buildCondition(
    condition: V2Condition,
    scope: ExprScope,
    path: string,
  ): SimCondition | undefined {
    switch (condition.kind) {
      case 'ttc':
        return {
          kind: 'ttc',
          a: condition.of,
          b: condition.to,
          cmp: CMP[condition.op] as 'lte' | 'gte',
          value: Math.max(0, evalNum(condition.valueS, scope, `${path}.valueS`)),
        };
      case 'headway':
        return {
          kind: 'headway',
          a: condition.of,
          b: condition.to,
          cmp: CMP[condition.op] as 'lte' | 'gte',
          value: Math.max(0, evalNum(condition.valueS, scope, `${path}.valueS`)),
        };
      case 'distance': {
        const to = condition.to;
        if ('role' in to) {
          return {
            kind: 'distance',
            a: condition.from,
            b: to.role,
            mode: condition.measure,
            cmp: CMP[condition.op] as 'lte' | 'gte',
            value: Math.max(0, evalNum(condition.valueM, scope, `${path}.valueM`)),
          };
        }
        // Distance to a fixed place is `reaches` with an explicit radius.
        const point = this.pointOf(to, scope, `${path}.to`);
        if (!point) return undefined;
        const scene = toSceneXZ(point);
        return {
          kind: 'reaches',
          actorId: condition.from,
          region: {
            kind: 'circle',
            center: { x: scene.x, z: scene.z },
            radiusM: Math.max(0.5, evalNum(condition.valueM, scope, `${path}.valueM`)),
          },
        };
      }
      case 'reaches': {
        const point = this.pointOf(condition.region, scope, `${path}.region`);
        if (!point) return undefined;
        const scene = toSceneXZ(point);
        return {
          kind: 'reaches',
          actorId: condition.of,
          region: {
            kind: 'circle',
            center: { x: scene.x, z: scene.z },
            radiusM: Math.max(0.5, evalNum(condition.toleranceM, scope, `${path}.toleranceM`, 3)),
          },
        };
      }
      case 'speed':
        return {
          kind: 'speed',
          actorId: condition.of,
          cmp: CMP[condition.op] as 'lte' | 'gte',
          value: Math.max(0, evalNum(condition.valueKph, scope, `${path}.valueKph`) * KPH_TO_MPS),
        };
      case 'standstill':
        return {
          kind: 'standstill',
          actorId: condition.of,
          durationS: Math.max(0, evalNum(condition.forS, scope, `${path}.forS`)),
        };
      case 'visible':
        return { kind: 'visible', a: condition.of, to: condition.to, value: condition.visible };
      case 'collision':
        return {
          kind: 'collision',
          a: condition.of,
          ...(condition.with === 'any' ? {} : { b: condition.with }),
        };
      case 'signal':
        {
          const signalId = this.resolveSignalProgram(condition.signal, path);
          if (!signalId) return undefined;
          if (condition.phase !== 'green' && condition.phase !== 'yellow' && condition.phase !== 'red') {
            this.notes.push({
              path: `${path}.phase`,
              reason: `engine signal programs do not yet model authored phase "${condition.phase}"; condition was dropped`,
            });
            return undefined;
          }
          return { kind: 'signal', signalId, phase: condition.phase };
        }
      case 'and':
      case 'or': {
        const operands = condition.operands
          .map((operand, i) => this.buildCondition(operand, scope, `${path}.operands.${i}`))
          .filter((c): c is SimCondition => c !== undefined);
        if (operands.length === 0) return undefined;
        if (operands.length === 1) return operands[0];
        return { kind: condition.kind, of: operands } as SimCondition;
      }
      case 'not': {
        const operand = this.buildCondition(condition.operand, scope, `${path}.operand`);
        return operand ? ({ kind: 'not', of: operand } as SimCondition) : undefined;
      }
    }
  }

  private resolveSignalProgram(ref: SignalRef, path: string): string | null {
    const plan = this.signalPlan ?? buildSiteSignalPlan(this.bundle, this.site);
    this.signalPlan = plan;
    if ('handle' in ref) {
      const direct = plan.programs.find((program) => program.id === ref.handle)?.id;
      const mapped = plan.programByHeadId.get(ref.handle);
      if (direct ?? mapped) return direct ?? mapped ?? null;
      this.notes.push({
        path: `${path}.signal.handle`,
        reason: `map signal handle "${ref.handle}" is not controlled at site junction ${plan.junctionId ?? '<none>'}; condition was dropped`,
      });
      return null;
    }

    const match = this.site.featureMatches[ref.feature];
    const expectedJunction = match?.mapFeatureId.startsWith('junction:')
      ? match.mapFeatureId.slice('junction:'.length)
      : null;
    if (!expectedJunction || expectedJunction !== plan.junctionId) {
      this.notes.push({
        path: `${path}.signal.feature`,
        reason: `feature "${ref.feature}" is not the signalized site junction; condition was dropped`,
      });
      return null;
    }

    const gateById = new Map(this.bundle.index.gates.map((gate) => [gate.id, gate]));
    let gateId: string | undefined;
    if (ref.approach === 'ego') {
      gateId = this.site.frame.egoGateId;
    } else {
      const relation = ref.approach === 'opposing' ? 'opposing' : `from_${ref.approach}`;
      gateId = this.site.bindings.find((binding) => binding.conflict?.relation === relation)?.conflict?.gateId;
      if (!gateId && this.site.frame.egoGateId) {
        const descriptor = this.bundle.index.junctionDescriptors[expectedJunction];
        for (const pair of descriptor?.conflictPairs ?? []) {
          if (pair.gateA !== this.site.frame.egoGateId && pair.gateB !== this.site.frame.egoGateId) continue;
          const pairRelation = pair.gateA === this.site.frame.egoGateId
            ? pair.relation
            : pair.relation === 'from_left'
              ? 'from_right'
              : pair.relation === 'from_right'
                ? 'from_left'
                : pair.relation;
          if (pairRelation === relation) {
            gateId = pair.gateA === this.site.frame.egoGateId ? pair.gateB : pair.gateA;
            break;
          }
        }
      }
    }
    const connectingLane = gateId ? gateById.get(gateId)?.connectingLaneRsl : undefined;
    let candidates = connectingLane ? plan.programsByConnectingLane.get(connectingLane) : undefined;
    if ((!candidates || candidates.length === 0) && gateId) {
      // An unprotected movement often has no dedicated head: it follows the
      // through head on the same physical approach. Preserve that map fact by
      // resolving through the descriptor's approach group, not by choosing an
      // arbitrary junction signal.
      const descriptor = this.bundle.index.junctionDescriptors[expectedJunction];
      const approach = descriptor?.approaches.find((candidate) => candidate.gateIds.includes(gateId!));
      const sameApproachPrograms = (approach?.gateIds ?? [])
        .flatMap((candidateGateId) => {
          const candidateLane = gateById.get(candidateGateId)?.connectingLaneRsl;
          return candidateLane ? [...(plan.programsByConnectingLane.get(candidateLane) ?? [])] : [];
        })
        .sort();
      candidates = [...new Set(sameApproachPrograms)];
    }
    if (candidates?.[0]) return candidates[0];
    this.notes.push({
      path: `${path}.signal.approach`,
      reason: `no physical signal head binds the ${ref.approach} movement at junction ${expectedJunction}; condition was dropped`,
    });
    return null;
  }

  private declareOcclusionPair(pair: { observer: string; target: string; occluderId?: string }): void {
    if (!this.actors.some((a) => a.id === pair.observer) || !this.actors.some((a) => a.id === pair.target)) {
      this.notes.push({
        path: 'occlusionPairs',
        reason: `occlusion pair ${pair.observer}/${pair.target} references a role that was not materialized`,
      });
      return;
    }
    const key = `${pair.observer}\0${pair.target}\0${pair.occluderId ?? ''}`;
    const existing = this.occlusionPairs.some(
      (p) => `${p.observer}\0${p.target}\0${p.occluderId ?? ''}` === key,
    );
    if (!existing) this.occlusionPairs.push(pair);
  }

  private buildRoleOcclusionPairs(): void {
    for (const role of this.template.roles) {
      const raw = role.extensions?.['occludes'];
      if (!raw || typeof raw !== 'object') continue;
      const pair = raw as { observer?: unknown; target?: unknown };
      if (typeof pair.observer !== 'string' || typeof pair.target !== 'string') {
        this.notes.push({ path: `roles.${role.id}.extensions.occludes`, reason: 'occlusion declaration is not {observer,target}' });
        continue;
      }
      this.declareOcclusionPair({ observer: pair.observer, target: pair.target, occluderId: `actor:${role.id}` });
    }
  }

  /* ------------------------------------------------------------------ props */

  private buildOccluders(): void {
    for (const prop of this.template.props) {
      const count = prop.repeat?.count ?? 1;
      const scope = this.baseScope();
      const spacing = prop.repeat
        ? evalNum(prop.repeat.spacingM, scope, `props.${prop.id}.repeat.spacingM`, 6)
        : 0;
      const baseS = evalNum(prop.pose.s, scope, `props.${prop.id}.pose.s`, 0);
      const featureOffset = prop.feature ? (this.site.featureMatches[prop.feature]?.s ?? 0) : 0;
      const dimsOverride = (prop.extensions?.['dims'] ?? undefined) as
        | { l?: number; w?: number; h?: number }
        | undefined;
      const dims = propDims(prop.catalogId, dimsOverride);

      for (let i = 0; i < count; i += 1) {
        const s = featureOffset + baseS + i * spacing;
        let at: { x: number; y: number; headingRad: number };
        try {
          const baseTFrac = evalTFrac(prop.pose.tFrac, scope, `props.${prop.id}.pose.tFrac`, 0);
          const tFracStep = prop.repeat
            ? evalTFrac(prop.repeat.tFracStep, scope, `props.${prop.id}.repeat.tFracStep`, 0)
            : 0;
          at = this.framePosePoint(
            { ...prop.pose, s, tFrac: baseTFrac + i * tFracStep },
            scope,
            `props.${prop.id}.pose`,
          );
        } catch {
          continue;
        }
        const scene = toSceneXZ({ x: at.x, y: at.y });
        this.occluders.push({
          id: count > 1 ? `${prop.id}-${i}` : prop.id,
          ...(count > 1 ? { groupId: prop.id } : {}),
          obb: {
            center: { x: scene.x, z: scene.z },
            lengthM: dims.l * prop.scale,
            widthM: dims.w * prop.scale,
            headingRad: at.headingRad + prop.headingOffsetRad,
            heightM: dims.h * prop.scale,
          },
        });
      }
      if (prop.occludes && count > 0) {
        this.declareOcclusionPair({ observer: prop.occludes.observer, target: prop.occludes.target, occluderId: prop.id });
        this.notes.push({
          path: `props.${prop.id}`,
          reason: `occlusion declared between ${prop.occludes.observer} and ${prop.occludes.target}; reveal-to-conflict is reported by the engine, not solved for`,
        });
      }
    }
  }

  /* --------------------------------------------------------------- assemble */

  run(options: MaterializeOptions): MaterializeResult {
    this.buildReferenceRoute();
    this.buildActors();
    this.foldInitialRules();
    // Rules folded after the actors were built: rebuild the ones that changed.
    if (this.initialRules.size > 0) {
      for (let i = 0; i < this.actors.length; i += 1) {
        const rules = this.initialRules.get(this.actors[i]!.id);
        if (!rules) continue;
        this.actors[i] = parseActor({
          ...this.actors[i]!,
          behavior: { ...this.actors[i]!.behavior, rules: { ...this.actors[i]!.behavior.rules, ...rules } },
        });
      }
    }
    this.signalPlan = buildSiteSignalPlan(this.bundle, this.site);
    if (this.signalPlan.programs.length > 0) {
      this.notes.push({
        path: 'signalPrograms',
        reason: `${this.signalPlan.programs.length} physical map signal head(s) bound to junction ${this.signalPlan.junctionId}; phase durations use the explicit synthetic-default plan because authoritative timing is absent`,
      });
    }
    this.buildInteractions();
    this.buildRoleOcclusionPairs();
    this.buildOccluders();

    let input = parseSimScenarioInput({
      schemaVersion: 1,
      mapId: this.bundle.mapId,
      clipSeconds: this.template.choreography.clipSeconds,
      warmupSeconds: this.template.choreography.warmupSeconds,
      dt: 0.02,
      seed: this.draw.paramSeed.slice(0, 16),
      ...(this.template.metricSubject && this.actors.some((a) => a.id === this.template.metricSubject)
        ? { metricSubject: this.template.metricSubject }
        : {}),
      actors: this.actors,
      interactions: this.interactions,
      signalPrograms: this.signalPlan.programs,
      occluders: this.occluders,
      occlusionPairs: this.occlusionPairs,
    });

    // --- arrival: the criticality that makes the scenario a scenario --------
    const solutions: ArrivalSolution[] = [];
    for (const role of this.template.roles) {
      if (role.kind !== 'conflicting_gate' || !role.arriveAtConflict) continue;
      const binding = this.bindingByRole.get(role.id);
      if (!binding?.conflict) continue;
      if (!input.actors.some((a) => a.id === role.id)) continue;
      const scope = this.scopeByRole.get(role.id) ?? this.baseScope();
      const deltaT = evalNum(
        role.arriveAtConflict.deltaT,
        scope,
        `roles.${role.id}.arriveAtConflict.deltaT`,
      );
      const scene = toSceneXZ(binding.conflict.point);
      const stationByLane = new Map<string, number>();
      for (const actorId of [role.id, role.arriveAtConflict.relativeTo]) {
        const route = this.routeByRole.get(actorId);
        if (!route || route.isFreeform) continue;
        const projection = route.projectPoint(binding.conflict.point);
        if (projection.d > 2) {
          this.notes.push({
            path: `roles.${role.id}.arriveAtConflict`,
            reason: `matcher conflict is ${projection.d.toFixed(2)} m from ${actorId}'s bound route; refusing to mint lane provenance for an off-route point`,
          });
          continue;
        }
        const pose = route.poseAt(projection.s);
        if (pose.rsl) stationByLane.set(pose.rsl, pose.storageS);
      }
      const stations = [...stationByLane]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rsl, s]) => ({ rsl, s }));
      const solved = solveArrival(
        input,
        {
          of: role.id,
          at: {
            kind: 'point',
            at: { x: scene.x, z: scene.z },
            ...(stations.length > 0 ? { referenceFrame: { stations } } : {}),
          },
          syncWith: role.arriveAtConflict.relativeTo,
          deltaT,
        },
        this.bundle.graph,
        { interactionId: `role:${role.id}` },
      );
      if (!solved.ok) {
        this.notes.push({
          path: `roles.${role.id}.arriveAtConflict`,
          reason: `${solved.issue.code}: ${solved.issue.reason}`,
        });
        continue;
      }
      solutions.push(solved.solution);
      input = applyArrivalSolution(input, solved.solution, this.bundle.graph);
    }

    // Timeline-level `arrival` triggers are baked here rather than left for the
    // engine. The engine would solve them identically on every run, but then the
    // *instance file* would not be a fully-resolved document — and "the seam is
    // a fully resolved concrete scenario" is the whole point of the seam.
    const resolved = resolveArrivalTriggers(input, this.bundle.graph);
    input = normalizeSimScenarioInput(resolved.input);
    solutions.push(...resolved.solutions);
    for (const issue of resolved.issues) {
      this.notes.push({
        path: issue.path,
        reason: `${issue.code}: ${issue.reason}`,
      });
    }

    const issues = checkFeasibility(input, this.bundle.graph);
    const feasible = !issues.some((i) => i.severity === 'error');

    const key: ReplayKey = {
      templateId: templateId(this.template),
      templateVersion: this.template.scenarioVersion,
      templateDigest: contentHash(this.template).slice(0, 16),
      mapId: this.bundle.mapId,
      matcherIndexDigest: this.site.topologyDigest,
      engineGraphDigest: this.bundle.graph.topologyDigest,
      siteId: this.site.siteId,
      matcherVersion: MATCH_SEMANTICS_VERSION,
      solverVersion: ENGINE_VERSION,
      paramSeed: this.draw.paramSeed,
      drawIndex: options.drawIndex ?? -1,
    };

    const manifest: InstanceManifest = {
      kind: 'scenario-instance-manifest',
      manifestVersion: 1,
      replayKey: key,
      instanceId: `${key.siteId}#${key.drawIndex}`,
      archetype: this.template.meta.archetype ?? null,
      negativeControl: this.template.meta.negativeControl,
      metricSubject: input.metricSubject ?? null,
      site: {
        siteId: this.site.siteId,
        score: this.site.score,
        verdict: this.site.degradation.verdict,
        originFeatureId: this.site.frame.origin.mapFeatureId,
        entryLaneRsl: this.site.frame.entryLaneRsl,
        egoTurn: this.site.frame.egoTurn ?? null,
        degradationSummary: this.site.degradation.summary,
        matchedReasons: this.site.matchedReasons,
      },
      params: {
        values: { ...this.draw.values },
        categorical: { ...this.draw.categorical },
        rejectedConstraints: [...this.draw.rejectedConstraints],
      },
      actors: input.actors.map((a) => ({
        id: a.id,
        roleKind: this.roleById.get(a.id)?.kind ?? 'unknown',
        laneRsl: a.initial.laneRef?.rsl ?? null,
        spawnS: this.spawnSByRole.get(a.id) ?? 0,
        initialSpeedMps: a.initial.speedMps,
        bindingStatus: this.bindingByRole.get(a.id)?.status ?? 'unknown',
      })),
      arrival: solutions,
      inputHash: contentHash(input),
      feasible,
      issues,
      notes: [...this.notes],
    };

    return { input, manifest };
  }
}

/* --------------------------------------------------------------- utilities */

function parseActor(value: unknown): SimActor {
  const parsed = safeParseSimScenarioInput({ actors: [value] });
  if (!parsed.ok) {
    throw new CliError('actor_invalid', 'a materialized actor failed the engine contract', {
      path: 'actors',
      detail: { issues: parsed.issues },
      exitCode: 2,
    });
  }
  return parsed.value.actors[0] as SimActor;
}

function parseInteraction(value: unknown): SimInteraction {
  const record = value as {
    id?: string;
    actorId?: string;
    trigger?: { kind?: string; interactionId?: string };
  };
  const actorId = record.actorId ?? 'probe';

  // BUGFIX (occluded-pedestrian campaign, 2026-08-01): this probe validates one
  // interaction inside a scenario that contains only that interaction, but
  // `simScenarioInputSchema` resolves `after()` references at *scenario* level.
  // So every `after()` trigger failed here with "after() references unknown
  // interaction <id>" — the whole trigger kind was unreachable through `uniscenarios`,
  // even though the engine runs it correctly once the real scenario is
  // assembled. The probe now carries a stub for whatever the trigger names.
  const afterId =
    record.trigger?.kind === 'after' && typeof record.trigger.interactionId === 'string'
      ? record.trigger.interactionId
      : undefined;
  const stubs =
    afterId === undefined || afterId === record.id
      ? []
      : [
          {
            id: afterId,
            actorId,
            verb: 'exist',
            trigger: { kind: 'at', t: 0 },
            target: { state: 'present' },
          },
        ];

  const parsed = safeParseSimScenarioInput({
    actors: [
      {
        id: actorId,
        kind: 'vehicle',
        dims: { l: 4, w: 2, h: 1.5 },
        initial: { pose: { x: 0, z: 0, headingRad: 0 }, speedMps: 0 },
        behavior: { route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] } },
      },
    ],
    interactions: [...stubs, value],
  });
  if (!parsed.ok) {
    throw new CliError('interaction_invalid', 'a materialized interaction failed the engine contract', {
      path: 'interactions',
      detail: { issues: parsed.issues },
      exitCode: 2,
    });
  }
  return parsed.value.interactions[stubs.length] as SimInteraction;
}

function polylinePointsOf(route: Route): Array<{ x: number; z: number }> {
  const n = Math.max(2, Math.ceil(route.lengthM));
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i <= n; i += 1) {
    const p = route.poseAt((route.lengthM * i) / n).point;
    const scene = toSceneXZ(p);
    out.push({ x: scene.x, z: scene.z });
  }
  return out;
}

function buildRouteFromPoints(points: Array<{ x: number; y: number }>): Route | null {
  const distinct = points.filter(
    (p, i) => i === 0 || Math.hypot(p.x - (points[i - 1] as { x: number }).x, p.y - (points[i - 1] as { y: number }).y) > 1e-6,
  );
  if (distinct.length < 2) return null;
  return Route.fromPolyline(distinct);
}

/**
 * The engine's `set` keys are a subset of the authored registry, and two of the
 * authored ones split a single engine switch. Mapping is explicit so a key with
 * no counterpart is *reported*, never silently ignored.
 */
export function mapSetKey(key: string): string | null {
  switch (key) {
    case 'rules.collisionAvoidance':
    case 'rules.obeySignals':
    case 'rules.aggression':
      return key;
    case 'rules.yieldToVehicles':
    case 'rules.yieldToPedestrians':
      return 'rules.yield';
    case 'rules.speedFactor':
      return 'rules.speedFactor';
    default:
      break;
  }
  if (/^(lights|doors|pose|env)\.[A-Za-z0-9_]+$/.test(key)) return key;
  if (/^signal:[A-Za-z0-9._:@/-]+\.phase$/.test(key)) return key;
  return null;
}

/** Materialize one concrete instance. */
export function materialize(
  template: ScenarioTemplateV2,
  bundle: MapBundle,
  site: MatchedSite,
  options: MaterializeOptions = {},
): MaterializeResult {
  const drawIndex = options.drawIndex ?? -1;
  const draw = resolveParams(template, {
    siteId: site.siteId,
    drawIndex,
    seedOverride: options.seed,
  });
  return new Materializer(template, bundle, site, draw).run({ ...options, drawIndex });
}

export { paramsVersion };
