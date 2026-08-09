import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryStorage, WebTemplateFileStore, type TemplateFileStore } from '@uniscenarios/scenario-model';
import { GENERATED_CAMPAIGN_DIAGNOSTICS, GENERATED_CAMPAIGN_ENTRIES } from './generated';
import { readPlaybackFiles } from '@uniscenarios/playback';
import {
  CAMPAIGN_IMPORTS_KEY,
  campaignImports,
  importCampaignEntry,
  isCampaignReady,
  loadSavedCampaign,
  persistVerifiedCampaignEntries,
} from './catalog';

const template = {
  scenarioVersion: 2,
  meta: {
    name: 'Campaign test', description: '', createdAt: '2026-08-02T00:00:00.000Z',
    modifiedAt: '2026-08-02T00:00:00.000Z', appVersion: 'test',
  },
  sourceMap: { mapId: 'yale-street', mapName: 'Yale Street' },
  anchor: { features: [] }, roles: [], props: [],
  choreography: { clipSeconds: 20, interactions: [] }, invariants: [], variants: [],
};

describe('edge campaign catalog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('aggregates deterministically and reports missing owners without guessing', () => {
    expect(GENERATED_CAMPAIGN_ENTRIES.map((entry) => entry.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(GENERATED_CAMPAIGN_DIAGNOSTICS).toEqual([]);
    expect(GENERATED_CAMPAIGN_ENTRIES.find((entry) => entry.ordinal === 5)?.binding)
      .toBe('pinned-behavioral-surrogate');
    expect(GENERATED_CAMPAIGN_ENTRIES.find((entry) => entry.ordinal === 9)?.binding)
      .toBe('pinned-behavioral-surrogate');
  });

  it('fails closed when required evidence is incomplete', () => {
    const three = GENERATED_CAMPAIGN_ENTRIES.find((entry) => entry.ordinal === 3)!;
    expect(isCampaignReady({ ...three, diagnostics: ['template is incomplete'] })).toBe(false);
    expect(GENERATED_CAMPAIGN_DIAGNOSTICS).toEqual([]);
  });

  it('uses a collision-safe browser name and records reopen metadata', async () => {
    const storage = new MemoryStorage();
    const store = new WebTemplateFileStore({ storage });
    const entry = GENERATED_CAMPAIGN_ENTRIES.find((item) => item.ordinal === 9)!;
    const root = new URL('../../../../examples/edge-cases/09-stalled-vehicle-beyond-sight/', import.meta.url);
    const canonicalTemplate = readFileSync(new URL('scenario.template.json', root));
    const instance = readFileSync(new URL('scenario.instance.json', root));
    const trace = readFileSync(new URL('scenario.trace.json.gz', root));
    const base = `campaign-09-${entry.stableId}`;
    await store.write(base, template as never);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('trace')) return new Response(trace, { status: 200 });
      if (url.includes('instance')) return new Response(instance, { status: 200 });
      return new Response(canonicalTemplate, { status: 200 });
    }));
    const imported = await importCampaignEntry(entry, { store, storage: storage as never });
    expect(imported.record.savedName).toBe(`${base}-2`);
    expect(imported.record).toMatchObject({
      ordinal: 9, stableId: entry.stableId, slug: entry.slug,
      title: entry.title, mapId: 'el-camino-road',
    });
    expect(imported.template.sourceMap?.mapId).toBe('el-camino-road');
    expect(imported.template.roles).toHaveLength(5);
    expect(imported.template.roles.every((role) => role.kind === 'scene_absolute')).toBe(true);
    expect(imported.template.roles.map((role) => role.id).sort())
      .toEqual(imported.evidence.actors.map((actor) => actor.id).sort());
    expect(imported.template.choreography.interactions.length).toBeGreaterThan(0);
    expect(campaignImports(storage as never)).toEqual([imported.record]);
    const persisted = await store.read(imported.record.savedName) as typeof imported.template;
    expect(persisted.scenarioVersion).toBe(2);
    expect(persisted.roles).toHaveLength(5);
    const second = await importCampaignEntry(entry, { store, storage: storage as never });
    expect(second.record.savedName).toBe(`${base}-3`);
    expect((await store.list()).map((file) => file.name)).toEqual([base, `${base}-2`, `${base}-3`]);
    expect(campaignImports(storage as never)).toEqual([second.record]);
  });

  it('drops stale cross-card save mappings instead of reopening the wrong scenario', () => {
    const storage = new MemoryStorage();
    storage.setItem(CAMPAIGN_IMPORTS_KEY, JSON.stringify([{
      ordinal: 2,
      stableId: 'edge-05-ambulance-gridlock-v1',
      slug: '05-ambulance-gridlocked-intersection',
      savedName: 'campaign-05-05-ambulance-gridlocked-intersection',
      mapId: 'yale-street',
      title: 'Bus-Occluded Child at a Signalized Crossing',
      importedAt: '2026-08-02T00:00:00.000Z',
    }]));
    expect(campaignImports(storage as never)).toEqual([]);
  });

  it('fails Reopen saved closed when the card record or stored title has shifted', async () => {
    const storage = new MemoryStorage();
    const store = new WebTemplateFileStore({ storage });
    const entry = GENERATED_CAMPAIGN_ENTRIES.find((item) => item.ordinal === 5)!;
    const savedName = `campaign-05-${entry.stableId}`;
    const { sourceMap: _sourceMap, ...portableTemplate } = template;
    await store.write(savedName, { ...portableTemplate, meta: { ...template.meta, name: 'Different scenario' } } as never);
    const record = {
      ordinal: 5, stableId: entry.stableId, slug: entry.slug, savedName,
      mapId: entry.mapId!, title: entry.title, importedAt: '2026-08-02T00:00:00.000Z',
    };
    await expect(loadSavedCampaign(record, entry, { store })).rejects.toThrow(/identity/);
    await expect(loadSavedCampaign({ ...record, stableId: 'edge-09-double-turn-mobility-scooter-v1' }, entry, { store }))
      .rejects.toThrow(/identity/);
  });

  it('rolls back every file and commits no metadata when Import All persistence fails', async () => {
    const storage = new MemoryStorage();
    const backing = new WebTemplateFileStore({ storage });
    let writes = 0;
    const failing: TemplateFileStore = {
      list: () => backing.list(),
      read: (name) => backing.read(name),
      delete: (name) => backing.delete(name),
      write: async (name, doc) => {
        writes++;
        if (writes === 2) throw new Error('simulated quota failure');
        await backing.write(name, doc);
      },
    };
    const entries = [1, 2].map((ordinal) => GENERATED_CAMPAIGN_ENTRIES.find((item) => item.ordinal === ordinal)!);
    const templates = entries.map((entry) => ({
      entry,
      template: { ...template, meta: { ...template.meta, name: entry.title }, sourceMap: null } as never,
    }));
    await expect(persistVerifiedCampaignEntries(templates, { store: failing, storage: storage as never }))
      .rejects.toThrow('simulated quota failure');
    expect(await backing.list()).toEqual([]);
    expect(campaignImports(storage as never)).toEqual([]);
  });

  it.each([3, 10])('loads exact scenario %i evidence without weakening identity checks', async (ordinal) => {
    const root = new URL('../../../../examples/edge-cases/', import.meta.url);
    const folder = ordinal === 3
      ? '03-red-light-ambulance-preemption'
      : '10-officer-flashing-red-junction';
    const input = readFileSync(new URL(`${folder}/scenario.instance.json`, root));
    const trace = readFileSync(new URL(`${folder}/scenario.trace.json.gz`, root));
    const pair = await readPlaybackFiles(
      { name: `${folder}.instance.json`, arrayBuffer: async () => input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) },
      { name: `${folder}.trace.json.gz`, arrayBuffer: async () => trace.buffer.slice(trace.byteOffset, trace.byteOffset + trace.byteLength) },
    );
    expect(pair.startTime).toBe(0);
    expect(pair.endTime).toBe(20);
    expect(pair.trace.ticks.t).toHaveLength(1001);

    const raw = Buffer.from(JSON.stringify(JSON.parse(input.toString('utf8')).input));
    await expect(readPlaybackFiles(
      { name: `${folder}.raw-input.json`, arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) },
      { name: `${folder}.trace.json.gz`, arrayBuffer: async () => trace.buffer.slice(trace.byteOffset, trace.byteOffset + trace.byteLength) },
    )).rejects.toThrow(/kind must be "scenario-instance"/);
  });
});
