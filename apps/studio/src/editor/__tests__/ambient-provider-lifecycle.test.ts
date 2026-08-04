import { describe, expect, it } from 'vitest';
import { MemoryStorage, TemplateDocument, WebTemplateFileStore } from '@uniscenarios/scenario-model';

import {
  AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY,
  ambientTrafficProviderFromExtensions,
} from '../../ambient/provider';
import { simulationSourceHash } from '../../campaign/recovery';
import { MAPS } from '../../maps';
import { EditorDocument, autosaveName } from '../document';

describe('ambient traffic engine scenario lifecycle', () => {
  it('keeps the legacy default, and makes an explicit Off choice digest-bearing, undoable, and serializable', async () => {
    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const originalHash = simulationSourceHash(document.data);

    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('sumo');
    document.setAmbientTrafficExtension(AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY, 'off');
    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('off');
    expect(simulationSourceHash(document.data)).not.toBe(originalHash);

    expect(document.undo()).toBe(true);
    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('sumo');
    expect(simulationSourceHash(document.data)).toBe(originalHash);
    expect(document.redo()).toBe(true);
    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('off');

    await document.flush();
    const persisted = TemplateDocument.fromJSON(await store.read(autosaveName(map.id)));
    expect(ambientTrafficProviderFromExtensions(persisted.data.extensions)).toBe('off');
    document.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(ambientTrafficProviderFromExtensions(reopened.data.extensions)).toBe('off');
    reopened.dispose();
  });
});
