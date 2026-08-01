/**
 * Signal compliance and the `set(rules.*)` switches.
 *
 * `rules.obeySignals = false` is how C3's red-light-violation archetype is
 * authored, and `rules.collisionAvoidance = false` is the make-or-break flag
 * that stops a challenger chickening out of a critical approach.
 */

import { describe, expect, it } from 'vitest';
import { runSimulation } from '../sim/engine.js';
import { LANE_LEFT, scenario, syntheticGraph, vehicle } from './fixtures/scenarios.js';

const graph = syntheticGraph();
const STOP_LINE_S = 180;

function signalScenario(obeySignals: boolean) {
  return scenario(graph, {
    actors: [
      vehicle(graph, {
        id: 'ego',
        rsl: LANE_LEFT,
        s: 20,
        speedMps: 12,
        cruiseSpeedMps: 12,
        rules: { obeySignals },
      }),
    ],
    signalPrograms: [
      {
        id: 'sig-main',
        phases: [{ phase: 'red', durationS: 120 }],
        loop: false,
        stopLines: [{ rsl: LANE_LEFT, s: STOP_LINE_S }],
      },
    ],
  });
}

describe('signal compliance', () => {
  it('stops at the line on red', () => {
    const { trace } = runSimulation(signalScenario(true), { graph });
    const track = trace.ticks.actors['ego']!;
    const last = track.x.length - 1;
    expect(track.x[last]!).toBeLessThan(STOP_LINE_S);
    expect(track.x[last]!).toBeGreaterThan(STOP_LINE_S - 3);
    expect(track.speedMps[last]!).toBeLessThan(0.05);
  });

  it('runs the red when rules.obeySignals is false', () => {
    const { trace } = runSimulation(signalScenario(false), { graph });
    const track = trace.ticks.actors['ego']!;
    const last = track.x.length - 1;
    expect(track.x[last]!).toBeGreaterThan(STOP_LINE_S);
    expect(track.speedMps[last]!).toBeCloseTo(12, 1);
  });

  it('a set(rules.obeySignals=false) mid-clip releases a stopped actor', () => {
    const base = signalScenario(true);
    const input = {
      ...base,
      interactions: [
        {
          id: 'jump-the-light',
          actorId: 'ego',
          trigger: { kind: 'at' as const, t: 16 },
          verb: 'set' as const,
          target: { key: 'rules.obeySignals', value: false },
        },
      ],
    };
    const { trace } = runSimulation(input, { graph });
    const track = trace.ticks.actors['ego']!;
    const atFire = trace.ticks.t.findIndex((v) => v >= 16 - 1e-9);
    expect(track.speedMps[atFire]!).toBeLessThan(0.5);
    expect(track.speedMps[track.speedMps.length - 1]!).toBeGreaterThan(3);
    expect(trace.events.some((e) => e.kind === 'state_set' && e.key === 'rules.obeySignals')).toBe(true);
  });

  it('the signal phase timeline is queryable as a trigger condition', () => {
    const base = signalScenario(false);
    const input = {
      ...base,
      signalPrograms: [
        {
          ...base.signalPrograms[0]!,
          // green for the warm-up + 8 s, then red.
          phases: [
            { phase: 'green' as const, durationS: 13 },
            { phase: 'red' as const, durationS: 120 },
          ],
        },
      ],
      interactions: [
        {
          id: 'brake-on-red',
          actorId: 'ego',
          trigger: {
            kind: 'when' as const,
            condition: { kind: 'signal' as const, signalId: 'sig-main', phase: 'red' as const },
            byLatest: 19,
            ifNever: 'skip' as const,
          },
          verb: 'speed' as const,
          target: { mode: 'stop' as const },
          dynamics: { shape: 'linear' as const, constraint: 'rate' as const, value: 4 },
        },
      ],
    };
    const { trace } = runSimulation(input, { graph });
    const fired = trace.events.find((e) => e.kind === 'trigger_fired');
    expect(fired?.t).toBeCloseTo(8, 1);
    expect(trace.ticks.actors['ego']!.speedMps[trace.ticks.t.length - 1]!).toBeLessThan(0.05);
    expect(trace.ticks.signals?.['sig-main']?.phase).toHaveLength(trace.ticks.t.length);
    expect(trace.ticks.signals?.['sig-main']?.phase[0]).toBe('green');
    expect(trace.ticks.signals?.['sig-main']?.phase.at(-1)).toBe('red');
  });

  it('records a forced signal phase and applies it to the same controller book', () => {
    const base = signalScenario(false);
    const input = {
      ...base,
      interactions: [
        {
          id: 'force-green',
          actorId: 'ego',
          trigger: { kind: 'at' as const, t: 2 },
          verb: 'set' as const,
          target: { key: 'signal:sig-main.phase', value: 'green' },
        },
      ],
    };
    const { trace } = runSimulation(input, { graph });
    const at = trace.ticks.t.findIndex((time) => time >= 2);
    expect(trace.ticks.signals?.['sig-main']?.phase[at]).toBe('green');
    expect(trace.ticks.signals?.['sig-main']?.phase.at(-1)).toBe('green');
  });

  it('filters a stop line to its bound junction movement', () => {
    const base = signalScenario(true);
    const unrelated = {
      ...base,
      signalPrograms: base.signalPrograms.map((program) => ({
        ...program,
        stopLines: program.stopLines.map((line) => ({
          ...line,
          connectingLaneRsls: ['junction:other'],
        })),
      })),
    };
    const { trace } = runSimulation(unrelated, { graph });
    expect(trace.ticks.actors['ego']!.x.at(-1)).toBeGreaterThan(STOP_LINE_S);
  });
});

describe('rules.collisionAvoidance', () => {
  function approach(collisionAvoidance: boolean) {
    return scenario(graph, {
      actors: [
        vehicle(graph, { id: 'lead', rsl: LANE_LEFT, s: 120, speedMps: 0, cruiseSpeedMps: 0 }),
        vehicle(graph, {
          id: 'challenger',
          rsl: LANE_LEFT,
          s: 20,
          speedMps: 14,
          cruiseSpeedMps: 14,
          rules: { collisionAvoidance },
        }),
      ],
    });
  }

  it('brakes for a stopped leader when enabled', () => {
    const { trace } = runSimulation(approach(true), { graph, guards: 'collect' });
    expect(trace.metrics.collisions).toHaveLength(0);
    const gap =
      trace.ticks.actors['lead']!.x[trace.ticks.t.length - 1]! -
      trace.ticks.actors['challenger']!.x[trace.ticks.t.length - 1]!;
    expect(gap).toBeGreaterThan(2);
  });

  it('commits and collides when disabled', () => {
    const { trace } = runSimulation(approach(false), { graph, guards: 'collect' });
    expect(trace.metrics.collisions.length).toBeGreaterThan(0);
    expect(trace.metrics.minTTC!.value).toBeLessThan(1);
  });
});
