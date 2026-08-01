import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adjudicateScenarioReview,
  classifyVisualArtifact,
  createScenarioReviewTemplate,
  upsertScenarioReview,
} from '../scenario-review-ledger-lib.mjs';

const phases = ['pre-reveal', 'reveal', 'conflict', 'aftermath'];

function scenarioManifest() {
  return {
    schema: 'uniscenarios.scenario-visual-evidence.v1',
    evidenceClass: 'scenario-instance-incident',
    scenarioId: 'scenario-1',
    mapId: 'yale-street',
    inputHash: 'a'.repeat(64),
    traceDigest: 'b'.repeat(64),
    renderer: { cameraMode: 'incident-composition' },
    frames: phases.map((phase, index) => ({
      phase,
      artifact: { file: `frames/${phase}.png`, sha256: String(index + 1).repeat(64) },
    })),
    video: { file: 'incident.mp4', sha256: 'f'.repeat(64) },
    machineAssessment: { verdict: 'pass', gates: [] },
  };
}

test('classifies map orbit and stress screenshots as diagnostic-only', () => {
  const orbit = {
    schema: 'uniscenarios.render-export.v1',
    renderer: { cameraMode: 'incident-composition' },
    purpose: 'stress smoke',
    frames: [{ cameraMode: 'orbit' }],
  };
  const classification = classifyVisualArtifact(orbit);
  assert.equal(classification.kind, 'diagnostic-only');
  assert.equal(classification.eligibleForHumanScenarioReview, false);
  assert.match(classification.reasons.join('\n'), /orbit captures/);
  assert.match(classification.reasons.join('\n'), /stress\/smoke captures/);
});

test('never counts a pending review and requires observation of exact frame and video digests', () => {
  const manifest = scenarioManifest();
  const review = createScenarioReviewTemplate(manifest, 'manifest.json');
  assert.equal(review.decision.countsTowardScenarioCoverage, false);
  assert.equal(adjudicateScenarioReview(manifest, review).status, 'invalid');

  review.inspection.reviewer = 'visual-qa-agent';
  review.inspection.completedAt = '2026-08-01T00:00:00.000Z';
  review.inspection.verdict = 'accepted';
  review.inspection.frames = review.inspection.frames.map((frame) => ({ ...frame, observed: true }));
  review.inspection.video.observed = true;
  const decision = adjudicateScenarioReview(manifest, review);
  assert.deepEqual(decision, { status: 'accepted', countsTowardScenarioCoverage: true, reasons: [] });

  const ledger = upsertScenarioReview(null, manifest, review);
  assert.deepEqual(ledger.summary, {
    reviewed: 1,
    accepted: 1,
    rejected: 0,
    byMap: { 'yale-street': { reviewed: 1, accepted: 1, rejected: 0 } },
  });
  assert.equal(ledger.entries[0].countsTowardScenarioCoverage, true);

  review.inspection.frames[0].sha256 = '0'.repeat(64);
  assert.throws(() => upsertScenarioReview(ledger, manifest, review), /all four exact key-frame digests/);
});

test('cannot count the same instance and trace twice under different scenario ids', () => {
  const first = scenarioManifest();
  const firstReview = createScenarioReviewTemplate(first);
  firstReview.inspection.reviewer = 'visual-qa-agent';
  firstReview.inspection.completedAt = '2026-08-01T00:00:00.000Z';
  firstReview.inspection.verdict = 'accepted';
  firstReview.inspection.frames = firstReview.inspection.frames.map((frame) => ({ ...frame, observed: true }));
  firstReview.inspection.video.observed = true;
  const ledger = upsertScenarioReview(null, first, firstReview);

  const duplicate = scenarioManifest();
  duplicate.scenarioId = 'scenario-duplicate';
  const duplicateReview = createScenarioReviewTemplate(duplicate);
  duplicateReview.inspection.reviewer = 'visual-qa-agent';
  duplicateReview.inspection.completedAt = '2026-08-01T00:01:00.000Z';
  duplicateReview.inspection.verdict = 'accepted';
  duplicateReview.inspection.frames = duplicateReview.inspection.frames.map((frame) => ({ ...frame, observed: true }));
  duplicateReview.inspection.video.observed = true;
  assert.throws(
    () => upsertScenarioReview(ledger, duplicate, duplicateReview),
    /same instance\/trace evidence is already counted/,
  );
});

test('refuses to put an orbit manifest in the scenario review ledger', () => {
  const manifest = scenarioManifest();
  manifest.renderer.cameraMode = 'orbit';
  const review = createScenarioReviewTemplate(manifest);
  review.inspection.reviewer = 'visual-qa-agent';
  review.inspection.verdict = 'rejected';
  review.inspection.frames = review.inspection.frames.map((frame) => ({ ...frame, observed: true }));
  review.inspection.video.observed = true;
  assert.throws(() => upsertScenarioReview(null, manifest, review), /orbit captures are renderer diagnostics/);
});
