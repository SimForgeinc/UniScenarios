import { describe, expect, it } from 'vitest';

import { buildLaneGraph } from '../map/lane-graph.js';
import { buildSeededPlacementRoute } from '../map/route.js';
import type { TopologyIndex, TopologyLane } from '../map/topology.js';

interface TestLane {
  rsl: string;
  x0: number;
  x1: number;
  y?: number;
  predecessors?: string[];
  successors?: string[];
}

function topology(definitions: readonly TestLane[]): TopologyIndex {
  const lanes: Record<string, TopologyLane> = {};
  for (const [index, definition] of definitions.entries()) {
    const laneId = -1 - index;
    const y = definition.y ?? 0;
    lanes[definition.rsl] = {
      rsl: definition.rsl,
      roadId: index + 1,
      section: 0,
      laneId,
      laneType: 'driving',
      isJunction: false,
      junctionId: null,
      predecessors: definition.predecessors ?? [],
      successors: definition.successors ?? [],
      speedLimitKph: 50,
      representativeWidthM: 3.5,
      widthSamples: [
        { s: 0, widthM: 3.5 },
        { s: definition.x1 - definition.x0, widthM: 3.5 },
      ],
      adjacentLanes: {
        left: { side: 'left', laneRsl: null, sameDirection: false, permissionIds: [] },
        right: { side: 'right', laneRsl: null, sameDirection: false, permissionIds: [] },
      },
      laneChangePermissions: [],
      polyline: [
        { x: definition.x0, y },
        { x: definition.x1, y },
      ],
    };
  }
  return {
    schemaVersion: 1,
    mapName: 'placement-route-test',
    source: { xodrSha256: 'placement-route-test' },
    lanes,
    gates: [],
    junctions: {},
  };
}

describe('buildSeededPlacementRoute', () => {
  it('returns the same connected route for the same document seed and actor id', () => {
    const graph = buildLaneGraph(topology([
      { rsl: '1:0:-1', x0: 0, x1: 10, successors: ['2:0:-1', '3:0:-1'] },
      { rsl: '2:0:-1', x0: 10, x1: 30, predecessors: ['1:0:-1'] },
      { rsl: '3:0:-1', x0: 10, x1: 30, predecessors: ['1:0:-1'] },
    ]));
    const options = {
      startRsl: '1:0:-1',
      startStorageS: 5,
      requiredDownstreamM: 15,
      seed: 'document-seed',
      actorId: 'vehicle_01',
    };

    const first = buildSeededPlacementRoute(graph, options);
    const second = buildSeededPlacementRoute(graph, options);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lanes).toHaveLength(2);
    expect(first.route.legs.map((leg) => leg.rsl)).toEqual(first.lanes);
    expect(first.downstreamM).toBeGreaterThanOrEqual(options.requiredDownstreamM);
  });

  it('uses the seed to vary a legal branch without changing connectivity', () => {
    const graph = buildLaneGraph(topology([
      { rsl: '1:0:-1', x0: 0, x1: 10, successors: ['2:0:-1', '3:0:-1'] },
      { rsl: '2:0:-1', x0: 10, x1: 30, predecessors: ['1:0:-1'] },
      { rsl: '3:0:-1', x0: 10, x1: 30, predecessors: ['1:0:-1'] },
    ]));
    const branches = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      const result = buildSeededPlacementRoute(graph, {
        startRsl: '1:0:-1',
        startStorageS: 5,
        requiredDownstreamM: 15,
        seed: `variation-${i}`,
        actorId: 'vehicle_01',
      });
      expect(result.ok).toBe(true);
      if (result.ok) branches.add(result.lanes[1]!);
    }
    expect(branches).toEqual(new Set(['2:0:-1', '3:0:-1']));
  });

  it('backtracks from a short dead end to a branch with enough runway', () => {
    const graph = buildLaneGraph(topology([
      { rsl: '1:0:-1', x0: 0, x1: 10, successors: ['2:0:-1', '3:0:-1'] },
      { rsl: '2:0:-1', x0: 10, x1: 15, predecessors: ['1:0:-1'] },
      { rsl: '3:0:-1', x0: 10, x1: 20, predecessors: ['1:0:-1'], successors: ['4:0:-1'] },
      { rsl: '4:0:-1', x0: 20, x1: 50, predecessors: ['3:0:-1'] },
    ]));

    const result = buildSeededPlacementRoute(graph, {
      startRsl: '1:0:-1',
      startStorageS: 9,
      requiredDownstreamM: 35,
      seed: 'dead-end-first-is-allowed',
      actorId: 'vehicle_01',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lanes).toEqual(['1:0:-1', '3:0:-1', '4:0:-1']);
    expect(result.downstreamM).toBeCloseTo(41);
  });

  it('returns a stable no-route error when available runway is insufficient', () => {
    const graph = buildLaneGraph(topology([
      { rsl: '1:0:-1', x0: 0, x1: 10, successors: ['2:0:-1'] },
      { rsl: '2:0:-1', x0: 10, x1: 15, predecessors: ['1:0:-1'] },
    ]));

    const result = buildSeededPlacementRoute(graph, {
      startRsl: '1:0:-1',
      startStorageS: 9,
      requiredDownstreamM: 20,
      seed: 'no-route',
      actorId: 'vehicle_01',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'route_disconnected',
        detail: { startRsl: '1:0:-1', requiredDownstreamM: 20 },
      },
    });
  });
});
