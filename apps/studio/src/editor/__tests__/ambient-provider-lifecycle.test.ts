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
  it('fails missing provider choice closed, and makes changes digest-bearing, undoable, and serializable', async () => {
    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const originalHash = simulationSourceHash(document.data);

    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('off');
    document.setAmbientTrafficExtension(AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY, 'native');
    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('native');
    expect(simulationSourceHash(document.data)).not.toBe(originalHash);

    expect(document.undo()).toBe(true);
    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('off');
    expect(simulationSourceHash(document.data)).toBe(originalHash);
    expect(document.redo()).toBe(true);
    expect(ambientTrafficProviderFromExtensions(document.data.extensions)).toBe('native');

    await document.flush();
    const persisted = TemplateDocument.fromJSON(await store.read(autosaveName(map.id)));
    expect(ambientTrafficProviderFromExtensions(persisted.data.extensions)).toBe('native');
    document.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(ambientTrafficProviderFromExtensions(reopened.data.extensions)).toBe('native');
    reopened.dispose();
  });
});
