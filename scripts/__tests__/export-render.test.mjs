import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  buildScenarioManifest,
  buildScenarioEvidenceGates,
  buildIncidentRenderPreflight,
  cameraActorClearance,
  cameraForIncident,
  selectIncidentFrames,
  selectIncidentVideoFrames,
  tracePose,
  validateScenarioPair,
} from '../export-render-lib.mjs';

const INSTANCE_FILE = new URL(
  '../../fixtures/evidence/golden-yale-bus-stop/instance.json',
  import.meta.url,
);
const TRACE_FILE = new URL(
  '../../fixtures/evidence/golden-yale-bus-stop/trace.json.gz',
  import.meta.url,
);

async function fixture() {
  const [instanceBytes, traceGzip] = await Promise.all([readFile(INSTANCE_FILE), readFile(TRACE_FILE)]);
  const traceBytes = gunzipSync(traceGzip);
  return {
    instance: JSON.parse(instanceBytes.toString('utf8')),
    trace: JSON.parse(traceBytes.toString('utf8')),
    traceBytes,
  };
}

function clone(value) {
  return structuredClone(value);
}

test('strictly validates the corrected concrete Yale instance and trace', async () => {
  const { instance, trace, traceBytes } = await fixture();
  const evidence = validateScenarioPair(instance, trace, traceBytes, { requiredMapId: 'yale-street' });

  assert.equal(evidence.inputHash, instance.manifest.inputHash);
  assert.equal(evidence.topology.matcherIndexDigest, instance.manifest.replayKey.matcherIndexDigest);
  assert.equal(evidence.topology.engineGraphDigest, instance.manifest.replayKey.engineGraphDigest);
  assert.equal(evidence.traceDigest.length, 64);
  assert.deepEqual(evidence.actorIds, ['bus', 'ego', 'ped']);
  assert.deepEqual(
    evidence.actorModels.map(({ id, catalogId, modelBasis, static: isStatic }) => ({ id, catalogId, modelBasis, static: isStatic })),
    [
      { id: 'bus', catalogId: 'vehicle.bus', modelBasis: 'input-tag', static: true },
      { id: 'ego', catalogId: 'vehicle.sedan', modelBasis: 'input-tag', static: false },
      { id: 'ped', catalogId: 'pedestrian.adult_walking', modelBasis: 'kind-default', static: false },
    ],
  );
  assert.equal(instance.manifest.archetype, 'C5.bus-stop-emergence');
  assert.match(instance.manifest.site.matchedReasons.join('\n'), /bus_stop/);
  assert.match(instance.manifest.site.matchedReasons.join('\n'), /right side of travel/);
  assert.equal(instance.manifest.actors.find((actor) => actor.id === 'bus').laneRsl, '87:0:-4');
  assert.equal(instance.input.actors.find((actor) => actor.id === 'bus').initial.laneRef.tFrac, -0.4);
});

test('hard-fails input hash, map, actor-id, and static-track mismatches', async () => {
  const { instance, trace, traceBytes } = await fixture();

  const badHash = clone(instance);
  badHash.input.seed = 'different';
  assert.throws(
    () => validateScenarioPair(badHash, trace, traceBytes),
    /manifest\.inputHash .* != recomputed.*trace\.header\.inputHash .* != recomputed/,
  );

  const badMap = clone(trace);
  badMap.header.mapId = 'el-camino-road';
  assert.throws(() => validateScenarioPair(instance, badMap, traceBytes), /map ids differ/);

  const badEngineTopology = clone(trace);
  badEngineTopology.header.engineGraphDigest = 'wrong-engine-domain';
  assert.throws(() => validateScenarioPair(instance, badEngineTopology, traceBytes), /engine graph digests differ/);

  const missingMatcherTopology = clone(instance);
  delete missingMatcherTopology.manifest.replayKey.matcherIndexDigest;
  assert.throws(
    () => validateScenarioPair(missingMatcherTopology, trace, traceBytes),
    /manifest\.replayKey\.matcherIndexDigest is missing/,
  );

  const badActors = clone(trace);
  badActors.header.actorIds = ['bus', 'ego'];
  assert.throws(() => validateScenarioPair(instance, badActors, traceBytes), /actor ids differ/);

  const movingStatic = clone(trace);
  movingStatic.ticks.actors.bus.x[100] += 0.1;
  assert.throws(() => validateScenarioPair(instance, movingStatic, traceBytes), /static actor bus\.x changes/);
});

test('selects named pre-reveal, reveal, conflict, and aftermath ticks deterministically', async () => {
  const { trace } = await fixture();
  const selected = selectIncidentFrames(trace);
  assert.deepEqual(selected.map((frame) => frame.phase), ['pre-reveal', 'reveal', 'conflict', 'aftermath']);
  assert.ok(Math.abs(selected[0].t - (trace.metrics.revealToConflict.losOpenT - 0.2)) < 1e-9);
  assert.equal(selected[1].t, trace.metrics.revealToConflict.losOpenT);
  assert.equal(selected[2].t, trace.metrics.revealToConflict.conflictT);
  assert.equal(selected[3].t, trace.metrics.revealToConflict.conflictT + 0.5);
});

test('selects a continuous, monotonic incident-video sequence', async () => {
  const { trace } = await fixture();
  const selected = selectIncidentVideoFrames(trace, 10);
  assert.ok(Math.abs(selected.startT - (trace.metrics.revealToConflict.losOpenT - 1)) < 1e-9);
  assert.ok(Math.abs(selected.endT - (trace.metrics.revealToConflict.conflictT + 0.8)) < 1e-9);
  assert.equal(selected.frames[0].t, selected.startT);
  assert.equal(selected.frames.at(-1).t, selected.endT);
  assert.ok(selected.frames.length >= Math.floor((selected.endT - selected.startT) * 10));
  for (let index = 1; index < selected.frames.length; index += 1) {
    assert.ok(selected.frames[index].index > selected.frames[index - 1].index);
    assert.ok(selected.frames[index].t > selected.frames[index - 1].t);
  }
});

test('keeps every incident camera outside actor OBBs and freezes after conflict', async () => {
  const { instance, trace, traceBytes } = await fixture();
  const evidence = validateScenarioPair(instance, trace, traceBytes);
  const framingIds = [...new Set([
    ...evidence.metricPair,
    ...trace.metrics.revealToConflict.relevantOccluderIds.map((id) => id.replace(/^actor:/, '')),
  ])];
  const keyFrames = selectIncidentFrames(trace);
  const videoFrames = selectIncidentVideoFrames(trace, 12).frames;
  const frames = [...keyFrames, ...videoFrames];
  let frozen = null;
  for (const frame of frames) {
    const camera = cameraForIncident(trace, evidence.metricPair, frame.index, 0, framingIds);
    const poses = evidence.actorIds.map((id) => tracePose(trace, id, frame.index));
    const clearance = cameraActorClearance(camera, poses, evidence.actorModels);
    assert.ok(clearance.clearanceM >= 2, `${frame.t}s camera clearance to ${clearance.actorId}`);
    if (frame.t > trace.metrics.revealToConflict.conflictT) {
      const view = { eye: camera.eye, target: camera.target, fovDeg: camera.fovDeg };
      if (frozen === null) frozen = view;
      else assert.deepEqual(view, frozen);
      assert.equal(camera.basis, 'conflict-frozen-low-oblique');
      assert.equal(camera.frozenAtT, trace.metrics.revealToConflict.conflictT);
    }
  }
});

test('builds a wall-clock-free deterministic manifest with named topology domains', async () => {
  const { instance, trace, traceBytes } = await fixture();
  const evidence = validateScenarioPair(instance, trace, traceBytes);
  const input = {
    instanceDoc: instance,
    trace,
    evidence,
    topologyDomains: {
      authoringMatcherTopology: { digest: 'a' },
      simulationRoadGraph: { digest: 'b' },
      studioRenderScene: { digest: 'c' },
    },
    viewport: { width: 960, height: 600, deviceScaleFactor: 1, includeUi: false },
    frameRecords: [{ phase: 'conflict', t: 5.94, poses: [], camera: {}, artifact: { file: 'frames/frame-000.png', sha256: 'd' } }],
    videoSequence: { startT: 3.92, endT: 6.74, fps: 10, frameCount: 29, frames: [] },
    video: { file: 'slice.mp4', sha256: 'e' },
    inputArtifacts: { instance: { sha256: 'f' }, traceFile: { sha256: 'g' } },
    rendererStats: { actorRenderer: { batches: 3, drawCalls: 10 } },
  };

  const first = buildScenarioManifest(input);
  const second = buildScenarioManifest(clone(input));
  assert.deepEqual(second, first);
  assert.equal(first.generatedAt, null);
  assert.equal(first.schema, 'uniscenarios.scenario-visual-evidence.v1');
  assert.equal(first.countsTowardScenarioCoverage, false);
  assert.equal(first.scenarioId, instance.manifest.instanceId);
  assert.equal(first.archetypeId, 'C5.bus-stop-emergence');
  assert.equal(first.siteId, instance.manifest.replayKey.siteId);
  assert.equal(first.drawId, instance.manifest.replayKey.drawIndex);
  assert.deepEqual(Object.keys(first.topologyDomains), [
    'authoringMatcherTopology',
    'simulationRoadGraph',
    'studioRenderScene',
  ]);
});

test('rejects the current Yale checkpoint because its pedestrian teleports out at conflict', async () => {
  const { instance, trace, traceBytes } = await fixture();
  const evidence = validateScenarioPair(instance, trace, traceBytes);
  const preflight = buildIncidentRenderPreflight(trace, evidence);
  assert.equal(preflight.verdict, 'reject');
  assert.deepEqual(
    preflight.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    ['incident-pair-present-in-aftermath'],
  );
  const rendered = JSON.parse(await readFile(new URL(
    '../../fixtures/evidence/golden-yale-bus-stop/render-manifest.json',
    import.meta.url,
  ), 'utf8'));
  const machine = buildScenarioEvidenceGates({
    trace,
    evidence,
    topologyDomains: rendered.topologyDomains,
    frameRecords: rendered.frames,
    videoSequence: rendered.videoSequence,
    video: rendered.video,
    diagnostics: [],
  });

  assert.equal(machine.verdict, 'reject');
  assert.deepEqual(
    machine.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    ['incident-pair-present-in-aftermath'],
  );
});
