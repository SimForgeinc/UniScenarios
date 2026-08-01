import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CATALOG_SLOTS_PER_MAP,
  INCIDENT_DOMAINS,
  INCIDENT_TAXONOMY,
  createScenarioCatalog,
  validateScenarioCatalog,
  type ScenarioCatalogManifest,
} from '../catalog.js';
import { DEV_ASSETS, KNOWN_MAPS, REPO_ROOT } from '../maps.js';

let tmp: string;
let manifestFile: string;
let catalog: ScenarioCatalogManifest;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'uniscenarios-catalog-'));
  manifestFile = path.join(tmp, 'catalog.json');
  catalog = await createScenarioCatalog({ repoRoot: REPO_ROOT, devAssets: DEV_ASSETS });
  await writeFile(manifestFile, `${JSON.stringify(catalog, null, 2)}\n`);
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

function clone(): ScenarioCatalogManifest {
  return JSON.parse(JSON.stringify(catalog)) as ScenarioCatalogManifest;
}

function refreshSlotDigest(slot: Record<string, unknown>): void {
  // Deliberately not exposed by production code: mutation tests generally want
  // both the local design digest and catalog digest to fail.
  delete slot['designDigest'];
}

describe('UniScenarios authored scenario catalog', () => {
  it('authors exactly 100 distinct, deterministic, map-grounded designs per supported map', async () => {
    const again = await createScenarioCatalog({ repoRoot: REPO_ROOT, devAssets: DEV_ASSETS });
    expect(again).toEqual(catalog);
    expect(catalog.slots).toHaveLength(KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP);
    expect(new Set(catalog.slots.map((slot) => slot.identity)).size).toBe(catalog.slots.length);
    expect(new Set(catalog.slots.map((slot) => slot.seed)).size).toBe(catalog.slots.length);
    expect(new Set(catalog.slots.map((slot) => `${slot.mapId}\0${slot.scenario.incidentId}\0${slot.site.locationId}\0${slot.variant.id}`)).size).toBe(catalog.slots.length);

    for (const mapId of KNOWN_MAPS) {
      const slots = catalog.slots.filter((slot) => slot.mapId === mapId);
      expect(slots).toHaveLength(100);
      expect(slots.map((slot) => slot.ordinal)).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(new Set(slots.map((slot) => slot.scenario.incidentId)).size).toBeGreaterThanOrEqual(20);
      expect(new Set(slots.map((slot) => slot.scenario.domain)).size).toBeGreaterThanOrEqual(7);
      expect(slots.every((slot) => slot.status === 'authored')).toBe(true);
      expect(slots.every((slot) => slot.brief.eventSequence.length >= 3)).toBe(true);
      expect(slots.every((slot) => slot.acceptance.checks.length === 6)).toBe(true);
      expect(slots.every((slot) => slot.evidencePaths.video.startsWith(`evidence/${mapId}/`))).toBe(true);

      const locationBytes = await readFile(path.join(DEV_ASSETS, mapId, 'derived', 'locations.json.gz'));
      const source = JSON.parse(gunzipSync(locationBytes).toString('utf8')) as { locations: Array<{ id: string }> };
      const sourceIds = new Set(source.locations.map((location) => location.id));
      expect(slots.every((slot) => sourceIds.has(slot.site.locationId))).toBe(true);
    }

    expect(catalog.taxonomy.length).toBeGreaterThanOrEqual(30);
    expect(new Set(catalog.taxonomy.map((entry) => entry.domain))).toEqual(new Set(INCIDENT_DOMAINS));
    expect(catalog.progress).toEqual({
      target: 500,
      planned: 0,
      authored: 500,
      generated: 0,
      simulated: 0,
      rendered: 0,
      visuallyAccepted: 0,
      rejected: 0,
    });

    const report = validateScenarioCatalog(catalog, { manifestFile });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.maps).toEqual(Object.fromEntries(KNOWN_MAPS.map((mapId) => [mapId, 100])));
  }, 120_000);

  it('keeps matcher, engine, and location provenance as distinct digest domains', () => {
    for (const map of catalog.maps) {
      expect(map.matcherIndexDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(map.engineGraphDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(map.locationCatalogDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(new Set([map.matcherIndexDigest, map.engineGraphDigest, map.locationCatalogDigest]).size).toBe(3);
    }
    for (const slot of catalog.slots) {
      const map = catalog.maps.find((entry) => entry.mapId === slot.mapId)!;
      expect(slot.provenance.matcherIndexDigest).toBe(map.matcherIndexDigest);
      expect(slot.provenance.engineGraphDigest).toBe(map.engineGraphDigest);
      expect(slot.provenance.locationCatalogDigest).toBe(map.locationCatalogDigest);
    }
  });

  it('is a broad incident catalog rather than repeated parameter samples of five templates', () => {
    expect(INCIDENT_TAXONOMY.length).toBeGreaterThanOrEqual(30);
    const implemented = catalog.slots.filter((slot) => slot.implementation.state === 'template-backed');
    const authoredDesigns = catalog.slots.filter((slot) => slot.implementation.state === 'authored-design');
    expect(authoredDesigns.length).toBeGreaterThan(implemented.length);
    expect(new Set(catalog.slots.map((slot) => slot.scenario.incidentId)).size).toBeGreaterThanOrEqual(30);
    expect(catalog.researchSources.every((source) => source.url.startsWith('https://'))).toBe(true);
  });

  it('creates and verifies the 500-design manifest through the real CLI', async () => {
    const out = path.join(tmp, 'cli-catalog.json');
    const created = await execa('node', [
      path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'scen.js'),
      'catalog', 'create', '--out', out,
    ], { reject: false, timeout: 120_000 });
    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({
      totalSlots: 500,
      taxonomy: { incidentTypes: INCIDENT_TAXONOMY.length, domains: INCIDENT_DOMAINS.length },
      progress: { authored: 500, simulated: 0, visuallyAccepted: 0 },
      status: { authored: 500 },
    });

    const verified = await execa('node', [
      path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'scen.js'),
      'catalog', 'verify', out,
    ], { reject: false, timeout: 120_000 });
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      ok: true,
      slots: 500,
      statuses: { authored: 500 },
      progress: { authored: 500, rendered: 0, visuallyAccepted: 0 },
    });
  }, 180_000);

  it('rejects duplicate identities and duplicate authored designs', () => {
    const broken = clone() as unknown as { slots: Array<Record<string, unknown>> };
    broken.slots[1] = { ...broken.slots[0], ordinal: 1 };
    refreshSlotDigest(broken.slots[1]!);
    const report = validateScenarioCatalog(broken, { manifestFile });
    expect(report.ok).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('duplicate_identity');
    expect(report.issues.map((entry) => entry.code)).toContain('duplicate_design');
  });

  it('rejects a site whose type or affordances do not fit its incident', () => {
    const broken = clone() as unknown as { slots: Array<Record<string, unknown>> };
    const target = broken.slots.find((slot) => (slot['scenario'] as { incidentId: string }).incidentId === 'vru.multiple-threat-crosswalk')!;
    (target['site'] as Record<string, unknown>)['type'] = 'parking_space';
    (target['site'] as Record<string, unknown>)['affordances'] = [];
    refreshSlotDigest(target);
    const report = validateScenarioCatalog(broken, { manifestFile });
    expect(report.issues.map((entry) => entry.code)).toContain('invalid_site_binding');
  });

  it('rejects collapsed provenance domains', () => {
    const broken = clone() as unknown as {
      maps: Array<Record<string, unknown>>;
      slots: Array<Record<string, unknown>>;
    };
    broken.maps[0]!['engineGraphDigest'] = broken.maps[0]!['matcherIndexDigest'];
    const report = validateScenarioCatalog(broken, { manifestFile });
    expect(report.issues.some((entry) => entry.code === 'invalid_provenance' && entry.path.startsWith('maps('))).toBe(true);
  });

  it('rejects missing evidence as soon as status advances past authored', () => {
    const broken = clone() as unknown as { slots: Array<Record<string, unknown>> };
    broken.slots[0]!['status'] = 'simulated';
    refreshSlotDigest(broken.slots[0]!);
    const report = validateScenarioCatalog(broken, { manifestFile, evidenceExists: () => false });
    expect(report.ok).toBe(false);
    const missing = report.issues.filter((entry) => entry.code === 'missing_evidence');
    expect(missing.map((entry) => entry.path)).toEqual([
      'slots[0].evidencePaths.instance',
      'slots[0].evidencePaths.trace',
      'slots[0].evidencePaths.result',
    ]);
  });

  it('never accepts visual status without six passed gates and a reviewer', () => {
    const broken = clone() as unknown as { slots: Array<Record<string, unknown>> };
    broken.slots[0]!['status'] = 'visually-accepted';
    refreshSlotDigest(broken.slots[0]!);
    const report = validateScenarioCatalog(broken, {
      manifestFile,
      evidenceExists: () => true,
    });
    expect(report.issues.map((entry) => entry.code)).toContain('invalid_acceptance_manifest');
  });

  it('can enforce complete evidence bundles without claiming authored designs are accepted', () => {
    const report = validateScenarioCatalog(catalog, {
      manifestFile,
      requireEvidence: true,
      evidenceExists: (file) => file.endsWith('/instance.json'),
    });
    expect(report.ok).toBe(false);
    expect(report.evidenceChecked).toBe(true);
    expect(report.issues.some((entry) => entry.code === 'missing_evidence' && entry.path.endsWith('.video'))).toBe(true);
  });
});
