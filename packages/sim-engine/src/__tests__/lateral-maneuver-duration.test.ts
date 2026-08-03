import { describe, expect, it } from 'vitest';
import { runSimulation } from '../sim/engine.js';
import { LANE_LEFT, LANE_RIGHT, scenario, syntheticGraph, vehicle } from './fixtures/scenarios.js';

const graph = syntheticGraph();

function laneChange(durationS: number, window = { startS: 1, endS: 1.5 }) {
  return scenario(graph, {
    clipSeconds: 12,
    actors: [vehicle(graph, { id: 'ego', rsl: LANE_RIGHT, s: 20, speedMps: 10, cruiseSpeedMps: 10 })],
    interactions: [{
      id: `lane-${durationS}`,
      actorId: 'ego',
      trigger: { kind: 'at' as const, t: 1 },
      window,
      verb: 'changeLane' as const,
      target: { mode: 'lane' as const, rsl: LANE_LEFT },
      dynamics: { shape: 'sinusoidal' as const, constraint: 'time' as const, value: durationS },
    }],
  });
}

function completionTime(durationS: number): { completed: number; trace: ReturnType<typeof runSimulation>['trace']; issues: ReturnType<typeof runSimulation>['issues'] } {
  const result = runSimulation(laneChange(durationS), { graph, guards: 'collect' });
  const completed = result.trace.events.find((event) => event.kind === 'interaction_completed');
  expect(completed).toBeDefined();
  return { completed: completed!.t, trace: result.trace, issues: result.issues };
}

describe('duration-aware lateral manoeuvres', () => {
  it('executes gradual 1 s, 3 s, and 6 s requests with physical ordering', () => {
    const fast = completionTime(1);
    const normal = completionTime(3);
    const cautious = completionTime(6);

    // A one-second full-lane request exceeds the generic vehicle envelope and
    // is deliberately lengthened instead of snapping.
    expect(fast.issues).toContainEqual(expect.objectContaining({ code: 'lateral_duration_clamped' }));
    expect(normal.completed).toBeGreaterThan(fast.completed);
    expect(cautious.completed).toBeGreaterThan(normal.completed + 2);
    for (const result of [fast, normal, cautious]) {
      const track = result.trace.ticks.actors.ego!;
      let peakStep = 0;
      for (let index = 1; index < track.y.length; index += 1) peakStep = Math.max(peakStep, Math.abs(track.y[index]! - track.y[index - 1]!));
      expect(peakStep).toBeLessThan(0.06);
      expect(track.y.at(-1)).toBeCloseTo(0, 2);
    }
  });

  it('uses the half-open clip only for eligibility and completes after its end', () => {
    const { trace } = runSimulation(laneChange(3, { startS: 1, endS: 1.01 }), { graph });
    expect(trace.events).toContainEqual(expect.objectContaining({ kind: 'trigger_fired', t: 1 }));
    expect(trace.events).toContainEqual(expect.objectContaining({ kind: 'interaction_completed' }));
    const completed = trace.events.find((event) => event.kind === 'interaction_completed')!;
    expect(completed.t).toBeGreaterThan(1.01);
    expect(trace.events).not.toContainEqual(expect.objectContaining({ kind: 'interaction_aborted', reason: 'window' }));
  });

  it('is deterministic across rebuilds used by reset and seek', () => {
    const first = runSimulation(laneChange(3), { graph, guards: 'collect' });
    const second = runSimulation(laneChange(3), { graph, guards: 'collect' });
    expect(second.trace.events).toEqual(first.trace.events);
    expect(second.trace.ticks.actors.ego).toEqual(first.trace.ticks.actors.ego);
    expect(second.issues).toEqual(first.issues);
  });
});
