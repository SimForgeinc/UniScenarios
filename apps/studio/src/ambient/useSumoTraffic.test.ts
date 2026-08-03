import { describe, expect, it } from 'vitest';
import { trafficMetrics } from './useSumoTraffic';

function packed(actors: readonly { id: number; x: number; z: number; speed: number; acceleration: number }[]): ArrayBuffer {
  const result = new ArrayBuffer(actors.length * 32);
  const view = new DataView(result);
  actors.forEach((actor, index) => {
    const offset = index * 32;
    view.setUint32(offset, actor.id, true);
    view.setFloat32(offset + 4, actor.x, true);
    view.setFloat32(offset + 8, actor.z, true);
    view.setFloat32(offset + 16, actor.speed, true);
    view.setFloat32(offset + 20, actor.acceleration, true);
  });
  return result;
}

describe('SUMO live product metrics', () => {
  it('counts local queues, emergency braking, and completed flow vehicles deterministically', () => {
    const run = { seenActorIds: new Set<number>(), completedActorIds: new Set<number>() };
    const first = trafficMetrics({ actorCount: 3, states: packed([
      { id: 1, x: 0, z: 0, speed: 0, acceleration: 0 },
      { id: 2, x: 20, z: 0, speed: 8, acceleration: -8 },
      { id: 3, x: 500, z: 0, speed: 10, acceleration: 0 },
    ]) }, { x: 0, z: 0 }, run);
    expect(first).toEqual({ nearbyActorCount: 2, queuedActorCount: 1, completedActorCount: 0, emergencyStoppingActorCount: 1 });

    const second = trafficMetrics({ actorCount: 2, states: packed([
      { id: 2, x: 21, z: 0, speed: 7, acceleration: 0 },
      { id: 4, x: 10, z: 0, speed: 4, acceleration: 0 },
    ]) }, { x: 0, z: 0 }, run);
    expect(second.completedActorCount).toBe(2);
    expect(second.nearbyActorCount).toBe(2);
  });
});
