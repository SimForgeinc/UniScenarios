/**
 * `uniscenarios` end to end, through the real binary.
 *
 * These exist because the CLI's contract is not its TypeScript signatures — it
 * is *stdout is JSON, stderr is a structured error, and the exit code says
 * which kind of answer this is*. Only a subprocess can assert that.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa, type ExecaError } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEV_ASSETS, REPO_ROOT } from '../maps.js';
import { readTraceFile, writeTraceFile } from '../template-io.js';

const BIN = path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'uniscenarios.js');
const LTAP = path.join(REPO_ROOT, 'examples', 'ltap-opposing.template.json');
const MAP = 'yale-street';
const haveArtifacts =
  existsSync(path.join(DEV_ASSETS, MAP, 'derived', 'topology-derived.json.gz')) && existsSync(LTAP);

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function scen(...args: string[]): Promise<Run> {
  try {
    const r = await execa('node', [BIN, ...args], { reject: false, timeout: 180_000 });
    return { code: r.exitCode ?? 0, stdout: r.stdout, stderr: r.stderr };
  } catch (error) {
    const e = error as ExecaError;
    return { code: e.exitCode ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

function json<T = Record<string, unknown>>(run: Run): T {
  return JSON.parse(run.stdout) as T;
}

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'scen-smoke-'));
});
afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('uniscenarios — contract', () => {
  it('prints its command surface as JSON', async () => {
    const run = await scen();
    expect(run.code).toBe(0);
    const payload = json<{ bin: string; commands: Array<{ name: string }> }>(run);
    expect(payload.bin).toBe('uniscenarios');
    expect(payload.commands.map((c) => c.name)).toContain('sites match');
  });

  it('reports an unknown flag as a structured error on stderr, exit 1', async () => {
    const run = await scen('maps', 'list', '--limt', '3');
    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    const error = JSON.parse(run.stderr) as { code: string; path: string; detail: { known: string[] } };
    expect(error.code).toBe('unknown_flag');
    expect(error.path).toBe('--limt');
    expect(error.detail.known).toContain('pretty');
  });

  it('reports an unknown map with the closed vocabulary attached', async () => {
    const run = await scen('locations', 'find', '--map', 'not-a-map');
    expect(run.code).toBe(1);
    const error = JSON.parse(run.stderr) as { code: string; detail: { known: string[] } };
    expect(error.code).toBe('unknown_map');
    expect(error.detail.known).toContain(MAP);
  });

  it('lists the five maps and their artifacts', async () => {
    const run = await scen('maps', 'list');
    expect(run.code).toBe(0);
    const payload = json<{ maps: Array<{ mapId: string; artifacts: Record<string, boolean> }> }>(run);
    expect(payload.maps).toHaveLength(5);
    expect(payload.maps.map((m) => m.mapId)).toContain(MAP);
  });

  it('prints the published JSON Schema paths', async () => {
    const run = await scen('schemas');
    expect(run.code).toBe(0);
    const payload = json<{ schemas: Array<{ name: string; exists: boolean }> }>(run);
    expect(payload.schemas.map((s) => s.name).sort()).toEqual(['anchor', 'interactions', 'template']);
    expect(payload.schemas.every((s) => s.exists)).toBe(true);
  });

  it('exits 2 with structured issues on a malformed template', async () => {
    const run = await scen('template', 'validate', path.join(REPO_ROOT, 'package.json'));
    expect(run.code).toBe(2);
    const payload = json<{ ok: boolean; issues: Array<{ code: string }> }>(run);
    expect(payload.ok).toBe(false);
    expect(payload.issues.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!haveArtifacts)('uniscenarios — the pipeline', () => {
  it('validates the worked example clean', async () => {
    const run = await scen('template', 'validate', LTAP);
    expect(run.code).toBe(0);
    const payload = json<{ ok: boolean; counts: { error: number } }>(run);
    expect(payload.ok).toBe(true);
    expect(payload.counts.error).toBe(0);
  });

  it('answers a structured location query with handles and road anchors', async () => {
    const run = await scen(
      'locations',
      'find',
      '--map',
      MAP,
      '--type',
      'junction_movement',
      '--facts',
      'turn_relation=Left',
      '--limit',
      '5',
    );
    expect(run.code).toBe(0);
    const payload = json<{ results: Array<{ handle: string; roadAnchor: { rsl: string } | null; matchedReasons: string[] }> }>(run);
    expect(payload.results.length).toBeGreaterThan(0);
    for (const r of payload.results) {
      expect(r.handle).toMatch(/\//);
      expect(r.roadAnchor?.rsl).toBeTruthy();
      expect(r.matchedReasons.length).toBeGreaterThan(0);
    }
  });

  it('resolves free text to ranked handles', async () => {
    const run = await scen('locations', 'resolve', '--map', MAP, 'the intersection on el camino real');
    expect(run.code).toBe(0);
    const payload = json<{ results: Array<{ handle: string; score: number }> }>(run);
    expect(payload.results.length).toBeGreaterThan(0);
  });

  it('matches sites and then runs one all the way to a verdict', async () => {
    const match = await scen('sites', 'match', LTAP, '--map', MAP);
    expect(match.code).toBe(0);
    const sites = json<{ maps: Array<{ sites: Array<{ siteId: string; score: number }> }> }>(match)
      .maps[0]!.sites;
    expect(sites.length).toBeGreaterThan(0);

    const instanceFile = path.join(tmp, 'cell.instance.json');
    const traceFile = path.join(tmp, 'cell.trace.json.gz');

    const inst = await scen(
      'instantiate',
      LTAP,
      '--map',
      MAP,
      '--site',
      sites[0]!.siteId,
      '--draw',
      '0',
      '--out',
      instanceFile,
    );
    expect([0, 2]).toContain(inst.code);
    expect(existsSync(instanceFile)).toBe(true);
    const instance = json<{ manifest: { replayKey: { siteId: string }; arrival: unknown[] } }>(inst);
    expect(instance.manifest.replayKey.siteId).toBe(sites[0]!.siteId);
    expect(instance.manifest.arrival.length).toBe(1);

    const sim = await scen('simulate', instanceFile, '--trace', traceFile);
    expect([0, 2]).toContain(sim.code);
    expect(existsSync(traceFile)).toBe(true);
    const simulated = json<{ metrics: { minTTC: { value: number } | null }; traceDigest: string }>(sim);
    expect(simulated.metrics.minTTC).not.toBeNull();
    expect(simulated.traceDigest).toMatch(/^[0-9a-f]{64}$/);

    const evaluated = await scen('evaluate', traceFile);
    expect([0, 2]).toContain(evaluated.code);
    const verdict = json<{ verdict: string; band: string }>(evaluated);
    expect(['accept', 'reject']).toContain(verdict.verdict);
    expect(verdict.band).toBeTruthy();
  });

  it('verifies instance/trace evidence hashes and actor ids, and fails stale/tampered pairs', async () => {
    const match = await scen('sites', 'match', LTAP, '--map', MAP);
    expect(match.code).toBe(0);
    const siteId = json<{ maps: Array<{ sites: Array<{ siteId: string }> }> }>(match).maps[0]!.sites[0]!.siteId;
    const instanceFile = path.join(tmp, 'evidence.instance.json');
    const traceFile = path.join(tmp, 'evidence.trace.json.gz');

    const inst = await scen('instantiate', LTAP, '--map', MAP, '--site', siteId, '--draw', '0', '--out', instanceFile);
    expect([0, 2]).toContain(inst.code);
    const sim = await scen('simulate', instanceFile, '--trace', traceFile);
    expect([0, 2]).toContain(sim.code);

    const ok = await scen('evidence', 'verify', instanceFile, traceFile);
    expect(ok.code).toBe(0);
    const okPayload = json<{ ok: boolean; actorCount: number; issues: Array<{ code: string }> }>(ok);
    expect(okPayload.ok).toBe(true);
    expect(okPayload.actorCount).toBeGreaterThan(0);
    expect(okPayload.issues).toEqual([]);

    const tamperedInstanceFile = path.join(tmp, 'evidence-tampered.instance.json');
    const tampered = JSON.parse(await readFile(instanceFile, 'utf8'));
    tampered.input.actors[0].initial.speedMps += 0.5;
    await writeFile(tamperedInstanceFile, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    const tamperedRun = await scen('evidence', 'verify', tamperedInstanceFile, traceFile);
    expect(tamperedRun.code).toBe(2);
    expect(json<{ issues: Array<{ code: string }> }>(tamperedRun).issues.map((i) => i.code)).toContain('instance_input_hash_mismatch');

    const trace = await readTraceFile(traceFile);
    const badHashTrace = path.join(tmp, 'evidence-bad-hash.trace.json.gz');
    await writeTraceFile(badHashTrace, { ...trace, header: { ...trace.header, inputHash: '0'.repeat(64) } });
    const badHash = await scen('evidence', 'verify', instanceFile, badHashTrace);
    expect(badHash.code).toBe(2);
    expect(json<{ issues: Array<{ code: string }> }>(badHash).issues.map((i) => i.code)).toContain('trace_input_hash_mismatch');

    const missingActorTrace = path.join(tmp, 'evidence-missing-actor.trace.json.gz');
    await writeTraceFile(missingActorTrace, {
      ...trace,
      header: { ...trace.header, actorIds: trace.header.actorIds.slice(0, -1) },
    });
    const missingActor = await scen('evidence', 'verify', instanceFile, missingActorTrace);
    expect(missingActor.code).toBe(2);
    expect(json<{ issues: Array<{ code: string }> }>(missingActor).issues.map((i) => i.code)).toContain('trace_actor_ids_mismatch');

    const extraActorTrace = path.join(tmp, 'evidence-extra-actor.trace.json.gz');
    await writeTraceFile(extraActorTrace, {
      ...trace,
      header: { ...trace.header, actorIds: [...trace.header.actorIds, '__ghost'].sort() },
    });
    const extraActor = await scen('evidence', 'verify', instanceFile, extraActorTrace);
    expect(extraActor.code).toBe(2);
    expect(json<{ issues: Array<{ code: string }> }>(extraActor).issues.map((i) => i.code)).toContain('trace_actor_ids_mismatch');
  }, 240_000);

  it('runs tier-2 validation with invariant residuals', async () => {
    const run = await scen('validate', LTAP, '--tier', '2', '--map', MAP, '--draw', '0');
    expect([0, 2]).toContain(run.code);
    const payload = json<{ invariants: Array<{ id: string; status: string }> }>(run);
    expect(payload.invariants.map((i) => i.id)).toContain('criticality');
    expect(payload.invariants.map((i) => i.id)).toContain('arrival-band');
  });

  it('runs a resumable batch and reproduces every cell on the second pass', async () => {
    const out = path.join(tmp, 'batch');
    const first = await scen('batch', LTAP, '--map', MAP, '--draws', '2', '--out', out, '--concurrency', '2');
    expect(first.code).toBe(0);
    const a = json<{ cells: number; resumed: number; results: Array<{ traceDigest: string; instanceId: string }> }>(first);
    expect(a.cells).toBeGreaterThan(0);
    expect(a.resumed).toBe(0);

    const second = await scen('batch', LTAP, '--map', MAP, '--draws', '2', '--out', out, '--concurrency', '2');
    expect(second.code).toBe(0);
    const b = json<{ cells: number; resumed: number; results: Array<{ traceDigest: string; instanceId: string }> }>(second);
    expect(b.resumed).toBe(b.cells);
    expect(b.results.map((r) => r.traceDigest)).toEqual(a.results.map((r) => r.traceDigest));

    const forced = await scen('batch', LTAP, '--map', MAP, '--draws', '2', '--out', out, '--force', '--concurrency', '2');
    expect(forced.code).toBe(0);
    const c = json<{ resumed: number; results: Array<{ traceDigest: string }> }>(forced);
    expect(c.resumed).toBe(0);
    // Recomputed from scratch, in a different worker, and byte-identical.
    expect(c.results.map((r) => r.traceDigest)).toEqual(a.results.map((r) => r.traceDigest));
  }, 240_000);
});
