import { describe, expect, it } from 'vitest';
import { boundedTrafficActorCount } from './protocol';

describe('SUMO transferred-state actor cap', () => {
  it('never transfers more actors than the requested product tier', () => {
    expect(boundedTrafficActorCount(105, 100)).toBe(100);
    expect(boundedTrafficActorCount(26, 32)).toBe(26);
    expect(boundedTrafficActorCount(1, 0)).toBe(0);
  });
});
