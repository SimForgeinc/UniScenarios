import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { exportOpenScenarioXml13Esmini } from '../../cli/src/index.js';
import { buildLaneGraph, parseSimScenarioInput, runSimulation, type TopologyIndex } from '../../sim-engine/src/index.js';
import { compareNormalizedTraces, normalizeCanonicalTrace, normalizeExternalTrace } from '../../trace-comparator/src/index.js';
import { parseEsminiCsv } from '../src/esmini-csv.js';
import { createVerifiedMacOsLocalExecutor } from '../src/runner.js';

const binaryArg = process.argv[2];
const sourceXodrArg = process.argv[3];
if (!binaryArg || !sourceXodrArg) throw new Error('Usage: tsx run-pinned-trajectory-smoke.ts /path/to/esmini /path/to/straight_500m.xodr');
const binary = path.resolve(binaryArg);
const sourceXodr = path.resolve(sourceXodrArg);

// Hash verification is a mandatory precondition even though this compact smoke
// invokes the process directly to retain its exact stdout/stderr and CSV path.
await createVerifiedMacOsLocalExecutor(binary);
const root = await mkdtemp(path.join(os.tmpdir(), 'uniscenarios-real-esmini-'));
const xodr = path.join(root, 'straight_500m.xodr');
await writeFile(xodr, await readFile(sourceXodr));

const graph = buildLaneGraph({
  schemaVersion: 1, mapName: 'straight-500m', source: { xodrSha256: 'pinned-esmini-fixture' },
  lanes: {}, gates: [], junctions: {},
} satisfies TopologyIndex);
const input = parseSimScenarioInput({
  mapId: 'straight-500m', clipSeconds: 20, warmupSeconds: 0, dt: 0.02,
  physics: { mode: 'kinematic-v1' }, metricSubject: 'ego',
  actors: [{
    id: 'ego', kind: 'vehicle', dims: { l: 4.5, w: 1.8, h: 1.5 },
    initial: { pose: { x: 10, z: 0, headingRad: 0 }, speedMps: 5 },
    behavior: { route: { kind: 'polyline', points: [{ x: 10, z: 0 }, { x: 210, z: 0 }] } },
  }],
  props: [], interactions: [], occlusionPairs: [], signalPrograms: [],
});
const canonical = runSimulation(input, { graph }).trace;
const exported = exportOpenScenarioXml13Esmini(input, {
  graph, executionMode: 'trajectory-replay', esminiMode: 'deterministic-trajectory',
  roadFile: 'straight_500m.xodr', headerDate: '1970-01-01T00:00:00.000Z',
});
const scenario = path.join(root, 'scenario.xosc');
const csv = path.join(root, 'replay.csv');
const log = path.join(root, 'esmini.log');
await writeFile(scenario, exported.content, 'utf8');

const args = ['--osc', scenario, '--headless', '--fixed_timestep', '0.02', '--traj_filter', '0', '--collision', '--csv_logger', csv, '--logfile_path', log];
const execution = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(binary, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});
if (execution.code !== 0) throw new Error(`esmini exited ${execution.code}: ${execution.stderr || execution.stdout}`);

const externalRaw = parseEsminiCsv(await readFile(csv, 'utf8'), {
  durationS: 20, expectedVersion: '3.6.0', entityIdMap: { actor_ego: 'ego' },
});
const canonicalNormalized = normalizeCanonicalTrace(canonical);
const externalNormalized = normalizeExternalTrace(externalRaw, canonical.header.actorIds);
const comparison = compareNormalizedTraces(canonicalNormalized, externalNormalized.trace, externalNormalized.mapping, {
  profile: 'strict-trajectory-v1',
});
const report = {
  schema: 'uniscenarios.real-esmini-smoke/v1',
  runner: externalRaw.simulator,
  runnerBinaryVerified: true,
  sourceRevision: '131a5651737fd1e8bd5d800d8e77e89bb3178a1e',
  externalExitCode: execution.code,
  externalCompleted: externalRaw.completed,
  outputDirectory: root,
  comparison: {
    verdict: comparison.verdict,
    actorCount: comparison.actorMetrics.length,
    positionRmseM: comparison.globalMetrics.xyM.rmse,
    positionP95M: comparison.globalMetrics.xyM.p95,
    positionMaxM: comparison.globalMetrics.xyM.max,
    headingP95Deg: comparison.globalMetrics.headingRad.p95 * 180 / Math.PI,
    speedP95Mps: comparison.globalMetrics.speedMps.p95,
    presenceAgreement: comparison.globalMetrics.presenceAgreement,
    collisionEdges: comparison.collisionComparison.length,
    signalEdges: comparison.signalComparison.length,
    findings: comparison.findings,
  },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (comparison.verdict !== 'pass') process.exitCode = 1;
