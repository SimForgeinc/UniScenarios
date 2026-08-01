/**
 * Routes: a single arc-length parameterisation an actor drives along.
 *
 * A route is either a **lane chain** (ordered directed lanes, connected within
 * `ENDPOINT_TOL_M`) or a **freeform polyline** (pedestrian crossings, jaywalk
 * diagonals). Both expose the same `poseAt(s)` so the controllers never branch
 * on actor kind for geometry.
 *
 * Lateral position is *not* part of the route: actors carry a signed offset in
 * metres (positive = left of the centreline) that the lateral controller
 * animates. Completing a lane change re-bases the route onto the neighbour lane
 * and subtracts the lane separation from the offset, so the offset stays small
 * and a following actor's "same lane?" test stays meaningful.
 */

import { clamp, dist, normalizeAngle, pointSegment, type Vec2 } from '../core/math.js';
import { localFromScene } from '../frames.js';
import type { RouteSpec, TurnRelation } from '../schema/input.js';
import { ENDPOINT_TOL_M, type DirectedLane, type LaneGraph } from './lane-graph.js';
import type { LaneRsl } from './topology.js';

export interface RouteLeg extends DirectedLane {
  /** Route arc length at the leg's entry. */
  readonly sStart: number;
  readonly lengthM: number;
  /** Turn taken to enter this leg, when it is a junction connecting lane. */
  readonly turnRelation: TurnRelation | null;
}

export interface RoutePose {
  readonly point: Vec2;
  readonly headingRad: number;
  readonly rsl: LaneRsl | null;
  /** Arc length within the lane, in traversal direction. */
  readonly laneS: number;
  /**
   * Arc length within the lane in the index's **storage** direction. This is
   * the `s` that `laneRef`, `widthSamples` and signal stop lines speak, so it
   * is the only lane-local `s` that crosses the package boundary.
   */
  readonly storageS: number;
  readonly reversed: boolean;
  readonly legIndex: number;
}

export interface RouteBuildError {
  code:
    | 'route_lane_missing'
    | 'route_disconnected'
    | 'route_empty'
    | 'route_orientation_ambiguous';
  reason: string;
  detail?: Record<string, unknown>;
}

export class Route {
  readonly legs: readonly RouteLeg[];
  readonly lengthM: number;
  private readonly freePoints: readonly Vec2[] | null;
  private readonly freeCum: readonly number[] | null;
  private readonly freeHeadings: readonly number[] | null;
  private laneIndex: Map<LaneRsl, number> | null = null;

  private constructor(
    private readonly graph: LaneGraph | null,
    legs: readonly RouteLeg[],
    free: { points: Vec2[]; cum: number[]; headings: number[] } | null,
  ) {
    this.legs = legs;
    this.freePoints = free?.points ?? null;
    this.freeCum = free?.cum ?? null;
    this.freeHeadings = free?.headings ?? null;
    this.lengthM = free
      ? free.cum[free.cum.length - 1]!
      : legs.length === 0
        ? 0
        : legs[legs.length - 1]!.sStart + legs[legs.length - 1]!.lengthM;
  }

  static fromLegs(graph: LaneGraph, legs: readonly RouteLeg[]): Route {
    return new Route(graph, legs, null);
  }

  static fromPolyline(points: readonly Vec2[]): Route {
    const pts: Vec2[] = [];
    for (const p of points) {
      const prev = pts[pts.length - 1];
      if (prev && dist(prev, p) < 1e-9) continue;
      pts.push({ x: p.x, y: p.y });
    }
    const cum = [0];
    const headings: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
      headings.push(Math.atan2(pts[i]!.y - pts[i - 1]!.y, pts[i]!.x - pts[i - 1]!.x));
    }
    headings.push(headings[headings.length - 1] ?? 0);
    return new Route(null, [], { points: pts, cum, headings });
  }

  get isFreeform(): boolean {
    return this.freePoints !== null;
  }

  /** Index of the leg containing route arc length `s`. */
  legIndexAt(s: number): number {
    if (this.legs.length === 0) return -1;
    const q = clamp(s, 0, this.lengthM);
    let lo = 0;
    let hi = this.legs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.legs[mid]!.sStart <= q) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  poseAt(s: number): RoutePose {
    const q = clamp(s, 0, this.lengthM);
    if (this.freePoints && this.freeCum && this.freeHeadings) {
      let lo = 0;
      let hi = this.freeCum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.freeCum[mid]! <= q) lo = mid;
        else hi = mid;
      }
      const a = this.freePoints[lo]!;
      const b = this.freePoints[hi]!;
      const span = this.freeCum[hi]! - this.freeCum[lo]!;
      const t = span > 1e-9 ? (q - this.freeCum[lo]!) / span : 0;
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        headingRad: this.freeHeadings[lo]!,
        rsl: null,
        laneS: q,
        storageS: q,
        reversed: false,
        legIndex: -1,
      };
    }
    const i = this.legIndexAt(q);
    const leg = this.legs[i]!;
    const laneS = clamp(q - leg.sStart, 0, leg.lengthM);
    const sample = this.graph!.sampleDirected(leg, laneS);
    return {
      point: sample.point,
      headingRad: normalizeAngle(sample.headingRad),
      rsl: leg.rsl,
      laneS,
      storageS: leg.reversed ? leg.lengthM - laneS : laneS,
      reversed: leg.reversed,
      legIndex: i,
    };
  }

  /** Lane width at route arc length `s` (default 3.5 m off the lane graph). */
  widthAt(s: number): number {
    if (this.legs.length === 0 || !this.graph) return 3.5;
    const i = this.legIndexAt(s);
    const leg = this.legs[i]!;
    const laneS = clamp(s - leg.sStart, 0, leg.lengthM);
    const storageS = leg.reversed ? leg.lengthM - laneS : laneS;
    return this.graph.widthAt(leg.rsl, storageS);
  }

  /** Point offset laterally from the centreline; `+` is left of travel. */
  pointWithOffset(s: number, lateralM: number): Vec2 {
    const pose = this.poseAt(s);
    if (lateralM === 0) return pose.point;
    const nx = -Math.sin(pose.headingRad);
    const ny = Math.cos(pose.headingRad);
    return { x: pose.point.x + nx * lateralM, y: pose.point.y + ny * lateralM };
  }

  /**
   * Route arc length of a lane-local **storage** `s`, or `null` when the route
   * never traverses that lane. Ties (a lane visited twice) resolve to the first
   * visit, which keeps the reading monotone for a follower.
   *
   * Backed by a lazily built `rsl → legIndex` map: this is called once per
   * actor pair per tick by the leader search, so a linear scan over a 40-leg
   * route was measurable.
   */
  sOfLaneStorage(rsl: LaneRsl, storageS: number): number | null {
    if (!this.laneIndex) {
      this.laneIndex = new Map();
      for (let i = 0; i < this.legs.length; i++) {
        if (!this.laneIndex.has(this.legs[i]!.rsl)) this.laneIndex.set(this.legs[i]!.rsl, i);
      }
    }
    const i = this.laneIndex.get(rsl);
    if (i === undefined) return null;
    const leg = this.legs[i]!;
    const travel = leg.reversed ? leg.lengthM - storageS : storageS;
    return leg.sStart + clamp(travel, 0, leg.lengthM);
  }

  /** Whether the route ever traverses `rsl`. */
  includesLane(rsl: LaneRsl): boolean {
    return this.sOfLaneStorage(rsl, 0) !== null;
  }

  /** Nearest route arc length to a point, scanning coarsely then refining. */
  projectPoint(p: Vec2, stepM = 2): { s: number; d: number } {
    let best = { s: 0, d: Infinity };
    const n = Math.max(2, Math.ceil(this.lengthM / stepM) + 1);
    for (let i = 0; i < n; i++) {
      const s = (this.lengthM * i) / (n - 1);
      const d = dist(this.poseAt(s).point, p);
      if (d < best.d) best = { s, d };
    }
    // Golden-section-free local refine: two bisection passes over ±step.
    let lo = Math.max(0, best.s - stepM);
    let hi = Math.min(this.lengthM, best.s + stepM);
    for (let iter = 0; iter < 24; iter++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const d1 = dist(this.poseAt(m1).point, p);
      const d2 = dist(this.poseAt(m2).point, p);
      if (d1 < d2) hi = m2;
      else lo = m1;
    }
    const s = (lo + hi) / 2;
    return { s, d: dist(this.poseAt(s).point, p) };
  }

  /** Signed lateral offset of `p` from the centreline at `s` (`+` = left). */
  lateralOffsetAt(s: number, p: Vec2): number {
    const pose = this.poseAt(s);
    const dx = p.x - pose.point.x;
    const dy = p.y - pose.point.y;
    return -Math.sin(pose.headingRad) * dx + Math.cos(pose.headingRad) * dy;
  }
}

/* -------------------------------------------------------------- building */

function legFrom(graph: LaneGraph, d: DirectedLane, sStart: number): RouteLeg {
  const g = graph.requireGeometry(d.rsl);
  const turn = g.lane.isJunction ? graph.turnRelationOf(d.rsl) : null;
  return {
    rsl: d.rsl,
    reversed: d.reversed,
    sStart,
    lengthM: g.lengthM,
    turnRelation: (turn as TurnRelation | null) ?? null,
  };
}

/** Build a route from an explicit ordered lane chain. */
export function buildLanePathRoute(
  graph: LaneGraph,
  lanes: readonly LaneRsl[],
): { ok: true; route: Route } | { ok: false; error: RouteBuildError } {
  if (lanes.length === 0) return { ok: false, error: { code: 'route_empty', reason: 'no lanes' } };
  for (const rsl of lanes) {
    if (!graph.geometry(rsl)) {
      return {
        ok: false,
        error: { code: 'route_lane_missing', reason: `lane ${rsl} not in topology`, detail: { rsl } },
      };
    }
  }
  // Orient the first lane: prefer its nominal direction, but if a second lane
  // exists take whichever orientation actually connects to it.
  const first = lanes[0]!;
  let firstReversed = graph.nominalReversed(first) ?? false;
  if (lanes.length > 1) {
    const next = lanes[1]!;
    let matched = false;
    for (const reversed of [firstReversed, !firstReversed]) {
      const exit = graph.endpoints({ rsl: first, reversed }).exit;
      if (graph.orientToward(next, exit)) {
        firstReversed = reversed;
        matched = true;
        break;
      }
    }
    if (!matched) {
      return {
        ok: false,
        error: {
          code: 'route_disconnected',
          reason: `lane ${first} does not connect to ${next} within ${ENDPOINT_TOL_M} m`,
          detail: { from: first, to: next },
        },
      };
    }
  }

  const legs: RouteLeg[] = [legFrom(graph, { rsl: first, reversed: firstReversed }, 0)];
  for (let i = 1; i < lanes.length; i++) {
    const prev = legs[legs.length - 1]!;
    const exit = graph.endpoints(prev).exit;
    const oriented = graph.orientToward(lanes[i]!, exit);
    if (!oriented) {
      const gap = Math.min(
        dist(exit, graph.endpoints({ rsl: lanes[i]!, reversed: false }).entry),
        dist(exit, graph.endpoints({ rsl: lanes[i]!, reversed: true }).entry),
      );
      return {
        ok: false,
        error: {
          code: 'route_disconnected',
          reason: `lane ${prev.rsl} does not connect to ${lanes[i]} (gap ${gap.toFixed(2)} m > ${ENDPOINT_TOL_M} m)`,
          detail: { from: prev.rsl, to: lanes[i], gapM: gap },
        },
      };
    }
    legs.push(legFrom(graph, oriented, prev.sStart + prev.lengthM));
  }
  return { ok: true, route: Route.fromLegs(graph, legs) };
}

const TURN_FALLBACK_ORDER: TurnRelation[] = ['Straight', 'Right', 'Left', 'UTurnRight', 'UTurnLeft'];

/**
 * Walk successors from `startRsl`, consuming `turns` at each junction.
 *
 * Choice rule (deterministic): the requested turn if a gate offers it, else the
 * first available relation in `Straight, Right, Left, UTurnRight, UTurnLeft`,
 * else the lowest-`rsl` successor.
 */
export function buildFollowRoute(
  graph: LaneGraph,
  startRsl: LaneRsl,
  turns: readonly TurnRelation[],
  maxLengthM: number,
  startReversed?: boolean,
): { ok: true; route: Route } | { ok: false; error: RouteBuildError } {
  if (!graph.geometry(startRsl)) {
    return {
      ok: false,
      error: { code: 'route_lane_missing', reason: `lane ${startRsl} not in topology`, detail: { rsl: startRsl } },
    };
  }
  const reversed = startReversed ?? graph.nominalReversed(startRsl) ?? false;
  const legs: RouteLeg[] = [legFrom(graph, { rsl: startRsl, reversed }, 0)];
  const visited = new Set<string>([`${startRsl}#${reversed ? 'r' : 'f'}`]);
  let turnIdx = 0;

  while (legs[legs.length - 1]!.sStart + legs[legs.length - 1]!.lengthM < maxLengthM) {
    const current = legs[legs.length - 1]!;
    const succ = graph.successors(current).filter((d) => !visited.has(`${d.rsl}#${d.reversed ? 'r' : 'f'}`));
    if (succ.length === 0) break;

    let chosen = succ[0]!;
    const gates = graph.gatesFrom(current.rsl);
    if (gates.length > 0) {
      const byRelation = new Map<TurnRelation, DirectedLane>();
      for (const g of gates) {
        const match = succ.find((d) => d.rsl === g.connectingLaneRsl);
        if (match && !byRelation.has(g.turnRelation as TurnRelation)) {
          byRelation.set(g.turnRelation as TurnRelation, match);
        }
      }
      const want = turns[turnIdx];
      const pick =
        (want !== undefined ? byRelation.get(want) : undefined) ??
        TURN_FALLBACK_ORDER.map((r) => byRelation.get(r)).find((d) => d !== undefined);
      if (pick) {
        chosen = pick;
        if (want !== undefined) turnIdx++;
      }
    }
    visited.add(`${chosen.rsl}#${chosen.reversed ? 'r' : 'f'}`);
    legs.push(legFrom(graph, chosen, current.sStart + current.lengthM));
  }
  return { ok: true, route: Route.fromLegs(graph, legs) };
}

/** Resolve a `RouteSpec` from the input document. */
export function buildRoute(
  graph: LaneGraph,
  spec: RouteSpec,
): { ok: true; route: Route } | { ok: false; error: RouteBuildError } {
  switch (spec.kind) {
    case 'lanePath':
      return buildLanePathRoute(graph, spec.lanes);
    case 'follow':
      return buildFollowRoute(graph, spec.startRsl, spec.turns, spec.maxLengthM);
    case 'polyline':
      return { ok: true, route: Route.fromPolyline(spec.points.map(localFromScene)) };
  }
}

/**
 * Re-base a route onto the lateral neighbour at the actor's current position.
 *
 * Returns the new route plus the arc length that corresponds to the actor's
 * position on it, and the lane separation to subtract from the lateral offset.
 */
export function retargetToNeighbour(
  graph: LaneGraph,
  route: Route,
  sNow: number,
  side: 'left' | 'right',
  opts: { legalOnly: boolean; remainingTurns?: readonly TurnRelation[]; maxLengthM?: number },
): { route: Route; s: number; separationM: number; legal: boolean; targetRsl: LaneRsl } | null {
  const pose = route.poseAt(sNow);
  if (!pose.rsl) return null;
  const leg = route.legs[pose.legIndex]!;
  const storageS = leg.reversed ? leg.lengthM - pose.laneS : pose.laneS;
  // `adjacentLanes.left/right` is expressed in storage orientation; a reversed
  // leg swaps the driver's left and right.
  const storageSide: 'left' | 'right' = leg.reversed ? (side === 'left' ? 'right' : 'left') : side;
  const neighbour = graph.lateralNeighbour(pose.rsl, storageSide, storageS, opts.legalOnly);
  if (!neighbour) return null;
  const built = buildFollowRoute(
    graph,
    neighbour.rsl,
    opts.remainingTurns ?? [],
    opts.maxLengthM ?? 2000,
    leg.reversed,
  );
  if (!built.ok) return null;
  const proj = built.route.projectPoint(pose.point);
  const separation = (route.widthAt(sNow) + built.route.widthAt(proj.s)) / 2;
  return {
    route: built.route,
    s: proj.s,
    separationM: side === 'left' ? separation : -separation,
    legal: neighbour.legal,
    targetRsl: neighbour.rsl,
  };
}

/** Build a route that starts on `targetRsl` near `point` (used by `changeLane`
 * with an explicit lane target). */
export function retargetToLane(
  graph: LaneGraph,
  route: Route,
  sNow: number,
  targetRsl: LaneRsl,
  opts: { remainingTurns?: readonly TurnRelation[]; maxLengthM?: number } = {},
): { route: Route; s: number; separationM: number } | null {
  if (!graph.geometry(targetRsl)) return null;
  const pose = route.poseAt(sNow);
  const leg = pose.legIndex >= 0 ? route.legs[pose.legIndex] : undefined;
  const built = buildFollowRoute(
    graph,
    targetRsl,
    opts.remainingTurns ?? [],
    opts.maxLengthM ?? 2000,
    leg?.reversed,
  );
  if (!built.ok) return null;
  const proj = built.route.projectPoint(pose.point);
  const lateral = built.route.lateralOffsetAt(proj.s, pose.point);
  return { route: built.route, s: proj.s, separationM: -lateral };
}

/** Distance along a shared route between two arc lengths, or `null`. */
export function alongRouteGap(leaderS: number, followerS: number): number {
  return leaderS - followerS;
}

/** Closest approach between a point and a polyline, used by region tests. */
export function pointToPolyline(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const r = pointSegment(p, poly[i - 1]!, poly[i]!);
    if (r.d2 < best) best = r.d2;
  }
  return Math.sqrt(best);
}
