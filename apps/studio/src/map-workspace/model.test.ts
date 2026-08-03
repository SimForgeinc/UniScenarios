import { describe, expect, it } from 'vitest';
import { anchorFailure, parseRoadLaneRef, type MapFeatureSummary } from './model';

const exact: MapFeatureSummary = {
  id: 'loc_1', layerId: 'parking-spaces', name: 'Space 1', source: 'map-intel', sourceRef: 'parking-space/1',
  position: [1, 2, 3], binding: { quality: 'exact', rsl: '42:1:-2', s: 12, offsetM: 0, headingRad: 1, laneType: 'parking' },
  facts: {}, provenance: [],
};

describe('map workspace model', () => {
  it('parses stable road/section/lane references', () => {
    expect(parseRoadLaneRef('42:1:-2')).toEqual({ roadId: '42', section: 1, laneId: -2 });
    expect(parseRoadLaneRef('broken')).toBeNull();
  });

  it('fails closed for projected and ambiguous placement', () => {
    expect(anchorFailure(exact, 0)).toContain('exactly one');
    expect(anchorFailure({ ...exact, binding: { ...exact.binding, quality: 'projected' } }, 1)).toContain('projected');
    expect(anchorFailure(exact, 1)).toBeNull();
  });
});
