import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import {
  evaluateAmbientRobustness,
  evaluateIntentRubric,
  traceDigest,
  type AmbientRobustnessCase,
  type IntentRubricInput,
  type SimScenarioInput,
  type SimTrace,
} from '../../packages/sim-engine/src/index.ts';

import { loadMap } from '../../packages/cli/src/maps.js';

interface InstanceArtifact {
  readonly input: SimScenarioInput;
}

interface CampaignCase {
  readonly directory: string;
  readonly mapId: string;
  readonly seedPrefix: string;
}

const ROOT = new URL('./', import.meta.url);

const CAMPAIGN: readonly CampaignCase[] = [
  {
    directory: 'blind-chicane-emerging-worker',
    mapId: 'belmont-research-center',
    seedPrefix: 'edge-01',
  },
  {
    directory: 'bus-occluded-child-signalized-crossing',
    mapId: 'yale-street',
    seedPrefix: 'edge-02',
  },
];

function cases(prefix: string): readonly AmbientRobustnessCase[] {
  return [
    { label: 'off', profile: { version: 1, preset: 'off', seed: `${prefix}-off` } },
    { label: 'light', profile: { version: 1, preset: 'light', seed: `${prefix}-light`, maxActors: 24 } },
    { label: 'moderate', profile: { version: 1, preset: 'moderate', seed: `${prefix}-moderate`, maxActors: 40 } },
  ];
}

function compactTrace(trace: SimTrace): Record<string, unknown> {
  return {
    inputHash: trace.header.inputHash,
    traceDigest: traceDigest(trace),
    ticks: trace.ticks.t.length,
    durationS: trace.ticks.t.at(-1),
    collisions: trace.metrics.collisions.length,
    missedTriggers: trace.metrics.triggerNeverFired,
  };
}

async function runCampaignCase(item: CampaignCase): Promise<void> {
  const dir = new URL(`./${item.directory}/`, ROOT);
  const instance = JSON.parse(await readFile(new URL('instance.json', dir), 'utf8')) as InstanceArtifact;
  const rubric = JSON.parse(await readFile(new URL('intent-rubric.json', dir), 'utf8')) as IntentRubricInput;
  const bundle = await loadMap(item.mapId);
  const robustness = evaluateAmbientRobustness(instance.input, bundle.graph, cases(item.seedPrefix));

  const reports = [];
  for (const result of robustness.cases) {
    const intent = evaluateIntentRubric(result.trace, rubric);
    await writeFile(
      new URL(`ambient-${result.label}.trace.json.gz`, dir),
      gzipSync(`${JSON.stringify(result.trace)}\n`),
    );
    reports.push({
      label: result.label,
      profile: result.profile,
      provenance: result.provenance,
      engineEvaluation: result.evaluation,
      intentEvaluation: intent,
      deterministic: result.deterministic,
      authoredEventOrderPreserved: result.authoredEventOrderPreserved,
      authoredNeverFiredPreserved: result.authoredNeverFiredPreserved,
      ambientCollisions: result.ambientCollisions,
      accepted: result.accepted && intent.verdict === 'accept',
      failures: [
        ...result.failures,
        ...(intent.verdict === 'accept' ? [] : [`intent rubric verdict: ${intent.verdict}`]),
      ],
      trace: compactTrace(result.trace),
    });
  }

  const report = {
    version: 1,
    scenario: item.directory,
    baseline: {
      engineEvaluation: robustness.baselineEvaluation,
      trace: compactTrace(robustness.baselineTrace),
      intentEvaluation: evaluateIntentRubric(robustness.baselineTrace, rubric),
    },
    accepted: reports.every((entry) => entry.accepted),
    cases: reports,
  };
  await writeFile(new URL('ambient-matrix.json', dir), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${item.directory}: ${report.accepted ? 'accepted' : 'rejected'}`);
}

async function main(): Promise<void> {
  const requested = new Set(process.argv.slice(2));
  for (const item of CAMPAIGN) {
    if (requested.size === 0 || requested.has(item.directory)) await runCampaignCase(item);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
