import { describe, expect, it } from 'vitest';
import { behaviorSignature, requiredBehaviorChecksPassed, variationPreview } from '../behavior';

const trace = {
  header: { clipSeconds: 20 },
  ticks: {
    t: [0, 1, 2],
    actors: {
      ego: { x: [1, 2, 3], y: [4, 5, 6], headingRad: [0, 0, 0], speedMps: [1, 2, 3], laneRsl: ['r:0:-1', 'r:0:-1', 'r:0:-1'], s: [2, 4, 7], present: [1, 1, 1] },
    },
  },
  events: [{ t: 1, kind: 'trigger_fired', interactionId: 'brake', actorId: 'ego', verb: 'speed', forced: false }],
  metrics: { minTTC: null, collisions: [], triggerNeverFired: [], invariantResiduals: [], ticksSimulated: 3 },
} as any;

describe('variation behavior evidence', () => {
  it('summarizes semantic behavior independently of map coordinates', () => {
    expect(behaviorSignature(trace)).toMatchObject({ durationS: 20, actors: { ego: { routeClass: 'lane', distanceM: 5, finalSpeedMps: 3, interactionOrder: ['brake'] } } });
    expect(requiredBehaviorChecksPassed(trace)).toBe(true);
  });

  it('builds a scene-frame route and conflict overlay', () => {
    const preview = variationPreview(trace, [{ x: 8, z: -9, role: 'challenger' }], true, 'permutation');
    expect(preview.actors[0]?.points).toEqual([{ x: 1, z: -4 }, { x: 2, z: -5 }, { x: 3, z: -6 }]);
    expect(preview).toMatchObject({ mirrored: true, permutationKey: 'permutation', conflicts: [{ role: 'challenger' }] });
  });

  it('fails required checks for missed triggers and invariant residuals', () => {
    expect(requiredBehaviorChecksPassed({ ...trace, metrics: { ...trace.metrics, triggerNeverFired: ['brake'] } })).toBe(false);
    expect(requiredBehaviorChecksPassed({ ...trace, metrics: { ...trace.metrics, invariantResiduals: [{ id: 'pet', residual: .2 }] } })).toBe(false);
  });
});

