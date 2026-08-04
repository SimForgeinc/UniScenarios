import { buildDefaultPlacementRoute } from '@uniscenarios/sim-engine';
import type { MapEntry } from '../maps';
import type { LaneIndex } from '../editor/laneIndex';
import type { CopilotMapContext, CopilotPlacementSlot } from './types';

/**
 * Build a bounded, serialisable view of the current map for scenario generation.
 * The model selects slot ids; it never invents world coordinates or lane ids.
 */
export function buildCopilotMapContext(map: MapEntry, lanes: LaneIndex): CopilotMapContext {
  const candidates = [...lanes.all]
    .filter((lane) => lane.length >= 45)
    .sort((a, b) => Number(a.isJunction) - Number(b.isJunction) || b.length - a.length || a.rsl.localeCompare(b.rsl));
  const selected = candidates.slice(0, 18);
  const slots: CopilotPlacementSlot[] = [];
  for (const lane of selected) {
    for (const fraction of [0.25, 0.55] as const) {
      if (slots.length >= 24) break;
      const s = lane.length * fraction;
      const pose = lanes.poseAt(lane, s);
      const speed = Math.max(10, Math.min(50, lane.speedLimitKph ?? 30));
      const route = buildDefaultPlacementRoute(lanes.graph, {
        startRsl: lane.rsl,
        startStorageS: s,
        requiredDownstreamM: Math.max(90, (speed / 3.6) * 21 + 10),
      });
      if (!route.ok) continue;
      const safeSpeed = Math.max(5, Math.min(speed, ((route.downstreamM - 12) / 21) * 3.6));
      slots.push({
        id: `slot-${slots.length + 1}`,
        actorKinds: ['vehicle', 'pedestrian'],
        catalogIds: [
          'vehicle.sedan', 'vehicle.pickup', 'vehicle.van', 'vehicle.bus', 'vehicle.ambulance',
          'vehicle.motorcycle', 'vehicle.bicycle', 'pedestrian.adult_walking', 'pedestrian.child_walking',
        ],
        pose: { x: pose.x, y: 0, z: pose.z, headingRad: pose.headingRad },
        laneRef: {
          roadId: lane.roadId,
          section: lane.section,
          laneId: lane.laneId,
          s,
          t: 0,
          headingOffsetRad: 0,
        },
        routeLaneRsls: route.lanes,
        availableDownstreamM: route.downstreamM,
        recommendedSpeedKph: safeSpeed,
        labels: [lane.isJunction ? 'junction' : 'corridor', lane.forward ? 'with-s' : 'against-s', `road-${lane.roadId}`],
      });
    }
  }
  if (slots.length < 2) throw new Error('This map does not expose enough connected driving lanes for generated scenarios.');
  return {
    mapId: map.id,
    mapName: map.label,
    xodrSha256: lanes.stats.xodrSha256,
    laneCount: lanes.stats.lanes,
    junctionLaneCount: lanes.all.filter((lane) => lane.isJunction).length,
    bounds: lanes.stats.bounds,
    placementSlots: slots,
  };
}
