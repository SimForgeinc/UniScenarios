/**
 * Per-axis controllers.
 *
 * ## Motion model (and what it is not)
 *
 * Vehicles are **path followers with a bicycle-ish heading**: longitudinal
 * state is `(s, v)` along the route arc length, lateral state is a signed
 * offset from the centreline, and heading is `routeHeading + atan2(ṫ, v)` — the
 * body slip a real steering input would produce. There is no tyre model, no
 * yaw inertia, no load transfer. Accelerations are clamped to per-class limits,
 * which is the level of fidelity criticality metrics (TTC, required decel,
 * arrival timing) are actually sensitive to.
 *
 * Pedestrians are point-mass path followers with the same code path and softer
 * limits.
 *
 * ## One axis, one owner
 *
 * `longCmd` and `latCmd` are single slots. A newly fired interaction on an axis
 * *replaces* whatever was there and emits a `preemption` event — action-level
 * replacement, no priorities, no nesting (the esmini lesson from the research
 * doc). Releasing a command (its `until` fired, or its profile completed and it
 * had no `until`) returns the axis to default behaviour: cruise at
 * `speedFactor × speedLimit`, hold zero lateral offset.
 */

import { clamp } from '../core/math.js';
import { alongRouteGapM, lateralSeparationM } from './pairs.js';
import { transitionValue } from './dynamics.js';
import type { ActorRuntime } from './state.js';
import type { SignalBook } from './signals.js';
import { phaseForbidsEntry } from './signals.js';

export interface MotionLimits {
  readonly accelMax: number;
  readonly brakeComfort: number;
  readonly brakeHard: number;
  readonly lateralRateMax: number;
  readonly lateralAccelMax: number;
}

export const VEHICLE_LIMITS: MotionLimits = {
  accelMax: 3.0,
  brakeComfort: 3.5,
  brakeHard: 8.0,
  lateralRateMax: 2.5,
  lateralAccelMax: 3.0,
};

export const PEDESTRIAN_LIMITS: MotionLimits = {
  accelMax: 1.5,
  brakeComfort: 1.5,
  brakeHard: 3.0,
  lateralRateMax: 1.0,
  lateralAccelMax: 2.0,
};

export function limitsFor(a: ActorRuntime): MotionLimits {
  return a.kind === 'pedestrian' ? PEDESTRIAN_LIMITS : VEHICLE_LIMITS;
}

/** Cruise convergence gain: `τ = 0.5 s`, so warm-up settles to <1e-4 relative
 * error in 5 s. Deliberately brisk — the prologue exists to remove transients. */
const CRUISE_GAIN = 2.0;

/** Gap controller gains (PD on gap error). Critically damped for a 15 m/s
 * follower at a 2 s headway; equilibrium gap equals the commanded gap exactly,
 * unlike IDM's `1/sqrt(1-(v/v0)^4)` offset. */
const GAP_KP = 0.4;
const GAP_KD = 1.2;
/** Jam distance floor so a commanded time-gap does not collapse at standstill. */
const GAP_MIN_M = 2.0;

/** Aggression 0 → 1.3× gaps, 0.5 → 1.0×, 1 → 0.7×. */
export function gapScaleFor(aggression: number): number {
  return 1.3 - 0.6 * aggression;
}

/** Desired free-flow speed for an actor at its current position. */
export function cruiseSpeed(a: ActorRuntime, laneSpeedLimitMps: number): number {
  if (a.cruiseOverrideMps !== null) return a.cruiseOverrideMps;
  return laneSpeedLimitMps * a.rules.speedFactor;
}

/** Acceleration that converges on `vTarget` with a first-order lag. */
export function converge(a: ActorRuntime, vTarget: number, lim: MotionLimits): number {
  return clamp((vTarget - a.speedMps) * CRUISE_GAIN, -lim.brakeComfort, lim.accelMax);
}

/** PD gap-keeping acceleration toward `gapDesired` behind `leaderSpeed`. */
export function gapAccel(
  a: ActorRuntime,
  gapM: number,
  leaderSpeedMps: number,
  gapDesiredM: number,
  lim: MotionLimits,
): number {
  const error = gapM - Math.max(gapDesiredM, GAP_MIN_M);
  const raw = GAP_KP * error + GAP_KD * (leaderSpeedMps - a.speedMps);
  return clamp(raw, -lim.brakeHard, lim.accelMax);
}

/** Desired gap in metres for a `gap` command. */
export function desiredGapM(
  a: ActorRuntime,
  value: number,
  mode: 'time' | 'distance',
  scaled: boolean,
): number {
  const base = mode === 'time' ? value * a.speedMps : value;
  return scaled ? base * gapScaleFor(a.rules.aggression) : base;
}

/* ----------------------------------------------------------- longitudinal */

export interface LongitudinalInput {
  readonly actor: ActorRuntime;
  readonly t: number;
  readonly dt: number;
  readonly laneSpeedLimitMps: number;
  readonly leader: { gapM: number; speedMps: number } | null;
}

/** Commanded acceleration from the axis owner (or the default cruise law). */
export function longitudinalAccel(input: LongitudinalInput): number {
  const { actor: a, t, dt } = input;
  const lim = limitsFor(a);
  const cmd = a.longCmd;
  if (!cmd) {
    return converge(a, cruiseSpeed(a, input.laneSpeedLimitMps), lim);
  }
  if (cmd.kind === 'speed') {
    const vNext = transitionValue(cmd.dynamics, cmd.v0, cmd.target, t + dt - cmd.firedAt, cmd.duration);
    return clamp((vNext - a.speedMps) / dt, -lim.brakeHard, lim.accelMax);
  }
  // gap: the dynamics profile shapes the *approach* from the gap at fire time
  // to the commanded gap; a PD loop then tracks whatever the profile asks for.
  const gapNow = input.leader?.gapM ?? Infinity;
  const leaderV = input.leader?.speedMps ?? a.speedMps;
  if (!Number.isFinite(gapNow)) {
    return converge(a, cruiseSpeed(a, input.laneSpeedLimitMps), lim);
  }
  const gapCommanded = transitionValue(
    cmd.dynamics,
    cmd.v0,
    cmd.target,
    t + dt - cmd.firedAt,
    cmd.duration,
  );
  const accel = gapAccel(a, gapNow, leaderV, gapCommanded, lim);
  // Never exceed free flow while gap keeping.
  const vCap = cruiseSpeed(a, input.laneSpeedLimitMps);
  return a.speedMps + accel * dt > vCap ? clamp((vCap - a.speedMps) / dt, -lim.brakeHard, lim.accelMax) : accel;
}

/* --------------------------------------------------------------- governor */

export interface HazardResult {
  /** Most restrictive acceleration the governor will allow, m/s². */
  readonly accelCap: number;
  /** Decel that *would* have been required to avoid contact, m/s² (≥ 0). */
  readonly requiredDecel: number;
  readonly reason: 'none' | 'leader' | 'signal' | 'conflict';
}

/** Deceleration needed to shed `dv` over `gap` metres. */
export function requiredDecelFor(dv: number, gapM: number): number {
  if (dv <= 0) return 0;
  return (dv * dv) / (2 * Math.max(gapM, 0.05));
}

/**
 * The safety governor. Returns a *cap* on acceleration; the caller takes the
 * minimum with the commanded value, so the governor can only ever brake.
 *
 * `rules.collisionAvoidance = false` bypasses the leader and conflict terms
 * entirely — this is the flag that lets a challenger commit instead of
 * chickening out. Signal compliance is separate (`rules.obeySignals`) because
 * running a red is a *rule* violation, not a safety-system failure.
 */
export function governorCap(
  a: ActorRuntime,
  leader: { gapM: number; speedMps: number } | null,
  stopLineDistM: number | null,
  conflict: { distM: number; deltaT: number } | null,
): HazardResult {
  const lim = limitsFor(a);
  let cap = Infinity;
  let required = 0;
  let reason: HazardResult['reason'] = 'none';

  if (a.rules.collisionAvoidance && leader) {
    const headwayS = 1.5 - a.rules.aggression; // 1.0 s at the neutral setting
    const desired = Math.max(a.speedMps * headwayS, GAP_MIN_M);
    const accel = gapAccel(a, leader.gapM, leader.speedMps, desired, lim);
    const req = requiredDecelFor(a.speedMps - leader.speedMps, leader.gapM);
    required = Math.max(required, req);
    if (accel < cap) {
      cap = accel;
      reason = 'leader';
    }
  }

  if (stopLineDistM !== null) {
    // Brake to a stop at the line: a = -v² / 2d, with a 0.5 m standoff. Inside
    // the standoff the term saturates so the actor comes to a *clean* stop
    // rather than creeping asymptotically toward the line.
    const d = stopLineDistM - 0.5;
    const accel = d <= 0.05 ? -lim.brakeHard : -(a.speedMps * a.speedMps) / (2 * d);
    required = Math.max(required, -accel);
    const capped = Math.max(accel, -lim.brakeHard);
    if (capped < cap) {
      cap = capped;
      reason = 'signal';
    }
  }

  if (a.rules.collisionAvoidance && a.rules.yield && conflict) {
    // Give way: shed enough speed that we reach the crossing after them.
    const accel = -(a.speedMps * a.speedMps) / (2 * Math.max(conflict.distM - 2, 0.5));
    required = Math.max(required, -accel);
    const capped = Math.max(accel, -lim.brakeComfort);
    if (capped < cap) {
      cap = capped;
      reason = 'conflict';
    }
  }

  return { accelCap: cap, requiredDecel: required, reason };
}

/* ----------------------------------------------------------------- lateral */

/** Lateral offset for this tick, rate limited. Returns `{offset, rate}`. */
export function lateralStep(
  a: ActorRuntime,
  t: number,
  dt: number,
): { offset: number; rate: number; complete: boolean } {
  const lim = limitsFor(a);
  const cmd = a.latCmd;
  const target = cmd ? cmd.to : 0;
  let desired: number;
  let complete = false;
  if (cmd) {
    const elapsed = t + dt - cmd.firedAt;
    desired = transitionValue(cmd.dynamics, cmd.from, cmd.to, elapsed, cmd.duration);
    complete = elapsed >= cmd.duration;
  } else {
    // No owner: relax any residual offset back to the centreline in ~1 s.
    desired = a.lateralOffsetM + (target - a.lateralOffsetM) * clamp(dt / 1.0, 0, 1);
  }
  const maxStep = lim.lateralRateMax * dt;
  const delta = clamp(desired - a.lateralOffsetM, -maxStep, maxStep);
  const rawRate = delta / dt;
  const maxRateChange = lim.lateralAccelMax * dt;
  const rate = clamp(rawRate, a.lateralRateMps - maxRateChange, a.lateralRateMps + maxRateChange);
  return { offset: a.lateralOffsetM + rate * dt, rate, complete };
}

/** Heading including the body slip implied by lateral motion. */
export function headingWithSlip(pathHeading: number, lateralRate: number, speed: number): number {
  return pathHeading + Math.atan2(lateralRate, Math.max(speed, 0.5));
}

/* ------------------------------------------------------- hazard detection */

/** Nearest actor ahead in the same lane corridor, on the observer's route. */
export function findLeader(
  a: ActorRuntime,
  others: readonly ActorRuntime[],
  corridorHalfWidthM = 1.6,
): { gapM: number; speedMps: number; id: string } | null {
  let best: { gapM: number; speedMps: number; id: string } | null = null;
  for (const b of others) {
    if (b.id === a.id || !b.present || b.retired) continue;
    const gap = alongRouteGapM(a, b);
    if (gap === null || gap <= 0) continue;
    const lateral = lateralSeparationM(a, b);
    if (lateral === null || Math.abs(lateral) > corridorHalfWidthM) continue;
    if (best === null || gap < best.gapM) best = { gapM: gap, speedMps: b.speedMps, id: b.id };
  }
  return best;
}

/**
 * Distance to the next stop line the actor must respect, or `null`.
 *
 * Only lines on lanes the route actually traverses count, and only ahead of the
 * actor. A yellow is treated as forbidding entry; the governor's `-v²/2d` cap
 * then naturally lets a car too close to stop comfortably continue through,
 * because the required decel exceeds `brakeHard` and the cap saturates.
 */
export function distanceToStopLine(
  a: ActorRuntime,
  signals: SignalBook,
  t: number,
  lookaheadM: number,
): number | null {
  if (!a.rules.obeySignals || signals.isEmpty || a.route.isFreeform) return null;
  let best: number | null = null;
  for (const leg of a.route.legs) {
    if (leg.sStart + leg.lengthM < a.routeS) continue;
    if (leg.sStart - a.routeS > lookaheadM) break;
    for (const line of signals.onLane(leg.rsl)) {
      if (
        line.connectingLaneRsls.length > 0 &&
        !a.route.legs.some(
          (candidate) =>
            candidate.sStart >= leg.sStart && line.connectingLaneRsls.includes(candidate.rsl),
        )
      ) {
        continue;
      }
      const laneS = leg.reversed ? leg.lengthM - line.s : line.s;
      const routeS = leg.sStart + laneS;
      const d = routeS - a.routeS;
      if (d < -0.5 || d > lookaheadM) continue;
      const phase = signals.phaseAt(line.signalId, t);
      if (phase === null || !phaseForbidsEntry(phase)) continue;
      if (best === null || d < best) best = Math.max(d, 0);
    }
  }
  return best;
}
