import { describe, expect, it } from 'vitest';
import { MemoryStorage, TemplateDocument, WebTemplateFileStore } from '@uniscenarios/scenario-model';
import { contentHash } from '@uniscenarios/sim-engine';

import { ACCELERATED_SIGNAL_CYCLES_EXTENSION_KEY, ambientSignalCycleSettingsFromExtensions } from '../../ambient/model';
import { simulationSourceHash } from '../../campaign/recovery';
import { MAPS } from '../../maps';
import { EditorDocument, autosaveName } from '../document';

describe('accelerated signal cycle scenario lifecycle', () => {
  it('is default-off, execution-digest-bearing, undoable, serializable, and legacy-safe', async () => {
    const map = MAPS.find((entry) => entry.id.includes('yale')) ?? MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const originalHash = simulationSourceHash(document.data);
    expect(ambientSignalCycleSettingsFromExtensions(document.data.extensions).acceleratedSignalCycles).toBe(false);

    document.setAmbientTrafficExtension(ACCELERATED_SIGNAL_CYCLES_EXTENSION_KEY, true);
    expect(ambientSignalCycleSettingsFromExtensions(document.data.extensions).acceleratedSignalCycles).toBe(true);
    expect(simulationSourceHash(document.data)).not.toBe(originalHash);
    const enabledHash = contentHash(document.data.extensions);

    expect(document.undo()).toBe(true);
    expect(ambientSignalCycleSettingsFromExtensions(document.data.extensions).acceleratedSignalCycles).toBe(false);
    expect(simulationSourceHash(document.data)).toBe(originalHash);
    expect(document.redo()).toBe(true);
    expect(contentHash(document.data.extensions)).toBe(enabledHash);

    await document.flush();
    const persisted = TemplateDocument.fromJSON(await store.read(autosaveName(map.id)));
    expect(ambientSignalCycleSettingsFromExtensions(persisted.data.extensions).acceleratedSignalCycles).toBe(true);
    document.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(ambientSignalCycleSettingsFromExtensions(reopened.data.extensions).acceleratedSignalCycles).toBe(true);
    reopened.setAmbientTrafficExtension(ACCELERATED_SIGNAL_CYCLES_EXTENSION_KEY, undefined);
    expect(ambientSignalCycleSettingsFromExtensions(reopened.data.extensions).acceleratedSignalCycles).toBe(false);
    reopened.dispose();
  });
});
