import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CATALOG_SLOTS_PER_MAP,
  createScenarioCatalog,
  validateScenarioCatalog,
  type ScenarioCatalogManifest,
} from '../catalog.js';
import { KNOWN_MAPS, REPO_ROOT } from '../maps.js';

let tmp: string;
let devAssets: string;
let manifestFile: string;
let catalog: ScenarioCatalogManifest;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'uniscenarios-catalog-'));
  devAssets = path.join(tmp, 'dev-assets');
  manifestFile = path.join(tmp, 'catalog.json');
  await Promise.all(KNOWN_MAPS.map(async (mapId, index) => {
    const derived = path.join(devAssets, mapId, 'derived');
    await mkdir(derived, { recursive: true });
    await writeFile(path.join(derived, 'topology-derived.json.gz'), gzipSync(JSON.stringify({
      mapId,
      mapAssetId: `${mapId}-fixture`,
      catalogRevision: String(index + 1).repeat(32),
      topologyDigest: String(index + 1).repeat(64),
    })));
  }));
  catalog = await createScenarioCatalog({ repoRoot: REPO_ROOT, devAssets });
  await writeFile(manifestFile, `${JSON.stringify(catalog, null, 2)}\n`);
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

function clone(): ScenarioCatalogManifest {
  return JSON.parse(JSON.stringify(catalog)) as ScenarioCatalogManifest;
}

describe('UniScenarios deterministic scenario catalog', () => {
  it('enumerates exactly 100 unique deterministic slots on every supported map', async () => {
    const again = await createScenarioCatalog({ repoRoot: REPO_ROOT, devAssets });
    expect(again).toEqual(catalog);
    expect(catalog.slots).toHaveLength(KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP);
    expect(new Set(catalog.slots.map((slot) => slot.identity)).size).toBe(catalog.slots.length);
    expect(new Set(catalog.slots.map((slot) => slot.seed)).size).toBe(catalog.slots.length);

    for (const mapId of KNOWN_MAPS) {
      const slots = catalog.slots.filter((slot) => slot.mapId === mapId);
      expect(slots).toHaveLength(100);
      expect(slots.map((slot) => slot.ordinal)).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(new Set(slots.map((slot) => slot.template.id)).size).toBe(5);
      expect(slots.every((slot) => slot.status === 'reserved')).toBe(true);
      expect(slots.every((slot) => slot.evidencePaths.video.startsWith(`evidence/${mapId}/`))).toBe(true);
    }

    const report = validateScenarioCatalog(catalog, { manifestFile });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.maps).toEqual(Object.fromEntries(KNOWN_MAPS.map((mapId) => [mapId, 100])));
  });

  it('creates and verifies the 500-slot manifest through the real CLI', async () => {
    const out = path.join(tmp, 'cli', 'catalog.json');
    const created = await execa('node', [
      path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'scen.js'),
      'catalog',
      'create',
      '--out',
      out,
    ], { env: { SCEN_DEV_ASSETS: devAssets }, reject: false, timeout: 60_000 });
    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({ totalSlots: 500, status: { reserved: 500 } });

    const verified = await execa('node', [
      path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'scen.js'),
      'catalog',
      'verify',
      out,
    ], { reject: false, timeout: 60_000 });
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ ok: true, slots: 500, statuses: { reserved: 500 } });
  }, 120_000);

  it('rejects duplicate identities instead of silently overwriting a slot', () => {
    const broken = clone() as unknown as { slots: Array<{ identity: string }> };
    broken.slots[1]!.identity = broken.slots[0]!.identity;
    const report = validateScenarioCatalog(broken, { manifestFile });
    expect(report.ok).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('duplicate_identity');
  });

  it('rejects missing evidence as soon as status advances past reserved', () => {
    const broken = clone() as unknown as {
      slots: Array<{ status: string; evidencePaths: { instance: string; trace: string; result: string } }>;
    };
    broken.slots[0]!.status = 'simulated';
    const report = validateScenarioCatalog(broken, {
      manifestFile,
      evidenceExists: () => false,
    });
    expect(report.ok).toBe(false);
    const missing = report.issues.filter((entry) => entry.code === 'missing_evidence');
    expect(missing.map((entry) => entry.path)).toEqual([
      'slots[0].evidencePaths.instance',
      'slots[0].evidencePaths.trace',
      'slots[0].evidencePaths.result',
    ]);
  });

  it('can enforce a complete evidence bundle even for reserved slots', () => {
    const report = validateScenarioCatalog(catalog, {
      manifestFile,
      requireEvidence: true,
      evidenceExists: (file) => file.endsWith('/instance.json'),
    });
    expect(report.ok).toBe(false);
    expect(report.evidenceChecked).toBe(true);
    expect(report.issues.some((entry) => entry.code === 'missing_evidence' && entry.path.endsWith('.video'))).toBe(true);
  });

  it('rejects an identity whose seed or map provenance was edited', () => {
    const broken = clone() as unknown as {
      slots: Array<{ seed: string; provenance: { topologyDigest: string } }>;
    };
    broken.slots[0]!.seed = '0'.repeat(64);
    broken.slots[1]!.provenance.topologyDigest = 'f'.repeat(64);
    const report = validateScenarioCatalog(broken, { manifestFile });
    expect(report.issues.map((entry) => entry.code)).toContain('invalid_seed');
    expect(report.issues.map((entry) => entry.code)).toContain('invalid_provenance');
  });
});
