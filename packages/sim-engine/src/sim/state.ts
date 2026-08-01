/**
 * Mutable per-tick simulation state.
 *
 * Runtime objects are plain mutable records rather than immutable snapshots:
 * the engine is a tight fixed-step loop and allocation churn shows up directly
 * in the ticks/sec budget. Determinism comes from *iteration order* (every fan
 * out is over a sorted id list) not from immutability.
 */

import type { Vec2 } from '../core/math.js';
import type { Route } from '../map/route.js';
import type { LaneRsl } from '../map/topology.js';
import type {
  ActorKind,
  ActorRules,
  Dims,
  Dynamics,
  Interaction,
  TurnRelation,
} from '../schema/input.js';

/** The five axes. `set` owns one axis per key so two `set`s of different keys
 * coexist, matching "one axis, one owner" without over-serialising state. */
export type AxisId = 'longitudinal' | 'lateral' | 'route' | 'existence' | `state:${string}`;

export function axisOf(interaction: Interaction): AxisId {
  switch (interaction.verb) {
    case 'speed':
    case 'gap':
      return 'longitudinal';
    case 'changeLane':
    case 'laneOffset':
      return 'lateral';
    case 'route':
      return 'route';
    case 'exist':
      return 'existence';
    case 'set':
      return `state:${interaction.target.key}`;
  }
}

export interface LongitudinalCommand {
  readonly kind: 'speed' | 'gap';
  readonly interactionId: string;
  readonly firedAt: number;
  readonly dynamics: Dynamics;
  /** Speed at fire time, m/s — the profile's start value. */
  readonly v0: number;
  /** Profile duration in seconds, frozen at fire time. */
  duration: number;
  /** Resolved absolute target, m/s. Re-evaluated per tick for `match`/`gap`. */
  target: number;
  /** `gap` only. */
  readonly gap?: { actorId: string; value: number; mode: 'time' | 'distance' };
  /** `speed` only — kept so `match` can be re-resolved. */
  readonly speedTarget?: Interaction & { verb: 'speed' };
}

export interface LateralCommand {
  readonly kind: 'changeLane' | 'laneOffset';
  readonly interactionId: string;
  readonly firedAt: number;
  readonly dynamics: Dynamics;
  readonly from: number;
  readonly to: number;
  duration: number;
  /** `changeLane` only: the route to adopt once the profile completes. */
  pending?: { route: Route; s: number; separationM: number; targetRsl: LaneRsl | null };
  /** Remaining lane changes for a multi-lane `count`. */
  remaining: number;
  side?: 'left' | 'right';
  done: boolean;
}

export interface ActorRuntime {
  readonly id: string;
  readonly kind: ActorKind;
  readonly dims: Dims;
  readonly tags: readonly string[];
  rules: ActorRules;
  /** Free-flow cruise speed, m/s (recomputed when `speedFactor` changes). */
  cruiseSpeedMps: number;
  cruiseOverrideMps: number | null;

  route: Route;
  routeS: number;
  /** Remaining turn preferences, consumed when a route is rebuilt. */
  remainingTurns: TurnRelation[];

  speedMps: number;
  accelMps2: number;
  lateralOffsetM: number;
  lateralRateMps: number;

  position: Vec2;
  headingRad: number;

  present: boolean;
  /** `true` once the actor left the world for good (route end / clip end). */
  retired: boolean;

  longCmd: LongitudinalCommand | null;
  latCmd: LateralCommand | null;
  /** `until` conditions keyed by axis, released when satisfied. */
  untilByAxis: Map<AxisId, { interactionId: string; condition: NonNullable<Interaction['until']> }>;

  /** `set()` registry — the authoritative store for `lights.*`, `doors.*`, … */
  stateKeys: Map<string, boolean | number | string>;

  standstillSinceS: number | null;
  /** Running max of the decel that would have been required to stay safe. */
  requiredDecelMax: number;
}

/** Circumscribed radius used by the coarse pair metrics (TTC, min distance). */
export function actorRadius(a: { dims: Dims }): number {
  return Math.hypot(a.dims.l, a.dims.w) / 2;
}

export interface WorldState {
  t: number;
  readonly dt: number;
  readonly actors: ActorRuntime[];
  readonly byId: Map<string, ActorRuntime>;
  /** Pairs that are currently overlapping, so a collision fires once. */
  readonly activeCollisions: Set<string>;
}
