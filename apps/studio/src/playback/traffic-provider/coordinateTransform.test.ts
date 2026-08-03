import { describe, expect, it } from 'vitest';
import { toNetwork, toWorld, transformPackedStatesToWorld } from './coordinateTransform';

const transform = { translationX: 100, translationY: -40, rotationDegrees: 90, scale: 2, invertY: false };

describe('SUMO network/world coordinates', () => {
  it('round-trips points through map registration', () => {
    const world = toWorld(4, -3, transform);
    const network = toNetwork(world.x, world.y, transform);
    expect(network.x).toBeCloseTo(4);
    expect(network.y).toBeCloseTo(-3);
  });

  it('reflects OpenDRIVE y into renderer z without reflecting x', () => {
    const reflected = { translationX: 352, translationY: -1482, rotationDegrees: 0, scale: 1, invertY: true };
    expect(toWorld(300, 200, reflected)).toEqual({ x: 652, y: -1682 });
    expect(toNetwork(652, -1682, reflected)).toEqual({ x: 300, y: 200 });
  });

  it('transforms packed positions without changing hashes or signals', () => {
    const words = new Uint32Array(8);
    const floats = new Float32Array(words.buffer);
    words[0] = 123;
    floats[1] = 4;
    floats[2] = -3;
    floats[3] = 20;
    words[7] = 9;
    transformPackedStatesToWorld(words.buffer, 1, transform);
    expect(words[0]).toBe(123);
    expect(floats[1]).toBeCloseTo(106);
    expect(floats[2]).toBeCloseTo(-32);
    expect(floats[3]).toBeCloseTo(110);
    expect(words[7]).toBe(9);
  });

  it('rejects a truncated packed actor buffer', () => {
    expect(() => transformPackedStatesToWorld(new ArrayBuffer(7 * 4), 1, transform))
      .toThrow(/7 floats for 1 actors/);
  });
});
