import type { BehaviorSignature } from '@uniscenarios/anchor-matcher';
import type { SimTrace } from '@uniscenarios/sim-engine';
import type { VariationPreview } from './model';

export function behaviorSignature(trace: SimTrace): BehaviorSignature {
  const actors: BehaviorSignature['actors'] = {};
  for (const id of Object.keys(trace.ticks.actors).sort()) {
    const track = trace.ticks.actors[id]!;
    const interactionOrder = trace.events.flatMap((event) =>
      event.kind === 'trigger_fired' && event.actorId === id ? [event.interactionId] : []);
    const presentIndexes = track.present.flatMap((present, index) => present ? [index] : []);
    const first = presentIndexes[0];
    const last = presentIndexes.at(-1);
    const distanceM = first === undefined || last === undefined ? 0 : Math.abs(track.s[last]! - track.s[first]!);
    actors[id] = {
      routeClass: track.laneRsl.some(Boolean) ? 'lane' : 'freeform',
      distanceM,
      finalSpeedMps: last === undefined ? 0 : track.speedMps[last],
      interactionOrder,
    };
  }
  return {
    durationS: trace.header.clipSeconds,
    actors,
    ...(trace.metrics.minTTC ? { minTtcS: trace.metrics.minTTC.value } : {}),
    ...(trace.metrics.minPET ? { minPetS: trace.metrics.minPET.value } : {}),
    collisions: trace.metrics.collisions.length,
    invariantFailures: (trace.metrics.invariantResiduals ?? [])
      .filter((item) => Math.abs(item.residual) > 1e-3)
      .map((item) => item.id)
      .sort(),
  };
}

export function variationPreview(trace: SimTrace, conflicts: VariationPreview['conflicts'], mirrored: boolean, permutationKey: string): VariationPreview {
  const actors = Object.keys(trace.ticks.actors).sort().map((id) => {
    const track = trace.ticks.actors[id]!;
    const stride = Math.max(1, Math.floor(track.x.length / 160));
    const points: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < track.x.length; i += stride) {
      if (track.present[i]) points.push({ x: track.x[i]!, z: -track.y[i]! });
    }
    const first = track.present.findIndex(Boolean);
    return {
      id,
      points,
      start: first < 0 ? { x: 0, z: 0 } : { x: track.x[first]!, z: -track.y[first]! },
    };
  });
  return { actors, conflicts, mirrored, permutationKey };
}

export function requiredBehaviorChecksPassed(trace: SimTrace): boolean {
  return trace.metrics.triggerNeverFired.length === 0
    && (trace.metrics.invariantResiduals ?? []).every((item) => Math.abs(item.residual) <= 1e-3);
}
