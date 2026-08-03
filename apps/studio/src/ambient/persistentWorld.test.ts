import { describe, expect, it } from 'vitest';
import { defaultAmbientTrafficProfile, profileForPreset } from './model';
import { ambientMaterializationKey, ambientPopulationKey, PersistentAmbientWorld } from './persistentWorld';

describe('persistent ambient world lifecycle', () => {
  const city = defaultAmbientTrafficProfile();

  it('reuses exact identity before, during, and after repeated Play', () => {
    const world = new PersistentAmbientWorld<{ actors: string[]; routes: string[] }>();
    const populationKey = ambientPopulationKey('map-a', city);
    const materializationKey = ambientMaterializationKey(populationKey, 'scenario-a');
    const bundle = { actors: ['ambient:1', 'ambient:2'], routes: ['lane-a', 'lane-b'] };
    world.commit(world.begin(), { populationKey, materializationKey, value: bundle });

    expect(world.playback()).toBe(bundle);
    expect(world.playback()).toBe(bundle);
    expect(world.current?.value).toBe(bundle);
  });

  it('retains the visible population on preparation errors', () => {
    const world = new PersistentAmbientWorld<object>();
    const visible = { actors: ['ambient:1'] };
    world.commit(world.begin(), { populationKey: 'population-a', materializationKey: 'world-a', value: visible });
    world.fail(world.begin());
    expect(world.playback()).toBe(visible);
  });

  it('changes population only for map/profile/mix/seed changes, while authored edits only rematerialize', () => {
    const population = ambientPopulationKey('map-a', city);
    expect(ambientPopulationKey('map-a', city)).toBe(population);
    expect(ambientMaterializationKey(population, 'scenario-b')).not.toBe(ambientMaterializationKey(population, 'scenario-a'));
    expect(ambientPopulationKey('map-b', city)).not.toBe(population);
    expect(ambientPopulationKey('map-a', { ...city, seed: 'explicit-regenerate' })).not.toBe(population);
    expect(ambientPopulationKey('map-a', profileForPreset('light', city))).not.toBe(population);
    expect(ambientPopulationKey('map-a', { ...city, vehicleMix: { ...city.vehicleMix, truck: city.vehicleMix.truck + 0.1 } })).not.toBe(population);
  });

  it('ignores superseded generation results', () => {
    const world = new PersistentAmbientWorld<string>();
    const stale = world.begin();
    const current = world.begin();
    expect(world.commit(stale, { populationKey: 'old', materializationKey: 'old', value: 'old' })).toBe(false);
    expect(world.commit(current, { populationKey: 'new', materializationKey: 'new', value: 'new' })).toBe(true);
    expect(world.playback()).toBe('new');
  });
});
