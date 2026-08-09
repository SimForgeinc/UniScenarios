import { describe, expect, it } from 'vitest';
import {
  MemoryStorage,
  AuthoredActorLimitError,
  AUTHORED_ACTOR_LIMIT_CODE,
  MAX_AUTHORED_ACTORS,
  TemplateDocument,
  WebTemplateFileStore,
  defaultDashCamera,
  type ScenarioTemplateV2,
  type TemplateFileStore,
} from '@uniscenarios/scenario-model';
import { MAPS } from '../../maps';
import { EditorDocument, autosaveName, blankAutosaveName } from '../document';

const map = MAPS[0]!;
const galleryName = 'gallery-saved-scenario';

async function populatedTemplate(store: TemplateFileStore): Promise<ScenarioTemplateV2> {
  const document = await EditorDocument.open(map, { store, autosaveMs: 60_000 });
  document.rename('Saved intersection scenario');
  const [actorId] = document.add([{
    id: 'saved_vehicle',
    catalogId: 'vehicle.sedan',
    x: 1,
    y: 0,
    z: 2,
    headingRad: 0,
    initialSpeedKph: 30,
  }]);
  const role = document.data.roles.find((item) => item.id === actorId)!;
  document.addActorSensor(actorId!, defaultDashCamera(role.actor, 'saved_dash_camera'));
  await document.flush();
  const template = structuredClone(document.data);
  await store.write(galleryName, template);
  document.dispose();
  return template;
}

function expectCompletelyBlank(template: ScenarioTemplateV2): void {
  expect(template.meta.name).toBe('Untitled scenario');
  expect(template.roles).toEqual([]);
  expect(template.props).toEqual([]);
  expect(template.choreography.interactions).toEqual([]);
  expect(template.invariants).toEqual([]);
  expect(template.variants).toEqual([]);
  expect(template.extensions ?? {}).toEqual({});
  expect(template.choreography.warmupSeconds).toBe(0);
}

describe('fresh page-load authoring document', () => {
  it('rejects a multi-actor placement atomically when it would exceed 32 actors', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });
    const actor = (index: number) => ({
      id: `actor-${index}`,
      catalogId: 'vehicle.sedan' as const,
      x: index,
      y: 0,
      z: 0,
      headingRad: 0,
    });
    document.add(Array.from({ length: MAX_AUTHORED_ACTORS - 1 }, (_, index) => actor(index)));

    expect(() => document.add([actor(31), actor(32)])).toThrow(AuthoredActorLimitError);
    expect(document.actors).toHaveLength(MAX_AUTHORED_ACTORS - 1);
    expect(document.data.roles.some((role) => role.id === 'actor-31')).toBe(false);
    document.dispose();
  });

  it('imports legacy over-limit scenarios read-only while delete and undo remain available', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const source = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });
    source.add(Array.from({ length: MAX_AUTHORED_ACTORS }, (_, index) => ({
      id: `legacy-${index}`,
      catalogId: 'vehicle.sedan' as const,
      x: index,
      y: 0,
      z: 0,
      headingRad: 0,
    })));
    const extra = structuredClone(source.data.roles[0]!);
    extra.id = 'legacy-32';
    const legacy = { ...structuredClone(source.data), roles: [...source.data.roles, extra] };
    const document = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });

    document.importTemplate(legacy);
    expect(document.actors).toHaveLength(MAX_AUTHORED_ACTORS + 1);
    expect(document.validation.issues.some((issue) => issue.code === AUTHORED_ACTOR_LIMIT_CODE)).toBe(true);
    expect(() => document.rename('Blocked')).toThrow(AuthoredActorLimitError);

    document.remove(['legacy-32']);
    expect(document.actors).toHaveLength(MAX_AUTHORED_ACTORS);
    expect(document.undo()).toBe(true);
    expect(document.actors).toHaveLength(MAX_AUTHORED_ACTORS + 1);
    expect(document.redo()).toBe(true);
    expect(document.actors).toHaveLength(MAX_AUTHORED_ACTORS);
    source.dispose();
    document.dispose();
  });

  it('starts untitled and completely blank instead of restoring the map autosave', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    await populatedTemplate(store);

    const fresh = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });

    expect(fresh.actors).toEqual([]);
    expectCompletelyBlank(fresh.data);
    fresh.dispose();
  });

  it('keeps a named Gallery scenario available for explicit reopening', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const saved = await populatedTemplate(store);
    const fresh = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });

    fresh.importTemplate(await store.read(galleryName), { saveName: galleryName });

    expect(fresh.data).toEqual(saved);
    expect(fresh.actors.map((actor) => actor.id)).toEqual(['saved_vehicle']);
    expect(fresh.actors[0]!.sensors).toHaveLength(1);
    // Initial driving routes are actor state, not synthetic timeline actions.
    expect(fresh.data.choreography.interactions).toHaveLength(0);
    await fresh.flush();
    expect(TemplateDocument.fromJSON(await store.read(galleryName)).data).toEqual(saved);
    fresh.dispose();
  });

  it('normalizes imported warmup into the editor visible timeline', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const source = TemplateDocument.create({ name: 'Research scenario' });
    source.setClip(20, 7);
    const fresh = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });

    fresh.importTemplate(source.data);

    expect(fresh.data.choreography.warmupSeconds).toBe(0);
    fresh.dispose();
  });

  it('isolates blank-session autosave and ignores that draft on the next page load', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const priorAutosave = await populatedTemplate(store);
    const fresh = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });
    fresh.add([{ id: 'new_draft_actor', catalogId: 'vehicle.suv', x: 3, y: 0, z: 4, headingRad: 0 }]);
    await fresh.flush();
    fresh.dispose();

    expect(TemplateDocument.fromJSON(await store.read(autosaveName(map.id))).data).toEqual(priorAutosave);
    expect(TemplateDocument.fromJSON(await store.read(blankAutosaveName(map.id))).data.roles.map((role) => role.id)).toEqual(['new_draft_actor']);

    const refreshed = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });
    expectCompletelyBlank(refreshed.data);
    refreshed.dispose();
  });

  it('does not delete existing autosaves or named Gallery files', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    await populatedTemplate(store);
    const namesBefore = (await store.list()).map((entry) => entry.name).sort();
    const fresh = await EditorDocument.openBlank(map, { store, autosaveMs: 60_000 });
    await fresh.flush();
    fresh.dispose();
    const namesAfter = (await store.list()).map((entry) => entry.name).sort();

    expect(namesBefore).toEqual([autosaveName(map.id), galleryName].sort());
    expect(namesAfter).toEqual([...namesBefore, blankAutosaveName(map.id)].sort());
  });
});
