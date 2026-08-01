import { describe, expect, it } from 'vitest';

import { parseSimScenarioInput } from '../schema/input.js';
import { runSimulation } from '../sim/engine.js';
import { LANE_LEFT, LANE_RIGHT, syntheticGraph, vehicle } from './fixtures/scenarios.js';

const graph = syntheticGraph();

function inputWithStaticQueue(staticFlag: boolean) {
  const ego = vehicle(graph, { id: 'ego', rsl: LANE_LEFT, s: 0, speedMps: 10, cruiseSpeedMps: 10 });
  const target = vehicle(graph, { id: 'target', rsl: LANE_LEFT, s: 32, speedMps: 0, cruiseSpeedMps: 0, dims: { l: 0.6, w: 0.6, h: 1.7 } });
  const parked = vehicle(graph, { id: 'parked', rsl: LANE_RIGHT, s: 1, speedMps: 0, cruiseSpeedMps: 0 });
  return parseSimScenarioInput({
    mapId: 'synthetic-straight',
    clipSeconds: 2,
    warmupSeconds: 0,
    dt: 0.02,
    seed: 'static-metrics',
    metricSubject: 'ego',
    actors: [ego, target, { ...parked, static: staticFlag }],
    interactions: [],
    occluders: [],
  });
}

describe('static actors', () => {
  it('remain immobile even when authored with nonzero speed and cruise', () => {
    const parked = vehicle(graph, { id: 'parked', rsl: LANE_LEFT, s: 790, speedMps: 12, cruiseSpeedMps: 12 });
    const input = parseSimScenarioInput({
      mapId: 'synthetic-straight',
      clipSeconds: 2,
      warmupSeconds: 1,
      dt: 0.02,
      seed: 'static-immobile',
      actors: [{ ...parked, static: true }],
      interactions: [],
      occluders: [],
    });

    const { trace, issues } = runSimulation(input, { graph, guards: 'collect' });
    expect(issues.some((i) => i.code === 'runway_insufficient')).toBe(false);
    const tr = trace.ticks.actors['parked']!;
    expect(new Set(tr.x).size).toBe(1);
    expect(new Set(tr.y).size).toBe(1);
    expect(tr.speedMps.every((v) => v === 0)).toBe(true);
  });

  it('do not steal minTTC from the incident pair', () => {
    const dynamic = runSimulation(inputWithStaticQueue(false), { graph, guards: 'collect' }).trace;
    expect(dynamic.metrics.minTTC?.pair).toEqual(['ego', 'parked']);
    expect(dynamic.metrics.minTTC?.value).toBe(0);

    const fixed = runSimulation(inputWithStaticQueue(true), { graph, guards: 'collect' }).trace;
    expect(fixed.metrics.minTTC?.pair).toEqual(['ego', 'target']);
    expect(fixed.metrics.minTTC?.value).toBeGreaterThan(0);
    expect(fixed.metrics.minDistance.some((d) => d.pair.includes('parked'))).toBe(false);
  });

  it('marks declared occlusion ineffective when it never blocks the incident pair', () => {
    const ego = vehicle(graph, { id: 'ego', rsl: LANE_LEFT, s: 0, speedMps: 10, cruiseSpeedMps: 10 });
    const target = vehicle(graph, { id: 'target', rsl: LANE_LEFT, s: 40, speedMps: 0, cruiseSpeedMps: 0 });
    const input = parseSimScenarioInput({
      mapId: 'synthetic-straight',
      clipSeconds: 2,
      warmupSeconds: 0,
      dt: 0.02,
      seed: 'ineffective-occluder',
      metricSubject: 'ego',
      actors: [ego, target],
      interactions: [],
      occlusionPairs: [{ observer: 'ego', target: 'target', occluderId: 'off-axis-wall' }],
      occluders: [
        {
          id: 'off-axis-wall',
          obb: { center: { x: 20, z: 50 }, lengthM: 10, widthM: 2, heightM: 2, headingRad: 0 },
        },
      ],
    });

    const { trace } = runSimulation(input, { graph, guards: 'collect' });
    expect(trace.metrics.minTTC?.pair).toEqual(['ego', 'target']);
    expect(trace.metrics.occluderIneffective).toEqual([
      {
        pair: ['ego', 'target'],
        conflictT: trace.metrics.minTTC!.t,
        occluderId: 'off-axis-wall',
        relevantOccluderIds: ['off-axis-wall'],
        reason: 'never_blocked_before_conflict',
      },
    ]);
    expect(trace.metrics.revealToConflict).toBeNull();
  });

  it('honors occluderId when deciding which declared occluder was ineffective', () => {
    const ego = vehicle(graph, { id: 'ego', rsl: LANE_LEFT, s: 0, speedMps: 10, cruiseSpeedMps: 10 });
    const target = vehicle(graph, { id: 'target', rsl: LANE_LEFT, s: 40, speedMps: 0, cruiseSpeedMps: 0 });
    const input = parseSimScenarioInput({
      mapId: 'synthetic-straight',
      clipSeconds: 2,
      warmupSeconds: 0,
      dt: 0.02,
      seed: 'occluder-id',
      metricSubject: 'ego',
      actors: [ego, target],
      interactions: [],
      occlusionPairs: [
        { observer: 'ego', target: 'target', occluderId: 'on-axis-wall' },
        { observer: 'ego', target: 'target', occluderId: 'off-axis-wall' },
      ],
      occluders: [
        {
          id: 'on-axis-wall',
          obb: { center: { x: 20, z: 0 }, lengthM: 10, widthM: 2, heightM: 2, headingRad: 0 },
        },
        {
          id: 'off-axis-wall',
          obb: { center: { x: 20, z: 50 }, lengthM: 10, widthM: 2, heightM: 2, headingRad: 0 },
        },
      ],
    });

    const { trace } = runSimulation(input, { graph, guards: 'collect' });
    expect(trace.metrics.occluderIneffective).toEqual([
      {
        pair: ['ego', 'target'],
        conflictT: trace.metrics.minTTC!.t,
        occluderId: 'off-axis-wall',
        relevantOccluderIds: ['off-axis-wall'],
        reason: 'never_blocked_before_conflict',
      },
    ]);
  });

  it('does not mark declared occlusion ineffective when the pair is actually blocked', () => {
    const ego = vehicle(graph, { id: 'ego', rsl: LANE_LEFT, s: 0, speedMps: 10, cruiseSpeedMps: 10 });
    const target = vehicle(graph, { id: 'target', rsl: LANE_LEFT, s: 40, speedMps: 0, cruiseSpeedMps: 0 });
    const input = parseSimScenarioInput({
      mapId: 'synthetic-straight',
      clipSeconds: 2,
      warmupSeconds: 0,
      dt: 0.02,
      seed: 'effective-occluder',
      metricSubject: 'ego',
      actors: [ego, target],
      interactions: [],
      occlusionPairs: [{ observer: 'ego', target: 'target', occluderId: 'on-axis-wall' }],
      occluders: [
        {
          id: 'on-axis-wall',
          obb: { center: { x: 20, z: 0 }, lengthM: 10, widthM: 2, heightM: 2, headingRad: 0 },
        },
      ],
    });

    const { trace } = runSimulation(input, { graph, guards: 'collect' });
    expect(trace.metrics.occluderIneffective).toEqual([]);
  });

  it('still lets a parked actor block line-of-sight triggers', () => {
    const ego = vehicle(graph, { id: 'ego', rsl: LANE_LEFT, s: 0, speedMps: 0, cruiseSpeedMps: 0 });
    const target = vehicle(graph, { id: 'target', rsl: LANE_LEFT, s: 30, speedMps: 0, cruiseSpeedMps: 0 });
    const parked = vehicle(graph, { id: 'parked', rsl: LANE_LEFT, s: 15, speedMps: 0, cruiseSpeedMps: 0 });
    const input = parseSimScenarioInput({
      mapId: 'synthetic-straight',
      clipSeconds: 2,
      warmupSeconds: 0,
      dt: 0.02,
      seed: 'static-occludes',
      actors: [ego, target, { ...parked, static: true }],
      interactions: [
        {
          id: 'when-visible',
          actorId: 'ego',
          trigger: {
            kind: 'when',
            condition: { kind: 'visible', a: 'ego', to: 'target', value: true },
            byLatest: 1,
            ifNever: 'skip',
          },
          verb: 'speed',
          target: { mode: 'absolute', value: 1 },
          dynamics: { shape: 'linear', constraint: 'time', value: 0.1 },
        },
      ],
      occluders: [],
    });

    const { trace } = runSimulation(input, { graph, guards: 'collect' });
    expect(trace.events.some((e) => e.kind === 'trigger_fired' && e.interactionId === 'when-visible')).toBe(false);
    expect(trace.metrics.triggerNeverFired).toEqual(['when-visible']);
    // The parked actor was an occluder but not a metric participant.
    expect(trace.metrics.minDistance.some((d) => d.pair.includes('parked'))).toBe(false);
  });
});
