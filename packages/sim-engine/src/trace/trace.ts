/**
 * The trace format — the engine's only output.
 *
 * Columnar per actor: one array per channel, index-aligned with `ticks.t`. That
 * keeps gzipped traces small (long runs of near-identical floats compress well)
 * and makes the editor's scrubber a pair of array lookups.
 *
 * **Frame:** `header.frame` is always `'xodr-local'` — `x` east, `y` north,
 * headings CCW from `+x`. Consumers that draw in the y-up scene frame apply
 * `scene = (x, 0, -y)` (see `src/frames.ts`), or call `traceToSceneFrame`.
 *
 * Only `t ∈ [0, clipSeconds]` is recorded. The warm-up prologue is excluded by
 * construction; the state at `t = 0` *is* the prologue's final state.
 */

import { quantize } from '../core/math.js';
import { toSceneXZ } from '../frames.js';

export const TRACE_FORMAT_VERSION = 1;

/** Decimal places each channel is quantised to before serialisation. */
export const TRACE_PRECISION = {
  t: 6,
  position: 4,
  heading: 6,
  speed: 4,
  s: 4,
} as const;

export interface ActorTrack {
  readonly x: number[];
  readonly y: number[];
  readonly headingRad: number[];
  readonly speedMps: number[];
  readonly laneRsl: Array<string | null>;
  /** Route arc length, metres. */
  readonly s: number[];
  /** 1 while the actor exists in the world, 0 before spawn / after despawn. */
  readonly present: number[];
}

/** Export/render-ready phase channel for one concrete signal program. */
export interface SignalTrack {
  readonly phase: Array<'green' | 'yellow' | 'red'>;
}

export type SimEvent =
  | { t: number; kind: 'trigger_fired'; interactionId: string; actorId: string; verb: string; forced: boolean }
  | { t: number; kind: 'trigger_skipped'; interactionId: string; actorId: string; reason: string }
  | {
      t: number;
      kind: 'preemption';
      actorId: string;
      axis: string;
      byInteractionId: string;
      preemptedInteractionId: string;
    }
  | { t: number; kind: 'released'; actorId: string; axis: string; interactionId: string; reason: 'until' | 'complete' }
  | { t: number; kind: 'lane_change'; actorId: string; fromRsl: string | null; toRsl: string | null; legal: boolean }
  | { t: number; kind: 'lane_change_rejected'; actorId: string; interactionId: string; reason: string }
  | { t: number; kind: 'collision'; a: string; b: string }
  | { t: number; kind: 'spawn'; actorId: string }
  | { t: number; kind: 'despawn'; actorId: string; reason: 'route_end' | 'interaction' | 'clip_end' }
  | { t: number; kind: 'state_set'; actorId: string; key: string; value: boolean | number | string };

export interface PairMinDistance {
  readonly pair: [string, string];
  readonly minDistanceM: number;
  readonly t: number;
}

export interface MinTtcRecord {
  readonly value: number;
  readonly t: number;
  readonly pair: [string, string];
}

export interface RevealToConflict {
  /** Directional authored relation; unlike `pair`, these fields preserve roles. */
  readonly observer: string;
  readonly target: string;
  /** Seconds between line of sight opening and the conflict moment. */
  readonly value: number;
  /** First time the declared occluder ref actually blocked this pair. */
  readonly firstBlockedT: number;
  readonly losOpenT: number;
  readonly conflictT: number;
  readonly pair: [string, string];
  /** Concrete id or author-level group id from the declared occlusion pair. */
  readonly occluderId?: string;
  /** Concrete occluder members that resolved from the declaration. */
  readonly relevantOccluderIds: string[];
}

export interface OccluderIneffective {
  /** Directional authored relation; unlike `pair`, these fields preserve roles. */
  readonly observer: string;
  readonly target: string;
  /** Pair whose criticality was measured while the declared occluders never blocked LOS. */
  readonly pair: [string, string];
  readonly conflictT: number;
  /** Present when the first block happened only after `conflictT`, so it was too late. */
  readonly firstBlockedT?: number;
  /** Specific declared occluder or group that was ineffective; absent means the declaration allowed any occluder. */
  readonly occluderId?: string;
  readonly relevantOccluderIds: string[];
  readonly reason: 'never_blocked_before_conflict';
}

export type DeclaredOcclusionStatus =
  | 'revealed_before_conflict'
  | 'blocked_at_conflict'
  | 'never_blocked_before_conflict'
  | 'occluder_unobserved'
  | 'pair_unobserved';

/** One result for every authored observer/target/occluder declaration. */
export interface DeclaredOcclusionMetric {
  readonly observer: string;
  readonly target: string;
  /** Stable, unordered pair used by the distance/TTC metric tables. */
  readonly pair: [string, string];
  readonly occluderId?: string;
  readonly relevantOccluderIds: string[];
  readonly status: DeclaredOcclusionStatus;
  readonly firstBlockedT: number | null;
  readonly losOpenT: number | null;
  readonly conflictT: number | null;
  readonly revealToConflictS: number | null;
}

export interface InvariantResidual {
  readonly id: string;
  readonly kind: string;
  readonly target: number;
  readonly achieved: number;
  readonly residual: number;
}

export interface EpisodeMetrics {
  readonly minTTC: MinTtcRecord | null;
  readonly minDistance: PairMinDistance[];
  readonly requiredDecelMax: Record<string, number>;
  readonly invariantResiduals?: InvariantResidual[];
  readonly revealToConflict?: RevealToConflict | null;
  /** Complete directional evidence, one entry per authored occlusion pair. */
  readonly declaredOcclusion?: DeclaredOcclusionMetric[];
  /** Declared occlusion pairs that were never hidden before their closest criticality sample. */
  readonly occluderIneffective?: OccluderIneffective[];
  readonly collisions: Array<{ t: number; a: string; b: string }>;
  readonly triggerNeverFired: string[];
  /**
   * `true` when the criticality peak falls outside `t ∈ [4, clipSeconds - 4]` —
   * the research doc's "clipped criticality" reject filter.
   */
  readonly clippedCriticality: boolean;
  /** Wall-clock-free performance counter: integration steps executed. */
  readonly ticksSimulated: number;
}

export interface TraceHeader {
  readonly traceVersion: number;
  readonly engineVersion: string;
  /** `sha256(canonicalJson(parsedInput))`. */
  readonly inputHash: string;
  readonly seed: number | string;
  readonly mapId: string;
  /** Engine graph digest (currently source XODR sha256). */
  readonly engineGraphDigest: string;
  /** @deprecated use engineGraphDigest; kept for older trace consumers. */
  readonly topologyDigest: string;
  readonly dt: number;
  readonly clipSeconds: number;
  readonly warmupSeconds: number;
  readonly frame: 'xodr-local';
  readonly actorIds: string[];
  readonly metricSubject: string | null;
}

export interface SimTrace {
  readonly header: TraceHeader;
  readonly ticks: {
    readonly t: number[];
    readonly actors: Record<string, ActorTrack>;
    /** Present on traces produced by signal-aware engines; empty on unsignalized maps. */
    readonly signals?: Record<string, SignalTrack>;
  };
  readonly events: SimEvent[];
  readonly metrics: EpisodeMetrics;
}

/** Quantise every channel — the last step before a trace is compared or hashed. */
export function quantizeTrace(trace: SimTrace): SimTrace {
  const actors: Record<string, ActorTrack> = {};
  for (const id of Object.keys(trace.ticks.actors).sort()) {
    const tr = trace.ticks.actors[id]!;
    actors[id] = {
      x: tr.x.map((v) => quantize(v, TRACE_PRECISION.position)),
      y: tr.y.map((v) => quantize(v, TRACE_PRECISION.position)),
      headingRad: tr.headingRad.map((v) => quantize(v, TRACE_PRECISION.heading)),
      speedMps: tr.speedMps.map((v) => quantize(v, TRACE_PRECISION.speed)),
      laneRsl: [...tr.laneRsl],
      s: tr.s.map((v) => quantize(v, TRACE_PRECISION.s)),
      present: [...tr.present],
    };
  }
  return {
    ...trace,
    ticks: {
      t: trace.ticks.t.map((v) => quantize(v, TRACE_PRECISION.t)),
      actors,
      ...(trace.ticks.signals
        ? {
            signals: Object.fromEntries(
              Object.keys(trace.ticks.signals)
                .sort()
                .map((id) => [id, { phase: [...trace.ticks.signals![id]!.phase] }]),
            ),
          }
        : {}),
    },
  };
}

/** A trace whose tick channels are in the y-up scene frame. */
export interface SceneTrace {
  readonly header: Omit<TraceHeader, 'frame'> & { readonly frame: 'scene' };
  readonly ticks: {
    readonly t: number[];
    readonly actors: Record<string, Omit<ActorTrack, 'y'> & { z: number[] }>;
    readonly signals?: Record<string, SignalTrack>;
  };
  readonly events: SimEvent[];
  readonly metrics: EpisodeMetrics;
}

/** A copy with `ticks` rewritten into the y-up scene frame (`x`, `z`). */
export function traceToSceneFrame(trace: SimTrace): SceneTrace {
  const actors: Record<string, Omit<ActorTrack, 'y'> & { z: number[] }> = {};
  for (const id of Object.keys(trace.ticks.actors).sort()) {
    const tr = trace.ticks.actors[id]!;
    const x: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < tr.x.length; i++) {
      const p = toSceneXZ({ x: tr.x[i]!, y: tr.y[i]! });
      x.push(p.x);
      z.push(p.z);
    }
    actors[id] = {
      x,
      z,
      headingRad: [...tr.headingRad],
      speedMps: [...tr.speedMps],
      laneRsl: [...tr.laneRsl],
      s: [...tr.s],
      present: [...tr.present],
    };
  }
  return {
    header: { ...trace.header, frame: 'scene' },
    ticks: {
      t: [...trace.ticks.t],
      actors,
      ...(trace.ticks.signals
        ? {
            signals: Object.fromEntries(
              Object.keys(trace.ticks.signals)
                .sort()
                .map((id) => [id, { phase: [...trace.ticks.signals![id]!.phase] }]),
            ),
          }
        : {}),
    },
    events: trace.events,
    metrics: trace.metrics,
  };
}
