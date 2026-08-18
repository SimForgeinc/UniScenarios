import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { atomicJson, retryKind, stage } from './pipeline.mjs';
import {
  acceptanceCache,
  acceptsCampaignVideo,
  campaignVideoRow,
  canonicalJson,
  classifyText,
  contractIdentity,
  CONTRACT_SHA256,
  evaluateReview,
  isCurrentAcceptance,
  judgeAcceptanceSummary,
  normalizeJudgeDocument,
  retryRecommendation,
  REVIEW_CONTRACT,
  sha256Text,
} from './review-contract.mjs';

const REVIEW = Object.freeze({
  tier: '3d',
  mechanismFidelity: 'yes',
  visualGrounding: 'pass',
  actorFidelity: 'pass',
  eventSequence: 'pass',
  plausible: true,
  realism: 7,
  confidence: 0.8,
  defects: [],
  explanation: 'The requested mechanism happens on camera and every actor sits on the road.',
});

test('the review contract is a single canonically hashed source of truth', () => {
  const { sha256, ...body } = REVIEW_CONTRACT;
  assert.equal(sha256, CONTRACT_SHA256);
  assert.equal(sha256, sha256Text(canonicalJson(body)));
  // The canonical form is byte-identical to Python's
  // json.dumps(value, sort_keys=True, separators=(',', ':')), which is what makes one hash shared.
  assert.equal(
    canonicalJson({ b: 1, a: [true, null, 'é', 'tab\ttab'], z: 0.6 }),
    '{"a":[true,null,"\\u00e9","tab\\ttab"],"b":1,"z":0.6}',
  );
});

test('the reviewer prompt names exactly the codes a reviewer may emit', () => {
  const prompted = new Set(
    [...REVIEW_CONTRACT.prompt.matchAll(/^ {2}((?:scenario|simulation|render|capture|judge)\.[a-z.]+)/gm)]
      .map((match) => match[1]),
  );
  const taxonomy = new Set(REVIEW_CONTRACT.defects.codes);
  assert.deepEqual([...prompted].filter((code) => !taxonomy.has(code)), []);
  assert.deepEqual(
    [...taxonomy].filter((code) => !prompted.has(code)),
    REVIEW_CONTRACT.defects.pipelineCodes,
  );
});

test('every conformance vector the contract carries agrees with the shipped predicates', () => {
  assert.ok(REVIEW_CONTRACT.conformance.length >= 10);
  for (const vector of REVIEW_CONTRACT.conformance) {
    const result = evaluateReview(vector.review);
    assert.deepEqual({
      semanticAccepted: result.semanticAccepted,
      presentationAccepted: result.presentationAccepted,
      defectCodes: result.defectCodes,
      unsupported: result.unsupportedReason !== null,
    }, {
      semanticAccepted: vector.expect.semanticAccepted,
      presentationAccepted: vector.expect.presentationAccepted,
      defectCodes: vector.expect.defectCodes,
      unsupported: vector.expect.unsupported,
    }, vector.name);
  }
});

test('a realism-7 mechanism-correct render with camera and asset defects is semantic, not presentable', () => {
  const result = evaluateReview({
    ...REVIEW,
    visualGrounding: 'fail',
    defects: [
      { code: 'render.camera.framing', text: 'the conflict is cropped at the right edge' },
      { code: 'render.asset.grounding', text: 'the lead sedan hovers above the lane' },
    ],
  });
  assert.equal(result.semanticAccepted, true);
  assert.equal(result.presentationAccepted, false);
  assert.equal(result.unsupportedReason, null);
  assert.deepEqual(result.defectCodes, ['render.asset.grounding', 'render.camera.framing']);
  // The raw reviewer text and its confidence survive attribution.
  assert.deepEqual(
    result.defects.filter((defect) => defect.source === 'model').map((defect) => [defect.text, defect.confidence]),
    [['the conflict is cropped at the right edge', 0.8], ['the lead sedan hovers above the lane', 0.8]],
  );
});

test('a scenario defect fails both verdicts and no reviewer text can silently succeed', () => {
  const sequence = evaluateReview({
    ...REVIEW,
    eventSequence: 'fail',
    defects: [{ code: 'scenario.sequence', text: 'the pedestrian never enters the crosswalk' }],
  });
  assert.equal(sequence.semanticAccepted, false);
  assert.equal(sequence.presentationAccepted, false);
  assert.deepEqual(sequence.defectCodes, ['scenario.sequence']);

  for (const silent of [{ ...REVIEW, explanation: '   ' }, { ...REVIEW, explanation: undefined }]) {
    const result = evaluateReview(silent);
    assert.equal(result.semanticAccepted, false, 'an empty review cannot be accepted');
    assert.equal(result.presentationAccepted, false);
    assert.deepEqual(result.defectCodes, ['judge.uncertain']);
    assert.match(result.unsupportedReason, /no explanatory text/);
  }
});

test('free reviewer text is attributed to one code, and ambiguity becomes judge.uncertain', () => {
  assert.equal(classifyText('the camera crops the collision out of frame'), 'render.camera.framing');
  assert.equal(classifyText('the sedan hovers above the road surface'), 'render.asset.grounding');
  assert.equal(classifyText('the ego routes around the closure instead of stopping'), 'scenario.mechanism');
  assert.equal(classifyText('the pedestrian never crosses'), 'scenario.sequence');
  assert.equal(classifyText('frozen_actor'), 'simulation.kinematics');
  assert.equal(classifyText('other:the trailer clips through the wall'), 'render.asset.geometry');
  assert.equal(classifyText('renderer captured an empty scene'), 'capture.empty');
  assert.equal(classifyText('something about this feels off'), null);

  const ambiguous = evaluateReview({ ...REVIEW, defects: ['something about this feels off'] });
  assert.deepEqual(ambiguous.defectCodes, ['judge.uncertain']);
  assert.match(ambiguous.unsupportedReason, /unattributable defect text/);
  assert.equal(ambiguous.defects[0].text, 'something about this feels off');
});

test('retry recommendation follows the dominant defect prefix, never the cheapest excuse', () => {
  assert.deepEqual(retryRecommendation(['render.camera.framing', 'scenario.sequence'], { reviewed: 2 }), {
    action: 'reauthor', codes: ['scenario.sequence'], reason: 'dominant defect prefix scenario.',
  });
  assert.equal(retryRecommendation(['render.camera.framing'], { reviewed: 2 }).action, 'recompose');
  assert.equal(retryRecommendation(['simulation.collision'], { reviewed: 2 }).action, 'resimulate');
  assert.equal(retryRecommendation(['capture.empty'], { reviewed: 2 }).action, 'recapture');
  assert.equal(retryRecommendation(['judge.uncertain'], { reviewed: 2 }).action, 'rereview');
  assert.equal(retryRecommendation([], { reviewed: 2 }), null);
  // No 3D evidence at all is the one case where reauthoring is the cheapest available fix.
  assert.deepEqual(retryRecommendation(['capture.empty'], { reviewed: 0 }), {
    action: 'reauthor', codes: ['capture.empty'], reason: 'no reviewable presentation evidence',
  });
});

function judgeDocument(cells) {
  return { status: 'complete', contract: contractIdentity(), cells };
}

function judgedCell(cellId, review, overrides = {}) {
  const result = evaluateReview({ tier: '3d', ...review });
  return {
    cellId,
    status: 'complete',
    semanticAccepted: result.semanticAccepted,
    presentationAccepted: result.presentationAccepted,
    defectCodes: result.defectCodes,
    unsupportedReason: result.unsupportedReason,
    acceptance: { tier: result.tier, axes: result.axes, defects: result.defects, contract: contractIdentity() },
    ...overrides,
  };
}

test('judge summaries separate semantic truth from deliverable presentation', () => {
  const document = judgeDocument([
    judgedCell('camera-defect', { ...REVIEW, defects: [{ code: 'render.camera.framing', text: 'cropped' }] }),
    judgedCell('wrong-sequence', { ...REVIEW, eventSequence: 'fail' }),
    judgedCell('clean', REVIEW),
  ]);
  const summary = judgeAcceptanceSummary(document);
  assert.equal(summary.reviewed, 3);
  assert.equal(summary.semanticAcceptedCells, 2);
  assert.equal(summary.presentationAcceptedCells, 1);
  assert.equal(summary.unsupportedCells, 0);
  assert.deepEqual(summary.defectCodeCounts, { 'render.camera.framing': 1, 'scenario.sequence': 1 });
  assert.equal(summary.retry.action, 'reauthor');
});

test('a campaign video is a result only under the current contract with both verdicts clean', () => {
  const clean = judgedCell('clean', REVIEW);
  const cameraDefect = judgedCell('camera', { ...REVIEW, defects: [{ code: 'render.camera.framing', text: 'cropped' }] });
  const blind = judgedCell('blind', { tier: '2d', plausible: true, realism: 8, confidence: 0.9, defects: [], mechanismObserved: 'traffic moves' });
  const document = judgeDocument([clean, cameraDefect, blind]);

  assert.equal(acceptsCampaignVideo(document, clean), true);
  assert.equal(acceptsCampaignVideo(document, cameraDefect), false);
  assert.equal(acceptsCampaignVideo(document, blind), false, 'a blind 2D verdict is never a 3D result');
  assert.equal(campaignVideoRow(document, 'clean').cellId, 'clean');
  assert.equal(campaignVideoRow(document, 'camera'), null);

  // Stale evidence: the same accepted row under a superseded contract is not collectable.
  const superseded = { ...document, contract: { ...contractIdentity(), sha256: `${'0'.repeat(64)}` } };
  assert.equal(acceptsCampaignVideo(superseded, clean), false);
  assert.equal(campaignVideoRow(superseded, 'clean'), null);
  // Legacy documents normalize for reading but stay uncollectable.
  const legacy = normalizeJudgeDocument({ productReviewVersion: 'showcase-3d-product-review-v4', cells: [{ cellId: 'clean', status: 'complete', productAccepted: true, threeDReview: { version: 'showcase-3d-product-review-v4', ...REVIEW } }] });
  assert.equal(legacy.cells[0].presentationAccepted, true);
  assert.equal(campaignVideoRow(legacy, 'clean'), null);
});

test('retryKind spends an authoring cycle only on scenario defects', () => {
  const production = { render3d: true, judge: true, fallbackToVisual: true, topK: 3 };
  const scenarioOnly = judgeDocument([judgedCell('a', { ...REVIEW, eventSequence: 'fail' })]);
  const presentationOnly = judgeDocument([
    judgedCell('a', { ...REVIEW, defects: [{ code: 'render.camera.framing', text: 'cropped' }] }),
  ]);
  const accepted = judgeDocument([judgedCell('a', REVIEW)]);

  assert.equal(retryKind({ engine: 'compiler' }, production, scenarioOnly), 'visual-fallback');
  assert.equal(retryKind({ engine: 'vista2' }, production, scenarioOnly), 'visual-repair');
  assert.equal(retryKind({ engine: 'compiler' }, { ...production, _fallbackDepth: 1 }, scenarioOnly), null);
  assert.equal(retryKind({ engine: 'compiler' }, production, presentationOnly), null);
  assert.equal(retryKind({ engine: 'compiler' }, production, accepted), null);
  assert.equal(retryKind({ engine: 'compiler' }, production, { status: 'skipped', cells: [] }), null);
  // No presentation evidence at all still escalates to the visual author.
  assert.equal(retryKind({ engine: 'compiler' }, production, judgeDocument([])), 'visual-fallback');
});

test('historical judge documents normalize to attributable verdicts that are never current', () => {
  const legacy = {
    status: 'complete',
    productReviewVersion: 'showcase-3d-product-review-v4',
    acceptedCells: 2,
    cells: [
      {
        cellId: 'legacy-clean',
        status: 'complete',
        realism: 8,
        productAccepted: true,
        threeDReview: {
          version: 'showcase-3d-product-review-v4',
          mechanismFidelity: 'yes',
          visualGrounding: 'pass',
          actorFidelity: 'pass',
          eventSequence: 'pass',
          plausible: true,
          realism: 8,
          confidence: 0.9,
          defects: [],
          explanation: 'Clean run under the pre-split contract.',
          accepted: true,
        },
      },
      {
        cellId: 'legacy-camera',
        status: 'complete',
        productAccepted: true,
        threeDReview: {
          version: 'showcase-3d-product-review-v4',
          mechanismFidelity: 'yes',
          visualGrounding: 'pass',
          actorFidelity: 'pass',
          eventSequence: 'pass',
          plausible: true,
          realism: 7,
          confidence: 0.8,
          defects: ['the camera crops the moment of conflict out of frame'],
          explanation: 'Mechanism right, framing unusable.',
          accepted: false,
        },
      },
    ],
  };
  const normalized = normalizeJudgeDocument(legacy);
  assert.equal(isCurrentAcceptance(legacy), false);
  assert.equal(isCurrentAcceptance(normalized), false, 'normalization must not manufacture currency');
  assert.equal(normalized.contract.sha256, null);
  assert.equal(normalized.contract.reviewVersion, 'showcase-3d-product-review-v4');
  assert.equal(normalized.semanticAcceptedCells, 2);
  assert.equal(normalized.presentationAcceptedCells, 1);
  for (const row of normalized.cells) {
    assert.equal('productAccepted' in row, false, 'the miscalibrated legacy flag is dropped');
    assert.equal(row.acceptance.contract, null);
    assert.equal(row.acceptance.normalizedFrom, 'showcase-3d-product-review-v4');
  }
  assert.deepEqual(normalized.cells[1].defectCodes, ['render.camera.framing']);
  assert.equal(normalized.cells[1].semanticAccepted, true);
  assert.equal(normalized.cells[1].presentationAccepted, false);
  // A document already written under the current contract is passed through untouched.
  const current = judgeDocument([judgedCell('a', REVIEW)]);
  assert.equal(normalizeJudgeDocument(current), current);
});

test('cache keys bind a judgement to the contract, prompt, review code, request, and flags', () => {
  const base = {
    codeSha256: 'code-a',
    requestSha256: 'request-a',
    model: 'gpt-5.6-sol',
    effort: 'medium',
    flags: { judge: true, render3d: true, topK: 3 },
  };
  const key = (overrides) => acceptanceCache({ ...base, ...overrides }).key;
  const inputs = acceptanceCache(base).inputs;
  assert.equal(inputs.contractSha256, CONTRACT_SHA256);
  assert.equal(inputs.promptSha256, sha256Text(REVIEW_CONTRACT.prompt));
  assert.equal(key({}), key({}));
  for (const drift of [
    { codeSha256: 'code-b' },
    { requestSha256: 'request-b' },
    { model: 'other-model' },
    { effort: 'high' },
    { flags: { judge: true, render3d: false, topK: 3 } },
    { flags: { judge: true, render3d: true, topK: 1 } },
  ]) {
    assert.notEqual(key(drift), key({}), `cache key must change for ${JSON.stringify(drift)}`);
  }
});

test('a judgement cached under another contract is retired, never read as current', async (t) => {
  const jobDir = await mkdtemp(join(tmpdir(), 'showcase-stale-test-'));
  t.after(async () => rm(jobDir, { recursive: true, force: true }));
  const judgePath = join(jobDir, '70-judge.json');
  const events = [];
  const context = { jobDir, timings: {}, staleArtifacts: {}, emit: (event) => events.push(event) };
  await atomicJson(judgePath, {
    status: 'complete',
    cache: { key: 'superseded-contract-key' },
    cells: [{ cellId: 'a', presentationAccepted: true }],
  });

  let ran = 0;
  const fresh = await stage(context, '70-judge', [judgePath], async () => {
    ran += 1;
    const value = { status: 'complete', cache: { key: 'current-key' }, cells: [] };
    await atomicJson(judgePath, value);
    return value;
  }, { cacheKey: 'current-key' });

  assert.equal(ran, 1, 'a stale artifact must be recomputed');
  assert.equal(fresh.cache.key, 'current-key');
  assert.equal(JSON.parse(await readFile(judgePath, 'utf8')).cells.length, 0);
  assert.deepEqual(context.staleArtifacts['70-judge'].previousKey, 'superseded-contract-key');
  const retired = await readdir(join(jobDir, '.stale'));
  assert.deepEqual(retired, ['70-judge.json.superseded-c']);
  assert.equal(JSON.parse(await readFile(join(jobDir, '.stale', retired[0]), 'utf8')).cells[0].cellId, 'a');

  // A matching key is reused without rerunning the reviewer.
  const reused = await stage(context, '70-judge', [judgePath], async () => {
    ran += 1;
    return { status: 'complete', cells: [] };
  }, { cacheKey: 'current-key' });
  assert.equal(ran, 1);
  assert.equal(reused.cache.key, 'current-key');
});
