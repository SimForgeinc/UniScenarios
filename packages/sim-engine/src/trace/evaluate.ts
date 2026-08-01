/**
 * `evaluateTrace` — the reject filters every generated concrete passes through.
 *
 * From `docs/research/interactions-and-edge-cases.md` §Parameterization:
 *
 * | filter | rejects when |
 * |---|---|
 * | `trivially_safe` | `minTTC > 3 s` (tag as negative control instead of dropping) |
 * | `physically_unavoidable` | required decel exceeds `μg` — RSS-style |
 * | `never_fired` | any trigger never fired |
 * | `out_of_window` | the criticality peak falls outside `t ∈ [4, clip−4]` |
 * | `collision` | opt-in; off by default because some archetypes want contact |
 *
 * A scenario tagged `negative-control` keeps its `trivially_safe` finding but
 * is *accepted* — the taxonomy deliberately includes curb-standing pedestrians
 * and phantom-brake bait whose whole point is that nothing happens.
 */

import type { EpisodeMetrics, SimTrace } from './trace.js';
import { criticalityWindow } from './metrics.js';

export interface EvaluateFilters {
  /** `minTTC` above this is trivially safe. Default 3 s. */
  readonly trivialTtcS?: number;
  /** Road-friction decel ceiling, m/s². Default `0.8 × 9.81 = 7.85`. */
  readonly maxAchievableDecelMps2?: number;
  /** Criticality window. Defaults to `[4, clipSeconds − 4]`. */
  readonly window?: [number, number];
  /** Treat any collision as a rejection. Default `false`. */
  readonly rejectCollisions?: boolean;
  /** Skip `trivially_safe`; the scenario is a deliberate negative control. */
  readonly negativeControl?: boolean;
  /** Only apply the never-fired filter to these interaction ids. */
  readonly requiredTriggers?: readonly string[];
}

export type RejectCode =
  | 'trivially_safe'
  | 'physically_unavoidable'
  | 'never_fired'
  | 'out_of_window'
  | 'collision'
  | 'occlusion_unproven'
  | 'no_interaction';

export interface RejectFinding {
  readonly code: RejectCode;
  readonly reason: string;
  readonly detail?: Record<string, unknown>;
}

export interface TraceEvaluation {
  readonly verdict: 'accept' | 'reject';
  readonly findings: RejectFinding[];
  readonly tags: string[];
  /** Convenience copy of the numbers the verdict was based on. */
  readonly summary: {
    readonly minTTC: number | null;
    readonly minTTCt: number | null;
    readonly requiredDecelMax: number;
    readonly collisions: number;
    readonly neverFired: number;
    readonly occlusionUnproven: number;
  };
}

export const DEFAULT_TRIVIAL_TTC_S = 3;
export const DEFAULT_MAX_DECEL_MPS2 = 0.8 * 9.81;

export function evaluateMetrics(
  metrics: EpisodeMetrics,
  clipSeconds: number,
  filters: EvaluateFilters = {},
): TraceEvaluation {
  const findings: RejectFinding[] = [];
  const tags: string[] = [];
  const trivialTtc = filters.trivialTtcS ?? DEFAULT_TRIVIAL_TTC_S;
  const maxDecel = filters.maxAchievableDecelMps2 ?? DEFAULT_MAX_DECEL_MPS2;
  const [lo, hi] = filters.window ?? criticalityWindow(clipSeconds);

  const minTtc = metrics.minTTC;
  if (minTtc === null) {
    findings.push({
      code: 'no_interaction',
      reason: 'no pair ever closed on another — the episode has no interaction at all',
    });
  } else if (minTtc.value > trivialTtc) {
    tags.push('negative-control');
    findings.push({
      code: 'trivially_safe',
      reason: `min TTC ${minTtc.value.toFixed(2)} s exceeds the ${trivialTtc} s triviality threshold`,
      detail: { minTTC: minTtc.value, pair: minTtc.pair },
    });
  }

  let worstDecel = 0;
  let worstActor = '';
  for (const id of Object.keys(metrics.requiredDecelMax).sort()) {
    const v = metrics.requiredDecelMax[id]!;
    if (v > worstDecel) {
      worstDecel = v;
      worstActor = id;
    }
  }
  if (worstDecel > maxDecel) {
    findings.push({
      code: 'physically_unavoidable',
      reason: `${worstActor} needed ${worstDecel.toFixed(2)} m/s², above the ${maxDecel.toFixed(2)} m/s² friction ceiling`,
      detail: { actorId: worstActor, requiredDecel: worstDecel, ceiling: maxDecel },
    });
  }

  const required = filters.requiredTriggers;
  const neverFired = required
    ? metrics.triggerNeverFired.filter((id) => required.includes(id))
    : metrics.triggerNeverFired;
  if (neverFired.length > 0) {
    findings.push({
      code: 'never_fired',
      reason: `trigger(s) never fired: ${neverFired.join(', ')}`,
      detail: { interactionIds: neverFired },
    });
  }

  if (minTtc !== null && (minTtc.t < lo || minTtc.t > hi)) {
    findings.push({
      code: 'out_of_window',
      reason: `criticality peak at t=${minTtc.t.toFixed(2)} s falls outside [${lo}, ${hi}] s`,
      detail: { t: minTtc.t, window: [lo, hi] },
    });
  }

  if (metrics.collisions.length > 0) {
    tags.push('collision');
    if (filters.rejectCollisions) {
      findings.push({
        code: 'collision',
        reason: `${metrics.collisions.length} collision(s) occurred`,
        detail: { collisions: metrics.collisions },
      });
    }
  }

  const occlusionUnproven = (metrics.declaredOcclusion ?? []).filter(
    (entry) => entry.status !== 'revealed_before_conflict',
  );
  if (occlusionUnproven.length > 0) {
    findings.push({
      code: 'occlusion_unproven',
      reason: `${occlusionUnproven.length} declared occlusion relation(s) did not produce a blocked-to-clear reveal before conflict`,
      detail: {
        declarations: occlusionUnproven.map((entry) => ({
          observer: entry.observer,
          target: entry.target,
          occluderId: entry.occluderId ?? null,
          status: entry.status,
        })),
      },
    });
  }

  const blocking = findings.filter(
    (f) => !(f.code === 'trivially_safe' && filters.negativeControl),
  );

  return {
    verdict: blocking.length === 0 ? 'accept' : 'reject',
    findings,
    tags,
    summary: {
      minTTC: minTtc?.value ?? null,
      minTTCt: minTtc?.t ?? null,
      requiredDecelMax: worstDecel,
      collisions: metrics.collisions.length,
      neverFired: neverFired.length,
      occlusionUnproven: occlusionUnproven.length,
    },
  };
}

/** Apply the reject filters to a trace. */
export function evaluateTrace(trace: SimTrace, filters: EvaluateFilters = {}): TraceEvaluation {
  return evaluateMetrics(trace.metrics, trace.header.clipSeconds, filters);
}
