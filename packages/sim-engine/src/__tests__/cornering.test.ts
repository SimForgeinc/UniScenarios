import { describe, expect, it } from 'vitest';

import { parseSimScenarioInput } from '../schema/input.js';
import { cornerSpeedLimitMps } from '../sim/cornering.js';
import { runSimulation } from '../sim/engine.js';
import { Route } from '../map/route.js';
import { syntheticGraph } from './fixtures/scenarios.js';

const RIGHT_TURN = Route.fromPolyline([
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 40 },
]);

function limit(comfortableLateralAccelerationMps2: number): number {
  return cornerSpeedLimitMps({
    route: RIGHT_TURN,
    routeS: 22,
    currentSpeedMps: 13.4,
    desiredSpeedMps: 13.4,
    comfortableLateralAccelerationMps2,
    comfortableDecelerationMps2: 2.5,
    physicalLateralAccelerationMps2: 7,
    physicalDecelerationMps2: 8,
  });
}

function turnTrace(comfortableLateralAccelerationMps2: number, clipSeconds = 4) {
  const input = parseSimScenarioInput({
    mapId: 'profile-turn', clipSeconds, warmupSeconds: 0, dt: 0.02, seed: 'profile-turn',
    physics: { mode: 'kinematic-v1' },
    actors: [{
      id: 'car', kind: 'car', dims: { l: 4.8, w: 1.9, h: 1.5 },
      initial: { pose: { x: 0, z: 0, headingRad: 0 }, speedMps: 13.4 },
      behavior: {
        route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: -40 }] },
        cruiseSpeedMps: 13.4,
        drivingProfile: {
          comfortableLateralAccelerationMps2,
          comfortableDecelerationMps2: 2.5,
        },
      },
    }],
  });
  return runSimulation(input, { graph: syntheticGraph(), guards: 'collect' }).trace.ticks.actors.car!;
}

describe('profile-aware corner speed', () => {
  it('keeps straight roads at the desired speed', () => {
    const straight = Route.fromPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(cornerSpeedLimitMps({
      route: straight, routeS: 20, currentSpeedMps: 13.4, desiredSpeedMps: 13.4,
      comfortableLateralAccelerationMps2: 2.2, comfortableDecelerationMps2: 2.5,
      physicalLateralAccelerationMps2: 7, physicalDecelerationMps2: 8,
    })).toBeCloseTo(13.4, 6);
  });

  it('orders cautious, normal, and assertive corner speeds without a second cap', () => {
    const cautious = limit(1.4);
    const normal = limit(2.2);
    const assertive = limit(3.2);
    expect(cautious).toBeLessThan(normal);
    expect(normal).toBeLessThan(assertive);
    expect(normal).toBeGreaterThan(3);
  });

  it('slows for a right turn and carries more speed for an assertive actor', () => {
    const cautious = turnTrace(1.4);
    const normal = turnTrace(2.2);
    const assertive = turnTrace(3.2);
    const min = (track: typeof normal) => Math.min(...track.speedMps.slice(60, 180));
    expect(min(normal)).toBeLessThan(13.4);
    expect(min(cautious)).toBeLessThan(min(normal));
    expect(min(assertive)).toBeGreaterThan(min(normal));
    expect(min(normal)).toBeGreaterThan(3);
  });

  it('does not retire an authored actor for ordinary corner-tracking error', () => {
    const track = turnTrace(2.2, 7);
    expect(track.present.at(-1)).toBe(1);
    expect(track.speedMps.at(-1)).toBeGreaterThan(3);
    expect(track.s.at(-1)).toBeGreaterThan(40);
  });
});
