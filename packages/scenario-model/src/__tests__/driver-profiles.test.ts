import { describe, expect, it } from 'vitest';

import { DRIVER_PROFILES, driverProfileDefinition } from '../driver-profiles.js';

describe('driver profiles', () => {
  it('keeps assertiveness independent from traffic-law compliance', () => {
    expect(DRIVER_PROFILES.assertive.rules.aggression).toBeGreaterThan(DRIVER_PROFILES.lawful.rules.aggression);
    expect(DRIVER_PROFILES.assertive.rules.obeySignals).toBe(true);
    expect(DRIVER_PROFILES.cautious.rules.obeySignals).toBe(true);
    expect(DRIVER_PROFILES.violator.rules.obeySignals).toBe(false);
    expect(DRIVER_PROFILES.violator.rules.collisionAvoidance).toBe(true);
    expect(DRIVER_PROFILES.assertive.dynamics.comfortableLateralAccelerationMps2)
      .toBeGreaterThan(DRIVER_PROFILES.lawful.dynamics.comfortableLateralAccelerationMps2);
    expect(DRIVER_PROFILES.cautious.dynamics.comfortableLateralAccelerationMps2)
      .toBeLessThan(DRIVER_PROFILES.lawful.dynamics.comfortableLateralAccelerationMps2);
    expect(DRIVER_PROFILES.violator.dynamics).toEqual(DRIVER_PROFILES.lawful.dynamics);
  });

  it('defaults older authored roles to the lawful profile', () => {
    expect(driverProfileDefinition(undefined).id).toBe('lawful');
  });
});
