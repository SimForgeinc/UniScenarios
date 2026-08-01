import { createHash } from 'node:crypto';

export const TRACE_CHANNELS = [
  'x',
  'y',
  'headingRad',
  'speedMps',
  'laneRsl',
  's',
  'present',
];

export const REQUIRED_INCIDENT_PHASES = [
  'pre-reveal',
  'reveal',
  'conflict',
  'aftermath',
];

export const SCENARIO_EVIDENCE_SCHEMA = 'uniscenarios.scenario-visual-evidence.v1';

const KIND_DEFAULT_MODELS = {
  vehicle: 'vehicle.sedan',
  pedestrian: 'pedestrian.adult_walking',
};

export function canonicalJson(value) {
  return writeCanonical(value);
}

function writeCanonical(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${String(value)}`);
    return JSON.stringify(value + 0);
  }
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => writeCanonical(item === undefined ? null : item)).join(',')}]`;
  }
  if (type === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${writeCanonical(value[key])}`).join(',')}}`;
  }
  return 'null';
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Json(value) {
  return sha256Bytes(canonicalJson(value));
}

export function nearestIndex(times, target) {
  let best = 0;
  let distance = Infinity;
  for (let index = 0; index < times.length; index += 1) {
    const candidate = Math.abs(times[index] - target);
    if (candidate < distance) {
      best = index;
      distance = candidate;
    }
  }
  return best;
}

function exactSortedIds(values, label, issues) {
  if (!Array.isArray(values) || values.some((id) => typeof id !== 'string' || id.length === 0)) {
    issues.push(`${label} must be a non-empty string array`);
    return [];
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) issues.push(`${label} contains duplicate ids`);
  return sorted;
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function catalogModelFor(actor) {
  const explicit = (actor.tags ?? [])
    .filter((tag) => typeof tag === 'string' && tag.startsWith('catalog:'))
    .map((tag) => tag.slice('catalog:'.length));
  if (explicit.length > 1) throw new Error(`actor ${actor.id} has multiple catalog model tags`);
  if (explicit.length === 1 && explicit[0]) {
    return { catalogId: explicit[0], basis: 'input-tag' };
  }
  const catalogId = KIND_DEFAULT_MODELS[actor.kind];
  if (!catalogId) throw new Error(`actor ${actor.id} kind ${JSON.stringify(actor.kind)} has no renderer model`);
  return { catalogId, basis: 'kind-default' };
}

function validateTrack(actorId, track, tickCount, issues) {
  if (!track || typeof track !== 'object') {
    issues.push(`trace actor ${actorId} has no track`);
    return;
  }
  for (const channel of TRACE_CHANNELS) {
    if (!Array.isArray(track[channel]) || track[channel].length !== tickCount) {
      issues.push(`trace actor ${actorId}.${channel} length ${track[channel]?.length ?? 'missing'} != ticks ${tickCount}`);
    }
  }
}

function invariantValues(values) {
  return [...new Set(values.map((value) => canonicalJson(value)))];
}

function validateStaticActor(actor, track, issues) {
  if (!actor.static || !track) return;
  for (const channel of ['x', 'y', 'headingRad', 'speedMps', 'present']) {
    const unique = invariantValues(track[channel] ?? []);
    if (unique.length !== 1) issues.push(`static actor ${actor.id}.${channel} changes across the trace`);
  }
}

function requiredString(value, label, issues) {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(`${label} is missing`);
    return null;
  }
  return value;
}

/** Strictly join a concrete scenario instance to the one trace it produced. */
export function validateScenarioPair(instanceDoc, trace, traceCanonicalBytes, options = {}) {
  const issues = [];
  const input = instanceDoc?.input;
  if (!input || typeof input !== 'object') throw new Error('evidence integrity failed: instance.input is missing');
  if (!trace?.header || !trace?.ticks || !trace.ticks.actors) {
    throw new Error('evidence integrity failed: trace header/ticks are missing');
  }

  const inputHash = sha256Json(input);
  const manifestInputHash = instanceDoc.manifest?.inputHash ?? null;
  const traceInputHash = trace.header.inputHash ?? null;
  if (manifestInputHash !== inputHash) {
    issues.push(`manifest.inputHash ${manifestInputHash} != recomputed ${inputHash}`);
  }
  if (traceInputHash !== inputHash) {
    issues.push(`trace.header.inputHash ${traceInputHash} != recomputed ${inputHash}`);
  }

  const inputMapId = requiredString(input.mapId, 'instance.input.mapId', issues);
  const replayMapId = requiredString(instanceDoc.manifest?.replayKey?.mapId, 'manifest.replayKey.mapId', issues);
  const traceMapId = requiredString(trace.header.mapId, 'trace.header.mapId', issues);
  const requiredMapId = options.requiredMapId ?? null;
  const mapIds = [inputMapId, replayMapId, traceMapId, requiredMapId].filter(Boolean);
  if (new Set(mapIds).size > 1) issues.push(`map ids differ: ${mapIds.join(' != ')}`);

  const matcherIndexDigest = requiredString(
    instanceDoc.manifest?.replayKey?.matcherIndexDigest,
    'manifest.replayKey.matcherIndexDigest',
    issues,
  );
  const manifestEngineGraphDigest = requiredString(
    instanceDoc.manifest?.replayKey?.engineGraphDigest,
    'manifest.replayKey.engineGraphDigest',
    issues,
  );
  const traceEngineGraphDigest = requiredString(
    trace.header.engineGraphDigest,
    'trace.header.engineGraphDigest',
    issues,
  );
  const traceTopologyAlias = requiredString(
    trace.header.topologyDigest,
    'trace.header.topologyDigest',
    issues,
  );
  if (manifestEngineGraphDigest !== traceEngineGraphDigest) {
    issues.push(`engine graph digests differ: manifest=${manifestEngineGraphDigest} trace=${traceEngineGraphDigest}`);
  }
  if (traceTopologyAlias !== traceEngineGraphDigest) {
    issues.push(`trace topologyDigest must alias engineGraphDigest: ${traceTopologyAlias} != ${traceEngineGraphDigest}`);
  }

  const actors = Array.isArray(input.actors) ? input.actors : [];
  if (actors.length === 0) issues.push('instance input carries zero actors');
  const inputActorIds = exactSortedIds(actors.map((actor) => actor?.id), 'input actor ids', issues);
  const manifestActorIds = exactSortedIds(
    (instanceDoc.manifest?.actors ?? []).map((actor) => actor?.id),
    'manifest actor ids',
    issues,
  );
  const headerActorIds = exactSortedIds(trace.header.actorIds, 'trace header actor ids', issues);
  const trackActorIds = Object.keys(trace.ticks.actors).sort();
  if (!sameIds(inputActorIds, manifestActorIds)) {
    issues.push(`actor ids differ: input=${inputActorIds.join(',')} manifest=${manifestActorIds.join(',')}`);
  }
  if (!sameIds(inputActorIds, headerActorIds)) {
    issues.push(`actor ids differ: input=${inputActorIds.join(',')} trace-header=${headerActorIds.join(',')}`);
  }
  if (!sameIds(inputActorIds, trackActorIds)) {
    issues.push(`actor ids differ: input=${inputActorIds.join(',')} trace-tracks=${trackActorIds.join(',')}`);
  }

  const times = trace.ticks.t;
  if (!Array.isArray(times) || times.length === 0) issues.push('trace ticks.t is empty');
  else {
    if (times.some((time) => !Number.isFinite(time))) issues.push('trace ticks.t contains non-finite values');
    for (let index = 1; index < times.length; index += 1) {
      if (times[index] <= times[index - 1]) issues.push('trace ticks.t must be strictly increasing');
    }
  }
  for (const actor of actors) {
    const track = trace.ticks.actors[actor.id];
    validateTrack(actor.id, track, times?.length ?? 0, issues);
    validateStaticActor(actor, track, issues);
  }

  const metricPair = trace.metrics?.revealToConflict?.pair ?? trace.metrics?.minTTC?.pair ?? [];
  if (!Array.isArray(metricPair) || metricPair.length !== 2 || metricPair.some((id) => !inputActorIds.includes(id))) {
    issues.push(`metric pair must name exactly two input actors; got ${metricPair.join?.(',') ?? 'invalid'}`);
  }

  const actorModels = [];
  for (const actor of actors) {
    try {
      const model = catalogModelFor(actor);
      actorModels.push({
        id: actor.id,
        kind: actor.kind,
        static: actor.static === true,
        catalogId: model.catalogId,
        modelBasis: model.basis,
        dims: actor.dims,
      });
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (issues.length > 0) throw new Error(`evidence integrity failed: ${issues.join('; ')}`);
  return {
    mapId: inputMapId,
    inputHash,
    topology: {
      matcherIndexDigest,
      engineGraphDigest: traceEngineGraphDigest,
    },
    traceDigest: sha256Bytes(traceCanonicalBytes),
    actorIds: inputActorIds,
    actorModels: actorModels.sort((left, right) => left.id.localeCompare(right.id)),
    metricPair: [...metricPair],
  };
}

/** Four named incident samples, snapped to real recorded ticks. */
export function selectIncidentFrames(trace) {
  const times = trace.ticks.t;
  if (!Array.isArray(times) || times.length === 0) throw new Error('cannot select frames from an empty trace');
  const reveal = trace.metrics?.revealToConflict;
  const conflictT = reveal?.conflictT ?? trace.metrics?.minTTC?.t;
  const revealT = reveal?.losOpenT;
  if (!Number.isFinite(revealT) || !Number.isFinite(conflictT)) {
    throw new Error('trace must carry revealToConflict.losOpenT and a conflict timestamp');
  }
  const first = times[0];
  const last = times[times.length - 1];
  const clamp = (time) => Math.max(first, Math.min(last, time));
  const requested = [
    { phase: 'pre-reveal', targetT: clamp(revealT - 0.2) },
    { phase: 'reveal', targetT: clamp(revealT) },
    { phase: 'conflict', targetT: clamp(conflictT) },
    { phase: 'aftermath', targetT: clamp(conflictT + 0.5) },
  ];
  const selected = requested.map(({ phase, targetT }) => {
    const index = nearestIndex(times, targetT);
    return { phase, targetT, index, t: times[index] };
  });
  if (new Set(selected.map((frame) => frame.index)).size !== selected.length) {
    throw new Error('trace is too short to provide four distinct incident phases');
  }
  return selected;
}

/** Uniform trace samples for motion playback around the complete reveal. */
export function selectIncidentVideoFrames(trace, fps = 12) {
  if (!Number.isFinite(fps) || fps < 1) throw new Error('video fps must be a positive number');
  const reveal = trace.metrics?.revealToConflict;
  if (!reveal || !Number.isFinite(reveal.losOpenT) || !Number.isFinite(reveal.conflictT)) {
    throw new Error('trace must carry revealToConflict for incident video selection');
  }
  const times = trace.ticks.t;
  const startT = Math.max(times[0], reveal.losOpenT - 1);
  const endT = Math.min(times[times.length - 1], reveal.conflictT + 0.8);
  const count = Math.ceil((endT - startT) * fps);
  const selected = [];
  for (let frame = 0; frame <= count; frame += 1) {
    const targetT = Math.min(endT, startT + frame / fps);
    const index = nearestIndex(times, targetT);
    if (selected.at(-1)?.index === index) continue;
    selected.push({ index, targetT, t: times[index] });
  }
  if (selected.at(-1)?.t !== times[nearestIndex(times, endT)]) {
    const index = nearestIndex(times, endT);
    selected.push({ index, targetT: endT, t: times[index] });
  }
  return { fps, startT, endT, frames: selected };
}

/** Cheap trace-only gate that runs before any browser or GPU rendering. */
export function buildIncidentRenderPreflight(trace, evidence) {
  const selectedFrames = selectIncidentFrames(trace);
  const aftermath = selectedFrames.find((frame) => frame.phase === 'aftermath');
  const presence = Object.fromEntries(evidence.metricPair.map((id) => [
    id,
    aftermath ? trace.ticks.actors[id]?.present?.[aftermath.index] !== 0 : false,
  ]));
  const gates = [
    {
      id: 'four-distinct-incident-phases',
      status: new Set(selectedFrames.map((frame) => frame.index)).size === REQUIRED_INCIDENT_PHASES.length ? 'pass' : 'fail',
      evidence: selectedFrames.map(({ phase, index, t }) => ({ phase, index, t })),
    },
    {
      id: 'incident-pair-present-in-aftermath',
      status: evidence.metricPair.every((id) => presence[id]) ? 'pass' : 'fail',
      evidence: {
        metricPair: evidence.metricPair,
        aftermathT: aftermath?.t ?? null,
        presence,
        rationale: 'An aftermath frame must show the incident participants; despawning at conflict is a visible teleport.',
      },
    },
  ];
  return {
    schema: 'uniscenarios.scenario-render-preflight.v1',
    verdict: gates.every((gate) => gate.status === 'pass') ? 'pass' : 'reject',
    gates,
    selectedFrames,
  };
}

export function tracePose(trace, actorId, index) {
  const track = trace.ticks.actors[actorId];
  return {
    id: actorId,
    x: track.x[index],
    z: -track.y[index],
    headingRad: track.headingRad[index],
    speedMps: track.speedMps[index],
    present: track.present[index] !== 0,
  };
}

/** Stable map camera that keeps both members of the incident pair in frame. */
export function cameraForIncident(trace, pair, index, groundY = 0, framingActorIds = pair) {
  const sampleT = trace.ticks.t[index];
  const conflictT = trace.metrics?.revealToConflict?.conflictT ?? sampleT;
  const conflictIndex = nearestIndex(trace.ticks.t, conflictT);
  // The conflict composition is already known-good and all relevant actors are
  // present there. Freeze it for the tail instead of allowing a following
  // camera to drift through the bus, trees or buildings after despawn.
  const cameraIndex = sampleT > conflictT ? conflictIndex : index;
  const cameraT = trace.ticks.t[cameraIndex];
  const allPoses = framingActorIds.map((id) => tracePose(trace, id, cameraIndex));
  const poses = allPoses.filter((pose) => pose.present);
  const visibleAtSample = framingActorIds
    .map((id) => tracePose(trace, id, index))
    .filter((pose) => pose.present);
  if (poses.length === 0) throw new Error(`no framing actors are present at trace index ${index}`);
  const centerX = poses.reduce((sum, pose) => sum + pose.x, 0) / poses.length;
  const centerZ = poses.reduce((sum, pose) => sum + pose.z, 0) / poses.length;
  const subjectId = pair.includes(trace.header.metricSubject) ? trace.header.metricSubject : pair[0];
  const subject = tracePose(trace, subjectId, cameraIndex);
  const targetActor = tracePose(trace, pair.find((id) => id !== subjectId), cameraIndex);
  const sightlineLength = Math.hypot(subject.x - targetActor.x, subject.z - targetActor.z);
  const away = sightlineLength > 1e-6
    ? {
        x: (subject.x - targetActor.x) / sightlineLength,
        z: (subject.z - targetActor.z) / sightlineLength,
      }
    : { x: -Math.cos(subject.headingRad), z: Math.sin(subject.headingRad) };
  const side = { x: -away.z, z: away.x };
  const radius = Math.max(...poses.map((pose) => Math.hypot(pose.x - centerX, pose.z - centerZ)));
  const revealT = trace.metrics?.revealToConflict?.losOpenT ?? cameraT;
  const baseDistance = Math.max(11, Math.min(15, radius * 0.45 + 8));
  const revealProgress = conflictT > revealT
    ? Math.max(0, Math.min(1, (cameraT - revealT) / (conflictT - revealT)))
    : 1;
  // Stay almost on the ego sightline through reveal, then move toward the
  // clear median side of the road. The opposite sign puts the observer on
  // the bus-stop sidewalk, where Yale's shelter roof and street trees can
  // completely hide the incident despite adequate actor clearance.
  const distance = baseDistance + 11 * revealProgress;
  const sideOffset = 0.25 + 4.75 * revealProgress;
  const trailingEye = {
    x: subject.x + away.x * distance + side.x * sideOffset,
    z: subject.z + away.z * distance + side.z * sideOffset,
  };
  const fovDeg = Math.max(24, Math.min(52, 52 - (radius - 8) * 1.1));
  return {
    basis: cameraIndex === index ? 'ego-sightline-low-oblique' : 'conflict-frozen-low-oblique',
    frozenAtT: cameraIndex === index ? null : cameraT,
    pair: [...pair],
    framingActorIds: [...framingActorIds],
    visibleFramingActorIds: visibleAtSample.map((pose) => pose.id),
    fovDeg,
    eye: [
      trailingEye.x,
      groundY + 3.3 + 1.5 * revealProgress,
      trailingEye.z,
    ],
    target: [centerX, groundY + 1.35, centerZ],
  };
}

/** Horizontal clearance from a camera eye to the nearest actor footprint. */
export function cameraActorClearance(camera, poses, actorModels) {
  const dims = new Map(actorModels.map((actor) => [actor.id, actor.dims]));
  let minimum = Infinity;
  let actorId = null;
  for (const pose of poses) {
    if (!pose.present) continue;
    const actorDims = dims.get(pose.id);
    if (!actorDims) continue;
    const dx = camera.eye[0] - pose.x;
    const dz = camera.eye[2] - pose.z;
    const cos = Math.cos(pose.headingRad);
    const sin = Math.sin(pose.headingRad);
    const forward = cos * dx - sin * dz;
    const lateral = -sin * dx - cos * dz;
    const outsideForward = Math.max(0, Math.abs(forward) - actorDims.l / 2);
    const outsideLateral = Math.max(0, Math.abs(lateral) - actorDims.w / 2);
    const clearanceM = Math.hypot(outsideForward, outsideLateral);
    if (clearanceM < minimum) {
      minimum = clearanceM;
      actorId = pose.id;
    }
  }
  return { actorId, clearanceM: minimum };
}

export function scenarioIdentity(instanceDoc) {
  const replay = instanceDoc.manifest.replayKey;
  return {
    scenarioId: instanceDoc.manifest.instanceId,
    templateId: replay.templateId,
    archetypeId: instanceDoc.manifest.archetype,
    siteId: replay.siteId,
    drawId: replay.drawIndex,
    drawSeed: replay.paramSeed,
  };
}

function pass(id, evidence) {
  return { id, status: 'pass', evidence };
}

function fail(id, evidence) {
  return { id, status: 'fail', evidence };
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Build deterministic, review-independent acceptance gates. A render that
 * fails any gate is diagnostic output, never scenario evidence.
 */
export function buildScenarioEvidenceGates({
  trace,
  evidence,
  topologyDomains,
  frameRecords,
  videoSequence,
  video,
  diagnostics = [],
}) {
  const gates = [];
  const phases = frameRecords.map((frame) => frame.phase);
  const distinctTickCount = new Set(frameRecords.map((frame) => frame.index)).size;
  const exactPhases = phases.length === REQUIRED_INCIDENT_PHASES.length
    && phases.every((phase, index) => phase === REQUIRED_INCIDENT_PHASES[index])
    && distinctTickCount === REQUIRED_INCIDENT_PHASES.length;
  gates.push((exactPhases ? pass : fail)('four-distinct-incident-phases', {
    expected: REQUIRED_INCIDENT_PHASES,
    actual: phases,
    distinctTickCount,
  }));

  const revealT = trace.metrics?.revealToConflict?.losOpenT;
  const conflictT = trace.metrics?.revealToConflict?.conflictT;
  const byPhase = new Map(frameRecords.map((frame) => [frame.phase, frame]));
  const phaseTimesValid = Number.isFinite(revealT)
    && Number.isFinite(conflictT)
    && byPhase.get('pre-reveal')?.t < revealT
    && byPhase.get('reveal')?.t >= revealT
    && Math.abs((byPhase.get('conflict')?.t ?? Infinity) - conflictT) <= 1e-9
    && byPhase.get('aftermath')?.t > conflictT;
  gates.push((phaseTimesValid ? pass : fail)('phase-times-bracket-reveal-and-conflict', {
    revealT,
    conflictT,
    frameTimes: Object.fromEntries(frameRecords.map((frame) => [frame.phase, frame.t])),
  }));

  const expectedActors = evidence.actorIds;
  const posesExact = frameRecords.every((frame) => {
    const actual = (frame.poses ?? []).map((pose) => pose.id).sort();
    return actual.length === expectedActors.length
      && actual.every((id, index) => id === expectedActors[index]);
  });
  gates.push((posesExact ? pass : fail)('every-key-frame-carries-all-actor-poses', {
    expectedActorIds: expectedActors,
    frames: frameRecords.map((frame) => ({
      phase: frame.phase,
      actorIds: (frame.poses ?? []).map((pose) => pose.id).sort(),
    })),
  }));

  const aftermath = byPhase.get('aftermath');
  const aftermathPair = new Map((aftermath?.poses ?? []).map((pose) => [pose.id, pose.present]));
  const pairPresentAfterConflict = evidence.metricPair.every((id) => aftermathPair.get(id) === true);
  gates.push((pairPresentAfterConflict ? pass : fail)('incident-pair-present-in-aftermath', {
    metricPair: evidence.metricPair,
    presence: Object.fromEntries(evidence.metricPair.map((id) => [id, aftermathPair.get(id) ?? null])),
    rationale: 'An aftermath frame must show the incident participants; despawning at conflict is a visible teleport.',
  }));

  const compositionPasses = frameRecords.every((frame) => frame.composition?.passed === true);
  gates.push((compositionPasses ? pass : fail)('key-frame-composition', {
    frames: frameRecords.map((frame) => ({ phase: frame.phase, passed: frame.composition?.passed === true })),
  }));

  const clearancePasses = frameRecords.every(
    (frame) => Number.isFinite(frame.cameraActorClearance?.clearanceM)
      && frame.cameraActorClearance.clearanceM >= 2,
  );
  gates.push((clearancePasses ? pass : fail)('camera-outside-actor-footprints', {
    minimumM: 2,
    frames: frameRecords.map((frame) => ({
      phase: frame.phase,
      actorId: frame.cameraActorClearance?.actorId ?? null,
      clearanceM: frame.cameraActorClearance?.clearanceM ?? null,
    })),
  }));

  const artifactsValid = frameRecords.every(
    (frame) => typeof frame.artifact?.file === 'string' && isSha256(frame.artifact?.sha256),
  );
  const artifactHashes = frameRecords.map((frame) => frame.artifact?.sha256).filter(Boolean);
  const artifactsDistinct = new Set(artifactHashes).size === frameRecords.length;
  gates.push((artifactsValid && artifactsDistinct ? pass : fail)('key-frame-artifacts-valid-and-distinct', {
    files: frameRecords.map((frame) => frame.artifact?.file ?? null),
    hashesValid: artifactsValid,
    distinctHashCount: new Set(artifactHashes).size,
  }));

  const videoValid = typeof video?.file === 'string'
    && video.file.toLowerCase().endsWith('.mp4')
    && isSha256(video?.sha256)
    && Number.isInteger(video.frameCount)
    && video.frameCount > 0
    && Number.isFinite(video.fps)
    && video.fps >= 8
    && videoSequence?.frameCount === video.frameCount
    && videoSequence?.frames?.length === video.frameCount;
  gates.push((videoValid ? pass : fail)('mp4-encoded-and-probed', {
    file: video?.file ?? null,
    sha256: video?.sha256 ?? null,
    fps: video?.fps ?? null,
    frameCount: video?.frameCount ?? null,
    unavailable: video?.unavailable ?? false,
    reason: video?.reason ?? null,
  }));

  const videoCoversIncident = videoSequence
    && videoSequence.startT < revealT
    && videoSequence.endT > conflictT
    && videoSequence.frames?.length > 1
    && videoSequence.frames.every((frame, index, frames) => index === 0 || frame.t > frames[index - 1].t);
  gates.push((videoCoversIncident ? pass : fail)('video-covers-reveal-through-aftermath', {
    startT: videoSequence?.startT ?? null,
    revealT,
    conflictT,
    endT: videoSequence?.endT ?? null,
  }));

  const topologyKeys = ['authoringMatcherTopology', 'simulationRoadGraph', 'studioRenderScene'];
  const topologyValid = topologyKeys.every((key) => isSha256(topologyDomains?.[key]?.digest));
  gates.push((topologyValid ? pass : fail)('three-domain-topology-provenance', {
    domains: Object.fromEntries(topologyKeys.map((key) => [key, topologyDomains?.[key]?.digest ?? null])),
  }));

  gates.push((diagnostics.length === 0 ? pass : fail)('browser-diagnostics-empty', {
    count: diagnostics.length,
    diagnostics,
  }));

  return {
    verdict: gates.every((gate) => gate.status === 'pass') ? 'pass' : 'reject',
    gates,
  };
}

export function assertScenarioEvidenceAccepted(machineAssessment) {
  const failed = machineAssessment.gates.filter((gate) => gate.status !== 'pass');
  if (failed.length > 0) {
    throw new Error(`scenario visual evidence rejected: ${failed.map((gate) => gate.id).join(', ')}`);
  }
}

/** Build the wall-clock-free portion of the final evidence manifest. */
export function buildScenarioManifest({
  instanceDoc,
  trace,
  evidence,
  topologyDomains,
  viewport,
  frameRecords,
  videoSequence,
  video,
  inputArtifacts,
  rendererStats,
  diagnostics = [],
}) {
  const identity = scenarioIdentity(instanceDoc);
  const machineAssessment = buildScenarioEvidenceGates({
    trace,
    evidence,
    topologyDomains,
    frameRecords,
    videoSequence,
    video,
    diagnostics,
  });
  return {
    schema: SCENARIO_EVIDENCE_SCHEMA,
    generatedAt: null,
    deterministic: true,
    evidenceClass: 'scenario-instance-incident',
    coverageEligibility: machineAssessment.verdict === 'pass' ? 'pending-human-review' : 'rejected',
    countsTowardScenarioCoverage: false,
    renderer: {
      path: 'UniScenarios CityViewer + EditorController.ActorRenderer',
      realMapGeometry: true,
      realCatalogModels: true,
      frame: 'scene-y-up',
      stats: rendererStats,
    },
    ...identity,
    mapId: evidence.mapId,
    inputHash: evidence.inputHash,
    traceDigest: evidence.traceDigest,
    topologyDomains,
    actors: {
      count: evidence.actorIds.length,
      ids: evidence.actorIds,
      models: evidence.actorModels.map(({ dims, ...model }) => ({
        ...model,
        simulationDims: dims,
      })),
      staticInvariant: evidence.actorModels.filter((actor) => actor.static).map((actor) => actor.id),
    },
    metricPair: evidence.metricPair,
    metrics: {
      minTTC: trace.metrics.minTTC ?? null,
      revealToConflict: trace.metrics.revealToConflict ?? null,
      minDistance: trace.metrics.minDistance ?? [],
      collisions: trace.metrics.collisions ?? [],
    },
    viewport,
    frameTimes: frameRecords.map((frame) => ({ phase: frame.phase, t: frame.t })),
    frames: frameRecords,
    videoSequence,
    video,
    artifacts: inputArtifacts,
    machineAssessment,
    humanReview: {
      status: 'pending',
      verdict: null,
      required: true,
      template: 'review.json',
    },
    integrity: {
      instanceInputHashMatches: true,
      traceInputHashMatches: true,
      mapIdsExactMatch: true,
      actorIdsExactMatch: true,
      staticActorsInvariant: true,
    },
  };
}
