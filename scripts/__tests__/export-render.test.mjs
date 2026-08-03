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
  renderViewsAtTraceIndex,
  traceRenderState,
  sha256Json,
  sha256Bytes,
  tracePose,
  validateScenarioPair,
  validateScenarioResult,
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

test('direct export requires hard eligibility and exact atomic source commit hashes', () => {
  const catalogSlot = {
    identity: 'slot-1',
    attemptSeed: 'a'.repeat(64),
  };
  const instance = { catalogSlot, manifest: { inputHash: 'b'.repeat(64) } };
  const trace = { header: { catalogSlot } };
  const instanceBytes = Buffer.from(JSON.stringify(instance));
  const traceBytes = Buffer.from(JSON.stringify(trace));
  const accepted = {
    catalogSlot,
    instanceId: 'slot-1',
    status: 'ok',
    feasible: true,
    verdict: 'accept',
    eligibility: { eligible: true, collisionPolicy: 'reject', hardFailureCodes: [] },
    inputHash: instance.manifest.inputHash,
    traceDigest: sha256Json(trace),
    artifactHashes: {
      instanceSha256: sha256Bytes(instanceBytes),
      traceSha256: sha256Bytes(traceBytes),
    },
  };
  assert.doesNotThrow(() => validateScenarioResult(instance, trace, accepted, traceBytes, {
    instanceFileBytes: instanceBytes,
    traceFileBytes: traceBytes,
  }));

  const ineligible = clone(accepted);
  ineligible.eligibility = { eligible: false, collisionPolicy: 'allow', hardFailureCodes: ['collision'] };
  ineligible.artifactHashes.traceSha256 = '0'.repeat(64);
  assert.throws(
    () => validateScenarioResult(instance, trace, ineligible, traceBytes, {
      instanceFileBytes: instanceBytes,
      traceFileBytes: traceBytes,
    }),
    /eligibility\.eligible.*collisionPolicy.*hardFailureCodes.*artifactHashes\.traceSha256/,
  );
});

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

test('uses exact catalog or verified semantic-kind render identities without generic substitution', async () => {
  const { instance, trace, traceBytes } = await fixture();
  const cyclistInstance = clone(instance);
  const cyclistTrace = clone(trace);
  const cyclist = cyclistInstance.input.actors.find((actor) => actor.id === 'ped');
  cyclist.kind = 'bicycle';
  cyclist.dims = { l: 1.8, w: 0.6, h: 1.7 };
  const inputHash = sha256Json(cyclistInstance.input);
  cyclistInstance.manifest.inputHash = inputHash;
  cyclistTrace.header.inputHash = inputHash;
  const cyclistEvidence = validateScenarioPair(cyclistInstance, cyclistTrace, traceBytes);
  assert.equal(cyclistEvidence.actorModels.find((actor) => actor.id === 'ped').catalogId, 'vehicle.bicycle');

  for (const kind of ['animal', 'static_object']) {
    const semanticInstance = clone(cyclistInstance);
    const semanticTrace = clone(cyclistTrace);
    semanticInstance.input.actors.find((actor) => actor.id === 'ped').kind = kind;
    const semanticHash = sha256Json(semanticInstance.input);
    semanticInstance.manifest.inputHash = semanticHash;
    semanticTrace.header.inputHash = semanticHash;
    const semanticEvidence = validateScenarioPair(semanticInstance, semanticTrace, traceBytes);
    assert.deepEqual(
      semanticEvidence.actorModels.find((actor) => actor.id === 'ped').renderIdentity,
      { source: 'semantic', kind },
    );
    assert.equal(
      semanticEvidence.actorModels.find((actor) => actor.id === 'ped').modelBasis,
      'semantic-kind',
    );
  }
});

test('projects fixed and attached props plus articulated state into deterministic Studio render views', async () => {
  const { instance, trace, traceBytes } = await fixture();
  const document = clone(instance);
  const traced = clone(trace);
  document.input.props = [
    {
      id: 'barrier', catalogId: 'construction.traffic_cone',
      pose: { x: 12, z: -4, headingRad: 0.2 }, dims: { l: 1, w: 2, h: 3 }, scale: 2,
      collidable: true, essentiality: 'required',
    },
    {
      id: 'bike-rack', catalogId: 'street.bicycle_rack',
      pose: { x: 0, z: 0, headingRad: 0 }, dims: { l: 2, w: 0.5, h: 1 }, scale: 1,
      collidable: false, essentiality: 'required',
      attachment: { actorId: 'bus', longitudinalM: 1, lateralM: 0.5, heightM: 0.25, headingOffsetRad: 0.1 },
    },
  ];
  traced.header.propMetadata = Object.fromEntries(document.input.props.map((prop) => [prop.id, prop]));
  traced.events.push(
    { t: 1, kind: 'state_set', actorId: 'bus', key: 'doors.left', value: 'opening' },
    { t: 2, kind: 'state_set', actorId: 'bus', key: 'doors.left', value: 'open' },
  );
  const inputHash = sha256Json(document.input);
  document.manifest.inputHash = inputHash;
  traced.header.inputHash = inputHash;
  const evidence = validateScenarioPair(document, traced, traceBytes);

  const preEvent = traceRenderState(traced, 0);
  assert.deepEqual(preEvent.doors.get('bus'), { right: 'open', left: 'closed' });
  const index = traced.ticks.t.findIndex((time) => time >= 2);
  const views = renderViewsAtTraceIndex(document, traced, evidence, index);
  assert.deepEqual(views.actors.find((actor) => actor.id === 'bus').doors, { right: 'open', left: 'open' });
  assert.deepEqual(views.props.find((prop) => prop.id === 'barrier').dims, { l: 2, w: 4, h: 6 });
  const bus = views.actors.find((actor) => actor.id === 'bus');
  const rack = views.props.find((prop) => prop.id === 'bike-rack');
  assert.ok(Math.hypot(rack.x - bus.x, rack.z - bus.z) > 0.9);
  assert.equal(rack.heightM, 0.25);
  const camera = cameraForIncident(traced, evidence.metricPair, index, 0, evidence.metricPair, [
    { ...views.props.find((prop) => prop.id === 'barrier'), y: 0 },
  ]);
  assert.deepEqual(camera.framingPropIds, ['barrier']);

  const broken = clone(traced);
  delete broken.header.propMetadata.barrier;
  assert.throws(() => validateScenarioPair(document, broken, traceBytes), /prop ids differ/);
});

test('selects named pre-event, reveal, conflict, and aftermath ticks deterministically', async () => {
  const { trace } = await fixture();
  const selected = selectIncidentFrames(trace);
  const nearestT = (target) => trace.ticks.t.reduce((best, candidate) => (
    Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
  ));
  assert.deepEqual(selected.map((frame) => frame.phase), ['pre-event', 'reveal', 'conflict', 'aftermath']);
  assert.equal(selected[0].t, nearestT(trace.metrics.revealToConflict.losOpenT - 0.2));
  assert.equal(selected[1].t, nearestT(trace.metrics.revealToConflict.losOpenT));
  assert.equal(selected[2].t, nearestT(trace.metrics.revealToConflict.conflictT));
  assert.equal(selected[3].t, nearestT(trace.metrics.revealToConflict.conflictT + 0.5));
});

test('selects a continuous, monotonic incident-video sequence', async () => {
  const { trace } = await fixture();
  const selected = selectIncidentVideoFrames(trace, 10);
  assert.ok(Math.abs(selected.startT - (trace.metrics.revealToConflict.losOpenT - 1)) < 1e-9);
  assert.ok(Math.abs(selected.endT - (trace.metrics.revealToConflict.conflictT + 0.8)) < 1e-9);
  assert.ok(Math.abs(selected.frames[0].t - selected.startT) <= 0.01);
  assert.ok(Math.abs(selected.frames.at(-1).t - selected.endT) <= 0.01);
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

test('accepts the corrected Yale checkpoint with a stable aftermath', async () => {
  const { instance, trace, traceBytes } = await fixture();
  const evidence = validateScenarioPair(instance, trace, traceBytes);
  const preflight = buildIncidentRenderPreflight(trace, evidence);
  assert.equal(preflight.verdict, 'pass');
  assert.deepEqual(
    preflight.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    [],
  );
  const aftermath = preflight.selectedFrames.find((frame) => frame.phase === 'aftermath');
  assert.ok(aftermath.t > trace.metrics.revealToConflict.conflictT);
  for (const actorId of evidence.metricPair) {
    assert.notEqual(trace.ticks.actors[actorId].present[aftermath.index], 0);
  }
});
