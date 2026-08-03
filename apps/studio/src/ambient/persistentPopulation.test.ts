import { describe, expect, it } from 'vitest';
import { applyAmbientTraffic, runSimulation } from '@uniscenarios/sim-engine';
import { scenario, syntheticGraph, vehicle } from '../../../../packages/sim-engine/src/__tests__/fixtures/scenarios';
import { reuseAmbientPopulation } from './persistentPopulation';

describe('persistent ambient actor representation', () => {
  it('reuses exact IDs/routes/rules and produces the same signal-aware physics trace', () => {
    const graph = syntheticGraph();
    const base = scenario(graph, {
      clipSeconds: 8,
      warmupSeconds: 0,
      actors: [vehicle(graph, { id: 'ego', s: 200, speedMps: 8, cruiseSpeedMps: 8 })],
      metricSubject: 'ego',
    });
    const profile = { version: 1 as const, preset: 'custom' as const, densityVehiclesPerKm: 10, maxActors: 6, seed: 'persistent-parity' };
    const generated = applyAmbientTraffic(base, graph, profile);
    const ambientActors = generated.input.actors.filter((actor) => actor.tags.includes('ambient'));
    const reused = reuseAmbientPopulation(base, generated.provenance.profile, {
      actors: ambientActors,
      provenance: generated.provenance,
    });
    expect(reused).not.toBeNull();
    expect(reused!.input.actors.filter((actor) => actor.tags.includes('ambient'))).toEqual(ambientActors);

    const first = runSimulation(generated.input, { graph, guards: 'throw' }).trace;
    const second = runSimulation(reused!.input, { graph, guards: 'throw' }).trace;
    for (const actor of generated.provenance.actors) {
      expect(second.ticks.actors[actor.id]).toEqual(first.ticks.actors[actor.id]);
    }
    expect(second.ticks.signals).toEqual(first.ticks.signals);
  });

  it('does not reuse a population after an explicit profile/seed change', () => {
    const graph = syntheticGraph();
    const base = scenario(graph, { actors: [vehicle(graph, { id: 'ego', s: 200, speedMps: 0 })] });
    const generated = applyAmbientTraffic(base, graph, { version: 1, preset: 'light', seed: 'one' });
    expect(reuseAmbientPopulation(base, { ...generated.provenance.profile, seed: 'two' }, {
      actors: generated.input.actors,
      provenance: generated.provenance,
    })).toBeNull();
  });
});
