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
});
