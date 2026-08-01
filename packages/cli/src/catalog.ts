/**
 * Deterministic, map-grounded authoring catalog for UniScenarios.
 *
 * A slot is not a claim that a scenario has been simulated or visually
 * accepted. `authored` means that the incident mechanism, actors, event
 * sequence, real map site, operational variant, provenance, and acceptance
 * contract exist. Evidence states advance only when their artifacts exist.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  CATALOG_RESEARCH_SOURCES,
  INCIDENT_DOMAINS,
  INCIDENT_TAXONOMY,
  OPERATIONAL_VARIANTS,
  type IncidentDefinition,
} from './catalog-taxonomy.js';
import { CliError, EXIT } from './errors.js';
import { DEV_ASSETS, KNOWN_MAPS, REPO_ROOT } from './maps.js';

export const CATALOG_KIND = 'uniscenarios-scenario-catalog' as const;
export const CATALOG_VERSION = 2 as const;
export const CATALOG_GENERATOR_VERSION = '2.0.0' as const;
export const CATALOG_SLOTS_PER_MAP = 100 as const;
export const DEFAULT_CATALOG_NAMESPACE = 'uniscenarios-five-map-v2' as const;

/** Existing executable templates are implementation provenance, not the taxonomy. */
export const CATALOG_TEMPLATE_SOURCES = [
  { id: 'ltap-opposing', source: 'examples/ltap-opposing.template.json' },
  { id: 'cpnco-parked-row', source: 'examples/cpnco-parked-row.template.json' },
  { id: 'multiple-threat', source: 'examples/multiple-threat.template.json' },
  { id: 'bus-stop-emergence', source: 'examples/bus-stop-emergence.template.json' },
  { id: 'school-dartout', source: 'examples/school-dartout.template.json' },
] as const;

export type CatalogSlotStatus =
  | 'authored'
  | 'generated'
  | 'simulated'
  | 'rendered'
  | 'visually-accepted'
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
}

export interface CatalogMapProvenance {
  readonly mapId: string;
  readonly mapAssetId: string;
  readonly catalogRevision: string;
  /** Digest of the matcher/map-intel derived index domain. */
  readonly matcherIndexDigest: string;
  /** Independently computed digest of the engine topology graph domain. */
  readonly engineGraphDigest: string;
  readonly locationCatalogDigest: string;
  readonly slots: number;
}

export interface CatalogSiteBinding {
  readonly locationId: string;
  readonly handle: string;
  readonly name: string;
  readonly type: string;
  readonly tags: readonly string[];
  readonly affordances: readonly string[];
  readonly anchorQuality: string;
  readonly confidence: number;
  readonly roadAnchor: {
    readonly rsl: string;
    readonly s: number;
    readonly offsetM: number;
    readonly headingRad: number;
  };
  readonly sourceDigest: string;
}

export interface CatalogAcceptanceCheck {
  readonly id: 'schema' | 'site-grounding' | 'determinism' | 'kinematics' | 'render-integrity' | 'visual-realism';
  readonly kind: 'automated' | 'human';
  readonly criterion: string;
  readonly state: 'pending' | 'passed' | 'failed';
  readonly evidenceKey: keyof CatalogEvidencePaths | 'catalog';
}

export interface ScenarioCatalogSlot {
  readonly identity: string;
  readonly ordinal: number;
  readonly seed: string;
  readonly mapId: string;
  readonly status: CatalogSlotStatus;
  readonly provenance: {
    readonly namespace: string;
    readonly generatorVersion: string;
    readonly mapCatalogRevision: string;
    readonly matcherIndexDigest: string;
    readonly engineGraphDigest: string;
    readonly locationCatalogDigest: string;
    readonly taxonomyDigest: string;
    readonly templateDigest?: string;
  };
  readonly scenario: {
    readonly incidentId: string;
    readonly title: string;
    readonly domain: string;
    readonly summary: string;
    readonly sourceIds: readonly string[];
  };
  readonly site: CatalogSiteBinding;
  readonly variant: {
    readonly id: string;
    readonly title: string;
    readonly weather: string;
    readonly timeOfDay: string;
    readonly traffic: string;
    readonly visibility: string;
  };
  readonly brief: {
    readonly actors: IncidentDefinition['actors'];
    readonly eventSequence: readonly string[];
    readonly criticality: readonly string[];
    readonly acceptanceCriteria: readonly string[];
  };
  readonly implementation: {
    readonly state: 'authored-design' | 'template-backed';
    readonly templateId?: string;
    readonly templateSource?: string;
  };
  readonly acceptance: {
    readonly state: 'pending' | 'accepted' | 'rejected';
    readonly checks: readonly CatalogAcceptanceCheck[];
    readonly reviewer: null | { readonly id: string; readonly reviewedAt: string };
  };
  readonly evidencePaths: CatalogEvidencePaths;
  readonly designDigest: string;
}

export interface CatalogProgressCounts {
  readonly target: number;
  readonly planned: number;
  readonly authored: number;
  readonly generated: number;
  readonly simulated: number;
  readonly rendered: number;
  readonly visuallyAccepted: number;
  readonly rejected: number;
}

export interface ScenarioCatalogManifest {
  readonly kind: typeof CATALOG_KIND;
  readonly version: typeof CATALOG_VERSION;
  readonly contract: {
    readonly supportedMaps: readonly string[];
    readonly slotsPerMap: number;
    readonly totalSlots: number;
    readonly minimumIncidentTypesPerMap: number;
    readonly minimumDomainsPerMap: number;
  };
  readonly provenance: {
    readonly generator: '@uniscenarios/cli catalog create';
    readonly generatorVersion: string;
    readonly namespace: string;
    readonly taxonomyDigest: string;
  };
  readonly evidenceRoot: string;
  readonly maps: readonly CatalogMapProvenance[];
  readonly researchSources: typeof CATALOG_RESEARCH_SOURCES;
  readonly taxonomy: typeof INCIDENT_TAXONOMY;
  readonly templates: readonly CatalogTemplateProvenance[];
  readonly slots: readonly ScenarioCatalogSlot[];
  readonly progress: CatalogProgressCounts;
  readonly catalogDigest: string;
}

export interface CatalogIssue {
  readonly code:
    | 'invalid_catalog'
    | 'wrong_map_inventory'
    | 'wrong_slot_count'
    | 'insufficient_taxonomy_breadth'
    | 'duplicate_identity'
    | 'duplicate_design'
    | 'duplicate_seed'
    | 'invalid_identity'
    | 'invalid_seed'
    | 'invalid_provenance'
    | 'invalid_site_binding'
    | 'invalid_acceptance_manifest'
    | 'invalid_evidence_path'
    | 'missing_evidence'
    | 'invalid_progress_counts'
    | 'catalog_digest_mismatch';
  readonly path: string;
  readonly reason: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export interface CatalogValidationReport {
  readonly ok: boolean;
  readonly kind: 'uniscenarios-catalog-validation';
  readonly version: 2;
  readonly catalogDigest: string | null;
  readonly slots: number;
  readonly maps: Record<string, number>;
  readonly statuses: Record<string, number>;
  readonly incidentTypesByMap: Record<string, number>;
  readonly domainsByMap: Record<string, number>;
  readonly progress: CatalogProgressCounts;
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

interface RawRoadAnchor {
  readonly rsl?: unknown;
  readonly s?: unknown;
  readonly offsetM?: unknown;
  readonly headingRad?: unknown;
}

interface RawLocation {
  readonly id?: unknown;
  readonly handle?: unknown;
  readonly name?: unknown;
  readonly type?: unknown;
  readonly tags?: unknown;
  readonly affordances?: unknown;
  readonly anchor?: { readonly road?: RawRoadAnchor | null };
  readonly quality?: { readonly anchor?: unknown; readonly confidence?: unknown };
}

interface RawLocationCatalog {
  readonly mapId?: unknown;
  readonly mapAssetId?: unknown;
  readonly catalogRevision?: unknown;
  readonly locations?: unknown;
}

interface DerivedProvenance {
  readonly mapId?: unknown;
  readonly mapAssetId?: unknown;
  readonly catalogRevision?: unknown;
}

interface MapContext {
  readonly provenance: CatalogMapProvenance;
  readonly locations: readonly RawLocation[];
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function unzip(bytes: Buffer): Buffer {
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}

function digestPayload(manifest: Omit<ScenarioCatalogManifest, 'catalogDigest'>): string {
  return sha256(JSON.stringify(manifest));
}

function stableLocationDigest(location: RawLocation): string {
  return sha256(JSON.stringify({
    id: location.id,
    handle: location.handle,
    type: location.type,
    tags: location.tags,
    affordances: location.affordances,
    anchor: location.anchor,
    quality: location.quality,
  }));
}

function taxonomyDigest(): string {
  return sha256(JSON.stringify({ sources: CATALOG_RESEARCH_SOURCES, incidents: INCIDENT_TAXONOMY, variants: OPERATIONAL_VARIANTS }));
}

function catalogSeed(
  namespace: string,
  map: CatalogMapProvenance,
  ordinal: number,
  incident: IncidentDefinition,
  site: CatalogSiteBinding,
  variantId: string,
  taxonomyHash: string,
): string {
  return sha256([
    CATALOG_GENERATOR_VERSION,
    namespace,
    map.mapId,
    map.catalogRevision,
    map.matcherIndexDigest,
    map.engineGraphDigest,
    map.locationCatalogDigest,
    String(ordinal),
    incident.id,
    site.locationId,
    site.sourceDigest,
    variantId,
    taxonomyHash,
  ].join('\0'));
}

function catalogIdentity(mapId: string, ordinal: number, incidentId: string, seed: string): string {
  const mechanism = incidentId.split('.').at(-1)?.replace(/[^a-z0-9]+/g, '-') ?? 'scenario';
  return `${mapId}-${String(ordinal + 1).padStart(3, '0')}-${mechanism}-${seed.slice(0, 12)}`;
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
    return { id: entry.id, source: entry.source, digest: sha256(bytes) };
  }));
}

async function readMapContext(devAssets: string, mapId: string): Promise<MapContext> {
  const derivedFile = path.join(devAssets, mapId, 'derived', 'topology-derived.json.gz');
  const locationsFile = path.join(devAssets, mapId, 'derived', 'locations.json.gz');
  const engineFile = path.join(devAssets, mapId, 'topology-index.json.gz');
  let derivedBytes: Buffer;
  let locationBytes: Buffer;
  let engineBytes: Buffer;
  try {
    [derivedBytes, locationBytes, engineBytes] = await Promise.all([
      readFile(derivedFile), readFile(locationsFile), readFile(engineFile),
    ]);
  } catch {
    throw new CliError('missing_map_provenance', `cannot read complete map provenance for ${mapId}`, {
      path: path.join(devAssets, mapId),
      detail: { hint: 'run `pnpm --filter @uniscenarios/map-intel build:map -- --all`' },
    });
  }

  let derived: DerivedProvenance;
  let catalog: RawLocationCatalog;
  try {
    derived = JSON.parse(unzip(derivedBytes).toString('utf8')) as DerivedProvenance;
    catalog = JSON.parse(unzip(locationBytes).toString('utf8')) as RawLocationCatalog;
    JSON.parse(unzip(engineBytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new CliError('invalid_map_provenance', error instanceof Error ? error.message : String(error), {
      path: path.join(devAssets, mapId),
    });
  }
  if (
    derived.mapId !== mapId ||
    catalog.mapId !== mapId ||
    typeof catalog.mapAssetId !== 'string' ||
    typeof catalog.catalogRevision !== 'string' ||
    !Array.isArray(catalog.locations)
  ) {
    throw new CliError('invalid_map_provenance', `${mapId} is missing stable map/location provenance`, {
      path: path.join(devAssets, mapId),
      detail: { expectedMapId: mapId },
    });
  }
  if (derived.mapAssetId !== undefined && derived.mapAssetId !== catalog.mapAssetId) {
    throw new CliError('invalid_map_provenance', `${mapId} map asset IDs disagree across provenance domains`, {
      path: path.join(devAssets, mapId),
    });
  }
  return {
    provenance: {
      mapId,
      mapAssetId: catalog.mapAssetId,
      catalogRevision: catalog.catalogRevision,
      matcherIndexDigest: sha256(unzip(derivedBytes)),
      engineGraphDigest: sha256(unzip(engineBytes)),
      locationCatalogDigest: sha256(unzip(locationBytes)),
      slots: CATALOG_SLOTS_PER_MAP,
    },
    locations: catalog.locations as RawLocation[],
  };
}

function locationMatches(location: RawLocation, incident: IncidentDefinition): boolean {
  if (
    typeof location.id !== 'string' ||
    typeof location.handle !== 'string' ||
    typeof location.name !== 'string' ||
    typeof location.type !== 'string' ||
    !incident.siteTypes.includes(location.type) ||
    !location.anchor?.road ||
    typeof location.anchor.road.rsl !== 'string' ||
    typeof location.anchor.road.s !== 'number' ||
    typeof location.anchor.road.offsetM !== 'number' ||
    typeof location.anchor.road.headingRad !== 'number'
  ) return false;
  const affordances = Array.isArray(location.affordances) ? location.affordances : [];
  return (incident.requiredAffordances ?? []).every((entry) => affordances.includes(entry));
}

function bindSite(location: RawLocation): CatalogSiteBinding {
  const road = location.anchor!.road!;
  return {
    locationId: String(location.id),
    handle: String(location.handle),
    name: String(location.name),
    type: String(location.type),
    tags: Array.isArray(location.tags) ? location.tags.filter((entry): entry is string => typeof entry === 'string') : [],
    affordances: Array.isArray(location.affordances) ? location.affordances.filter((entry): entry is string => typeof entry === 'string') : [],
    anchorQuality: String(location.quality?.anchor ?? 'unknown'),
    confidence: typeof location.quality?.confidence === 'number' ? location.quality.confidence : 0,
    roadAnchor: {
      rsl: String(road.rsl),
      s: Number(road.s),
      offsetM: Number(road.offsetM),
      headingRad: Number(road.headingRad),
    },
    sourceDigest: stableLocationDigest(location),
  };
}

function siteScore(location: RawLocation, incident: IncidentDefinition): number {
  const tags = new Set(Array.isArray(location.tags) ? location.tags : []);
  const preferred = (incident.preferredTags ?? []).filter((tag) => tags.has(tag)).length;
  const exact = location.quality?.anchor === 'exact' ? 2 : 0;
  const confidence = typeof location.quality?.confidence === 'number' ? location.quality.confidence : 0;
  return preferred * 10 + exact + confidence;
}

function acceptanceChecks(): readonly CatalogAcceptanceCheck[] {
  return [
    { id: 'schema', kind: 'automated', criterion: 'Concrete instance passes the versioned scenario schema.', state: 'pending', evidenceKey: 'instance' },
    { id: 'site-grounding', kind: 'automated', criterion: 'Map, matcher index, engine graph, location ID, road anchor, and source digests remain exact.', state: 'pending', evidenceKey: 'catalog' },
    { id: 'determinism', kind: 'automated', criterion: 'Repeated generation and simulation produce identical normalized output for the recorded seed.', state: 'pending', evidenceKey: 'trace' },
    { id: 'kinematics', kind: 'automated', criterion: 'Actor speeds, accelerations, paths, clearances, trigger ordering, and conflict timing pass incident-specific plausibility limits.', state: 'pending', evidenceKey: 'result' },
    { id: 'render-integrity', kind: 'automated', criterion: 'Rendered frames use the pinned map and actors, cover pre-reveal through aftermath, and contain no missing/off-map/overlapping assets.', state: 'pending', evidenceKey: 'renderManifest' },
    { id: 'visual-realism', kind: 'human', criterion: 'A reviewer inspects stills and video and accepts site fit, actor intent, occlusion, timing, motion, continuity, and real-world plausibility.', state: 'pending', evidenceKey: 'visualInspection' },
  ];
}

function acceptanceCriteria(incident: IncidentDefinition): string[] {
  return [
    `The authored sequence is visibly present: ${incident.eventSequence.join(' → ')}`,
    `Critical observables are measured: ${incident.criticality.join(', ')}.`,
    'Every dynamic actor follows a continuous, lane/site-compatible path with plausible speed, acceleration, and response timing.',
    'The conflict is challenging but not created by teleportation, impossible overlap, wrong-way geometry, or an unavoidable initial state.',
    'Pre-reveal, reveal, conflict, and aftermath are visible in the evidence bundle and pass human review.',
  ];
}

function progressFor(slots: readonly ScenarioCatalogSlot[]): CatalogProgressCounts {
  const atLeast = (statuses: readonly CatalogSlotStatus[]) => slots.filter((slot) => statuses.includes(slot.status)).length;
  return {
    target: KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP,
    planned: 0,
    authored: slots.length,
    generated: atLeast(['generated', 'simulated', 'rendered', 'visually-accepted']),
    simulated: atLeast(['simulated', 'rendered', 'visually-accepted']),
    rendered: atLeast(['rendered', 'visually-accepted']),
    visuallyAccepted: atLeast(['visually-accepted']),
    rejected: atLeast(['rejected']),
  };
}

/** Build 100 distinct, authored, map-grounded incident briefs per map. */
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

  const [templates, contexts] = await Promise.all([
    readTemplateProvenance(repoRoot),
    Promise.all(KNOWN_MAPS.map((mapId) => readMapContext(devAssets, mapId))),
  ]);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const taxonomyHash = taxonomyDigest();
  const slots: ScenarioCatalogSlot[] = [];

  for (const context of contexts) {
    const map = context.provenance;
    const eligible = INCIDENT_TAXONOMY.flatMap((incident) => {
      if (incident.mapIds && !incident.mapIds.includes(map.mapId)) return [];
      const candidates = context.locations
        .filter((location) => locationMatches(location, incident))
        .sort((left, right) => siteScore(right, incident) - siteScore(left, incident) || String(left.id).localeCompare(String(right.id)));
      return candidates.length > 0 ? [{ incident, candidates }] : [];
    });
    if (eligible.length < 20 || new Set(eligible.map((entry) => entry.incident.domain)).size < 7) {
      throw new CliError('insufficient_map_authorability', `${map.mapId} cannot support a broad incident catalog`, {
        path: path.join(devAssets, map.mapId),
        detail: {
          eligibleIncidentTypes: eligible.map((entry) => entry.incident.id),
          domains: [...new Set(eligible.map((entry) => entry.incident.domain))],
        },
        exitCode: EXIT.validationFindings,
      });
    }

    for (let ordinal = 0; ordinal < CATALOG_SLOTS_PER_MAP; ordinal += 1) {
      const entry = eligible[ordinal % eligible.length]!;
      const cycle = Math.floor(ordinal / eligible.length);
      const location = entry.candidates[(cycle * 7 + ordinal) % entry.candidates.length]!;
      const site = bindSite(location);
      // Repeated use of a rare map feature (for example the only school zone)
      // advances the operational condition every taxonomy round. This keeps
      // map/incident/site/variant coordinates unique even when only one
      // suitable site exists.
      const variant = OPERATIONAL_VARIANTS[cycle % OPERATIONAL_VARIANTS.length]!;
      const seed = catalogSeed(namespace, map, ordinal, entry.incident, site, variant.id, taxonomyHash);
      const identity = catalogIdentity(map.mapId, ordinal, entry.incident.id, seed);
      const template = entry.incident.implementationTemplateId
        ? templateById.get(entry.incident.implementationTemplateId)
        : undefined;
      const withoutDesignDigest: Omit<ScenarioCatalogSlot, 'designDigest'> = {
        identity,
        ordinal,
        seed,
        mapId: map.mapId,
        status: 'authored',
        provenance: {
          namespace,
          generatorVersion: CATALOG_GENERATOR_VERSION,
          mapCatalogRevision: map.catalogRevision,
          matcherIndexDigest: map.matcherIndexDigest,
          engineGraphDigest: map.engineGraphDigest,
          locationCatalogDigest: map.locationCatalogDigest,
          taxonomyDigest: taxonomyHash,
          ...(template ? { templateDigest: template.digest } : {}),
        },
        scenario: {
          incidentId: entry.incident.id,
          title: entry.incident.title,
          domain: entry.incident.domain,
          summary: entry.incident.summary,
          sourceIds: [...entry.incident.sourceIds],
        },
        site,
        variant: { ...variant },
        brief: {
          actors: entry.incident.actors,
          eventSequence: entry.incident.eventSequence,
          criticality: entry.incident.criticality,
          acceptanceCriteria: acceptanceCriteria(entry.incident),
        },
        implementation: template
          ? { state: 'template-backed', templateId: template.id, templateSource: template.source }
          : { state: 'authored-design' },
        acceptance: { state: 'pending', checks: acceptanceChecks(), reviewer: null },
        evidencePaths: evidencePaths(root, map.mapId, identity),
      };
      slots.push({ ...withoutDesignDigest, designDigest: sha256(JSON.stringify(withoutDesignDigest)) });
    }
  }

  const maps = contexts.map((context) => context.provenance);
  const withoutDigest: Omit<ScenarioCatalogManifest, 'catalogDigest'> = {
    kind: CATALOG_KIND,
    version: CATALOG_VERSION,
    contract: {
      supportedMaps: [...KNOWN_MAPS],
      slotsPerMap: CATALOG_SLOTS_PER_MAP,
      totalSlots: KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP,
      minimumIncidentTypesPerMap: 20,
      minimumDomainsPerMap: 7,
    },
    provenance: {
      generator: '@uniscenarios/cli catalog create',
      generatorVersion: CATALOG_GENERATOR_VERSION,
      namespace,
      taxonomyDigest: taxonomyHash,
    },
    evidenceRoot: root,
    maps,
    researchSources: CATALOG_RESEARCH_SOURCES,
    taxonomy: INCIDENT_TAXONOMY,
    templates,
    slots,
    progress: progressFor(slots),
  };
  return { ...withoutDigest, catalogDigest: digestPayload(withoutDigest) };
}

const ALL_EVIDENCE = [
  'instance', 'trace', 'result', 'renderManifest', 'frame', 'video', 'visualInspection',
] as const satisfies readonly (keyof CatalogEvidencePaths)[];

const REQUIRED_EVIDENCE: Record<CatalogSlotStatus, readonly (keyof CatalogEvidencePaths)[]> = {
  authored: [],
  generated: ['instance'],
  simulated: ['instance', 'trace', 'result'],
  rendered: ['instance', 'trace', 'result', 'renderManifest', 'frame', 'video'],
  'visually-accepted': ALL_EVIDENCE,
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

function emptyProgress(): CatalogProgressCounts {
  return { target: 500, planned: 0, authored: 0, generated: 0, simulated: 0, rendered: 0, visuallyAccepted: 0, rejected: 0 };
}

export interface ValidateCatalogOptions {
  /** Path to the manifest; evidence paths are relative to its directory. */
  readonly manifestFile?: string;
  /** Physical evidence-root override, useful when artifacts are mounted elsewhere. */
  readonly evidenceRootOverride?: string;
  /** Require every authored evidence path, not only paths implied by slot status. */
  readonly requireEvidence?: boolean;
  /** Injectable for focused tests. */
  readonly evidenceExists?: (file: string) => boolean;
}

/** Machine verification for authorship, breadth, identity, provenance, and evidence. */
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
  if (contract['minimumIncidentTypesPerMap'] !== 20 || contract['minimumDomainsPerMap'] !== 7) {
    issue(issues, 'insufficient_taxonomy_breadth', 'contract', 'catalog breadth gates must require at least 20 incident types and 7 domains per map');
  }
  if (typeof value['evidenceRoot'] !== 'string' || !isSafeEvidencePath(`${evidenceRoot}/probe`, evidenceRoot)) {
    issue(issues, 'invalid_evidence_path', 'evidenceRoot', 'evidenceRoot must be a safe relative path');
  }

  const taxonomyRows = Array.isArray(value['taxonomy']) ? value['taxonomy'] : [];
  const incidentById = new Map<string, IncidentDefinition>();
  for (const row of taxonomyRows) {
    if (isRecord(row) && typeof row['id'] === 'string') incidentById.set(row['id'], row as unknown as IncidentDefinition);
  }
  const sourceRows = Array.isArray(value['researchSources']) ? value['researchSources'] : [];
  const sourceIds = new Set(sourceRows.flatMap((row) => isRecord(row) && typeof row['id'] === 'string' ? [row['id']] : []));
  const taxonomyHash = sha256(JSON.stringify({ sources: sourceRows, incidents: taxonomyRows, variants: OPERATIONAL_VARIANTS }));
  if (taxonomyRows.length < 30 || new Set(taxonomyRows.flatMap((row) => isRecord(row) && typeof row['domain'] === 'string' ? [row['domain']] : [])).size < INCIDENT_DOMAINS.length) {
    issue(issues, 'insufficient_taxonomy_breadth', 'taxonomy', 'taxonomy must cover at least 30 incident mechanisms across all eight domains');
  }
  const topProvenance = isRecord(value['provenance']) ? value['provenance'] : {};
  if (topProvenance['taxonomyDigest'] !== taxonomyHash || topProvenance['generatorVersion'] !== CATALOG_GENERATOR_VERSION) {
    issue(issues, 'invalid_provenance', 'provenance', 'top-level taxonomy/generator provenance is stale');
  }

  const mapRows = Array.isArray(value['maps']) ? value['maps'] : [];
  const mapById = new Map<string, CatalogMapProvenance>();
  for (const row of mapRows) {
    if (isRecord(row) && typeof row['mapId'] === 'string') mapById.set(row['mapId'], row as unknown as CatalogMapProvenance);
  }
  if (mapRows.length !== KNOWN_MAPS.length || KNOWN_MAPS.some((mapId) => !mapById.has(mapId))) {
    issue(issues, 'wrong_map_inventory', 'maps', 'maps[] must contain each supported map exactly once');
  }
  for (const [mapId, map] of mapById) {
    if (
      !/^[0-9a-f]{64}$/.test(map.matcherIndexDigest) ||
      !/^[0-9a-f]{64}$/.test(map.engineGraphDigest) ||
      !/^[0-9a-f]{64}$/.test(map.locationCatalogDigest) ||
      map.matcherIndexDigest === map.engineGraphDigest
    ) {
      issue(issues, 'invalid_provenance', `maps(map=${mapId})`, 'matcher, engine, and location provenance must be independent digest domains');
    }
  }

  const identities = new Set<string>();
  const seeds = new Set<string>();
  const designs = new Set<string>();
  const mapOrdinals = new Map<string, Set<number>>();
  const statusCounts: Record<string, number> = {};
  const mapCounts: Record<string, number> = {};
  const mapIncidents = new Map<string, Set<string>>();
  const mapDomains = new Map<string, Set<string>>();
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
    const scenario = isRecord(raw['scenario']) ? raw['scenario'] : {};
    const site = isRecord(raw['site']) ? raw['site'] : {};
    const variant = isRecord(raw['variant']) ? raw['variant'] : {};
    const brief = isRecord(raw['brief']) ? raw['brief'] : {};
    const implementation = isRecord(raw['implementation']) ? raw['implementation'] : {};
    const acceptance = isRecord(raw['acceptance']) ? raw['acceptance'] : {};
    const status = raw['status'];
    const paths = isRecord(raw['evidencePaths']) ? raw['evidencePaths'] : {};

    if (typeof identity !== 'string') issue(issues, 'invalid_identity', `${base}.identity`, 'identity must be a string');
    else if (identities.has(identity)) issue(issues, 'duplicate_identity', `${base}.identity`, `duplicate identity ${identity}`);
    else identities.add(identity);

    if (typeof seed !== 'string' || !/^[0-9a-f]{64}$/.test(seed)) issue(issues, 'invalid_seed', `${base}.seed`, 'seed must be 64 lowercase hexadecimal characters');
    else if (seeds.has(seed)) issue(issues, 'duplicate_seed', `${base}.seed`, `duplicate seed ${seed}`);
    else seeds.add(seed);

    if (typeof mapId === 'string') {
      mapCounts[mapId] = (mapCounts[mapId] ?? 0) + 1;
      if (typeof ordinal === 'number' && Number.isInteger(ordinal)) {
        const ordinals = mapOrdinals.get(mapId) ?? new Set<number>();
        ordinals.add(ordinal);
        mapOrdinals.set(mapId, ordinals);
      }
      if (typeof scenario['incidentId'] === 'string') {
        const set = mapIncidents.get(mapId) ?? new Set<string>();
        set.add(scenario['incidentId']);
        mapIncidents.set(mapId, set);
      }
      if (typeof scenario['domain'] === 'string') {
        const set = mapDomains.get(mapId) ?? new Set<string>();
        set.add(scenario['domain']);
        mapDomains.set(mapId, set);
      }
    }
    if (typeof status === 'string') statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    const map = typeof mapId === 'string' ? mapById.get(mapId) : undefined;
    const incident = typeof scenario['incidentId'] === 'string' ? incidentById.get(scenario['incidentId']) : undefined;
    if (
      !map || !incident ||
      typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= CATALOG_SLOTS_PER_MAP ||
      typeof provenance['namespace'] !== 'string' ||
      provenance['generatorVersion'] !== CATALOG_GENERATOR_VERSION ||
      provenance['mapCatalogRevision'] !== map.catalogRevision ||
      provenance['matcherIndexDigest'] !== map.matcherIndexDigest ||
      provenance['engineGraphDigest'] !== map.engineGraphDigest ||
      provenance['locationCatalogDigest'] !== map.locationCatalogDigest ||
      provenance['taxonomyDigest'] !== taxonomyHash
    ) {
      issue(issues, 'invalid_provenance', base, 'slot map, ordinal, incident, or provenance is incomplete/stale');
    } else if (
      typeof site['locationId'] !== 'string' || typeof site['sourceDigest'] !== 'string' ||
      typeof variant['id'] !== 'string' || !OPERATIONAL_VARIANTS.some((entry) => entry.id === variant['id'])
    ) {
      issue(issues, 'invalid_site_binding', `${base}.site`, 'site binding and operational variant must be complete');
    } else {
      const designCoordinate = `${mapId}\0${incident.id}\0${site['locationId']}\0${variant['id']}`;
      if (designs.has(designCoordinate)) issue(issues, 'duplicate_design', base, 'map/incident/site/variant design is duplicated');
      else designs.add(designCoordinate);
      const expectedSeed = catalogSeed(provenance['namespace'], map, ordinal, incident, site as unknown as CatalogSiteBinding, variant['id'], taxonomyHash);
      if (seed !== expectedSeed) issue(issues, 'invalid_seed', `${base}.seed`, 'seed does not match deterministic authored coordinates', expectedSeed, seed);
      const expectedIdentity = catalogIdentity(map.mapId, ordinal, incident.id, expectedSeed);
      if (identity !== expectedIdentity) issue(issues, 'invalid_identity', `${base}.identity`, 'identity does not match deterministic authored coordinates', expectedIdentity, identity);
      if (!incident.siteTypes.includes(String(site['type']))) issue(issues, 'invalid_site_binding', `${base}.site.type`, 'site type is not applicable to incident');
      const affordances = Array.isArray(site['affordances']) ? site['affordances'] : [];
      if ((incident.requiredAffordances ?? []).some((entry) => !affordances.includes(entry))) {
        issue(issues, 'invalid_site_binding', `${base}.site.affordances`, 'site lacks an incident-required affordance');
      }
      if (incident.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
        issue(issues, 'invalid_provenance', `${base}.scenario.sourceIds`, 'incident references an unknown research source');
      }
      if (
        scenario['title'] !== incident.title || scenario['domain'] !== incident.domain ||
        !Array.isArray(brief['actors']) || brief['actors'].length < 2 ||
        !Array.isArray(brief['eventSequence']) || brief['eventSequence'].length < 3 ||
        !Array.isArray(brief['criticality']) || brief['criticality'].length < 3 ||
        !Array.isArray(brief['acceptanceCriteria']) || brief['acceptanceCriteria'].length < 5
      ) issue(issues, 'invalid_catalog', `${base}.brief`, 'authored brief must retain complete incident actors, sequence, observables, and acceptance criteria');
      if (incident.implementationTemplateId && implementation['templateId'] !== incident.implementationTemplateId) {
        issue(issues, 'invalid_provenance', `${base}.implementation`, 'template-backed incident lost its implementation provenance');
      }
    }

    const checks = Array.isArray(acceptance['checks']) ? acceptance['checks'] : [];
    const checkIds = new Set(checks.flatMap((check) => isRecord(check) && typeof check['id'] === 'string' ? [check['id']] : []));
    if (
      checks.length !== 6 ||
      ['schema', 'site-grounding', 'determinism', 'kinematics', 'render-integrity', 'visual-realism'].some((id) => !checkIds.has(id)) ||
      (status === 'visually-accepted' && (acceptance['state'] !== 'accepted' || !isRecord(acceptance['reviewer']) || checks.some((check) => !isRecord(check) || check['state'] !== 'passed')))
    ) issue(issues, 'invalid_acceptance_manifest', `${base}.acceptance`, 'acceptance requires all six gates; visual acceptance additionally requires a reviewer and all checks passed');

    for (const key of ALL_EVIDENCE) {
      if (!isSafeEvidencePath(paths[key], evidenceRoot)) issue(issues, 'invalid_evidence_path', `${base}.evidencePaths.${key}`, 'evidence path must stay under evidenceRoot');
    }
    const required = options.requireEvidence
      ? ALL_EVIDENCE
      : typeof status === 'string' && status in REQUIRED_EVIDENCE
        ? REQUIRED_EVIDENCE[status as CatalogSlotStatus]
        : [];
    if (typeof status !== 'string' || !(status in REQUIRED_EVIDENCE)) issue(issues, 'invalid_catalog', `${base}.status`, 'unknown slot status');
    for (const key of required) {
      const relative = paths[key];
      if (typeof relative !== 'string') continue;
      evidenceChecked = true;
      const physical = options.evidenceRootOverride
        ? path.join(physicalRoot, path.posix.relative(evidenceRoot, relative))
        : path.join(physicalRoot, relative);
      if (!evidenceExists(physical)) issue(issues, 'missing_evidence', `${base}.evidencePaths.${key}`, `required evidence does not exist: ${physical}`);
    }

    if (typeof raw['designDigest'] !== 'string') {
      issue(issues, 'invalid_provenance', `${base}.designDigest`, 'design digest is required');
    } else {
      const { designDigest: _ignored, ...withoutDesignDigest } = raw;
      const expected = sha256(JSON.stringify(withoutDesignDigest));
      if (raw['designDigest'] !== expected) issue(issues, 'invalid_provenance', `${base}.designDigest`, 'authored design content does not match its digest', expected, raw['designDigest']);
    }
  });

  if (slots.length !== KNOWN_MAPS.length * CATALOG_SLOTS_PER_MAP) issue(issues, 'wrong_slot_count', 'slots', 'catalog must contain exactly 500 slots', 500, slots.length);
  for (const mapId of KNOWN_MAPS) {
    const ordinals = mapOrdinals.get(mapId) ?? new Set<number>();
    if (mapCounts[mapId] !== CATALOG_SLOTS_PER_MAP || ordinals.size !== CATALOG_SLOTS_PER_MAP) {
      issue(issues, 'wrong_slot_count', `slots(map=${mapId})`, 'map must contain each ordinal 0..99 exactly once', CATALOG_SLOTS_PER_MAP, mapCounts[mapId] ?? 0);
    }
    if ((mapIncidents.get(mapId)?.size ?? 0) < 20 || (mapDomains.get(mapId)?.size ?? 0) < 7) {
      issue(issues, 'insufficient_taxonomy_breadth', `slots(map=${mapId})`, 'map must contain at least 20 incident mechanisms across 7 domains');
    }
  }

  const calculatedProgress = progressFor(slots as unknown as ScenarioCatalogSlot[]);
  if (JSON.stringify(value['progress']) !== JSON.stringify(calculatedProgress)) {
    issue(issues, 'invalid_progress_counts', 'progress', 'planned/authored/generated/simulated/rendered/accepted counts must be derived from slot states', calculatedProgress, value['progress']);
  }
  if (typeof value['catalogDigest'] === 'string') {
    const { catalogDigest: _ignored, ...withoutDigest } = manifest;
    const expected = digestPayload(withoutDigest);
    if (value['catalogDigest'] !== expected) issue(issues, 'catalog_digest_mismatch', 'catalogDigest', 'catalog content does not match its digest', expected, value['catalogDigest']);
  } else issue(issues, 'catalog_digest_mismatch', 'catalogDigest', 'catalogDigest is required');

  return {
    ok: issues.length === 0,
    kind: 'uniscenarios-catalog-validation',
    version: 2,
    catalogDigest: typeof value['catalogDigest'] === 'string' ? value['catalogDigest'] : null,
    slots: slots.length,
    maps: mapCounts,
    statuses: statusCounts,
    incidentTypesByMap: Object.fromEntries(KNOWN_MAPS.map((mapId) => [mapId, mapIncidents.get(mapId)?.size ?? 0])),
    domainsByMap: Object.fromEntries(KNOWN_MAPS.map((mapId) => [mapId, mapDomains.get(mapId)?.size ?? 0])),
    progress: calculatedProgress,
    evidenceChecked,
    issues,
  };
}

function reportFor(catalogDigest: string | null, issues: CatalogIssue[], evidenceChecked: boolean): CatalogValidationReport {
  return {
    ok: false,
    kind: 'uniscenarios-catalog-validation',
    version: 2,
    catalogDigest,
    slots: 0,
    maps: {},
    statuses: {},
    incidentTypesByMap: {},
    domainsByMap: {},
    progress: emptyProgress(),
    evidenceChecked,
    issues,
  };
}

export { CATALOG_RESEARCH_SOURCES, INCIDENT_DOMAINS, INCIDENT_TAXONOMY, OPERATIONAL_VARIANTS };
