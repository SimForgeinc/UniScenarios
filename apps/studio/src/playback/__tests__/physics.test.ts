import { describe, expect, it } from 'vitest';
import { parseSimScenarioInput } from '@uniscenarios/sim-engine';
import { activePhysicsModeForTrace, withEditablePhysicsDefault } from '../physics';

describe('Studio physics migration', () => {
  const legacy = parseSimScenarioInput({
    actors: [{
      id: 'car', kind: 'car',
      initial: { pose: { x: 0, z: 0, headingRad: 0 }, speedMps: 0 },
      behavior: { route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] } },
    }],
  });

  it('pins an omitted editable document to dynamic-v1 without mutating the source', () => {
    const migrated = withEditablePhysicsDefault(legacy);
    expect(legacy.physics).toBeUndefined();
    expect(migrated.physics).toEqual({ mode: 'dynamic-v1' });
    expect(withEditablePhysicsDefault(migrated)).toBe(migrated);
  });

  it('preserves an explicit legacy pin and treats provenance-less evidence as kinematic', () => {
    const pinned = { ...legacy, physics: { mode: 'kinematic-v1' as const } };
    expect(withEditablePhysicsDefault(pinned)).toBe(pinned);
    expect(activePhysicsModeForTrace({ header: {} } as never)).toBe('kinematic-v1');
    expect(activePhysicsModeForTrace(null)).toBe('dynamic-v1');
  });

  it('shows Dynamic for an ambient-only trace with a supported vehicle backend', () => {
    const trace = {
      header: {
        physics: {
          mode: 'dynamic-v1',
          actorBackends: {
            'ambient:v1:car': { mode: 'dynamic-v1', reason: 'selected' },
          },
        },
      },
    } as never;
    expect(activePhysicsModeForTrace(trace)).toBe('dynamic-v1');
  });
});
