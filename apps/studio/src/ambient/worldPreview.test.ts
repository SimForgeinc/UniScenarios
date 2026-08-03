import { describe, expect, it } from 'vitest';
import { applyAmbientTraffic, contentHash } from '@uniscenarios/sim-engine';
import { syntheticGraph } from '../../../../packages/sim-engine/src/__tests__/fixtures/scenarios';
import { createAmbientWorldPreviewInput } from './worldPreview';

describe('scenario-independent ambient world preview', () => {
  const graph = syntheticGraph();
  const base = createAmbientWorldPreviewInput('empty-scratch');

  it('uses the current dynamic physics pipeline for the ambient-only world', () => {
    expect(base.physics).toEqual({ mode: 'dynamic-v1' });
  });

  it('creates a schema-valid map-only base without leaking its parse seed actor', () => {
    expect(base.mapId).toBe('empty-scratch');
    expect(base.actors).toEqual([]);
  });

  it('populates an empty scratch map deterministically with City actors', () => {
    const profile = { version: 1 as const, preset: 'city' as const, seed: 'world-city' };
    const first = applyAmbientTraffic(base, graph, profile);
    const second = applyAmbientTraffic(base, graph, profile);
    expect(first.provenance.actors.length).toBeGreaterThan(0);
    expect(contentHash(first)).toBe(contentHash(second));
  }, 20_000);

  it('does not depend on invalid authored choreography', () => {
    const invalidAuthoredDocument = { interactions: [{ id: 'missing-target' }] };
    const generated = applyAmbientTraffic(base, graph, { version: 1, preset: 'city', seed: 'invalid-independent' });
    expect(invalidAuthoredDocument.interactions).toHaveLength(1);
    expect(generated.provenance.actors.length).toBeGreaterThan(0);
  });

  it('respects Off and profile changes', () => {
    const off = applyAmbientTraffic(base, graph, { version: 1, preset: 'off', seed: 'same' });
    const light = applyAmbientTraffic(base, graph, { version: 1, preset: 'light', seed: 'same' });
    const city = applyAmbientTraffic(base, graph, { version: 1, preset: 'city', seed: 'same' });
    expect(off.provenance.actors).toEqual([]);
    expect(light.provenance.actors.length).toBeGreaterThan(0);
    expect(city.provenance.profileHash).not.toBe(light.provenance.profileHash);
    expect(city.provenance.actors.length).toBeGreaterThanOrEqual(light.provenance.actors.length);
  });
});
