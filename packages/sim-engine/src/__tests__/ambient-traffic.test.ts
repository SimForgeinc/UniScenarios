import { describe, expect, it } from 'vitest';

import {
  applyAmbientTraffic,
  contentHash,
  evaluateAmbientRobustness,
  promoteAmbientActor,
  runSimulation,
} from '../index.js';
import { scenario, syntheticGraph, vehicle } from './fixtures/scenarios.js';

describe('native ambient traffic', () => {
  const graph = syntheticGraph();
  const base = scenario(graph, {
    clipSeconds: 8,
    warmupSeconds: 0,
    actors: [vehicle(graph, { id: 'ego', s: 200, speedMps: 8, cruiseSpeedMps: 8 })],
    metricSubject: 'ego',
  });

  it('resolves the City preset to a car-heavy, deterministic street population', () => {
    const profile = { version: 1 as const, preset: 'city' as const, seed: 'city-default' };
    const a = applyAmbientTraffic(base, graph, profile);
    const b = applyAmbientTraffic(base, graph, profile);
    expect(a.provenance.profile).toMatchObject({
      preset: 'city',
      densityVehiclesPerKm: 8,
      pedestrianShare: 0.06,
      cyclistShare: 0.02,
      maxActors: 32,
    });
    expect(a.provenance.actors.length).toBeGreaterThan(0);
    expect(contentHash(a)).toBe(contentHash(b));
    const vulnerableUsers = a.provenance.actors.filter(({ kind }) => kind === 'pedestrian' || kind === 'bicycle');
    expect(vulnerableUsers.length).toBeLessThan(a.provenance.actors.length);
  });

  it('keeps a bounded City population present from t=0 through a 20 second clip', () => {
    const twentySecondBase = scenario(graph, {
      ...base,
      clipSeconds: 20,
      actors: [vehicle(graph, { id: 'ego', s: 200, speedMps: 8, cruiseSpeedMps: 8 })],
    });
    const generated = applyAmbientTraffic(twentySecondBase, graph, {
      version: 1,
      preset: 'city',
      seed: 'city-20-second-visibility',
    });
    const trace = runSimulation(generated.input, { graph, guards: 'throw' }).trace;
    expect(generated.provenance.actors.length).toBeGreaterThan(0);
    expect(generated.provenance.actors.length).toBeLessThanOrEqual(32);
    expect(trace.ticks.t[0]).toBe(0);
    expect(trace.ticks.t.at(-1)).toBe(20);
    for (const actor of generated.provenance.actors) {
      expect(actor.routeLaneRsls.length).toBeGreaterThan(0);
      expect(trace.ticks.actors[actor.id]!.present[0]).toBe(1);
      expect(trace.ticks.actors[actor.id]!.present.at(-1)).toBe(1);
    }
    const ambientIds = new Set(generated.provenance.actors.map(({ id }) => id));
    expect(trace.metrics.collisions.filter(({ a, b }) => ambientIds.has(a) || ambientIds.has(b))).toEqual([]);
  }, 30_000);

  it('is deterministic, provenance-closed, and leaves the authored input unchanged', () => {
    const profile = {
      version: 1 as const,
      preset: 'custom' as const,
      densityVehiclesPerKm: 10,
      seed: 'pinned-a',
      maxActors: 8,
      pedestrianShare: 0,
      cyclistShare: 0.2,
    };
    const before = contentHash(base);
    const a = applyAmbientTraffic(base, graph, profile);
    const b = applyAmbientTraffic(base, graph, profile);
    expect(contentHash(base)).toBe(before);
    expect(a.provenance.actors.length).toBeGreaterThan(0);
    expect(contentHash(a)).toBe(contentHash(b));
    expect(a.provenance.baseInputHash).toBe(before);
    expect(a.provenance.generatedInputHash).toBe(contentHash(a.input));
    expect(a.input.actors.filter((actor) => actor.tags.includes('ambient')).length).toBe(a.provenance.actors.length);
    expect(() => runSimulation(a.input, { graph, guards: 'throw' })).not.toThrow();
  });

  it('reserves runway for warm-up as well as the recorded clip', () => {
    const warmed = scenario(graph, {
      ...base,
      clipSeconds: 8,
      warmupSeconds: 20,
      actors: [vehicle(graph, { id: 'ego', s: 200, speedMps: 8, cruiseSpeedMps: 8 })],
    });
    const generated = applyAmbientTraffic(warmed, graph, {
      version: 1,
      preset: 'custom',
      densityVehiclesPerKm: 10,
      seed: 'warmup-runway-regression',
      maxActors: 8,
      pedestrianShare: 0,
      cyclistShare: 0,
    });
    expect(generated.provenance.actors.length).toBeGreaterThan(0);
    expect(() => runSimulation(generated.input, { graph, guards: 'throw' })).not.toThrow();
  });

  it('uses the seed only for background generation and respects authored exclusion space', () => {
    const profile = {
      version: 1 as const,
      preset: 'custom' as const,
      densityVehiclesPerKm: 12,
      maxActors: 10,
      exclusionRadiusM: 30,
    };
    const a = applyAmbientTraffic(base, graph, { ...profile, seed: 'a' });
    const b = applyAmbientTraffic(base, graph, { ...profile, seed: 'b' });
    expect(a.provenance.baseInputHash).toBe(b.provenance.baseInputHash);
    expect(a.provenance.generatedInputHash).not.toBe(b.provenance.generatedInputHash);
    const ego = base.actors[0]!;
    for (const actor of a.input.actors.filter((candidate) => candidate.tags.includes('ambient'))) {
      expect(Math.hypot(actor.initial.pose.x - ego.initial.pose.x, actor.initial.pose.z - ego.initial.pose.z)).toBeGreaterThan(30);
    }
  });

  it('supports off/light/moderate robustness checks and an ambient-to-authored promotion seam', () => {
    const report = evaluateAmbientRobustness(base, graph, [
      { label: 'off', profile: { version: 1, preset: 'off', seed: 'off' } },
      { label: 'light', profile: { version: 1, preset: 'light', seed: 'light', maxActors: 4 } },
      { label: 'moderate', profile: { version: 1, preset: 'moderate', seed: 'moderate', maxActors: 6 } },
    ], { filters: { negativeControl: true } });
    expect(report.cases.every((item) => item.deterministic)).toBe(true);
    expect(report.cases.every((item) => item.authoredEventOrderPreserved)).toBe(true);
    const ambient = applyAmbientTraffic(base, graph, {
      version: 1,
      preset: 'custom',
      densityVehiclesPerKm: 10,
      seed: 'promote',
      maxActors: 4,
    }).input.actors.find((actor) => actor.tags.includes('ambient'))!;
    const promoted = promoteAmbientActor(ambient, 'new-authored-actor');
    expect(promoted.id).toBe('new-authored-actor');
    expect(promoted.tags.some((tag) => tag.startsWith('ambient'))).toBe(false);
  });

  it('fails closed around collidable authored props for the entire clip', () => {
    const blocked = scenario(graph, {
      clipSeconds: 20,
      warmupSeconds: 0,
      actors: [vehicle(graph, { id: 'ego', s: 150, speedMps: 8, cruiseSpeedMps: 8 })],
      props: [{
        id: 'work-zone-barrier',
        groupId: 'work-zone',
        catalogId: 'construction.barrier',
        pose: { x: 500, z: 1.75, headingRad: Math.PI / 2 },
        dims: { l: 8, w: 1, h: 1 },
        scale: 1,
        collidable: true,
        essentiality: 'required',
      }],
    });
    const generated = applyAmbientTraffic(blocked, graph, {
      version: 1,
      preset: 'custom',
      densityVehiclesPerKm: 60,
      seed: 'prop-corridor-regression',
      maxActors: 40,
      exclusionRadiusM: 2,
      radiusM: 1_000,
      pedestrianShare: 0,
      cyclistShare: 0,
    });
    const trace = runSimulation(generated.input, { graph, guards: 'collect' }).trace;
    const ambientIds = new Set(generated.provenance.actors.map((actor) => actor.id));
    expect(trace.metrics.collisions.filter(({ a, b }) => ambientIds.has(a) || ambientIds.has(b))).toEqual([]);
    expect(generated.provenance.screening.evaluated).toBe(true);
    expect(generated.provenance.screening.passes).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('prunes dense same-lane and crossing conflicts instead of relaxing density safety', () => {
    const generated = applyAmbientTraffic(base, graph, {
      version: 1,
      preset: 'custom',
      densityVehiclesPerKm: 80,
      seed: 'dense-headway-regression',
      maxActors: 64,
      exclusionRadiusM: 2,
      radiusM: 1_000,
      pedestrianShare: 0,
      cyclistShare: 0.2,
    });
    const trace = runSimulation(generated.input, { graph, guards: 'collect' }).trace;
    const ambientIds = new Set(generated.provenance.actors.map((actor) => actor.id));
    expect(trace.metrics.collisions.filter(({ a, b }) => ambientIds.has(a) || ambientIds.has(b))).toEqual([]);
    expect(generated.provenance.actors.length).toBeLessThanOrEqual(64);
  });

  it('uses wet-road friction to prune ambient actors requiring infeasible deceleration', () => {
    const wet = scenario(graph, {
      ...base,
      operationalConditions: {
        weather: 'rain',
        timeOfDay: 'day',
        traffic: 'moderate',
        visibility: 'reduced-contrast',
        effects: { visibilityRangeM: 10_000, frictionScale: 0.1, trafficSpeedFactor: 1 },
      },
    });
    const generated = applyAmbientTraffic(wet, graph, {
      version: 1,
      preset: 'custom',
      densityVehiclesPerKm: 80,
      seed: 'dense-headway-regression',
      maxActors: 64,
      exclusionRadiusM: 2,
      radiusM: 1_000,
      pedestrianShare: 0,
      cyclistShare: 0.2,
    });
    const ceiling = 0.8 * 9.81 * 0.1;
    const trace = runSimulation(generated.input, { graph, guards: 'collect' }).trace;
    const ambientIds = new Set(generated.provenance.actors.map((actor) => actor.id));
    expect(generated.provenance.screening.maxAchievableDecelMps2).toBeCloseTo(ceiling);
    expect(generated.provenance.screening.reasons.some((reason) => reason.reason === 'required_decel')).toBe(true);
    for (const id of ambientIds) expect(trace.metrics.requiredDecelMax[id] ?? 0).toBeLessThanOrEqual(ceiling);
  }, 60_000);

  it('honors an explicit evaluator deceleration ceiling and remains deterministic', () => {
    const profile = {
      version: 1 as const,
      preset: 'custom' as const,
      densityVehiclesPerKm: 80,
      seed: 'dense-headway-regression',
      maxActors: 64,
      exclusionRadiusM: 2,
      radiusM: 1_000,
      pedestrianShare: 0,
      cyclistShare: 0.2,
    };
    const a = applyAmbientTraffic(base, graph, profile, { maxAchievableDecelMps2: 1 });
    const b = applyAmbientTraffic(base, graph, profile, { maxAchievableDecelMps2: 1 });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(a.provenance.screening.reasons.some((reason) =>
      reason.reason === 'required_decel' && (reason.requiredDecelMps2 ?? 0) > 1,
    )).toBe(true);
    const trace = runSimulation(a.input, { graph, guards: 'collect' }).trace;
    for (const actor of a.provenance.actors) {
      expect(trace.metrics.requiredDecelMax[actor.id] ?? 0).toBeLessThanOrEqual(1);
    }
  }, 60_000);
});
