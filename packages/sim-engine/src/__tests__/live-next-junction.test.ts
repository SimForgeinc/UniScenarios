import { describe, expect, it } from 'vitest';

import { buildLaneGraph } from '../map/lane-graph.js';
import { buildFollowRoute } from '../map/route.js';
import type { TopologyGate, TopologyIndex, TopologyLane } from '../map/topology.js';
import { runSimulation } from '../sim/engine.js';
import { scenario, vehicle } from './fixtures/scenarios.js';

type Point = { x: number; y: number };

function lane(
  rsl: string,
  points: Point[],
  predecessors: string[],
  successors: string[],
  isJunction = false,
): TopologyLane {
  const length = points.slice(1).reduce(
    (sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
    0,
  );
  return {
    rsl,
    roadId: Object.keys(rsl).reduce((sum, char) => sum + char.charCodeAt(0), 0),
    section: 0,
    laneId: -1,
    laneType: 'driving',
    isJunction,
    junctionId: isJunction ? 'junction' : null,
    predecessors,
    successors,
    speedLimitKph: 50,
    representativeWidthM: 3.5,
    widthSamples: [{ s: 0, widthM: 3.5 }, { s: length, widthM: 3.5 }],
    adjacentLanes: {
      left: { side: 'left', laneRsl: null, sameDirection: false, permissionIds: [] },
      right: { side: 'right', laneRsl: null, sameDirection: false, permissionIds: [] },
    },
    laneChangePermissions: [],
    polyline: points,
  };
}

function gate(
  id: string,
  junctionId: string,
  approachLaneRsl: string,
  connectingLaneRsl: string,
  turnRelation: TopologyGate['turnRelation'],
  exitLaneRsl: string,
): TopologyGate {
  return {
    id,
    junctionId,
    approachLaneRsl,
    connectingLaneRsl,
    turnRelation,
    headingChangeRad: turnRelation === 'Straight' ? 0 : turnRelation === 'Right' ? -Math.PI / 2 : Math.PI / 2,
    exitLaneRsls: [exitLaneRsl],
  };
}

function twoJunctionTopology(): TopologyIndex {
  const lanes = [
    lane('first-approach', [{ x: 0, y: 0 }, { x: 10, y: 0 }], [], ['first-straight', 'first-right']),
    lane('first-straight', [{ x: 10, y: 0 }, { x: 20, y: 0 }], ['first-approach'], ['middle'], true),
    lane('first-right', [{ x: 10, y: 0 }, { x: 15, y: -5 }, { x: 10, y: -10 }], ['first-approach'], ['first-right-exit'], true),
    lane('first-right-exit', [{ x: 10, y: -10 }, { x: 10, y: -40 }], ['first-right'], []),
    lane('middle', [{ x: 20, y: 0 }, { x: 50, y: 0 }], ['first-straight'], ['second-straight', 'second-right']),
    lane('second-straight', [{ x: 50, y: 0 }, { x: 60, y: 0 }], ['middle'], ['second-straight-exit'], true),
    lane('second-straight-exit', [{ x: 60, y: 0 }, { x: 100, y: 0 }], ['second-straight'], []),
    lane('second-right', [{ x: 50, y: 0 }, { x: 55, y: -5 }, { x: 50, y: -10 }], ['middle'], ['second-right-exit'], true),
    lane('second-right-exit', [{ x: 50, y: -10 }, { x: 50, y: -50 }], ['second-right'], []),
  ];
  return {
    schemaVersion: 1,
    mapName: 'live-next-junction',
    source: { xodrSha256: 'live-next-junction' },
    lanes: Object.fromEntries(lanes.map((value) => [value.rsl, value])),
    gates: [
      gate('first-straight-gate', 'first', 'first-approach', 'first-straight', 'Straight', 'middle'),
      gate('first-right-gate', 'first', 'first-approach', 'first-right', 'Right', 'first-right-exit'),
      gate('second-straight-gate', 'second', 'middle', 'second-straight', 'Straight', 'second-straight-exit'),
      gate('second-right-gate', 'second', 'middle', 'second-right', 'Right', 'second-right-exit'),
    ],
    junctions: {},
  };
}

describe('live next-junction route commands', () => {
  it('turns at the next junction ahead when the actor has already passed an earlier junction', () => {
    const graph = buildLaneGraph(twoJunctionTopology());
    const actor = vehicle(graph, {
      id: 'ego',
      rsl: 'first-approach',
      s: 0,
      speedMps: 10,
      cruiseSpeedMps: 10,
    });
    actor.behavior.route = {
      kind: 'lanePath',
      lanes: ['first-approach', 'first-straight', 'middle', 'second-straight', 'second-straight-exit'],
    };
    const input = scenario(graph, {
      clipSeconds: 12,
      warmupSeconds: 0,
      actors: [actor],
      interactions: [{
        id: 'right-at-next-junction',
        actorId: 'ego',
        trigger: { kind: 'at', t: 2.5 },
        verb: 'route',
        target: { kind: 'nextJunction', turn: 'Right', maxLengthM: 200 },
      }],
    });

    const { trace } = runSimulation(input, { graph, guards: 'collect' });

    expect(trace.events).toContainEqual(expect.objectContaining({
      kind: 'trigger_fired', interactionId: 'right-at-next-junction', t: 2.5,
    }));
    expect(trace.events.some((event) => event.kind === 'route_change_rejected')).toBe(false);
    expect(trace.ticks.actors.ego!.y.at(-1)!).toBeLessThan(-5);
    expect(trace.ticks.actors.ego!.x.at(-1)!).toBeLessThan(60);
  });

  it('rejects a missing requested movement instead of silently taking another branch', () => {
    const topology = twoJunctionTopology();
    topology.gates = topology.gates.filter((candidate) => candidate.id !== 'second-right-gate');
    const result = buildFollowRoute(
      buildLaneGraph(topology),
      'middle',
      ['Right'],
      200,
      undefined,
      { strictTurns: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'route_turn_unavailable',
        detail: { rsl: 'middle', requestedTurn: 'Right', availableTurns: ['Straight'] },
      },
    });
  });

  it('rejects when there is no downstream junction instead of accepting a no-op route', () => {
    const topology = twoJunctionTopology();
    const result = buildFollowRoute(
      buildLaneGraph(topology),
      'second-straight-exit',
      ['Right'],
      200,
      undefined,
      { strictTurns: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'route_turn_unavailable', detail: { requestedTurn: 'Right' } },
    });
  });
});
