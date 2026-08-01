/**
 * Episode metrics — the block that reject filters and evaluators consume.
 *
 * Accumulated online during the recorded window (`t ≥ 0`) so a long clip never
 * needs a second pass over the tick arrays.
 *
 * **reveal-to-conflict**: when occluders are present, we track for each pair
 * the last time line of sight *opened* before the criticality peak. The metric
 * is `conflictT − losOpenT` — the research doc's single derived occlusion
 * number, whose critical band is 0.4–1.5 s.
 */

import { pairKey, readPair } from '../sim/pairs.js';
import type { ActorRuntime } from '../sim/state.js';
import { hasLineOfSight, type OccluderShape } from '../sim/visibility.js';
import type { EpisodeMetrics, MinTtcRecord, PairMinDistance, RevealToConflict } from './trace.js';

interface PairAccumulator {
  readonly a: string;
  readonly b: string;
  minDistance: number;
  minDistanceT: number;
  minTtc: number;
  minTtcT: number;
  /** Most recent transition from blocked to clear line of sight. */
  losOpenT: number | null;
  losBlocked: boolean;
  sawOccluder: boolean;
}

export interface MetricAccumulator {
  readonly pairs: Map<string, PairAccumulator>;
  readonly requiredDecelMax: Record<string, number>;
  readonly collisions: Array<{ t: number; a: string; b: string }>;
  readonly triggerNeverFired: string[];
  ticks: number;
}

export function newMetricAccumulator(actorIds: readonly string[]): MetricAccumulator {
  const requiredDecelMax: Record<string, number> = {};
  for (const id of [...actorIds].sort()) requiredDecelMax[id] = 0;
  return {
    pairs: new Map(),
    requiredDecelMax,
    collisions: [],
    triggerNeverFired: [],
    ticks: 0,
  };
}

function pairAcc(acc: MetricAccumulator, a: string, b: string): PairAccumulator {
  const key = pairKey(a, b);
  let p = acc.pairs.get(key);
  if (!p) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    p = {
      a: lo,
      b: hi,
      minDistance: Infinity,
      minDistanceT: 0,
      minTtc: Infinity,
      minTtcT: 0,
      losOpenT: null,
      losBlocked: false,
      sawOccluder: false,
    };
    acc.pairs.set(key, p);
  }
  return p;
}

/** Fold one recorded tick into the accumulator. */
export function observeTick(
  acc: MetricAccumulator,
  t: number,
  actors: readonly ActorRuntime[],
  _collisions: ReadonlySet<string>,
  occluders: readonly OccluderShape[],
): void {
  acc.ticks++;
  const live = actors.filter((a) => a.present && !a.retired);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      const p = pairAcc(acc, a.id, b.id);
      const r = readPair(a, b);
      if (r.gapM < p.minDistance) {
        p.minDistance = r.gapM;
        p.minDistanceT = t;
      }
      if (r.ttcS < p.minTtc) {
        p.minTtc = r.ttcS;
        p.minTtcT = t;
      }
      if (occluders.length > 0) {
        p.sawOccluder = true;
        const clear = hasLineOfSight(a.position, b.position, occluders);
        if (!clear) {
          p.losBlocked = true;
        } else if (p.losBlocked) {
          p.losBlocked = false;
          p.losOpenT = t;
        } else if (p.losOpenT === null) {
          p.losOpenT = t;
        }
      }
    }
  }
}

/** The criticality window from the research doc's 20 s timing contract. */
export function criticalityWindow(clipSeconds: number): [number, number] {
  return [4, Math.max(4, clipSeconds - 4)];
}

export function computeMetrics(acc: MetricAccumulator, clipSeconds: number): EpisodeMetrics {
  const keys = [...acc.pairs.keys()].sort();

  const minDistance: PairMinDistance[] = [];
  let minTTC: MinTtcRecord | null = null;
  for (const key of keys) {
    const p = acc.pairs.get(key)!;
    if (Number.isFinite(p.minDistance)) {
      minDistance.push({ pair: [p.a, p.b], minDistanceM: p.minDistance, t: p.minDistanceT });
    }
    if (Number.isFinite(p.minTtc) && (minTTC === null || p.minTtc < minTTC.value)) {
      minTTC = { value: p.minTtc, t: p.minTtcT, pair: [p.a, p.b] };
    }
  }

  let revealToConflict: RevealToConflict | null = null;
  if (minTTC) {
    const p = acc.pairs.get(pairKey(minTTC.pair[0], minTTC.pair[1]));
    if (p && p.sawOccluder && p.losOpenT !== null && p.losOpenT <= minTTC.t) {
      revealToConflict = {
        value: minTTC.t - p.losOpenT,
        losOpenT: p.losOpenT,
        conflictT: minTTC.t,
        pair: minTTC.pair,
      };
    }
  }

  const [lo, hi] = criticalityWindow(clipSeconds);
  const clipped = minTTC === null ? false : minTTC.t < lo || minTTC.t > hi;

  const requiredDecelMax: Record<string, number> = {};
  for (const id of Object.keys(acc.requiredDecelMax).sort()) {
    requiredDecelMax[id] = acc.requiredDecelMax[id]!;
  }

  return {
    minTTC,
    minDistance,
    requiredDecelMax,
    revealToConflict,
    collisions: [...acc.collisions].sort((a, b) => a.t - b.t || (a.a < b.a ? -1 : 1)),
    triggerNeverFired: [...new Set(acc.triggerNeverFired)].sort(),
    clippedCriticality: clipped,
    ticksSimulated: acc.ticks,
  };
}
