import { describe, expect, it } from 'vitest';
import { MemoryStorage, WebTemplateFileStore, type Interaction } from '@uniscenarios/scenario-model';
import { MAPS } from '../../maps';
import { compiledWorldMatchesRevision, EditorDocument } from '../document';
import { LaneIndex } from '../laneIndex';
import {
  clearRouteGeometryCache,
  routeGeometryCacheSize,
  routesFromTemplate,
} from '../routeOverlay';

function index(): LaneIndex {
  return LaneIndex.build({
    mapName: 'instant-preview',
    lanes: {
      '1:0:-1': { roadId: 1, section: 0, laneId: -1, laneType: 'driving', successors: ['2:0:-1', '3:0:-1'], polyline: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      '2:0:-1': { roadId: 2, section: 0, laneId: -1, laneType: 'driving', predecessors: ['1:0:-1'], polyline: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
      '3:0:-1': { roadId: 3, section: 0, laneId: -1, laneType: 'driving', predecessors: ['1:0:-1'], polyline: [{ x: 10, y: 0 }, { x: 10, y: 10 }] },
    },
  });
}

function laneChangeIndex(): LaneIndex {
  const lane = (rsl: string, laneId: number, y: number, left: string | null, right: string | null) => ({
    roadId: 10, section: 0, laneId, laneType: 'driving', representativeWidthM: 3.5,
    speedLimitKph: 50,
    adjacentLanes: {
      left: { side: 'left' as const, laneRsl: left, sameDirection: left !== null, permissionIds: left ? [`${rsl}:left`] : [] },
      right: { side: 'right' as const, laneRsl: right, sameDirection: right !== null, permissionIds: right ? [`${rsl}:right`] : [] },
    },
    laneChangePermissions: [
      ...(left ? [{ id: `${rsl}:left`, side: 'left' as const, startS: 0, endS: 100, allowed: true, marking: 'broken', source: 'test' }] : []),
      ...(right ? [{ id: `${rsl}:right`, side: 'right' as const, startS: 0, endS: 100, allowed: true, marking: 'broken', source: 'test' }] : []),
    ],
    polyline: [{ x: 0, y }, { x: 100, y }],
  });
  return LaneIndex.build({ mapName: 'lane-change-preview', lanes: {
    '10:0:-1': lane('10:0:-1', -1, 0, '10:0:-2', '10:0:-3'),
    '10:0:-2': lane('10:0:-2', -2, 3.5, null, '10:0:-1'),
    '10:0:-3': lane('10:0:-3', -3, -3.5, '10:0:-1', null),
  } });
}

function laneChange(id: string, dk: number, t: number): Interaction {
  return {
    id, actor: 'ego', trigger: { kind: 'at', t }, verb: 'changeLane',
    target: { mode: 'relative', dk }, dynamics: { shape: 'cubic', constraint: 'time', value: 2 },
    maneuverDurationS: 2, maneuverStyle: 'normal',
  };
}

async function document(): Promise<EditorDocument> {
  const doc = await EditorDocument.openBlank(MAPS[0]!, {
    store: new WebTemplateFileStore({ storage: new MemoryStorage() }),
    autosaveMs: 60_000,
  });
  doc.add([{
    id: 'ego', catalogId: 'vehicle.sedan', x: 0, y: 0, z: 0, headingRad: 0,
    routeLaneRsls: ['1:0:-1', '2:0:-1'],
  }]);
  return doc;
}

describe('instant authored route preview', () => {
  it('projects a timeline edit synchronously, before background work settles', async () => {
    const doc = await document();
    const laneIndex = index();
    let resolveBackground!: () => void;
    const background = new Promise<void>((resolve) => { resolveBackground = resolve; });
    let notifications = 0;
    doc.subscribe(() => { notifications++; });

    const action: Interaction = {
      id: 'brake', actor: 'ego', trigger: { kind: 'at', t: 5 }, verb: 'speed',
      target: { mode: 'stop' }, dynamics: { shape: 'linear', constraint: 'time', value: 1 },
    };
    doc.addInteraction(action);

    expect(notifications).toBe(1);
    expect(routesFromTemplate(doc.data, laneIndex)[0]?.markers.some((marker) => marker.kind === 'stop')).toBe(true);
    let settled = false;
    void background.then(() => { settled = true; });
    expect(settled).toBe(false);
    resolveBackground();
    doc.dispose();
  });

  it('updates route, reroute and semantic markers through edit, undo and redo', async () => {
    const doc = await document();
    const laneIndex = index();
    const initial = routesFromTemplate(doc.data, laneIndex)[0]!;
    expect(initial.planned.at(-1)).toEqual({ x: 20, z: 0 });

    doc.addInteraction({
      id: 'turn', actor: 'ego', label: 'Turn right', trigger: { kind: 'at', t: 3 }, verb: 'route',
      target: { mode: 'lanePath', lanes: ['1:0:-1', '3:0:-1'] },
    });
    const edited = routesFromTemplate(doc.data, laneIndex)[0]!;
    expect(edited.planned.at(-1)).toEqual({ x: 10, z: -10 });
    expect(edited.markers.some((marker) => marker.kind === 'reroute')).toBe(true);

    expect(doc.undo()).toBe(true);
    expect(routesFromTemplate(doc.data, laneIndex)[0]!.planned.at(-1)).toEqual({ x: 20, z: 0 });
    expect(doc.redo()).toBe(true);
    expect(routesFromTemplate(doc.data, laneIndex)[0]!.planned.at(-1)).toEqual({ x: 10, z: -10 });
    doc.dispose();
  });

  it('rejects stale compiled worlds by document revision', async () => {
    const doc = await document();
    const compilingRevision = doc.revision;
    expect(compiledWorldMatchesRevision(doc, compilingRevision)).toBe(true);
    doc.update([{ id: 'ego', routeLaneRsls: ['1:0:-1', '3:0:-1'] }]);
    expect(compiledWorldMatchesRevision(doc, compilingRevision)).toBe(false);
    expect(compiledWorldMatchesRevision(doc, doc.revision)).toBe(true);
    doc.dispose();
  });

  it('invalidates only changed route geometry', async () => {
    clearRouteGeometryCache();
    const doc = await document();
    const laneIndex = index();
    const first = routesFromTemplate(doc.data, laneIndex)[0]!.planned;
    expect(routeGeometryCacheSize()).toBe(1);
    doc.add([{
      id: 'other', catalogId: 'vehicle.sedan', x: 0, y: 0, z: 0, headingRad: 0,
      routeLaneRsls: ['1:0:-1', '2:0:-1'],
    }]);
    const shared = routesFromTemplate(doc.data, laneIndex);
    expect(shared.find((route) => route.actorId === 'other')!.planned).toBe(first);
    expect(routeGeometryCacheSize()).toBe(1);

    doc.update([{ id: 'ego', routeLaneRsls: ['1:0:-1', '3:0:-1'] }]);
    const changed = routesFromTemplate(doc.data, laneIndex);
    expect(changed.find((route) => route.actorId === 'other')!.planned).toBe(first);
    expect(changed.find((route) => route.actorId === 'ego')!.planned).not.toBe(first);
    expect(routeGeometryCacheSize()).toBe(2);
    doc.dispose();
  });

  it('draws legal left and right lane-change geometry on their destination lanes', async () => {
    const doc = await document();
    doc.update([{ id: 'ego', routeLaneRsls: ['10:0:-1'] }]);
    const lanes = laneChangeIndex();
    const baseline = routesFromTemplate(doc.data, lanes)[0]!.planned;

    doc.addInteraction(laneChange('left', 1, 1));
    const left = routesFromTemplate(doc.data, lanes)[0]!.planned;
    expect(left).not.toEqual(baseline);
    expect(left.at(-1)!.z).toBeCloseTo(-3.5, 3);
    doc.removeInteraction('left');

    doc.addInteraction(laneChange('right', -1, 1));
    const right = routesFromTemplate(doc.data, lanes)[0]!.planned;
    expect(right).not.toEqual(baseline);
    expect(right.at(-1)!.z).toBeCloseTo(3.5, 3);
    doc.dispose();
  });

  it('restores projected geometry through delete, undo and redo', async () => {
    const doc = await document();
    doc.update([{ id: 'ego', routeLaneRsls: ['10:0:-1'] }]);
    const lanes = laneChangeIndex();
    const baseline = routesFromTemplate(doc.data, lanes)[0]!.planned;
    doc.addInteraction(laneChange('left', 1, 1));
    const changed = routesFromTemplate(doc.data, lanes)[0]!.planned;
    doc.removeInteraction('left');
    expect(routesFromTemplate(doc.data, lanes)[0]!.planned).toEqual(baseline);
    expect(doc.undo()).toBe(true);
    expect(routesFromTemplate(doc.data, lanes)[0]!.planned).toEqual(changed);
    expect(doc.redo()).toBe(true);
    expect(routesFromTemplate(doc.data, lanes)[0]!.planned).toEqual(baseline);
    doc.dispose();
  });

  it('composes sequential lane changes in trigger-time order', async () => {
    const doc = await document();
    doc.update([{ id: 'ego', routeLaneRsls: ['10:0:-1'] }]);
    const lanes = laneChangeIndex();
    doc.addInteraction(laneChange('first-left', 1, 1));
    doc.addInteraction(laneChange('then-right', -1, 5));
    const returned = routesFromTemplate(doc.data, lanes)[0]!.planned;
    expect(returned.at(-1)!.z).toBeCloseTo(0, 3);

    doc.removeInteraction('then-right');
    doc.addInteraction(laneChange('second-left', 1, 5));
    const unavailableSecondLeft = routesFromTemplate(doc.data, lanes)[0]!.planned;
    // There is no legal lane left of the first destination. The preview keeps
    // the last valid lane instead of inventing a disconnected lateral shift.
    expect(unavailableSecondLeft.at(-1)!.z).toBeCloseTo(-3.5, 3);
    doc.dispose();
  });

  it('projects authored within-lane offsets with maneuver geometry', async () => {
    const doc = await document();
    doc.update([{ id: 'ego', routeLaneRsls: ['10:0:-1'] }]);
    const lanes = laneChangeIndex();
    const baseline = routesFromTemplate(doc.data, lanes)[0]!.planned;
    doc.addInteraction({
      id: 'edge-ride', actor: 'ego', trigger: { kind: 'at', t: 1 }, verb: 'laneOffset',
      target: { tFrac: .5, reference: 'lane_center' },
      dynamics: { shape: 'cubic', constraint: 'time', value: 2 },
      maneuverDurationS: 2, maneuverStyle: 'normal',
    });
    const offset = routesFromTemplate(doc.data, lanes)[0]!.planned;
    expect(offset).not.toEqual(baseline);
    expect(offset.at(-1)!.z).toBeCloseTo(-1.75, 3);
    doc.dispose();
  });

  it('leaves the legal path unchanged when the requested adjacent lane is unavailable', async () => {
    const doc = await document();
    doc.update([{ id: 'ego', routeLaneRsls: ['10:0:-2'] }]);
    const lanes = laneChangeIndex();
    const baseline = routesFromTemplate(doc.data, lanes)[0]!.planned;
    doc.addInteraction(laneChange('missing-left', 1, 1));
    const rejected = routesFromTemplate(doc.data, lanes)[0]!.planned;
    expect(rejected.at(-1)).toEqual(baseline.at(-1));
    expect(rejected.every((point) => Math.abs(point.z + 3.5) < 1e-6)).toBe(true);
    doc.dispose();
  });
});
