/** Exact topology and runtime closure for the curated ambulance corridor. */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildLanePathRoute, runSimulation } from '@uniscenarios/sim-engine';

import { DEV_ASSETS, REPO_ROOT, loadMap } from '../maps.js';
import { readInstance } from '../template-io.js';

const MAP = 'yale-street';
const INSTANCE = path.join(
  REPO_ROOT,
  'examples',
  'edge-cases',
  '03-red-light-ambulance-preemption',
  'scenario.instance.json',
);
const haveArtifacts =
  existsSync(path.join(DEV_ASSETS, MAP, 'topology-index.json.gz')) &&
  existsSync(INSTANCE);

describe.skipIf(!haveArtifacts)('red-light ambulance preemption route', () => {
  it('uses a legal drivable corridor through the intended straight junction gate', async () => {
    const [bundle, instance] = await Promise.all([loadMap(MAP), readInstance(INSTANCE)]);
    const ambulance = instance.input.actors.find((actor) => actor.id === 'ambulance')!;
    const focus = instance.input.actors.find((actor) => actor.id === 'focus-vehicle')!;

    expect(ambulance.initial.laneRef).toMatchObject({ rsl: '773:0:1', s: 40.15070367719396 });
    expect(ambulance.behavior.route.kind).toBe('lanePath');
    if (ambulance.behavior.route.kind !== 'lanePath') throw new Error('ambulance route must be lane-bound');

    const built = buildLanePathRoute(bundle.graph, ambulance.behavior.route.lanes);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.error.reason);

    for (const leg of built.route.legs) {
      expect(bundle.graph.requireGeometry(leg.rsl).lane.laneType).toBe('driving');
      const nominal = bundle.graph.nominalReversed(leg.rsl);
      if (nominal !== null) expect(leg.reversed).toBe(nominal);
    }
    for (let index = 0; index < built.route.legs.length - 1; index += 1) {
      const leg = built.route.legs[index]!;
      const next = built.route.legs[index + 1]!;
      expect(bundle.graph.successors(leg)).toContainEqual({ rsl: next.rsl, reversed: next.reversed });
    }

    const gate = bundle.topology.gates.find((candidate) => candidate.id === '1201:0:1-1');
    expect(gate).toMatchObject({
      junctionId: '1201',
      approachLaneRsl: '93:0:1',
      connectingLaneRsl: '1207:0:1',
      exitLaneRsls: ['92:0:1'],
      turnRelation: 'Straight',
    });
    expect(ambulance.behavior.route.lanes).toEqual(expect.arrayContaining([
      gate!.approachLaneRsl,
      gate!.connectingLaneRsl,
      gate!.exitLaneRsls[0]!,
    ]));

    const spawnRouteS = built.route.sOfLaneStorage(
      ambulance.initial.laneRef!.rsl,
      ambulance.initial.laneRef!.s,
    );
    const focusProjection = built.route.projectPoint({
      x: focus.initial.pose.x,
      y: -focus.initial.pose.z,
    });
    expect(spawnRouteS).not.toBeNull();
    expect(focusProjection.s - spawnRouteS!).toBeCloseTo(118, 6);

    const result = runSimulation(instance.input, { graph: bundle.graph, guards: 'collect' });
    expect(result.issues).toEqual([]);
    expect(result.trace.metrics.collisions).toEqual([]);
    expect(result.trace.metrics.triggerNeverFired).toEqual([]);
    expect(result.trace.events.some((event) =>
      event.kind === 'road_departure_prevented' && event.actorId === 'ambulance')).toBe(false);
    expect(result.trace.ticks.actors.ambulance!.laneRsl).toContain('1207:0:1');
  }, 30_000);
});
