import {
  TemplateDocument,
  WebTemplateFileStore,
  type ScenarioTemplateV2,
  type TemplateFileStore,
} from '@uniscenarios/scenario-model';
import { readPlaybackFiles, type PlaybackBundle } from '@uniscenarios/playback';
import { GENERATED_CAMPAIGN_ENTRIES } from './generated';
import type { CampaignImportRecord, GeneratedCampaignEntry } from './types';

/** v2 records bind browser persistence to immutable manifest identity. */
export const CAMPAIGN_IMPORTS_KEY = 'uniscenarios.studio.campaign-imports.v3';

export function isCampaignReady(entry: GeneratedCampaignEntry): boolean {
  return entry.diagnostics.length === 0
    && !!entry.mapId
    && !!entry.assets.templateUrl
    && !!entry.assets.instanceUrl
    && !!entry.assets.traceUrl;
}

export async function loadCampaignTemplate(entry: GeneratedCampaignEntry): Promise<ScenarioTemplateV2> {
  if (!entry.assets.templateUrl) throw new Error('Canonical v2 template is missing');
  const response = await fetch(entry.assets.templateUrl);
  if (!response.ok) throw new Error(`Template fetch failed (${response.status})`);
  const value: unknown = await response.json();
  const template = TemplateDocument.fromJSON(value).data;
  assertTemplateIdentity(entry, template);
  return template;
}

export async function loadCampaignEvidence(entry: GeneratedCampaignEntry): Promise<PlaybackBundle> {
  if (!entry.assets.instanceUrl || !entry.assets.traceUrl) {
    throw new Error('The exact concrete instance and trace pair is incomplete');
  }
  const [instance, trace] = await Promise.all([
    fetch(entry.assets.instanceUrl),
    fetch(entry.assets.traceUrl),
  ]);
  if (!instance.ok) throw new Error(`Instance fetch failed (${instance.status})`);
  if (!trace.ok) throw new Error(`Trace fetch failed (${trace.status})`);
  const bundle = await readPlaybackFiles(
    { name: `${entry.slug}.instance.json`, arrayBuffer: () => instance.arrayBuffer() },
    { name: `${entry.slug}.trace.json.gz`, arrayBuffer: () => trace.arrayBuffer() },
  );
  assertEvidenceIdentity(entry, bundle);
  return bundle;
}

export async function loadVerifiedCampaignEntry(entry: GeneratedCampaignEntry): Promise<{
  template: ScenarioTemplateV2;
  evidence: PlaybackBundle;
}> {
  const [template, evidence] = await Promise.all([
    loadCampaignTemplate(entry),
    loadCampaignEvidence(entry),
  ]);
  assertCampaignEntryIdentity(entry, template, evidence);
  return { template, evidence };
}

export function assertCampaignEntryIdentity(
  entry: GeneratedCampaignEntry,
  template: ScenarioTemplateV2,
  evidence: PlaybackBundle,
): void {
  assertTemplateIdentity(entry, template);
  assertEvidenceIdentity(entry, evidence);
  assertCampaignActorIdentity(entry, template, evidence);
}

export function assertCampaignActorIdentity(
  entry: GeneratedCampaignEntry,
  template: ScenarioTemplateV2,
  evidence: PlaybackBundle,
): void {
  const templateActors = template.roles.map((role) => role.id).sort();
  const evidenceActors = evidence.instance.input.actors.map((actor) => actor.id).sort();
  if (JSON.stringify(templateActors) !== JSON.stringify(evidenceActors)) {
    throw new Error(`Campaign ${entry.ordinal} identity mismatch: editable and verified actor populations differ`);
  }
}

/**
 * Turn the exact concrete campaign rendition into an editable Studio document.
 *
 * Catalog templates are intentionally portable, so their roles have no scene
 * coordinates and the viewport cannot draw them directly. The verified
 * instance is the authoritative binding for this saved copy: project its
 * concrete initial poses onto the same stable role ids while retaining the
 * portable source in an extension for provenance and future re-lifting.
 */
export function editableCampaignTemplate(
  entry: GeneratedCampaignEntry,
  template: ScenarioTemplateV2,
  evidence: PlaybackBundle,
): ScenarioTemplateV2 {
  assertCampaignEntryIdentity(entry, template, evidence);
  const concreteById = new Map(evidence.instance.input.actors.map((actor) => [actor.id, actor]));
  const playbackById = new Map(evidence.actors.map((actor) => [actor.id, actor]));
  const roles = template.roles.map((role) => {
    const concrete = concreteById.get(role.id);
    const playback = playbackById.get(role.id);
    if (!concrete || !playback) {
      throw new Error(`Campaign ${entry.ordinal} cannot open editable role ${role.id}: concrete pose is missing`);
    }
    return {
      id: role.id,
      kind: 'scene_absolute' as const,
      actor: {
        ...role.actor,
        catalogId: role.actor.catalogId ?? playback.catalogId,
        dims: {
          length: concrete.dims.l,
          width: concrete.dims.w,
          height: concrete.dims.h,
        },
        static: concrete.static,
      },
      pose: {
        position: { x: concrete.initial.pose.x, y: 0, z: concrete.initial.pose.z },
        headingRad: concrete.initial.pose.headingRad,
      },
      ...(role.label === undefined ? {} : { label: role.label }),
      ...(role.initialSpeedKph === undefined ? {} : { initialSpeedKph: role.initialSpeedKph }),
      ...(role.essentiality === undefined ? {} : { essentiality: role.essentiality }),
      ...(role.extensions === undefined ? {} : { extensions: role.extensions }),
    };
  });
  return TemplateDocument.fromJSON({
    ...template,
    sourceMap: { mapId: entry.mapId!, mapName: entry.mapId! },
    anchor: { ...template.anchor, pin: { mapId: entry.mapId! } },
    roles,
    extensions: {
      ...template.extensions,
      'studio.presentation.campaignIdentity': {
        ordinal: entry.ordinal,
        stableId: entry.stableId,
        concreteInstanceId: evidence.instance.manifest.instanceId,
      },
      'studio.presentation.portableRoles': template.roles,
    },
  }).data;
}

export function campaignImports(storage: Storage = globalThis.localStorage): CampaignImportRecord[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CAMPAIGN_IMPORTS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CampaignImportRecord => {
      const value = item as Partial<CampaignImportRecord>;
      if (!Number.isInteger(value.ordinal) || typeof value.stableId !== 'string'
        || typeof value.slug !== 'string' || typeof value.savedName !== 'string'
        || typeof value.mapId !== 'string' || typeof value.title !== 'string'
        || typeof value.importedAt !== 'string') return false;
      const entry = GENERATED_CAMPAIGN_ENTRIES.find((candidate) => candidate.ordinal === value.ordinal);
      if (!entry) return false;
      const expectedBase = campaignSaveBase(entry);
      if (!value.savedName.startsWith(expectedBase)) return false;
      return value.stableId === entry.stableId && value.slug === entry.slug && value.mapId === entry.mapId;
    });
  } catch { return []; }
}

function campaignSaveBase(entry: GeneratedCampaignEntry): string {
  return `campaign-${String(entry.ordinal).padStart(2, '0')}-${entry.stableId}`.slice(0, 120);
}

function writeImports(records: CampaignImportRecord[], storage: Storage): void {
  storage.setItem(CAMPAIGN_IMPORTS_KEY, JSON.stringify(records));
}

function normalizedTitle(value: string): string {
  return value.replace(/^\d+\s*[·.:~-]\s*/, '').trim();
}

function assertTemplateIdentity(entry: GeneratedCampaignEntry, template: ScenarioTemplateV2): void {
  if (normalizedTitle(template.meta.name) !== normalizedTitle(entry.title)) {
    throw new Error(`Campaign ${entry.ordinal} identity mismatch: template title does not match manifest title`);
  }
  if (template.sourceMap && template.sourceMap.mapId !== entry.mapId) {
    throw new Error(`Campaign ${entry.ordinal} identity mismatch: template map does not match manifest map`);
  }
}

function assertEvidenceIdentity(entry: GeneratedCampaignEntry, evidence: PlaybackBundle): void {
  if (evidence.instance.input.mapId !== entry.mapId) {
    throw new Error(`Campaign ${entry.ordinal} identity mismatch: evidence map does not match manifest map`);
  }
  const manifestIds = evidence.instance.manifest.actors.map((actor) => actor.id).sort();
  const inputIds = evidence.instance.input.actors.map((actor) => actor.id).sort();
  if (JSON.stringify(manifestIds) !== JSON.stringify(inputIds)) {
    throw new Error(`Campaign ${entry.ordinal} identity mismatch: evidence actor populations differ`);
  }
}

export async function importCampaignEntry(
  entry: GeneratedCampaignEntry,
  options: { store?: TemplateFileStore; storage?: Storage } = {},
): Promise<{ template: ScenarioTemplateV2; evidence: PlaybackBundle; record: CampaignImportRecord }> {
  if (!isCampaignReady(entry)) {
    throw new Error(entry.diagnostics.join(' · ') || 'Campaign artifact is incomplete');
  }
  const loaded = await loadVerifiedCampaignEntry(entry);
  const evidence = loaded.evidence;
  const template = editableCampaignTemplate(entry, loaded.template, evidence);
  const storage = options.storage ?? globalThis.localStorage;
  const store = options.store ?? new WebTemplateFileStore({ storage });
  const existing = await store.list();
  const base = campaignSaveBase(entry);
  let savedName = base;
  if (existing.some((item) => item.name === savedName)) {
    let suffix = 2;
    while (existing.some((item) => item.name === `${base}-${suffix}`)) suffix++;
    savedName = `${base}-${suffix}`;
  }
  await store.write(savedName, template);
  const record: CampaignImportRecord = {
    ordinal: entry.ordinal,
    stableId: entry.stableId,
    slug: entry.slug,
    savedName,
    mapId: entry.mapId!,
    title: entry.title,
    importedAt: new Date().toISOString(),
  };
  const records = campaignImports(storage).filter((item) => item.ordinal !== entry.ordinal && item.stableId !== entry.stableId);
  writeImports([...records, record].sort((a, b) => a.ordinal - b.ordinal), storage);
  return { template, evidence, record };
}

export async function importAllCampaignEntries(options: {
  store?: TemplateFileStore;
  storage?: Storage;
} = {}): Promise<CampaignImportRecord[]> {
  if (GENERATED_CAMPAIGN_ENTRIES.length !== 12 || GENERATED_CAMPAIGN_ENTRIES.some((entry) => !isCampaignReady(entry))) {
    throw new Error('Import all is locked until all twelve curated scenarios and verified artifacts are complete');
  }
  // Validate every artifact before the first write, then roll back browser
  // files if persistence fails partway through. Metadata is committed last.
  const loaded = await Promise.all(GENERATED_CAMPAIGN_ENTRIES.map(async (entry) => ({
    entry,
    ...(await loadVerifiedCampaignEntry(entry)),
  })));
  return persistVerifiedCampaignEntries(loaded.map(({ entry, template, evidence }) => ({
    entry,
    template: editableCampaignTemplate(entry, template, evidence),
  })), options);
}

export async function persistVerifiedCampaignEntries(
  loaded: readonly { entry: GeneratedCampaignEntry; template: ScenarioTemplateV2 }[],
  options: { store?: TemplateFileStore; storage?: Storage } = {},
): Promise<CampaignImportRecord[]> {
  const storage = options.storage ?? globalThis.localStorage;
  const store = options.store ?? new WebTemplateFileStore({ storage });
  const files = await store.list();
  const occupied = new Set(files.map((file) => file.name));
  const plans: Array<{
    template: ScenarioTemplateV2;
    record: CampaignImportRecord;
    previous: unknown | null;
  }> = [];
  for (const { entry, template } of loaded) {
    const base = campaignSaveBase(entry);
    let savedName = base;
    if (occupied.has(savedName)) {
      let suffix = 2;
      while (occupied.has(`${base}-${suffix}`)) suffix++;
      savedName = `${base}-${suffix}`;
    }
    occupied.add(savedName);
    const previous = files.some((file) => file.name === savedName) ? await store.read(savedName) : null;
    plans.push({
      template,
      previous,
      record: {
        ordinal: entry.ordinal,
        stableId: entry.stableId,
        slug: entry.slug,
        savedName,
        mapId: entry.mapId!,
        title: entry.title,
        importedAt: new Date().toISOString(),
      },
    });
  }
  const written: typeof plans = [];
  try {
    for (const plan of plans) {
      await store.write(plan.record.savedName, plan.template);
      written.push(plan);
    }
    writeImports(plans.map((plan) => plan.record), storage);
  } catch (reason) {
    for (const plan of written.reverse()) {
      try {
        if (plan.previous === null) await store.delete(plan.record.savedName);
        else await store.write(plan.record.savedName, plan.previous as ScenarioTemplateV2);
      } catch { /* Preserve the original persistence error. */ }
    }
    throw reason;
  }
  return plans.map((plan) => plan.record);
}

export async function loadSavedCampaign(
  record: CampaignImportRecord,
  expected?: GeneratedCampaignEntry,
  options: { store?: TemplateFileStore } = {},
): Promise<{
  entry: GeneratedCampaignEntry;
  template: ScenarioTemplateV2;
}> {
  const entry = GENERATED_CAMPAIGN_ENTRIES.find((item) => item.ordinal === record.ordinal);
  if (!entry) throw new Error(`Campaign manifest ${record.ordinal} is no longer available`);
  if (expected && (entry.ordinal !== expected.ordinal || entry.stableId !== expected.stableId)) {
    throw new Error(`Saved scenario identity mismatch: expected ${expected.stableId}, got ${entry.stableId}`);
  }
  if (record.stableId !== entry.stableId || record.slug !== entry.slug || record.mapId !== entry.mapId) {
    throw new Error(`Saved scenario identity no longer matches campaign ${entry.ordinal}; open a fresh verified copy`);
  }
  if (!record.savedName.startsWith(campaignSaveBase(entry))) {
    throw new Error(`Saved scenario ${record.savedName} does not belong to campaign ${entry.ordinal}`);
  }
  const value = await (options.store ?? new WebTemplateFileStore()).read(record.savedName);
  const template = TemplateDocument.fromJSON(value).data;
  const identity = template.extensions?.['studio.presentation.campaignIdentity'] as {
    ordinal?: unknown;
    stableId?: unknown;
  } | undefined;
  if (identity?.ordinal !== entry.ordinal || identity.stableId !== entry.stableId
    || template.sourceMap?.mapId !== entry.mapId) {
    throw new Error(`Saved scenario identity no longer matches campaign ${entry.ordinal}; open a fresh verified copy`);
  }
  return { entry, template };
}
