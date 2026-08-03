import { describe, expect, it } from 'vitest';
import type { MapSignalCatalog } from '@uniscenarios/scenario-materializer';
import { createMapSignalPlan, ownedSignalHeadIds, physicalSignalChoiceIndex, physicalSignalChoiceIssue, physicalSignalChoices } from './authoring';

const catalog: MapSignalCatalog = {
  heads: [{ id: 'h1', roadId: '1', s: 2, dynamic: true }, { id: 'h2', roadId: '2', s: 3, dynamic: true }],
  roadControls: [], speedLimits: [], applicability: [],
  controllers: [
    { id: 'late', sequence: 2, signalIds: ['h1'] },
    { id: 'early', sequence: 1, signalIds: ['h1', 'h2'] },
  ],
  junctions: [{ junctionId: 'j', controllerIds: ['late', 'early'] }],
};

describe('signal authoring catalog', () => {
  it('returns every membership in controller sequence order', () => {
    expect(physicalSignalChoices(catalog, 'h1')).toEqual([
      { headId: 'h1', junctionId: 'j', controllerId: 'early', controllerSequence: 1 },
      { headId: 'h1', junctionId: 'j', controllerId: 'late', controllerSequence: 2 },
    ]);
    expect(physicalSignalChoices(catalog, 'missing')).toEqual([]);
  });

  it('creates a versioned empty plan and avoids id collisions', () => {
    expect(createMapSignalPlan('map', 'digest', physicalSignalChoices(catalog, 'h1')[0]!, new Set(['signals-j']))).toMatchObject({
      id: 'signals-j-2', version: 1, binding: { mapId: 'map', junctionId: 'j', controlDigest: 'digest' }, clips: [],
    });
  });

  it('selects the exact derived controller instead of relying on catalog order', () => {
    const choices = physicalSignalChoices(catalog, 'h1');
    expect(physicalSignalChoiceIndex(choices, 'j', 'late')).toBe(1);
    expect(physicalSignalChoiceIndex(choices, 'j', 'missing')).toBe(-1);
    expect(physicalSignalChoiceIssue(choices, 'j', 'late')).toBeNull();
    expect(physicalSignalChoiceIssue(choices, 'j', 'missing')).toContain('stale');
    expect(physicalSignalChoiceIndex([...choices, choices[1]!], 'j', 'late')).toBe(-1);
    expect(physicalSignalChoiceIssue([...choices, choices[1]!], 'j', 'late')).toContain('ambiguous');
  });

  it('claims every head at an authored junction', () => {
    const plan = createMapSignalPlan('map', 'digest', physicalSignalChoices(catalog, 'h1')[0]!);
    expect([...ownedSignalHeadIds(catalog, [plan])].sort()).toEqual(['h1', 'h2']);
  });
});
