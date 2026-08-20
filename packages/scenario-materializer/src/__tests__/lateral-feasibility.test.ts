import { describe, expect, it } from 'vitest';

import { lateralFeasibilityEnvelope } from '../materialize.js';

const car = {
  tireMu: 1,
  maxLateralAccelerationMps2: 7,
  maxSteerRad: 0.58,
  wheelbaseM: 2.7,
} as const;

describe('lateral feasibility envelope', () => {
  it('accepts the measured full-grip construction return', () => {
    const result = lateralFeasibilityEnvelope(1.5, 1.2, 11.11, 1, car);

    expect(result.demandedAccelerationMps2).toBeCloseTo(6.014, 3);
    expect(result.tyreCeilingMps2).toBe(7);
    expect(result.availableAccelerationMps2).toBe(7);
    expect(result.minimumDurationS).toBeLessThan(1.2);
  });

  it('uses the local ice grip instead of the scene-wide dry ceiling', () => {
    const dry = lateralFeasibilityEnvelope(1.5, 1.2, 11.11, 1, car);
    const ice = lateralFeasibilityEnvelope(1.5, 1.2, 11.11, 0.15, car);

    expect(dry.availableAccelerationMps2).toBe(7);
    expect(ice.tyreCeilingMps2).toBeCloseTo(1.4709975, 7);
    expect(ice.availableAccelerationMps2).toBeCloseTo(1.4709975, 7);
    expect(ice.demandedAccelerationMps2).toBeGreaterThan(ice.availableAccelerationMps2);
    expect(ice.minimumDurationS).toBeGreaterThan(1.2);
  });
});
