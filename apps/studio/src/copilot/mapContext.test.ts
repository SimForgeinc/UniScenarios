import { describe, expect, it, vi } from 'vitest';
import { LaneIndex } from '../editor/laneIndex';
import { buildCopilotMapContext } from './mapContext';

const map = {
  id: 'elevated-map', label: 'Elevated Map', locality: 'test', manifest: '', xodr: '', lanePolygons: '',
  signals: '', topology: '', derivedTopology: '', locations: '', sumoManifest: '',
} as const;

function lanes(): LaneIndex {
  return LaneIndex.build({
    mapName: 'Elevated Map', source: { xodrSha256: 'fixture-hash' },
    lanes: {
      '1:0:-1': { roadId: 1, section: 0, laneId: -1, laneType: 'driving', speedLimitKph: 30, successors: ['2:0:-1'], polyline: [{ x: 0, y: 0 }, { x: 160, y: 0 }] },
      '2:0:-1': { roadId: 2, section: 0, laneId: -1, laneType: 'driving', speedLimitKph: 30, predecessors: ['1:0:-1'], successors: ['3:0:-1'], polyline: [{ x: 160, y: 0 }, { x: 320, y: 0 }] },
      '3:0:-1': { roadId: 3, section: 0, laneId: -1, laneType: 'driving', speedLimitKph: 30, predecessors: ['2:0:-1'], polyline: [{ x: 320, y: 0 }, { x: 480, y: 0 }] },
    },
  });
}

describe('Copilot map-context elevations', () => {
  it('stores sampled road elevations in every future placement slot', () => {
    const laneIndex = lanes();
    const flat = buildCopilotMapContext(map, laneIndex);
    const sampler = vi.fn((x: number, z: number) => 5 + x / 100 + z / 1_000);
    const elevated = buildCopilotMapContext(map, laneIndex, sampler);

    expect(sampler).toHaveBeenCalledTimes(elevated.placementSlots.length);
    expect(elevated.placementSlots.length).toBeLessThanOrEqual(24);
    elevated.placementSlots.forEach((slot, index) => {
      const baseline = flat.placementSlots[index]!;
      expect(slot.pose.y).toBeCloseTo(5 + slot.pose.x / 100 + slot.pose.z / 1_000, 10);
      expect({ ...slot.pose, y: 0 }).toEqual(baseline.pose);
      expect(slot.laneRef).toEqual(baseline.laneRef);
      expect(slot.routeLaneRsls).toEqual(baseline.routeLaneRsls);
      expect(slot.id).toBe(baseline.id);
    });
  });

  it('uses the historical zero elevation when no sampler is available', () => {
    expect(buildCopilotMapContext(map, lanes(), null).placementSlots.every((slot) => slot.pose.y === 0)).toBe(true);
  });
});
