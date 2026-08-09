import { describe, expect, it } from 'vitest';

import { buildLaneGraph } from '../map/lane-graph.js';
import { parseSimScenarioInput, type ActorKind } from '../schema/input.js';
import { runSimulation } from '../sim/engine.js';
import { syntheticTopology } from './fixtures/synthetic-map.js';

const graph = buildLaneGraph(syntheticTopology());

describe('custom route runtime semantics', () => {
  it.each(['car', 'pedestrian', 'animal', 'sidewalk_robot', 'bicycle', 'scooter', 'drone'] as const)(
    'keeps %s speed ownership separate and retains the route after its editor window',
    (kind: ActorKind) => {
      const input = parseSimScenarioInput({
        mapId: 'synthetic-straight', clipSeconds: 3, warmupSeconds: 0, dt: 0.02,
        seed: `custom-route-${kind}`,
        actors: [{
          id: 'actor', kind,
          initial: { pose: { x: 0, z: 0, headingRad: 0 }, speedMps: 3 },
          behavior: {
            route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] },
            cruiseSpeedMps: 3,
            rules: { collisionAvoidance: false, yield: false },
          },
        }],
        interactions: [{
          id: 'custom-route', actorId: 'actor', trigger: { kind: 'at', t: 1 },
          window: { startS: 1, endS: 2 }, verb: 'route',
          target: { kind: 'polyline', points: [{ x: 3, z: 0 }, { x: 103, z: 20 }] },
        }],
      });

      const { trace } = runSimulation(input, { graph, guards: 'collect' });
      const track = trace.ticks.actors.actor!;
      const before = trace.ticks.t.findIndex((time) => time >= 0.98);
      const after = trace.ticks.t.findIndex((time) => time >= 1.02);
      const pastWindow = trace.ticks.t.findIndex((time) => time >= 2.2);
      expect(Math.abs(track.speedMps[after]! - track.speedMps[before]!)).toBeLessThan(0.25);
      expect(Math.abs(track.y.at(-1)!)).toBeGreaterThan(Math.abs(track.y[pastWindow]!) + 0.05);
    },
  );

  it('joins a moving actor to the first waypoint instead of projecting to a terminal point', () => {
    const input = parseSimScenarioInput({
      mapId: 'synthetic-straight', clipSeconds: 5, warmupSeconds: 0, dt: 0.02,
      seed: 'custom-route-live-pose',
      actors: [{
        id: 'pedestrian', kind: 'pedestrian',
        initial: { pose: { x: 0, z: 0, headingRad: 0 }, speedMps: 5 / 3.6 },
        behavior: {
          route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] },
          cruiseSpeedMps: 5 / 3.6,
          rules: { collisionAvoidance: false, yield: false },
        },
      }],
      interactions: [{
        id: 'custom-route', actorId: 'pedestrian', trigger: { kind: 'at', t: 0.7 }, verb: 'route',
        target: { kind: 'polyline', points: [{ x: -3.5, z: -0.1 }, { x: -10, z: -7 }] },
        joinFromCurrentPose: true,
      }],
    });

    const { trace } = runSimulation(input, { graph, guards: 'collect' });
    const track = trace.ticks.actors.pedestrian!;
    const atRouteStart = trace.ticks.t.findIndex((time) => time >= 0.7);
    const oneSecondLater = trace.ticks.t.findIndex((time) => time >= 1.7);
    expect(track.present[oneSecondLater]).toBe(1);
    expect(track.speedMps[oneSecondLater]).toBeGreaterThan(1);
    expect(Math.hypot(
      track.x[oneSecondLater]! - track.x[atRouteStart]!,
      track.y[oneSecondLater]! - track.y[atRouteStart]!,
    )).toBeGreaterThan(0.75);
  });

  it('follows a freeform world path until physical contact', () => {
    const input = parseSimScenarioInput({
      mapId: 'synthetic-straight', clipSeconds: 4, warmupSeconds: 0, dt: 0.02,
      seed: 'best-effort-world-path',
      actors: [
        {
          id: 'actor', kind: 'car', dims: { l: 4, w: 2, h: 1.5 },
          initial: { pose: { x: 0, z: 8, headingRad: 0 }, speedMps: 5 },
          behavior: {
            route: { kind: 'polyline', points: [{ x: 0, z: 8 }, { x: 30, z: 8 }] },
            cruiseSpeedMps: 5,
            rules: { obeySignals: true, collisionAvoidance: true, yield: true },
          },
        },
        {
          id: 'obstacle', kind: 'static_object', dims: { l: 2, w: 2, h: 2 }, static: true,
          initial: { pose: { x: 9, z: 8, headingRad: 0 }, speedMps: 0 },
          behavior: {
            route: { kind: 'polyline', points: [{ x: 9, z: 8 }, { x: 10, z: 8 }] },
            rules: { collisionAvoidance: true },
          },
        },
      ],
      interactions: [{
        id: 'custom-route', actorId: 'actor', trigger: { kind: 'at', t: 0 }, verb: 'route',
        target: { kind: 'polyline', points: [{ x: 0, z: 8 }, { x: 30, z: 8 }] },
        joinFromCurrentPose: true, bestEffortWorldPath: true,
      }],
    });

    const { trace } = runSimulation(input, { graph, guards: 'collect' });
    expect(trace.events).toContainEqual(expect.objectContaining({ kind: 'collision', a: 'actor', b: 'obstacle' }));
    expect(trace.events).toContainEqual(expect.objectContaining({ kind: 'crash_disabled', actorId: 'actor' }));
    expect(trace.ticks.actors.actor!.speedMps.at(-1)).toBeLessThan(0.01);
  });
});
