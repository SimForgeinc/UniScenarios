import { createHash } from 'node:crypto';

import {
  REQUIRED_INCIDENT_PHASES,
  SCENARIO_EVIDENCE_SCHEMA,
  canonicalJson,
} from './export-render-lib.mjs';

export const SCENARIO_REVIEW_SCHEMA = 'uniscenarios.scenario-visual-review.v1';
export const SCENARIO_REVIEW_LEDGER_SCHEMA = 'uniscenarios.scenario-visual-review-ledger.v1';

function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function exactPhaseFrames(manifest) {
  const frames = manifest?.frames ?? [];
  return frames.length === REQUIRED_INCIDENT_PHASES.length
    && frames.every((frame, index) => frame.phase === REQUIRED_INCIDENT_PHASES[index]);
}

/**
 * Keep map-orbit, stress, editor, and renderer-smoke artifacts outside the
 * scenario review namespace even when they happen to contain actors.
 */
export function classifyVisualArtifact(manifest) {
  const reasons = [];
  if (manifest?.schema !== SCENARIO_EVIDENCE_SCHEMA) {
    reasons.push(`schema ${manifest?.schema ?? 'missing'} is not ${SCENARIO_EVIDENCE_SCHEMA}`);
  }
  if (manifest?.evidenceClass !== 'scenario-instance-incident') {
    reasons.push(`evidenceClass ${manifest?.evidenceClass ?? 'missing'} is not scenario-instance-incident`);
  }
  if (manifest?.renderer?.cameraMode === 'orbit' || manifest?.cameraMode === 'orbit') {
    reasons.push('orbit captures are renderer diagnostics, not scenario evidence');
  }
  const purpose = `${manifest?.purpose ?? ''} ${manifest?.kind ?? ''}`.toLowerCase();
  if (purpose.includes('stress') || purpose.includes('smoke')) {
    reasons.push('stress/smoke captures are diagnostics, not scenario evidence');
  }
  if (typeof manifest?.scenarioId !== 'string' || manifest.scenarioId.length === 0) {
    reasons.push('scenarioId is missing');
  }
  if (!exactPhaseFrames(manifest)) {
    reasons.push('exact pre-reveal/reveal/conflict/aftermath frames are missing');
  }
  if (typeof manifest?.video?.file !== 'string' || typeof manifest?.video?.sha256 !== 'string') {
    reasons.push('an MP4 artifact and digest are required');
  }
  if (manifest?.machineAssessment?.verdict !== 'pass') {
    reasons.push('machine assessment did not pass');
  }
  return {
    kind: reasons.length === 0 ? 'scenario-review-candidate' : 'diagnostic-only',
    eligibleForHumanScenarioReview: reasons.length === 0,
    reasons,
  };
}

export function createScenarioReviewTemplate(manifest, manifestFile = 'manifest.json') {
  const classification = classifyVisualArtifact(manifest);
  return {
    schema: SCENARIO_REVIEW_SCHEMA,
    manifest: {
      file: manifestFile,
      sha256: sha256Json(manifest),
      scenarioId: manifest?.scenarioId ?? null,
      inputHash: manifest?.inputHash ?? null,
      traceDigest: manifest?.traceDigest ?? null,
    },
    classification,
    inspection: {
      reviewer: null,
      completedAt: null,
      verdict: null,
      notes: [],
      frames: (manifest?.frames ?? []).map((frame) => ({
        phase: frame.phase,
        file: frame.artifact?.file ?? null,
        sha256: frame.artifact?.sha256 ?? null,
        observed: false,
      })),
      video: {
        file: manifest?.video?.file ?? null,
        sha256: manifest?.video?.sha256 ?? null,
        observed: false,
      },
    },
    decision: {
      status: 'pending',
      countsTowardScenarioCoverage: false,
      reasons: classification.reasons,
    },
  };
}

function exactReviewedArtifacts(manifest, review) {
  const expectedFrames = manifest.frames.map((frame) => ({
    phase: frame.phase,
    file: frame.artifact.file,
    sha256: frame.artifact.sha256,
  }));
  const actualFrames = review?.inspection?.frames ?? [];
  const framesMatch = actualFrames.length === expectedFrames.length
    && actualFrames.every((frame, index) => frame.observed === true
      && frame.phase === expectedFrames[index].phase
      && frame.file === expectedFrames[index].file
      && frame.sha256 === expectedFrames[index].sha256);
  const expectedVideo = manifest.video;
  const actualVideo = review?.inspection?.video;
  const videoMatches = actualVideo?.observed === true
    && actualVideo.file === expectedVideo.file
    && actualVideo.sha256 === expectedVideo.sha256;
  return { framesMatch, videoMatches };
}

export function adjudicateScenarioReview(manifest, review) {
  const reasons = [];
  const classification = classifyVisualArtifact(manifest);
  if (!classification.eligibleForHumanScenarioReview) reasons.push(...classification.reasons);
  if (review?.schema !== SCENARIO_REVIEW_SCHEMA) reasons.push('review schema is invalid');
  if (review?.manifest?.sha256 !== sha256Json(manifest)) reasons.push('review does not bind the exact manifest');
  if (review?.manifest?.scenarioId !== manifest?.scenarioId) reasons.push('review scenarioId differs from manifest');
  if (typeof review?.inspection?.reviewer !== 'string' || review.inspection.reviewer.trim().length === 0) {
    reasons.push('reviewer is required');
  }
  if (!['accepted', 'rejected'].includes(review?.inspection?.verdict)) {
    reasons.push('review verdict must be accepted or rejected');
  }
  const artifacts = exactReviewedArtifacts(manifest, review);
  if (!artifacts.framesMatch) reasons.push('all four exact key-frame digests must be observed');
  if (!artifacts.videoMatches) reasons.push('the exact MP4 digest must be observed');
  const valid = reasons.length === 0;
  const accepted = valid && review.inspection.verdict === 'accepted';
  return {
    status: valid ? review.inspection.verdict : 'invalid',
    countsTowardScenarioCoverage: accepted,
    reasons,
  };
}

export function upsertScenarioReview(ledger, manifest, review) {
  const decision = adjudicateScenarioReview(manifest, review);
  if (decision.status === 'invalid') {
    throw new Error(`invalid scenario visual review: ${decision.reasons.join('; ')}`);
  }
  const base = ledger ?? { schema: SCENARIO_REVIEW_LEDGER_SCHEMA, entries: [] };
  if (base.schema !== SCENARIO_REVIEW_LEDGER_SCHEMA || !Array.isArray(base.entries)) {
    throw new Error('invalid scenario visual review ledger');
  }
  const entry = {
    scenarioId: manifest.scenarioId,
    mapId: manifest.mapId,
    inputHash: manifest.inputHash,
    traceDigest: manifest.traceDigest,
    renderManifestSha256: sha256Json(manifest),
    reviewer: review.inspection.reviewer,
    completedAt: review.inspection.completedAt,
    verdict: decision.status,
    notes: review.inspection.notes ?? [],
    frameArtifacts: review.inspection.frames.map(({ observed: _observed, ...frame }) => frame),
    videoArtifact: {
      file: review.inspection.video.file,
      sha256: review.inspection.video.sha256,
    },
    countsTowardScenarioCoverage: decision.countsTowardScenarioCoverage,
  };
  const entries = base.entries.filter((item) => item.scenarioId !== manifest.scenarioId);
  entries.push(entry);
  entries.sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  return {
    schema: SCENARIO_REVIEW_LEDGER_SCHEMA,
    entries,
    summary: {
      reviewed: entries.length,
      accepted: entries.filter((item) => item.countsTowardScenarioCoverage).length,
      rejected: entries.filter((item) => item.verdict === 'rejected').length,
    },
  };
}
