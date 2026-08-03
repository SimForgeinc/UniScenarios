import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AuditAssetError,
  auditGatePassed,
  auditXml14Instance,
  loadProductionAuditMap,
  summarizeAuditResults,
} from '../tools/xml14-suite-audit.js';

const temporary: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function assetRoot(stale = false): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xml14-audit-assets-'));
  temporary.push(root);
  const mapRoot = path.join(root, 'fixture-map');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(mapRoot);
  const xodr = Buffer.from('<OpenDRIVE/>');
  const digest = createHash('sha256').update(xodr).digest('hex');
  await writeFile(path.join(mapRoot, 'map.xodr'), xodr);
  await writeFile(path.join(mapRoot, 'topology-index.json.gz'), gzipSync(Buffer.from(JSON.stringify({
    schemaVersion: 1,
    mapName: 'fixture-map',
    source: { xodrSha256: stale ? 'stale' : digest },
    lanes: {}, gates: [], junctions: {},
  }))));
  return root;
}

async function instanceFile(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xml14-audit-instance-'));
  temporary.push(root);
  const file = path.join(root, 'scenario.instance.json');
  await writeFile(file, JSON.stringify({
    kind: 'scenario-instance', version: 1,
    manifest: { instanceId: 'fixture#0', replayKey: { mapId: 'fixture-map', engineGraphDigest: 'fixture-digest' } },
    input: {
      schemaVersion: 1, mapId: 'fixture-map', clipSeconds: 20, warmupSeconds: 0,
      physics: { mode: 'kinematic-v1' },
      actors: [{
        id: 'ego', kind: 'vehicle', dims: { l: 4.5, w: 1.8, h: 1.5 },
        initial: { pose: { x: 0, z: 0, headingRad: 0 }, speedMps: 0 },
        behavior: { route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 10, z: 0 }] } },
      }],
      props: [], interactions: [], occlusionPairs: [], signalPrograms: [],
    },
  }));
  return file;
}

describe('production OpenSCENARIO suite assets', () => {
  it('loads a digest-matched XODR/topology pair', async () => {
    const root = await assetRoot();
    const loaded = await loadProductionAuditMap('fixture-map', root);
    expect(loaded.graph.topologyDigest).toBe(loaded.xodrSha256);
    expect(loaded.graph.laneRsls()).toEqual([]);
  });

  it('rejects stale and missing production assets distinctly', async () => {
    await expect(loadProductionAuditMap('fixture-map', await assetRoot(true)))
      .rejects.toMatchObject({ name: 'AuditAssetError', code: 'asset-stale' });
    await expect(loadProductionAuditMap('missing-map', await assetRoot()))
      .rejects.toMatchObject({ name: 'AuditAssetError', code: 'asset-missing' });
  });

  it('reports asset-unavailable separately and blocks the hard gate', async () => {
    const result = await auditXml14Instance(await instanceFile(), '/unused/official.xsd', async () => {
      throw new AuditAssetError('asset-missing', 'production topology is unavailable');
    });
    expect(result).toMatchObject({ verdict: 'asset-blocked', assetCode: 'asset-missing' });
    const counts = summarizeAuditResults([
      { id: 'valid', verdict: 'xsd-validated' },
      { id: 'unsupported', verdict: 'unsupported-fail-closed' },
      result,
    ]);
    expect(counts).toEqual({ total: 3, xsdValidated: 1, unsupportedFailClosed: 1, assetBlocked: 1, unexpectedFailures: 0 });
    expect(auditGatePassed(counts)).toBe(false);
    expect(auditGatePassed({ ...counts, assetBlocked: 0, total: 2 })).toBe(true);
  });

  it('blocks an instance whose replay key does not match production topology', async () => {
    const production = await loadProductionAuditMap('fixture-map', await assetRoot());
    const result = await auditXml14Instance(await instanceFile(), '/unused/official.xsd', async () => production);
    expect(result).toMatchObject({
      id: 'fixture#0', mapId: 'fixture-map', verdict: 'asset-blocked', assetCode: 'instance-topology-stale',
    });
  });
});
