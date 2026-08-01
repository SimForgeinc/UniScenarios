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
import type { OcclusionPair } from '../schema/input.js';
import type { ActorRuntime } from '../sim/state.js';
import { hasLineOfSight, type OccluderShape } from '../sim/visibility.js';
import type { EpisodeMetrics, MinTtcRecord, OccluderIneffective, PairMinDistance, RevealToConflict } from './trace.js';

interface PairAccumulator {
  readonly a: string;
  readonly b: string;
  minDistance: number;
  minDistanceT: number;
  minTtc: number;
  minTtcT: number;
}

interface BlockedInterval {
  readonly startT: number;
  endT: number | null;
}

interface OcclusionMonitor {
  readonly key: string;
  readonly pair: [string, string];
  readonly occluderId?: string;
  /** Concrete ids observed for this declared ref; proves a non-vacuous relevant set. */
  readonly relevantOccluderIds: Set<string>;
  /** Blocked intervals observed after t=0, transition-compressed. */
  readonly blockedIntervals: BlockedInterval[];
  /** First sample at or after t=0 where this declared ref blocked the pair. */
  firstBlockedT: number | null;
  /** Most recent transition from blocked to clear line of sight. */
  losOpenT: number | null;
  losBlocked: boolean;
  sawOccluder: boolean;
  sawBlocked: boolean;
}

export interface MetricAccumulator {
  readonly pairs: Map<string, PairAccumulator>;
  readonly occlusionMonitors: OcclusionMonitor[];
  readonly requiredDecelMax: Record<string, number>;
  readonly collisions: Array<{ t: number; a: string; b: string }>;
  readonly triggerNeverFired: string[];
  ticks: number;
}

export function newMetricAccumulator(
  actorIds: readonly string[],
  occlusionPairs: readonly OcclusionPair[] = [],
): MetricAccumulator {
  const requiredDecelMax: Record<string, number> = {};
  for (const id of [...actorIds].sort()) requiredDecelMax[id] = 0;
  return {
    pairs: new Map(),
    occlusionMonitors: occlusionPairs
      .map((p) => ({
        key: pairKey(p.observer, p.target),
        pair: [p.observer, p.target] as [string, string],
        ...(p.occluderId === undefined ? {} : { occluderId: p.occluderId }),
        relevantOccluderIds: new Set<string>(),
        blockedIntervals: [],
        firstBlockedT: null,
        losOpenT: null,
        losBlocked: false,
        sawOccluder: false,
        sawBlocked: false,
      }))
      .sort((a, b) => a.key.localeCompare(b.key) || (a.occluderId ?? '').localeCompare(b.occluderId ?? '')),
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
  const live = actors.filter((a) => a.present && !a.retired && !a.static);
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
      const key = pairKey(a.id, b.id);
      for (const monitor of acc.occlusionMonitors) {
        if (monitor.key !== key) continue;
        const relevant = monitor.occluderId
          ? occluders.filter((o) => o.id === monitor.occluderId || o.groupId === monitor.occluderId)
          : occluders;
        if (relevant.length === 0) continue;
        monitor.sawOccluder = true;
        for (const o of relevant) monitor.relevantOccluderIds.add(o.id);
        const clear = hasLineOfSight(a.position, b.position, relevant);
        if (!clear) {
          if (!monitor.losBlocked) monitor.blockedIntervals.push({ startT: t, endT: null });
          if (monitor.firstBlockedT === null) monitor.firstBlockedT = t;
          monitor.losBlocked = true;
          monitor.sawBlocked = true;
        } else if (monitor.losBlocked) {
          monitor.losBlocked = false;
          monitor.losOpenT = t;
          const latest = monitor.blockedIntervals[monitor.blockedIntervals.length - 1];
          if (latest) latest.endT = t;
        }
      }
    }
  }
}

/** The criticality window from the research doc's 20 s timing contract. */
export function criticalityWindow(clipSeconds: number): [number, number] {
  return [4, Math.max(4, clipSeconds - 4)];
}

function revealOpenTAtConflict(monitor: OcclusionMonitor, conflictT: number): number | null {
  let latest: BlockedInterval | null = null;
  for (const interval of monitor.blockedIntervals) {
    if (interval.startT <= conflictT) latest = interval;
    else break;
  }
  // If the latest blocked interval before conflict has no closing clear sample,
  // or clears only after conflict, the actor is still hidden at conflict. Do not
  // reuse an older open transition from a previous interval.
  if (!latest || latest.endT === null || latest.endT > conflictT) return null;
  return latest.endT;
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
  const occluderIneffective: OccluderIneffective[] = [];
  if (minTTC) {
    const candidates = acc.occlusionMonitors
      .filter((m) => m.key === pairKey(minTTC.pair[0], minTTC.pair[1]))
      .map((m) => ({ monitor: m, losOpenT: revealOpenTAtConflict(m, minTTC.t) }))
      .filter((c): c is { monitor: OcclusionMonitor; losOpenT: number } => c.losOpenT !== null)
      .sort((a, b) => b.losOpenT - a.losOpenT);
    const best = candidates[0];
    if (best) {
      revealToConflict = {
        value: minTTC.t - best.losOpenT,
        firstBlockedT: best.monitor.firstBlockedT ?? best.losOpenT,
        losOpenT: best.losOpenT,
        conflictT: minTTC.t,
        pair: minTTC.pair,
        ...(best.monitor.occluderId === undefined ? {} : { occluderId: best.monitor.occluderId }),
        relevantOccluderIds: [...best.monitor.relevantOccluderIds].sort(),
      };
    }
  }
  for (const monitor of acc.occlusionMonitors) {
    const p = acc.pairs.get(monitor.key);
    if (!p || !monitor.sawOccluder || !Number.isFinite(p.minDistance)) continue;
    const conflictT = p.minTtc === Infinity ? p.minDistanceT : p.minTtcT;
    if (monitor.firstBlockedT === null || monitor.firstBlockedT > conflictT) {
      occluderIneffective.push({
        pair: monitor.pair,
        conflictT,
        ...(monitor.firstBlockedT === null ? {} : { firstBlockedT: monitor.firstBlockedT }),
        ...(monitor.occluderId === undefined ? {} : { occluderId: monitor.occluderId }),
        relevantOccluderIds: [...monitor.relevantOccluderIds].sort(),
        reason: 'never_blocked_before_conflict',
      });
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
    occluderIneffective,
    collisions: [...acc.collisions].sort((a, b) => a.t - b.t || (a.a < b.a ? -1 : 1)),
    triggerNeverFired: [...new Set(acc.triggerNeverFired)].sort(),
    clippedCriticality: clipped,
    ticksSimulated: acc.ticks,
  };
}
