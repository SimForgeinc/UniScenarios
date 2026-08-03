import { describe, expect, it } from 'vitest';
import { ScenarioNotFoundError, type TemplateFileStore } from '@uniscenarios/scenario-model';
import { EditorDocument } from '../editor/document';
import { LaneIndex } from '../editor/laneIndex';
import { routesFromTemplate } from '../editor/routeOverlay';
import { MAPS } from '../maps';
import { buildTimelineGroups } from './model';
import { submitTimelineAction, type TimelineActionDraft } from './TimelineDock';

function memoryStore(): { store: TemplateFileStore; files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    store: {
      list: async () => [],
      read: async (name) => {
        if (!files.has(name)) throw new ScenarioNotFoundError(name);
        return structuredClone(files.get(name));
      },
      write: async (name, value) => {
        const serializable = value as { toJSON?: () => unknown };
        files.set(name, structuredClone(serializable.toJSON?.() ?? value));
      },
      delete: async (name) => files.delete(name),
    },
  };
}

async function boxTruck(store: TemplateFileStore): Promise<{ document: EditorDocument; actorId: string }> {
  const document = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 60_000 });
  const [actorId] = document.add([{
    id: 'box-truck', catalogId: 'vehicle.box_truck', x: 0, y: 0, z: 0, headingRad: 0,
    routeLaneRsls: ['5:0:-3', '6:0:-3'], initialSpeedKph: 48.28032,
  }]);
  return { document, actorId: actorId! };
}

function draft(actorId: string, definitionId: string, time = 2): TimelineActionDraft {
  return { actorId, definitionId, time, duration: definitionId === 'turn_left' ? 2 : 1, targetSpeed: 30, editingId: null };
}

function laneIndex(): LaneIndex {
  return LaneIndex.build({
    mapName: 'timeline-submit',
    lanes: {
      '5:0:-3': { roadId: 5, section: 0, laneId: -3, laneType: 'driving', successors: ['6:0:-3', '7:0:-3'], polyline: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      '6:0:-3': { roadId: 6, section: 0, laneId: -3, laneType: 'driving', predecessors: ['5:0:-3'], polyline: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
      '7:0:-3': { roadId: 7, section: 0, laneId: -3, laneType: 'driving', predecessors: ['5:0:-3'], polyline: [{ x: 10, y: 0 }, { x: 10, y: 10 }] },
    },
  });
}

describe('timeline action dialog submission', () => {
  it('adds Accelerate as one undoable action and publishes the preview revision synchronously', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const before = document.revision;
    const notified: number[] = [];
    document.subscribe(() => notified.push(document.revision));

    const result = submitTimelineAction(document, draft(actorId, 'accelerate'));

    expect(result.ok).toBe(true);
    expect(document.revision).toBe(before + 1);
    expect(notified).toEqual([before + 1]);
    expect(document.data.choreography.interactions).toMatchObject([
      { actor: actorId, label: 'Accelerate', verb: 'speed', target: { mode: 'delta', deltaKph: 10 } },
    ]);
    expect(buildTimelineGroups(document.data)[0]!.lanes[0]!.items).toHaveLength(1);
    expect(routesFromTemplate(document.data, laneIndex())[0]!.markers.some((marker) => marker.kind === 'speed-change')).toBe(true);
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions).toHaveLength(0);
    document.dispose();
  });

  it('adds Turn left in a parallel lane and exposes its route marker in the same cycle', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    expect(submitTimelineAction(document, draft(actorId, 'accelerate')).ok).toBe(true);
    const before = document.revision;

    const result = submitTimelineAction(
      document,
      draft(actorId, 'turn_left'),
      (_id, turn) => turn === 'left' ? ['5:0:-3', '7:0:-3'] : null,
    );

    expect(result.ok).toBe(true);
    expect(document.revision).toBe(before + 1);
    const group = buildTimelineGroups(document.data)[0]!;
    expect(document.data.choreography.interactions.at(-1)).toMatchObject({
      verb: 'route',
      target: { mode: 'lanePath', lanes: ['5:0:-3', '7:0:-3'] },
    });
    expect(group.lanes).toHaveLength(2);
    expect(group.lanes.map((lane) => lane.items[0]!.interaction.label).sort()).toEqual(['Accelerate', 'Turn left']);
    expect(routesFromTemplate(document.data, laneIndex())[0]!.markers.some((marker) => marker.kind === 'turn-left')).toBe(true);
    document.dispose();
  });

  it('rejects conflicting longitudinal actions with a visible-ready error instead of a no-op', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    expect(submitTimelineAction(document, draft(actorId, 'accelerate')).ok).toBe(true);
    const before = document.revision;

    const result = submitTimelineAction(document, draft(actorId, 'decelerate'));

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain('overlaps “Accelerate”');
    expect(document.revision).toBe(before);
    expect(document.data.choreography.interactions).toHaveLength(1);
    document.dispose();
  });

  it('survives undo/redo, autosave, and reload without changing action semantics', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    expect(submitTimelineAction(document, draft(actorId, 'accelerate', 3.5)).ok).toBe(true);
    const authored = structuredClone(document.data.choreography.interactions[0]);
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions).toHaveLength(0);
    expect(document.redo()).toBe(true);
    await document.flush();
    document.dispose();

    const reopened = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 60_000 });
    expect(reopened.data.choreography.interactions).toEqual([authored]);
    expect(buildTimelineGroups(reopened.data)[0]!.lanes[0]!.items[0]).toMatchObject({ anchorTime: 3.5 });
    reopened.dispose();
  });

  it('returns explicit validation feedback for stale or invalid drafts', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    expect(submitTimelineAction(document, { ...draft(actorId, 'accelerate'), duration: Number.NaN })).toEqual({
      ok: false, message: 'Duration must be between 0.1 and 20 seconds.',
    });
    expect(submitTimelineAction(document, draft('deleted-actor', 'accelerate'))).toMatchObject({
      ok: false, message: expect.stringContaining('no longer exists'),
    });
    document.dispose();
  });
});
