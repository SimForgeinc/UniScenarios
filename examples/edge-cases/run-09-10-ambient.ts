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

interface InstanceArtifact { readonly input: SimScenarioInput }
interface CampaignCase {
  readonly directory: string;
  readonly instance: string;
  readonly mapId: string;
  readonly seedPrefix: string;
}

const ROOT = new URL('./', import.meta.url);
const CAMPAIGN: readonly CampaignCase[] = [
  {
    directory: 'double-turn-mobility-scooter',
    instance: 'instance.json',
    mapId: 'el-camino-road',
    seedPrefix: 'edge-09',
  },
  {
    directory: 'reversible-lane-stadium-egress',
    instance: 'source.instance.json',
    mapId: 'yale-street',
    seedPrefix: 'edge-10',
  },
];

function matrix(prefix: string): readonly AmbientRobustnessCase[] {
  return [
    { label: 'off', profile: { version: 1, preset: 'off', seed: `${prefix}-off` } },
    { label: 'light', profile: { version: 1, preset: 'light', seed: `${prefix}-light` } },
    { label: 'moderate', profile: { version: 1, preset: 'moderate', seed: `${prefix}-moderate` } },
  ];
}

function compact(trace: SimTrace): Record<string, unknown> {
  return {
    inputHash: trace.header.inputHash,
    traceDigest: traceDigest(trace),
    ticks: trace.ticks.t.length,
    durationS: trace.ticks.t.at(-1),
    collisions: trace.metrics.collisions.length,
    missedTriggers: trace.metrics.triggerNeverFired,
  };
}

function ambientCounts(provenance: {
  readonly profile: { readonly maxActors: number; readonly densityVehiclesPerKm: number };
  readonly eligibleLaneKm: number;
  readonly actors: readonly unknown[];
  readonly warnings: readonly string[];
}): Record<string, number> {
  const removalWarning = provenance.warnings.find((warning) => warning.startsWith('Removed '));
  const removedByScreening = removalWarning ? Number.parseInt(removalWarning.split(' ')[1] ?? '0', 10) : 0;
  const retained = provenance.actors.length;
  return {
    requested: Math.min(
      provenance.profile.maxActors,
      Math.round(provenance.eligibleLaneKm * provenance.profile.densityVehiclesPerKm),
    ),
    generatedBeforeScreening: retained + removedByScreening,
    retained,
    removedByFullClipScreening: removedByScreening,
  };
}

async function run(item: CampaignCase): Promise<void> {
  const dir = new URL(`./${item.directory}/`, ROOT);
  const instance = JSON.parse(await readFile(new URL(item.instance, dir), 'utf8')) as InstanceArtifact;
  const rubric = JSON.parse(await readFile(new URL('intent-rubric.json', dir), 'utf8')) as IntentRubricInput;
  const bundle = await loadMap(item.mapId);
  const robustness = evaluateAmbientRobustness(instance.input, bundle.graph, matrix(item.seedPrefix));
  const cases = [];
  for (const result of robustness.cases) {
    const intent = evaluateIntentRubric(result.trace, rubric);
    await writeFile(new URL(`ambient-${result.label}.trace.json.gz`, dir), gzipSync(`${JSON.stringify(result.trace)}\n`));
    cases.push({
      label: result.label,
      profile: result.profile,
      provenance: result.provenance,
      ambientCounts: ambientCounts(result.provenance),
      engineEvaluation: result.evaluation,
      intentEvaluation: intent,
      deterministic: result.deterministic,
      authoredEventOrderPreserved: result.authoredEventOrderPreserved,
      authoredNeverFiredPreserved: result.authoredNeverFiredPreserved,
      ambientCollisions: result.ambientCollisions,
      accepted: result.accepted && intent.verdict === 'accept',
      failures: [...result.failures, ...(intent.verdict === 'accept' ? [] : [`intent rubric verdict: ${intent.verdict}`])],
      trace: compact(result.trace),
    });
  }
  const baselineIntent = evaluateIntentRubric(robustness.baselineTrace, rubric);
  const report = {
    version: 1,
    scenario: item.directory,
    baseline: {
      engineEvaluation: robustness.baselineEvaluation,
      trace: compact(robustness.baselineTrace),
      intentEvaluation: baselineIntent,
    },
    accepted: cases.every((entry) => entry.accepted),
    cases,
  };
  await writeFile(new URL('ambient-matrix.json', dir), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${item.directory}: ${report.accepted ? 'accepted' : 'rejected'}`);
  if (!report.accepted || baselineIntent.verdict !== 'accept') {
    console.log(JSON.stringify(report, null, 2));
  }
}

async function main(): Promise<void> {
  const selected = process.argv[2];
  for (const item of CAMPAIGN) {
    if (!selected || item.directory.includes(selected)) await run(item);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
