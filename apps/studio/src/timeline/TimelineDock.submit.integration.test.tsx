import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScenarioNotFoundError, type Interaction, type TemplateFileStore, type Trigger } from '@uniscenarios/scenario-model';
import { EditorDocument } from '../editor/document';
import { LaneIndex } from '../editor/laneIndex';
import { routesFromTemplate } from '../editor/routeOverlay';
import { MAPS } from '../maps';
import { buildTimelineGroups, interactionWithTimelineRange, TIMELINE_LAYOUT_EXTENSION_KEY, timelineLayoutExtension } from './model';
import { ActionEditor, actionEditorStateForItem, submitTimelineAction, type TimelineActionDraft } from './TimelineDock';

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
  return { actorId, definitionId, time, duration: definitionId === 'turn_left' ? 2 : 1, targetSpeed: 30, maneuverDuration: 3, maneuverStyle: 'normal', editingId: null };
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
  it('authors distance and TTC triggers against another authored actor and rejects stale/self targets', async () => {
    const { store } = memoryStore();
    const document = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 60_000 });
    const [pedestrianId] = document.add([{ id: 'walker', catalogId: 'pedestrian.adult_walking', x: 0, y: 0, z: 0, headingRad: 0 }]);
    const [vehicleId] = document.add([{ id: 'car', catalogId: 'vehicle.sedan', x: 15, y: 0, z: 0, headingRad: Math.PI, routeLaneRsls: ['5:0:-3', '6:0:-3'], initialSpeedKph: 30 }]);
    const distance = submitTimelineAction(document, { ...draft(pedestrianId!, 'walk'), triggerMode: 'distance', triggerActorId: vehicleId, triggerThreshold: 9.5, triggerDeadline: 12, triggerIfNever: 'skip' });
    expect(distance.ok).toBe(true);
    expect(document.data.choreography.interactions[0]!.trigger).toEqual({ kind: 'when', condition: { kind: 'distance', from: vehicleId, to: { role: pedestrianId }, measure: 'euclidean', op: '<=', valueM: 9.5 }, byLatest: 12, ifNever: 'skip' });
    expect(submitTimelineAction(document, { ...draft(pedestrianId!, 'walk'), triggerMode: 'ttc', triggerActorId: pedestrianId, triggerThreshold: 2, triggerDeadline: 10, triggerIfNever: 'skip' })).toEqual({ ok: false, message: 'An actor cannot trigger itself.' });
    expect(submitTimelineAction(document, { ...draft(pedestrianId!, 'walk'), triggerMode: 'ttc', triggerActorId: 'deleted-car', triggerThreshold: 2, triggerDeadline: 10, triggerIfNever: 'skip' })).toEqual({ ok: false, message: 'The trigger actor no longer exists. Choose another authored actor.' });
    document.dispose();
  });

  it('persists near-miss intent as a typed route goal rather than baked scene points', async () => {
    const { store } = memoryStore();
    const document = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 60_000 });
    const [pedestrianId] = document.add([{ id: 'walker', catalogId: 'pedestrian.adult_walking', x: 0, y: 0, z: 0, headingRad: 0 }]);
    const [vehicleId] = document.add([{ id: 'car', catalogId: 'vehicle.sedan', x: 15, y: 0, z: 0, headingRad: Math.PI, routeLaneRsls: ['5:0:-3', '6:0:-3'], initialSpeedKph: 30 }]);
    const result = submitTimelineAction(document, { ...draft(pedestrianId!, 'walk'), desiredOutcome: 'nearMiss', triggerMode: 'distance', triggerActorId: vehicleId, triggerThreshold: 10, triggerDeadline: 12, triggerIfNever: 'skip', nearMissClearanceM: .7, nearMissPass: 'front', nearMissMinSpeedMps: .8, nearMissMaxSpeedMps: 2.4 });
    expect(result.ok).toBe(true);
    expect(document.data.choreography.interactions[0]).toMatchObject({ actor: pedestrianId, verb: 'route', trigger: { kind: 'when', condition: { kind: 'distance', from: vehicleId, to: { role: pedestrianId }, valueM: 10 } }, target: { mode: 'nearMiss', target: vehicleId, clearanceM: .7, pass: 'front', minSpeedKph: 2.88, maxSpeedKph: 8.64, deadlineS: 12 } });
    expect(document.data.invariants).toContainEqual({ id: 'near_miss_near_miss_walker_1', kind: 'near_miss', pedestrian: pedestrianId, target: vehicleId, clearanceRangeM: [.65, .75], essentiality: 'required' });
    expect(JSON.stringify(document.data.choreography.interactions[0])).not.toContain('points');
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions).toHaveLength(0);
    expect(document.data.invariants).toHaveLength(0);
    document.dispose();
  });
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
      (_id, turn) => turn === 'Left' ? ['5:0:-3', '7:0:-3'] : null,
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

  it('keeps conflicting resources as stacked diagnostics instead of blocking authoring', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    expect(submitTimelineAction(document, draft(actorId, 'accelerate')).ok).toBe(true);
    const before = document.revision;

    const result = submitTimelineAction(document, draft(actorId, 'decelerate'));

    expect(result).toMatchObject({ ok: true, warning: expect.stringContaining('overlaps “Accelerate”') });
    expect(document.revision).toBe(before + 1);
    expect(document.data.choreography.interactions).toHaveLength(2);
    expect(buildTimelineGroups(document.data)[0]!.lanes).toHaveLength(2);
    document.dispose();
  });

  it('commits retime and vertical placement as one undoable document gesture', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const added = submitTimelineAction(document, draft(actorId, 'accelerate'));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const original = structuredClone(added.interaction);
    const before = document.revision;
    document.replaceInteractionWithPresentation(
      original.id,
      interactionWithTimelineRange(original, { start: 6, end: 9 }),
      TIMELINE_LAYOUT_EXTENSION_KEY,
      timelineLayoutExtension({ [original.id]: 3 }),
    );
    expect(document.revision).toBe(before + 1);
    expect(document.data.choreography.interactions[0]).toMatchObject({ trigger: { kind: 'at', t: 6 }, until: { kind: 'at', t: 9 } });
    expect(document.data.extensions?.[TIMELINE_LAYOUT_EXTENSION_KEY]).toEqual({ version: 1, lanes: { [original.id]: 3 } });
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions[0]).toEqual(original);
    expect(document.data.extensions?.[TIMELINE_LAYOUT_EXTENSION_KEY]).toBeUndefined();
    expect(document.redo()).toBe(true);
    expect(document.data.choreography.interactions[0]).toMatchObject({ trigger: { t: 6 }, until: { t: 9 } });
    document.dispose();
  });

  it('stores a lane-change maneuver independently from its eligibility window', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const result = submitTimelineAction(document, {
      ...draft(actorId, 'lane_left'), duration: 8, maneuverDuration: 6, maneuverStyle: 'assertive',
    });
    expect(result.ok).toBe(true);
    expect(document.data.choreography.interactions[0]).toMatchObject({
      trigger: { kind: 'at', t: 2 }, until: { kind: 'at', t: 10 },
      dynamics: { shape: 'sinusoidal', constraint: 'time', value: 6 },
      maneuverDurationS: 6,
      maneuverStyle: 'assertive',
    });
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

  it('accepts, persists, undoes, and reloads a timeline-generated millisecond timestamp exactly', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const result = submitTimelineAction(document, { ...draft(actorId, 'indicator_hazard', 1.735), duration: .3650000000000001 });
    expect(result.ok).toBe(true);
    expect(document.data.choreography.interactions[0]).toMatchObject({
      trigger: { kind: 'at', t: 1.735 }, until: { kind: 'at', t: 2.1 },
    });
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions).toHaveLength(0);
    expect(document.redo()).toBe(true);
    await document.flush();
    const serialized = structuredClone(document.data.choreography.interactions[0]);
    document.dispose();

    const reopened = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 60_000 });
    expect(reopened.data.choreography.interactions[0]).toEqual(serialized);
    expect(actionEditorStateForItem(buildTimelineGroups(reopened.data)[0]!.lanes[0]!.items[0]!, buildTimelineGroups(reopened.data)[0]!)).toMatchObject({
      time: 1.735, duration: .365,
    });
    reopened.dispose();
  });

  it('declares millisecond precision for every draggable clip timing input', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    expect(submitTimelineAction(document, { ...draft(actorId, 'indicator_hazard', 1.735), duration: .365 }).ok).toBe(true);
    const group = buildTimelineGroups(document.data)[0]!;
    const state = actionEditorStateForItem(group.lanes[0]!.items[0]!, group)!;
    const markup = renderToStaticMarkup(<ActionEditor state={state} group={group} readOnly={false} rightInset={16} onChange={() => undefined} onSave={() => undefined} onClose={() => undefined} />);
    expect(markup.match(/<input[^>]*data-testid="interaction-time"[^>]*>/)?.[0]).toContain('step="0.001"');
    expect(markup.match(/<input[^>]*data-testid="interaction-window-duration"[^>]*>/)?.[0]).toContain('step="0.001"');
    document.dispose();
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

  const conditionalTriggers = [
    ['after', (actorId: string): Trigger => ({ kind: 'after', of: 'prior-action', event: 'end', delayS: 1.25 })],
    ['when', (actorId: string): Trigger => ({ kind: 'when', condition: { kind: 'speed', of: actorId, op: '<=', valueKph: 12 }, byLatest: 9.5, ifNever: 'fire' })],
    ['arrival', (actorId: string): Trigger => ({ kind: 'arrival', of: actorId, at: { role: actorId }, syncWith: actorId, deltaT: .4 })],
  ] as const;

  it.each(conditionalTriggers)('click → Update preserves a %s trigger byte-for-byte in one undoable edit', async (_kind, triggerFor) => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const original: Interaction = {
      id: 'conditional-action', actor: actorId, label: 'Set target speed', trigger: triggerFor(actorId),
      verb: 'speed', target: { mode: 'absolute', valueKph: 42 }, dynamics: { shape: 'cubic', constraint: 'rate', value: 2.75 },
    };
    document.addInteraction(original);
    const item = buildTimelineGroups(document.data)[0]!.lanes[0]!.items[0]!;
    const editor = actionEditorStateForItem(item, buildTimelineGroups(document.data)[0]!);
    expect(editor).toMatchObject({ editingId: original.id, definitionId: 'target_speed', targetSpeed: 42, timingEditable: false });
    const before = document.revision;

    const result = submitTimelineAction(document, { ...editor!, time: Number.NaN, duration: Number.NaN, targetSpeed: 55 });

    expect(result.ok).toBe(true);
    expect(document.revision).toBe(before + 1);
    expect(document.data.choreography.interactions[0]).toEqual({ ...original, target: { mode: 'absolute', valueKph: 55 } });
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions[0]).toEqual(original);
    document.dispose();
  });

  it.each(conditionalTriggers)('click → Update preserves a %s until condition byte-for-byte', async (_kind, untilFor) => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const original: Interaction = {
      id: 'conditional-until', actor: actorId, label: 'Accelerate', trigger: { kind: 'at', t: 2 }, until: untilFor(actorId),
      verb: 'speed', target: { mode: 'delta', deltaKph: 10 }, dynamics: { shape: 'linear', constraint: 'time', value: 1 },
    };
    document.addInteraction(original);
    const group = buildTimelineGroups(document.data)[0]!;
    const editor = actionEditorStateForItem(group.lanes[0]!.items[0]!, group);
    expect(editor?.timingEditable).toBe(false);

    expect(submitTimelineAction(document, { ...editor!, time: 18, duration: 20 }).ok).toBe(true);

    expect(document.data.choreography.interactions[0]).toEqual(original);
    document.dispose();
  });

  it('updates safe lateral details while preserving conditional timing', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const trigger: Trigger = { kind: 'when', condition: { kind: 'speed', of: actorId, op: '>=', valueKph: 20 }, byLatest: 8, ifNever: 'skip' };
    const until: Trigger = { kind: 'after', of: 'prior-action', event: 'end', delayS: 2 };
    const original: Interaction = {
      id: 'conditional-lane', actor: actorId, label: 'Change lane left', trigger, until,
      verb: 'changeLane', target: { mode: 'relative', dk: 1 }, dynamics: { shape: 'sinusoidal', constraint: 'time', value: 3 },
      maneuverDurationS: 3, maneuverStyle: 'normal',
    };
    document.addInteraction(original);
    const group = buildTimelineGroups(document.data)[0]!;
    const editor = actionEditorStateForItem(group.lanes[0]!.items[0]!, group)!;

    expect(submitTimelineAction(document, { ...editor, maneuverDuration: 6, maneuverStyle: 'assertive' }).ok).toBe(true);

    expect(document.data.choreography.interactions[0]).toMatchObject({
      trigger, until, dynamics: { shape: 'sinusoidal', constraint: 'time', value: 6 },
      maneuverDurationS: 6, maneuverStyle: 'assertive',
    });
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions[0]).toEqual(original);
    document.dispose();
  });

  it('changes a conditional action preset without changing either timing boundary', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    const trigger: Trigger = { kind: 'when', condition: { kind: 'speed', of: actorId, op: '>=', valueKph: 20 }, byLatest: 8, ifNever: 'skip' };
    const until: Trigger = { kind: 'arrival', of: actorId, at: { role: actorId }, syncWith: actorId, ttc: 1.5 };
    const original: Interaction = {
      id: 'conditional-change', actor: actorId, label: 'Set target speed', trigger, until,
      verb: 'speed', target: { mode: 'absolute', valueKph: 42 }, dynamics: { shape: 'linear', constraint: 'time', value: 1 },
    };
    document.addInteraction(original);
    const group = buildTimelineGroups(document.data)[0]!;
    const editor = actionEditorStateForItem(group.lanes[0]!.items[0]!, group)!;

    expect(submitTimelineAction(document, { ...editor, definitionId: 'lane_left', maneuverDuration: 4, maneuverStyle: 'cautious' }).ok).toBe(true);

    expect(document.data.choreography.interactions[0]).toMatchObject({
      id: original.id, label: 'Change lane left', trigger, until, verb: 'changeLane',
      target: { mode: 'relative', dk: 1 }, dynamics: { shape: 'sinusoidal', constraint: 'time', value: 4 },
      maneuverDurationS: 4, maneuverStyle: 'cautious',
    });
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions[0]).toEqual(original);
    document.dispose();
  });

  it('renders conditional timing as unavailable while leaving safe controls editable', async () => {
    const { store } = memoryStore();
    const { document, actorId } = await boxTruck(store);
    document.addInteraction({
      id: 'conditional-form', actor: actorId, label: 'Change lane left',
      trigger: { kind: 'after', of: 'prior-action', event: 'start', delayS: 0 },
      verb: 'changeLane', target: { mode: 'relative', dk: 1 }, dynamics: { shape: 'sinusoidal', constraint: 'time', value: 3 },
      maneuverDurationS: 3, maneuverStyle: 'normal',
    });
    const group = buildTimelineGroups(document.data)[0]!;
    const state = actionEditorStateForItem(group.lanes[0]!.items[0]!, group)!;

    const markup = renderToStaticMarkup(<ActionEditor state={state} group={group} readOnly={false} rightInset={16} onChange={() => undefined} onSave={() => undefined} onClose={() => undefined} />);

    expect(markup).toMatch(/disabled=""[^>]*data-testid="interaction-time"/);
    expect(markup).toMatch(/disabled=""[^>]*data-testid="interaction-window-duration"/);
    expect(markup.match(/<select[^>]*data-testid="action-preset"[^>]*>/)?.[0]).not.toContain('disabled');
    expect(markup.match(/<input[^>]*data-testid="maneuver-duration"[^>]*>/)?.[0]).not.toContain('disabled');
    expect(markup).toContain('Its timing is preserved');
    document.dispose();
  });
});
