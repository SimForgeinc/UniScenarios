import { describe, expect, it } from 'vitest';

import { buildMapControlPlan, parseMapSignalCatalog } from './map-signals.js';

describe('map-wide ambient physical controls', () => {
  it('binds every OpenDRIVE junction head to its exact approach stop line', () => {
    const signalCatalog = parseMapSignalCatalog(
      `
        <road id="200"><signals><signalReference id="h1" s="5"><validity fromLane="-1" toLane="-1"/></signalReference></signals></road>
        <road id="400"><signals><signalReference id="h2" s="5"><validity fromLane="-1" toLane="-1"/></signalReference></signals></road>
        <controller id="c1" sequence="0"><control signalId="h1"/></controller>
        <controller id="c2" sequence="0"><control signalId="h2"/></controller>
        <junction id="j1"><controller id="c1"/></junction>
        <junction id="j2"><controller id="c2"/></junction>
      `,
      {
        features: [
          { properties: { id: 'h1', road_id: '200', s: 5, signal_category: 'traffic_light', dynamic: 'yes' } },
          { properties: { id: 'h2', road_id: '400', s: 5, signal_category: 'traffic_light', dynamic: 'yes' } },
          { properties: { id: 'stop-2', road_id: '400', s: 5, signal_category: 'stop_sign', dynamic: 'no' } },
        ],
      },
    );
    const lengths: Record<string, number> = { '100:0:-1': 50, '300:0:-1': 70 };
    const bundle = {
      signalCatalog,
      topology: {
        lanes: {
          '100:0:-1': { roadId: 100, laneId: -1 },
          '200:0:-1': { roadId: 200, laneId: -1 },
          '300:0:-1': { roadId: 300, laneId: -1 },
          '400:0:-1': { roadId: 400, laneId: -1 },
        },
        gates: [
          { id: 'g1', junctionId: 'j1', approachLaneRsl: '100:0:-1', connectingLaneRsl: '200:0:-1' },
          { id: 'g2', junctionId: 'j2', approachLaneRsl: '300:0:-1', connectingLaneRsl: '400:0:-1' },
        ],
      },
      graph: {
        geometry: (rsl: string) => lengths[rsl] === undefined ? null : { lengthM: lengths[rsl] },
        nominalReversed: () => false,
      },
      index: {
        junctionDescriptors: {
          j1: { approaches: [{ gateIds: ['g1'] }], conflictPairs: [] },
          j2: { approaches: [{ gateIds: ['g2'] }], conflictPairs: [] },
        },
      },
    } as any;

    const plan = buildMapControlPlan(bundle);
    expect(plan.signalPrograms.map((program) => program.id)).toEqual(['signal:h1', 'signal:h2']);
    expect(plan.signalPrograms.map((program) => program.mapBinding)).toEqual([
      expect.objectContaining({ junctionId: 'j1', controllerIds: ['c1'], headIds: ['h1'] }),
      expect.objectContaining({ junctionId: 'j2', controllerIds: ['c2'], headIds: ['h2'] }),
    ]);
    expect(plan.signalPrograms.flatMap((program) => program.stopLines)).toEqual([
      { rsl: '100:0:-1', s: 49, connectingLaneRsls: ['200:0:-1'] },
      { rsl: '300:0:-1', s: 69, connectingLaneRsls: ['400:0:-1'] },
    ]);
    expect(plan.roadControls).toEqual([
      expect.objectContaining({
        id: 'road-control:stop-2',
        stopLines: [{ rsl: '300:0:-1', s: 69, connectingLaneRsls: ['400:0:-1'] }],
      }),
    ]);
  });
});
