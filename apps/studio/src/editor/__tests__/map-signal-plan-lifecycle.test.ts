import { describe, expect, it } from 'vitest';
import {
  MemoryStorage,
  TemplateDocument,
  WebTemplateFileStore,
  type MapSignalPlan,
} from '@uniscenarios/scenario-model';

import { MAPS } from '../../maps';
import { EditorDocument, autosaveName } from '../document';

describe('map signal plan editor lifecycle', () => {
  it('groups each plan edit for undo and persists the controller binding on reload', async () => {
    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const plan: MapSignalPlan = {
      id: 'signals-junction-447',
      version: 1,
      binding: { mapId: map.id, junctionId: '447', controlDigest: 'controls-v1' },
      clips: [{
        id: 'phase-1', startS: 2, endS: 5,
        reference: { controllerId: 'controller-1', headId: 'head-1' },
        indication: 'green',
      }],
    };

    document.addMapSignalPlan(plan);
    document.replaceMapSignalPlan(plan.id, {
      ...plan,
      clips: [{ ...plan.clips[0]!, indication: 'yellow' }],
    });
    expect(document.data.mapSignalPlans[0]?.clips[0]?.indication).toBe('yellow');
    expect(document.undo()).toBe(true);
    expect(document.data.mapSignalPlans[0]?.clips[0]?.indication).toBe('green');
    expect(document.redo()).toBe(true);

    await document.flush();
    const persisted = TemplateDocument.fromJSON(await store.read(autosaveName(map.id)));
    expect(persisted.data.mapSignalPlans).toEqual(document.data.mapSignalPlans);
    document.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(reopened.data.mapSignalPlans).toEqual([{
      ...plan,
      clips: [{ ...plan.clips[0]!, indication: 'yellow' }],
    }]);
    reopened.dispose();
  });
});
