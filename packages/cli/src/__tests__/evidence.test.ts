import { describe, expect, it } from 'vitest';

import {
  buildLaneGraph,
  contentHash,
  parseSimScenarioInput,
  runSimulation,
  type TopologyIndex,
} from '@uniscenarios/sim-engine';

import { verifyEvidenceHashes } from '../evidence.js';
import type { InstanceFile } from '../template-io.js';
const LANE = '1:0:-1';
const topology: TopologyIndex = {
  schemaVersion: 1,
  mapName: 'evidence-map',
  source: { xodrSha256: 'engine-synthetic' },
  lanes: {
    [LANE]: {
      rsl: LANE,
      roadId: 1,
      section: 0,
      laneId: -1,
      laneType: 'driving',
      isJunction: false,
      junctionId: null,
      predecessors: [],
      successors: [],
      speedLimitKph: 30,
      representativeWidthM: 3.5,
      widthSamples: [{ s: 0, widthM: 3.5 }, { s: 100, widthM: 3.5 }],
      adjacentLanes: {
        left: { side: 'left', laneRsl: null, sameDirection: false, permissionIds: [] },
        right: { side: 'right', laneRsl: null, sameDirection: false, permissionIds: [] },
      },
      laneChangePermissions: [],
      polyline: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    },
  },
  gates: [],
  junctions: {},
};
const graph = buildLaneGraph(topology);

function evidencePair(): { instance: InstanceFile; trace: ReturnType<typeof runSimulation>['trace'] } {
  const input = parseSimScenarioInput({
    mapId: 'evidence-map',
    clipSeconds: 1,
    warmupSeconds: 0,
    actors: [{
      id: 'ego',
      kind: 'vehicle',
      dims: { l: 4.5, w: 1.9, h: 1.5 },
      initial: {
        laneRef: { rsl: LANE, s: 10, tFrac: 0 },
        pose: { x: 10, z: 0, headingRad: 0 },
        speedMps: 5,
      },
      behavior: {
        route: { kind: 'lanePath', lanes: [LANE] },
        cruiseSpeedMps: 5,
      },
    }],
  });
  const trace = runSimulation(input, { graph, guards: 'collect' }).trace;
  const instance = {
    kind: 'scenario-instance' as const,
    version: 1 as const,
    input,
    manifest: {
      inputHash: contentHash(input),
      replayKey: {
        mapId: input.mapId,
        matcherIndexDigest: 'matcher-synthetic',
        engineGraphDigest: trace.header.engineGraphDigest,
      },
      actors: input.actors.map((actor) => ({ id: actor.id })),
    },
  } as unknown as InstanceFile;
  return { instance, trace };
}

describe('strict instance/trace evidence provenance', () => {
  it('accepts only a complete same-input, same-map, same-topology pair', () => {
    const { instance, trace } = evidencePair();
    const report = verifyEvidenceHashes(instance, trace);

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.matcherIndexDigest).toBe('matcher-synthetic');
    expect(report.manifestEngineGraphDigest).toBe(trace.header.engineGraphDigest);
    expect(report.traceEngineGraphDigest).toBe(trace.header.engineGraphDigest);
    expect(report.traceTrackActorIds).toEqual(['ego']);
  });

  it('rejects engine topology drift without comparing it to the matcher domain', () => {
    const { instance, trace } = evidencePair();
    const report = verifyEvidenceHashes(instance, {
      ...trace,
      header: { ...trace.header, engineGraphDigest: 'different-engine-graph' },
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'trace_engine_graph_digest_mismatch',
      'trace_topology_alias_mismatch',
    ]));
  });

  it('rejects a missing matcher-domain digest even when engine topology matches', () => {
    const { instance, trace } = evidencePair();
    const replayKey = { ...instance.manifest.replayKey } as Record<string, unknown>;
    delete replayKey['matcherIndexDigest'];
    const broken = {
      ...instance,
      manifest: { ...instance.manifest, replayKey },
    } as unknown as InstanceFile;
    const report = verifyEvidenceHashes(broken, trace);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('matcher_index_digest_missing');
  });

  it('rejects map, manifest actors, header actors, and track actors independently', () => {
    const { instance, trace } = evidencePair();
    const broken = {
      ...instance,
      manifest: {
        ...instance.manifest,
        replayKey: { ...instance.manifest.replayKey, mapId: 'wrong-map' },
        actors: [],
      },
    } as unknown as InstanceFile;
    const report = verifyEvidenceHashes(broken, {
      ...trace,
      header: { ...trace.header, mapId: 'other-map', actorIds: [] },
      ticks: { ...trace.ticks, actors: {} },
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'instance_map_id_mismatch',
      'trace_map_id_mismatch',
      'instance_actor_ids_mismatch',
      'trace_actor_ids_mismatch',
      'trace_actor_tracks_mismatch',
    ]));
  });
});
