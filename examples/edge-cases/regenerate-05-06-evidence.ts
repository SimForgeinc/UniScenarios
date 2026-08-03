import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  contentHash,
  normalizeSimScenarioInput,
  parseSimScenarioInput,
  runSimulation,
  traceDigest,
  type SimScenarioInput,
  type SimTrace,
} from '@uniscenarios/sim-engine';

import { loadMap } from '../../packages/cli/src/maps.js';
import { metricsSummary } from '../../packages/cli/src/commands/simulate.js';

interface CampaignCase { readonly directory: string; readonly stableId: string; readonly matcherIndexDigest: string }
interface InstanceEnvelope {
  readonly kind: 'scenario-instance';
  readonly version: 1;
  readonly manifest: Record<string, unknown>;
  readonly input: SimScenarioInput;
}

const ROOT = new URL('./', import.meta.url);
const CASES: readonly CampaignCase[] = [
  {
    directory: '05-ambulance-gridlocked-intersection',
    stableId: 'edge-05-ambulance-gridlock-v1',
    matcherIndexDigest: '33eb942298b3492266d0582782f020ef121cc1d8da08bcb3080c9b71ea01f95e',
  },
  {
    directory: '06-dark-signal-conflicting-human-control',
    stableId: 'edge-06-dark-signal-human-control-v1',
    matcherIndexDigest: '33eb942298b3492266d0582782f020ef121cc1d8da08bcb3080c9b71ea01f95e',
  },
];

function eventCounts(trace: SimTrace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of trace.events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
}

function compactEvidence(trace: SimTrace): Record<string, unknown> {
  const events = trace.events
    .filter((event) => event.kind === 'trigger_fired' || event.kind === 'state_set')
    .map((event) => ({
      t: event.t,
      kind: event.kind,
      actorId: 'actorId' in event ? event.actorId : null,
      interactionId: 'interactionId' in event ? event.interactionId : null,
      key: 'key' in event ? event.key : null,
      value: 'value' in event ? event.value : null,
    }));
  const finalIndex = trace.ticks.t.length - 1;
  const final = Object.entries(trace.ticks.actors).map(([id, track]) => ({
    id,
    x: track.x[finalIndex],
    z: -track.y[finalIndex],
    speedMps: track.speedMps[finalIndex],
  }));
  const speedExtremaKph = Object.fromEntries(Object.entries(trace.ticks.actors).map(([id, track]) => [id, {
    min: Math.min(...track.speedMps) * 3.6,
    max: Math.max(...track.speedMps) * 3.6,
  }]));
  return { events, final, speedExtremaKph };
}

async function main(): Promise<void> {
for (const item of CASES) {
  const directory = new URL(`./${item.directory}/`, ROOT);
  const instanceUrl = new URL('instance.baseline.json', directory);
  const parsed = JSON.parse(await readFile(instanceUrl, 'utf8')) as SimScenarioInput | InstanceEnvelope;
  const rawInput = 'kind' in parsed && parsed.kind === 'scenario-instance' ? parsed.input : parsed;
  const input = normalizeSimScenarioInput(parseSimScenarioInput(rawInput));
  const bundle = await loadMap(input.mapId);
  const inputHash = contentHash(input);
  const simulation = runSimulation(input, { graph: bundle.graph, guards: 'collect' });
  const trace = simulation.trace;
  const envelope: InstanceEnvelope = {
    kind: 'scenario-instance',
    version: 1,
    manifest: {
      instanceId: `${item.stableId}:verified-baseline`,
      inputHash,
      replayKey: {
        mapId: input.mapId,
        matcherIndexDigest: item.matcherIndexDigest,
        engineGraphDigest: trace.header.engineGraphDigest,
      },
      actors: input.actors.map((actor) => ({ id: actor.id })),
    },
    input,
  };
  const tracePath = path.resolve(new URL('trace.baseline.json.gz', directory).pathname);
  await writeFile(instanceUrl, `${JSON.stringify(envelope, null, 2)}\n`);
  await writeFile(new URL('trace.baseline.json.gz', directory), gzipSync(`${JSON.stringify(trace)}\n`));
  await writeFile(new URL('result.baseline.json', directory), `${JSON.stringify({
    file: path.resolve(instanceUrl.pathname),
    mapId: input.mapId,
    header: trace.header,
    traceDigest: traceDigest(trace),
    metrics: metricsSummary(trace),
    events: eventCounts(trace),
    issues: simulation.issues,
    arrival: simulation.arrival,
    trace: tracePath,
  }, null, 2)}\n`);
  await writeFile(new URL('evidence.baseline.json', directory), `${JSON.stringify(compactEvidence(trace), null, 2)}\n`);
  console.log(`${item.directory}: ${inputHash} ${traceDigest(trace)}`);
}
}

void main();
