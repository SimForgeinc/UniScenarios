import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MemoryStorage, TemplateDocument, WebTemplateFileStore } from '@uniscenarios/scenario-model';
import { editableCampaignTemplate, loadSavedCampaign } from '../../campaign';
import { GENERATED_CAMPAIGN_ENTRIES } from '../../campaign/generated';
import { readPlaybackFiles } from '@uniscenarios/playback';
import { MAPS } from '../../maps';
import { EditorDocument, autosaveName } from '../document';

describe('editable campaign save lifecycle', () => {
  it('mirrors edits to both the map autosave and the named Reopen saved slot', async () => {
    const entry = GENERATED_CAMPAIGN_ENTRIES.find((candidate) => candidate.ordinal === 9)!;
    const root = path.resolve(process.cwd(), '../..', 'examples/edge-cases/09-stalled-vehicle-beyond-sight');
    const template = TemplateDocument.fromJSON(JSON.parse(await readFile(path.join(root, 'scenario.template.json'), 'utf8'))).data;
    const instance = await readFile(path.join(root, 'scenario.instance.json'));
    const trace = await readFile(path.join(root, 'scenario.trace.json.gz'));
    const evidence = await readPlaybackFiles(
      { name: 'instance.json', arrayBuffer: async () => instance.buffer.slice(instance.byteOffset, instance.byteOffset + instance.byteLength) },
      { name: 'trace.json.gz', arrayBuffer: async () => trace.buffer.slice(trace.byteOffset, trace.byteOffset + trace.byteLength) },
    );
    const editable = editableCampaignTemplate(entry, template, evidence);
    const map = MAPS.find((candidate) => candidate.id === entry.mapId)!;
    const storage = new MemoryStorage();
    const store = new WebTemplateFileStore({ storage });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const savedName = `campaign-09-${entry.stableId}`;
    document.importTemplate(editable, { saveName: savedName });
    document.rename('Scenario 09 edited in Studio');
    await document.flush();

    const named = TemplateDocument.fromJSON(await store.read(savedName));
    const autosave = TemplateDocument.fromJSON(await store.read(autosaveName(map.id)));
    expect(named.data.meta.name).toBe('Scenario 09 edited in Studio');
    expect(named.data.roles).toHaveLength(5);
    expect(named.data.choreography.clipSeconds).toBe(editable.choreography.clipSeconds);
    expect(named.data.choreography.interactions.map((interaction) => interaction.id))
      .toEqual(editable.choreography.interactions.map((interaction) => interaction.id));
    expect(autosave.data).toEqual(named.data);
    const reopened = await loadSavedCampaign({
      ordinal: entry.ordinal,
      stableId: entry.stableId,
      slug: entry.slug,
      savedName,
      mapId: entry.mapId!,
      title: entry.title,
      importedAt: '2026-08-02T00:00:00.000Z',
    }, entry, { store });
    expect(reopened.template.meta.name).toBe('Scenario 09 edited in Studio');
    document.dispose();
  });
});
