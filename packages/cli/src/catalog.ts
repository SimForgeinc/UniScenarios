/**
 * Deterministic reservation catalog for mass scenario generation.
 *
 * A catalog is deliberately cheaper than generation: it fixes 100 identities
 * per supported map before workers begin, so retries and parallel scheduling
 * cannot create, omit, or silently rename incidents. Evidence paths are also
 * reserved up front. A slot may remain `reserved`; once its status advances,
 * the verifier requires the evidence appropriate to that status to exist.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { CliError, EXIT } from './errors.js';
import { DEV_ASSETS, KNOWN_MAPS, REPO_ROOT } from './maps.js';

export const CATALOG_KIND = 'uniscenarios-scenario-catalog' as const;
export const CATALOG_VERSION = 1 as const;
export const CATALOG_GENERATOR_VERSION = '1.0.0' as const;
export const CATALOG_SLOTS_PER_MAP = 100 as const;
export const DEFAULT_CATALOG_NAMESPACE = 'uniscenarios-five-map-v1' as const;

export const CATALOG_TEMPLATE_SOURCES = [
  { id: 'ltap-opposing', source: 'examples/ltap-opposing.template.json' },
  { id: 'cpnco-parked-row', source: 'examples/cpnco-parked-row.template.json' },
  { id: 'multiple-threat', source: 'examples/multiple-threat.template.json' },
  { id: 'bus-stop-emergence', source: 'examples/bus-stop-emergence.template.json' },
  { id: 'school-dartout', source: 'examples/school-dartout.template.json' },
] as const;

export type CatalogSlotStatus =
  | 'reserved'
  | 'generated'
  | 'simulated'
  | 'rendered'
  | 'visually-proven'
  | 'rejected';

export interface CatalogEvidencePaths {
  readonly instance: string;
  readonly trace: string;
  readonly result: string;
  readonly renderManifest: string;
  readonly frame: string;
  readonly video: string;
  readonly visualInspection: string;
}

export interface CatalogTemplateProvenance {
  readonly id: string;
  readonly source: string;
  readonly digest: string;
  readonly category: string;
}

export interface CatalogMapProvenance {
  readonly mapId: string;
  readonly mapAssetId: string;
  readonly catalogRevision: string;
  readonly topologyDigest: string;
  readonly slots: number;
}

export interface ScenarioCatalogSlot {
  readonly identity: string;
  readonly ordinal: number;
  readonly provenance: {
    readonly namespace: string;
    readonly generatorVersion: string;
    readonly mapCatalogRevision: string;
    readonly topologyDigest: string;
    readonly templateDigest: string;
  };
  readonly seed: string;
  readonly mapId: string;
  readonly template: {
    readonly id: string;
    readonly source: string;
    readonly digest: string;
  };
  readonly category: string;
  readonly status: CatalogSlotStatus;
  readonly evidencePaths: CatalogEvidencePaths;
}

export interface ScenarioCatalogManifest {
  readonly kind: typeof CATALOG_KIND;
  readonly version: typeof CATALOG_VERSION;
  readonly contract: {
    readonly supportedMaps: readonly string[];
    readonly slotsPerMap: number;
    readonly totalSlots: number;
  };
  readonly provenance: {
    readonly generator: '@uniscenarios/cli catalog create';
    readonly generatorVersion: string;
    readonly namespace: string;
  };
  readonly evidenceRoot: string;
  readonly maps: readonly CatalogMapProvenance[];
  readonly templates: readonly CatalogTemplateProvenance[];
  readonly slots: readonly ScenarioCatalogSlot[];
  readonly catalogDigest: string;
}

export interface CatalogIssue {
  readonly code:
    | 'invalid_catalog'
    | 'wrong_map_inventory'
    | 'wrong_slot_count'
    | 'duplicate_identity'
    | 'duplicate_seed'
    | 'invalid_identity'
    | 'invalid_seed'
    | 'invalid_provenance'
    | 'invalid_evidence_path'
    | 'missing_evidence'
    | 'catalog_digest_mismatch';
  readonly path: string;
  readonly reason: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export interface CatalogValidationReport {
  readonly ok: boolean;
  readonly kind: 'uniscenarios-catalog-validation';
  readonly version: 1;
  readonly catalogDigest: string | null;
  readonly slots: number;
  readonly maps: Record<string, number>;
  readonly statuses: Record<string, number>;
  readonly evidenceChecked: boolean;
  readonly issues: readonly CatalogIssue[];
}

export interface CreateCatalogOptions {
  readonly repoRoot?: string;
  readonly devAssets?: string;
  readonly namespace?: string;
  /** Relative to the catalog file unless verification supplies an override. */
  readonly evidenceRoot?: string;
}

interface DerivedProvenance {
  readonly mapId?: unknown;
  readonly mapAssetId?: unknown;
  readonly catalogRevision?: unknown;
  readonly topologyDigest?: unknown;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function catalogSeed(
  namespace: string,
  map: CatalogMapProvenance,
  ordinal: number,
  template: CatalogTemplateProvenance,
): string {
  return sha256([
    CATALOG_GENERATOR_VERSION,
    namespace,
    map.mapId,
    map.catalogRevision,
    map.topologyDigest,
    String(ordinal),
    template.id,
    template.digest,
  ].join('\0'));
}

function catalogIdentity(mapId: string, ordinal: number, seed: string): string {
  return `${mapId}-${String(ordinal + 1).padStart(3, '0')}-${seed.slice(0, 16)}`;
}

function evidencePaths(evidenceRoot: string, mapId: string, identity: string): CatalogEvidencePaths {
  const base = path.posix.join(evidenceRoot, mapId, identity);
  return {
    instance: `${base}/instance.json`,
    trace: `${base}/trace.json.gz`,
    result: `${base}/result.json`,
    renderManifest: `${base}/render/manifest.json`,
    frame: `${base}/render/frame.png`,
    video: `${base}/render/video.mp4`,
    visualInspection: `${base}/render/visual-inspection.json`,
  };
}

function assertRelativeRoot(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '');
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new CliError('bad_value', '--evidence-root must be a non-empty relative path without ..', {
      path: '--evidence-root',
    });
  }
  return normalized;
}

async function readTemplateProvenance(repoRoot: string): Promise<CatalogTemplateProvenance[]> {
  return Promise.all(CATALOG_TEMPLATE_SOURCES.map(async (entry) => {
    const file = path.join(repoRoot, entry.source);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch {
      throw new CliError('file_not_found', `cannot read catalog template ${entry.source}`, { path: file });
    }
    let value: { meta?: { archetype?: unknown } };
    try {
      value = JSON.parse(bytes.toString('utf8')) as { meta?: { archetype?: unknown } };
    } catch (error) {
      throw new CliError('invalid_json', error instanceof Error ? error.message : String(error), {
        path: file,
      });
    }
    const category = value.meta?.archetype;
    if (typeof category !== 'string' || category.length === 0) {
      throw new CliError('template_invalid', `${entry.source} has no meta.archetype`, {
        path: `${file}#meta.archetype`,
        exitCode: EXIT.validationFindings,
      });
    }
    return { id: entry.id, source: entry.source, digest: sha256(bytes), category };
  }));
}

async function readMapProvenance(devAssets: string, mapId: string): Promise<CatalogMapProvenance> {
  const file = path.join(devAssets, mapId, 'derived', 'topology-derived.json.gz');
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    throw new CliError('missing_map_provenance', `cannot read ${file}`, {
      path: file,
      detail: { hint: 'run `pnpm --filter @uniscenarios/map-intel build:map -- --all`' },
    });
  }
  let value: DerivedProvenance;
  try {
    const plain = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    value = JSON.parse(plain.toString('utf8')) as DerivedProvenance;
  } catch (error) {
    throw new CliError('invalid_map_provenance', error instanceof Error ? error.message : String(error), {
      path: file,
    });
  }
  if (
    value.mapId !== mapId ||
    typeof value.mapAssetId !== 'string' ||
    typeof value.catalogRevision !== 'string' ||
    typeof value.topologyDigest !== 'string'
  ) {
    throw new CliError('invalid_map_provenance', `${file} is missing stable map provenance`, {
      path: file,
      detail: { expectedMapId: mapId },
    });
  }
  return {
    mapId,
    mapAssetId: value.mapAssetId,
    catalogRevision: value.catalogRevision,
    topologyDigest: value.topologyDigest,
    slots: CATALOG_SLOTS_PER_MAP,
  };
}

function digestPayload(manifest: Omit<ScenarioCatalogManifest, 'catalogDigest'>): string {
  return sha256(JSON.stringify(manifest));
}

/** Build exactly 100 deterministic reservations for each of the five maps. */
export async function createScenarioCatalog(
  options: CreateCatalogOptions = {},
): Promise<ScenarioCatalogManifest> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const devAssets = options.devAssets ?? (options.repoRoot ? path.join(repoRoot, 'dev-assets') : DEV_ASSETS);
  const namespace = options.namespace ?? DEFAULT_CATALOG_NAMESPACE;
  const root = assertRelativeRoot(options.evidenceRoot ?? 'evidence');
  if (namespace.trim().length === 0) {
    throw new CliError('bad_value', '--namespace must not be empty', { path: '--namespace' });
  }

  const [templates, maps] = await Promise.all([
    readTemplateProvenance(repoRoot),
    Promise.all(KNOWN_MAPS.map((mapId) => readMapProvenance(devAssets, mapId))),
  ]);
  const slots: ScenarioCatalogSlot[] = [];
  for (const map of maps) {
    for (let ordinal = 0; ordinal < CATALOG_SLOTS_PER_MAP; ordinal += 1) {
      const template = templates[ordinal % templates.length] as CatalogTemplateProvenance;
      const seed = catalogSeed(namespace, map, ordinal, template);
      const identity = catalogIdentity(map.mapId, ordinal, seed);
      slots.push({
        identity,
        ordinal,
        provenance: {
          namespace,
          generatorVersion: CATALOG_GENERATOR_VERSION,
          mapCatalogRevision: map.catalogRevision,
          topologyDigest: map.topologyDigest,
          templateDigest: template.digest,
        },
        seed,
        mapId: map.mapId,
        template: { id: template.id, source: template.source, digest: template.digest },
        category: template.category,
        status: 'reserved',
        evidencePaths: evidencePaths(root, map.mapId, identity),
      });
    }
  }

  const withoutDigest: Omit<ScenarioCatalogManifest, 'catalogDigest'> = {
    kind: CATALOG_KIND,
    version: CATALOG_VERSION,
    contract: {
      supportedMaps: [...KNOWN_MAPS],
      slotsPerMap: CATALOG_SLOTS_PER_MAP,
      totalSlots: KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP,
    },
    provenance: {
      generator: '@uniscenarios/cli catalog create',
      generatorVersion: CATALOG_GENERATOR_VERSION,
      namespace,
    },
    evidenceRoot: root,
    maps,
    templates,
    slots,
  };
  return { ...withoutDigest, catalogDigest: digestPayload(withoutDigest) };
}

const ALL_EVIDENCE = [
  'instance',
  'trace',
  'result',
  'renderManifest',
  'frame',
  'video',
  'visualInspection',
] as const satisfies readonly (keyof CatalogEvidencePaths)[];

const REQUIRED_EVIDENCE: Record<CatalogSlotStatus, readonly (keyof CatalogEvidencePaths)[]> = {
  reserved: [],
  generated: ['instance'],
  simulated: ['instance', 'trace', 'result'],
  rendered: ['instance', 'trace', 'result', 'renderManifest', 'frame', 'video'],
  'visually-proven': ALL_EVIDENCE,
  rejected: ['instance', 'result'],
};

function issue(
  issues: CatalogIssue[],
  code: CatalogIssue['code'],
  pathValue: string,
  reason: string,
  expected?: unknown,
  actual?: unknown,
): void {
  issues.push({ code, path: pathValue, reason, ...(expected === undefined ? {} : { expected }), ...(actual === undefined ? {} : { actual }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeEvidencePath(value: unknown, evidenceRoot: string): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || value.split('/').includes('..')) return false;
  return value === evidenceRoot || value.startsWith(`${evidenceRoot}/`);
}

export interface ValidateCatalogOptions {
  /** Path to the manifest; evidence paths are relative to its directory. */
  readonly manifestFile?: string;
  /** Physical evidence-root override, useful when artifacts are mounted elsewhere. */
  readonly evidenceRootOverride?: string;
  /** Require every reserved evidence path, not only paths implied by slot status. */
  readonly requireEvidence?: boolean;
  /** Injectable for focused tests. */
  readonly evidenceExists?: (file: string) => boolean;
}

/** Machine verification for cardinality, identity, provenance, and evidence. */
export function validateScenarioCatalog(
  value: unknown,
  options: ValidateCatalogOptions = {},
): CatalogValidationReport {
  const issues: CatalogIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, 'invalid_catalog', '$', 'catalog must be a JSON object');
    return reportFor(null, issues, false);
  }
  const manifest = value as unknown as ScenarioCatalogManifest;
  const slots = Array.isArray(value['slots']) ? value['slots'] : [];
  const evidenceRoot = typeof value['evidenceRoot'] === 'string' ? value['evidenceRoot'] : '';

  if (value['kind'] !== CATALOG_KIND || value['version'] !== CATALOG_VERSION) {
    issue(issues, 'invalid_catalog', '$', `kind/version must be ${CATALOG_KIND}@${CATALOG_VERSION}`);
  }
  const contract = isRecord(value['contract']) ? value['contract'] : {};
  const supported = Array.isArray(contract['supportedMaps']) ? contract['supportedMaps'] : [];
  if (JSON.stringify(supported) !== JSON.stringify([...KNOWN_MAPS])) {
    issue(issues, 'wrong_map_inventory', 'contract.supportedMaps', 'catalog must use the canonical five-map inventory', [...KNOWN_MAPS], supported);
  }
  if (contract['slotsPerMap'] !== CATALOG_SLOTS_PER_MAP || contract['totalSlots'] !== KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP) {
    issue(issues, 'wrong_slot_count', 'contract', 'contract must declare exactly 100 slots per map and 500 total');
  }
  if (typeof value['evidenceRoot'] !== 'string' || !isSafeEvidencePath(`${evidenceRoot}/probe`, evidenceRoot)) {
    issue(issues, 'invalid_evidence_path', 'evidenceRoot', 'evidenceRoot must be a safe relative path');
  }

  const mapRows = Array.isArray(value['maps']) ? value['maps'] : [];
  const mapById = new Map<string, CatalogMapProvenance>();
  for (const row of mapRows) {
    if (isRecord(row) && typeof row['mapId'] === 'string') mapById.set(row['mapId'], row as unknown as CatalogMapProvenance);
  }
  if (mapRows.length !== KNOWN_MAPS.length || KNOWN_MAPS.some((mapId) => !mapById.has(mapId))) {
    issue(issues, 'wrong_map_inventory', 'maps', 'maps[] must contain each supported map exactly once');
  }

  const identities = new Set<string>();
  const seeds = new Set<string>();
  const mapOrdinals = new Map<string, Set<number>>();
  const statusCounts: Record<string, number> = {};
  const mapCounts: Record<string, number> = {};
  const evidenceExists = options.evidenceExists ?? existsSync;
  const physicalRoot = options.evidenceRootOverride
    ? path.resolve(options.evidenceRootOverride)
    : path.dirname(path.resolve(options.manifestFile ?? 'catalog.json'));
  let evidenceChecked = false;

  slots.forEach((raw, index) => {
    const base = `slots[${index}]`;
    if (!isRecord(raw)) {
      issue(issues, 'invalid_catalog', base, 'slot must be an object');
      return;
    }
    const identity = raw['identity'];
    const seed = raw['seed'];
    const mapId = raw['mapId'];
    const ordinal = raw['ordinal'];
    const provenance = isRecord(raw['provenance']) ? raw['provenance'] : {};
    const template = isRecord(raw['template']) ? raw['template'] : {};
    const status = raw['status'];
    const paths = isRecord(raw['evidencePaths']) ? raw['evidencePaths'] : {};

    if (typeof identity !== 'string') {
      issue(issues, 'invalid_identity', `${base}.identity`, 'identity must be a string');
    } else if (identities.has(identity)) {
      issue(issues, 'duplicate_identity', `${base}.identity`, `duplicate identity ${identity}`);
    } else identities.add(identity);

    if (typeof seed !== 'string' || !/^[0-9a-f]{64}$/.test(seed)) {
      issue(issues, 'invalid_seed', `${base}.seed`, 'seed must be 64 lowercase hexadecimal characters');
    } else if (seeds.has(seed)) {
      issue(issues, 'duplicate_seed', `${base}.seed`, `duplicate seed ${seed}`);
    } else seeds.add(seed);

    if (typeof mapId === 'string') {
      mapCounts[mapId] = (mapCounts[mapId] ?? 0) + 1;
      if (typeof ordinal === 'number' && Number.isInteger(ordinal)) {
        const ordinals = mapOrdinals.get(mapId) ?? new Set<number>();
        ordinals.add(ordinal);
        mapOrdinals.set(mapId, ordinals);
      }
    }
    if (typeof status === 'string') statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    const map = typeof mapId === 'string' ? mapById.get(mapId) : undefined;
    if (
      !map ||
      typeof ordinal !== 'number' ||
      !Number.isInteger(ordinal) ||
      ordinal < 0 ||
      ordinal >= CATALOG_SLOTS_PER_MAP ||
      typeof template['id'] !== 'string' ||
      typeof template['digest'] !== 'string' ||
      typeof provenance['namespace'] !== 'string'
    ) {
      issue(issues, 'invalid_provenance', base, 'slot map/ordinal/template/provenance is incomplete');
    } else if (typeof seed === 'string' && typeof identity === 'string') {
      const templateRow: CatalogTemplateProvenance = {
        id: template['id'],
        source: String(template['source'] ?? ''),
        digest: template['digest'],
        category: String(raw['category'] ?? ''),
      };
      const expectedSeed = catalogSeed(provenance['namespace'], map, ordinal, templateRow);
      if (seed !== expectedSeed) issue(issues, 'invalid_seed', `${base}.seed`, 'seed does not match deterministic slot coordinates', expectedSeed, seed);
      const expectedIdentity = catalogIdentity(map.mapId, ordinal, expectedSeed);
      if (identity !== expectedIdentity) issue(issues, 'invalid_identity', `${base}.identity`, 'identity does not match deterministic slot coordinates', expectedIdentity, identity);
      if (
        provenance['generatorVersion'] !== CATALOG_GENERATOR_VERSION ||
        provenance['mapCatalogRevision'] !== map.catalogRevision ||
        provenance['topologyDigest'] !== map.topologyDigest ||
        provenance['templateDigest'] !== template['digest']
      ) {
        issue(issues, 'invalid_provenance', `${base}.provenance`, 'slot provenance does not match map/template inventory');
      }
    }

    for (const key of ALL_EVIDENCE) {
      if (!isSafeEvidencePath(paths[key], evidenceRoot)) {
        issue(issues, 'invalid_evidence_path', `${base}.evidencePaths.${key}`, 'evidence path must stay under evidenceRoot');
      }
    }

    const required = options.requireEvidence
      ? ALL_EVIDENCE
      : typeof status === 'string' && status in REQUIRED_EVIDENCE
        ? REQUIRED_EVIDENCE[status as CatalogSlotStatus]
        : [];
    if (typeof status !== 'string' || !(status in REQUIRED_EVIDENCE)) {
      issue(issues, 'invalid_catalog', `${base}.status`, 'unknown slot status');
    }
    for (const key of required) {
      const relative = paths[key];
      if (typeof relative !== 'string') continue;
      evidenceChecked = true;
      const physical = options.evidenceRootOverride
        ? path.join(physicalRoot, path.posix.relative(evidenceRoot, relative))
        : path.join(physicalRoot, relative);
      if (!evidenceExists(physical)) {
        issue(issues, 'missing_evidence', `${base}.evidencePaths.${key}`, `required evidence does not exist: ${physical}`);
      }
    }
  });

  if (slots.length !== KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP) {
    issue(issues, 'wrong_slot_count', 'slots', 'catalog must contain exactly 500 slots', 500, slots.length);
  }
  for (const mapId of KNOWN_MAPS) {
    const ordinals = mapOrdinals.get(mapId) ?? new Set<number>();
    if (mapCounts[mapId] !== CATALOG_SLOTS_PER_MAP || ordinals.size !== CATALOG_SLOTS_PER_MAP) {
      issue(issues, 'wrong_slot_count', `slots(map=${mapId})`, `map must contain each ordinal 0..99 exactly once`, CATALOG_SLOTS_PER_MAP, mapCounts[mapId] ?? 0);
    }
  }

  if (typeof value['catalogDigest'] === 'string') {
    const { catalogDigest: _ignored, ...withoutDigest } = manifest;
    const expected = digestPayload(withoutDigest);
    if (value['catalogDigest'] !== expected) {
      issue(issues, 'catalog_digest_mismatch', 'catalogDigest', 'catalog content does not match its digest', expected, value['catalogDigest']);
    }
  } else {
    issue(issues, 'catalog_digest_mismatch', 'catalogDigest', 'catalogDigest is required');
  }

  return {
    ok: issues.length === 0,
    kind: 'uniscenarios-catalog-validation',
    version: 1,
    catalogDigest: typeof value['catalogDigest'] === 'string' ? value['catalogDigest'] : null,
    slots: slots.length,
    maps: mapCounts,
    statuses: statusCounts,
    evidenceChecked,
    issues,
  };
}

function reportFor(catalogDigest: string | null, issues: CatalogIssue[], evidenceChecked: boolean): CatalogValidationReport {
  return {
    ok: false,
    kind: 'uniscenarios-catalog-validation',
    version: 1,
    catalogDigest,
    slots: 0,
    maps: {},
    statuses: {},
    evidenceChecked,
    issues,
  };
}
