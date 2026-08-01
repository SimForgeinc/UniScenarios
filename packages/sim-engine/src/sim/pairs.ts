/**
 * Pairwise kinematic readouts — the numbers both the trigger conditions and the
 * episode metrics are built from, computed once per tick per pair.
 *
 * ## The simplifications, stated plainly
 *
 * - **Clearance** uses each actor's circumscribed radius (`hypot(l,w)/2`), not
 *   the OBB. That makes `minDistance` and `ttc` slightly conservative for
 *   non-square footprints. Collision detection uses the real OBBs, so a
 *   "distance 0" reading never disagrees with a collision flag by more than the
 *   corner slack.
 * - **TTC** is the closing-speed form: `gap / closingSpeed`, where closing
 *   speed is the component of relative velocity along the centre-to-centre
 *   line. It is exact for head-on and rear-end geometries and degrades
 *   gracefully for crossing ones (it under-reports when paths cross without the
 *   line-of-centres shortening). A full path-intersection TTC needs the
 *   junction conflict-point table from `map-intel`, which this lane does not
 *   depend on.
 * - **Along-lane distance** is measured on the *first* actor's route. When the
 *   other actor is not on that route the reading is `null` and callers fall
 *   back to euclidean.
 */

import { actorRadius, type ActorRuntime } from './state.js';
import { dist, type Vec2 } from '../core/math.js';

export interface PairReadout {
  /** Surface-to-surface separation in metres (never negative). */
  readonly gapM: number;
  /** Centre-to-centre distance. */
  readonly centerDistM: number;
  /** Closing speed along the line of centres, m/s (negative = separating). */
  readonly closingMps: number;
  /** Seconds to contact at the current closing speed, `Infinity` if not closing. */
  readonly ttcS: number;
}

function velocityOf(a: ActorRuntime): Vec2 {
  return { x: Math.cos(a.headingRad) * a.speedMps, y: Math.sin(a.headingRad) * a.speedMps };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function readPair(a: ActorRuntime, b: ActorRuntime): PairReadout {
  const centerDist = dist(a.position, b.position);
  const clearance = actorRadius(a) + actorRadius(b);
  const gap = Math.max(0, centerDist - clearance);
  if (centerDist < 1e-9) {
    return { gapM: 0, centerDistM: 0, closingMps: 0, ttcS: 0 };
  }
  const ux = (b.position.x - a.position.x) / centerDist;
  const uy = (b.position.y - a.position.y) / centerDist;
  const va = velocityOf(a);
  const vb = velocityOf(b);
  const closing = (va.x - vb.x) * ux + (va.y - vb.y) * uy;
  const ttc = closing > 1e-6 ? gap / closing : Infinity;
  return { gapM: gap, centerDistM: centerDist, closingMps: closing, ttcS: ttc };
}

/**
 * Signed along-route distance from `observer` to `other`, measured on the
 * observer's route. Positive = ahead. `null` when `other` is not on the route.
 */
export function alongRouteDistance(observer: ActorRuntime, other: ActorRuntime): number | null {
  if (observer.route.isFreeform) return null;
  const otherPose = other.route.poseAt(other.routeS);
  if (otherPose.rsl === null) return null;
  const s = observer.route.sOfLaneStorage(otherPose.rsl, otherPose.storageS);
  if (s === null) return null;
  return s - observer.routeS;
}

/** Bumper-to-bumper along-route gap, or `null`. */
export function alongRouteGapM(observer: ActorRuntime, other: ActorRuntime): number | null {
  const d = alongRouteDistance(observer, other);
  if (d === null) return null;
  const halves = observer.dims.l / 2 + other.dims.l / 2;
  return d - Math.sign(d || 1) * halves;
}

/** Time headway `gap / v` from `observer` to `other`, or `null`. */
export function headwayS(observer: ActorRuntime, other: ActorRuntime): number | null {
  const gap = alongRouteGapM(observer, other);
  if (gap === null) return null;
  if (observer.speedMps < 1e-3) return gap <= 0 ? 0 : Infinity;
  return gap / observer.speedMps;
}

/**
 * Lateral separation between two actors measured on the observer's route —
 * used to decide "is this actor in my lane?" without a lane-identity join.
 */
export function lateralSeparationM(observer: ActorRuntime, other: ActorRuntime): number | null {
  const d = alongRouteDistance(observer, other);
  if (d === null) return null;
  const s = observer.routeS + d;
  return observer.route.lateralOffsetAt(s, other.position) - observer.lateralOffsetM;
}
