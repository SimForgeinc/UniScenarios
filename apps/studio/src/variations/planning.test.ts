import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VARIATION_WORKERS, deriveDefaultVariationPlan, enumerateVariationCandidates, loadVariationPreferences, saveVariationPreferences } from './planning';

const candidate = (rank: number) => ({ rank, permutationKey: `site-${rank}`, mapId: 'map', site: { siteId: `site-${rank}` }, equivalence: { eligibleForMaterialization: true } }) as never;

describe('variation campaign planning', () => {
  it.each([
    [0, true, 1, 0],
    [1, true, 32, 32],
    [5, true, 10, 50],
    [17, true, 3, 50],
    [50, true, 1, 50],
    [80, true, 1, 50],
  ])('targets a bounded campaign for %i compatible locations', (locations, sampled, draws, potential) => {
    expect(deriveDefaultVariationPlan(locations, sampled)).toMatchObject({ axisCombinations: 1, drawsPerLocation: draws, candidateBudget: 50, potentialCandidates: potential });
  });

  it('does not claim parameter diversity when no sampled parameters exist', () => {
    expect(deriveDefaultVariationPlan(1, false)).toMatchObject({ drawsPerLocation: 1, potentialCandidates: 1, limitedByParameters: true });
  });

  it('enumerates deterministic draws without exceeding the hard budget', () => {
    const planned = enumerateVariationCandidates([candidate(2), candidate(1)], 32, 50);
    expect(planned).toHaveLength(50);
    expect(planned[0]).toMatchObject({ drawIndex: 0, candidate: { rank: 1, permutationKey: 'site-1:draw-0' } });
    expect(planned[1]).toMatchObject({ drawIndex: 0, candidate: { rank: 2, permutationKey: 'site-2:draw-0' } });
    expect(planned.at(-1)).toMatchObject({ drawIndex: 24, candidate: { rank: 50, permutationKey: 'site-2:draw-24' } });
    expect(enumerateVariationCandidates([candidate(1)], 999, 9999)).toHaveLength(32);
  });

  it('loads bounded persisted manual values and defaults workers to max', () => {
    expect(DEFAULT_VARIATION_WORKERS).toBe(4);
    expect(loadVariationPreferences({ getItem: () => null })).toBeNull();
    expect(loadVariationPreferences({ getItem: () => JSON.stringify({ drawsPerLocation: 8, candidateBudget: 120, workerCount: 3 }) })).toEqual({ axisCombinations: 1, drawsPerLocation: 8, candidateBudget: 120, workerCount: 3 });
    const setItem = vi.fn();
    saveVariationPreferences({ axisCombinations: 1, drawsPerLocation: 4, candidateBudget: 50, workerCount: 4 }, { setItem });
    expect(setItem).toHaveBeenCalledOnce();
  });
});
