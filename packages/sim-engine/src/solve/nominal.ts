/**
 * Free-flow ("nominal") longitudinal motion — the reference the arrival solver
 * and the runway guard reason about.
 *
 * A nominal run is the actor alone on its route: it converges on its cruise
 * speed with the same first-order law the engine's default controller uses, and
 * ignores every interaction, leader, signal and conflict. That is exactly the
 * "reference actor's nominal motion" the research doc back-solves against, and
 * it makes arrival time a **monotone** function of spawn `s` — which is what
 * lets bisection be both deterministic and cheap (no full sim per probe).
 *
 * Integration starts at `t = -warmupSeconds` so the warm-up prologue is part of
 * the answer: an actor spawned below its cruise speed really does take a moment
 * to get there, and the solver accounts for it.
 */

import { clamp } from '../core/math.js';
import type { LaneGraph } from '../map/lane-graph.js';
import type { Route } from '../map/route.js';
import { PEDESTRIAN_LIMITS, VEHICLE_LIMITS } from '../sim/controllers.js';
import type { ActorKind } from '../schema/input.js';

export interface NominalActor {
  readonly kind: ActorKind;
  readonly route: Route;
  readonly startS: number;
  readonly initialSpeedMps: number;
  readonly speedFactor: number;
  readonly cruiseOverrideMps: number | null;
}

const CRUISE_GAIN = 2.0;

function cruiseAt(graph: LaneGraph, a: NominalActor, s: number): number {
  if (a.cruiseOverrideMps !== null) return a.cruiseOverrideMps;
  const pose = a.route.poseAt(s);
  if (!pose.rsl) return (a.kind === 'pedestrian' ? 1.4 : 13.4) * a.speedFactor;
  const g = graph.geometry(pose.rsl);
  return (g ? g.speedLimitMps : 13.4) * a.speedFactor;
}

export interface NominalProbe {
  /** Simulation time the actor reaches `targetS`, or `null` if it never does. */
  readonly tAtTarget: number | null;
  /** Distance covered by the end of the horizon. */
  readonly distanceM: number;
  /** Speed at the horizon. */
  readonly finalSpeedMps: number;
}

/**
 * Integrate free-flow motion from `-warmupSeconds` and report when the actor
 * passes `targetS` (linear interpolation inside the crossing tick).
 */
export function nominalRun(
  graph: LaneGraph,
  a: NominalActor,
  targetS: number | null,
  opts: { dt: number; warmupSeconds: number; horizonSeconds: number; boundByRoute?: boolean },
): NominalProbe {
  const boundByRoute = opts.boundByRoute ?? true;
  const lim = a.kind === 'pedestrian' ? PEDESTRIAN_LIMITS : VEHICLE_LIMITS;
  let v = a.initialSpeedMps;
  let s = a.startS;
  let t = -opts.warmupSeconds;
  const end = opts.horizonSeconds;
  if (targetS !== null && s >= targetS) {
    return { tAtTarget: t, distanceM: 0, finalSpeedMps: v };
  }
  const steps = Math.ceil((end + opts.warmupSeconds) / opts.dt);
  for (let i = 0; i < steps; i++) {
    const target = cruiseAt(graph, a, s);
    const accel = clamp((target - v) * CRUISE_GAIN, -lim.brakeComfort, lim.accelMax);
    const vNext = Math.max(0, v + accel * opts.dt);
    const sNext = s + vNext * opts.dt;
    if (targetS !== null && sNext >= targetS) {
      const span = sNext - s;
      const frac = span > 1e-9 ? (targetS - s) / span : 0;
      return { tAtTarget: t + frac * opts.dt, distanceM: targetS - a.startS, finalSpeedMps: vNext };
    }
    if (boundByRoute && sNext >= a.route.lengthM) {
      return { tAtTarget: null, distanceM: a.route.lengthM - a.startS, finalSpeedMps: vNext };
    }
    v = vNext;
    s = sNext;
    t += opts.dt;
  }
  return { tAtTarget: null, distanceM: s - a.startS, finalSpeedMps: v };
}

/** Distance a nominal actor covers within the clip — the runway guard's need. */
export function nominalRunwayNeedM(
  graph: LaneGraph,
  a: NominalActor,
  opts: { dt: number; warmupSeconds: number; clipSeconds: number },
): number {
  const probe = nominalRun(graph, a, null, {
    dt: opts.dt,
    warmupSeconds: opts.warmupSeconds,
    horizonSeconds: opts.clipSeconds,
    boundByRoute: false,
  });
  return probe.distanceM;
}
