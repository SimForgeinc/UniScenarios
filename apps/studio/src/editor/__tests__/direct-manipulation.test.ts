import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { MemoryStorage, WebTemplateFileStore } from '@uniscenarios/scenario-model';
import { MAPS } from '../../maps';
import { EditorController } from '../controller';
import { EditorDocument } from '../document';
import { LaneIndex } from '../laneIndex';

interface ControllerInternals {
  actorIdAt: (event: PointerEvent) => string | null;
  groundPoint: (event: PointerEvent) => Vector3 | null;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  computeGhostPose: (catalogId: 'construction.traffic_cone', ground: Vector3) => { headingRad: number };
  preview: Map<string, { x: number; headingRad: number; routeLaneRsls?: readonly string[] | null }>;
  selection: string[];
  publish: () => void;
  ghost: { setValid: (valid: boolean) => void };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture(actors: Array<{
  id: string;
  catalogId: 'construction.traffic_cone' | 'vehicle.sedan';
  x: number;
  z: number;
  lane?: boolean;
}> = [{ id: 'cone', catalogId: 'construction.traffic_cone', x: 0, z: 0 }]) {
  const document = await EditorDocument.openBlank(MAPS[0]!, {
    store: new WebTemplateFileStore({ storage: new MemoryStorage() }), autosaveMs: 60_000,
  });
  document.add(actors.map((actor) => ({
    id: actor.id,
    catalogId: actor.catalogId,
    x: actor.x,
    y: 0,
    z: actor.z,
    headingRad: 0,
    ...(actor.lane ? {
      laneRef: { roadId: '1', section: 0, laneId: -1, s: actor.x, t: 0, headingOffsetRad: 0 },
      routeLaneRsls: ['1:0:-1'],
      initialSpeedKph: 48.28032,
    } : {}),
  })));
  const laneIndex = LaneIndex.build({ mapName: 'direct-manipulation', lanes: {
    '1:0:-1': {
      roadId: 1, section: 0, laneId: -1, laneType: 'driving',
      polyline: [{ x: 0, y: 0 }, { x: 400, y: 0 }],
    },
  } });
  const captures = new Set<number>();
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    setPointerCapture: (id: number) => captures.add(id),
    releasePointerCapture: (id: number) => captures.delete(id),
    hasPointerCapture: (id: number) => captures.has(id),
  };
  const camera = new PerspectiveCamera(55, 2, 0.1, 1000);
  camera.position.set(0, 30, 30);
  camera.lookAt(0, 0, 0);
  const controls = {
    setEnabled: vi.fn(),
    getView: () => ({ position: [0, 30, 30] as const, target: [0, 0, 0] as const }),
    setView: vi.fn(),
  };
  const viewer = { scene: new Scene(), camera, controls, renderer: { domElement: canvas } } as unknown as CityViewer;
  const controller = new EditorController({ viewer, laneIndex, document, sampleHeight: () => 0 });
  const internals = controller as unknown as ControllerInternals;
  internals.actorIdAt = () => actors[0]?.id ?? null;
  internals.groundPoint = (event) => {
    const point = new Vector3(event.clientX, 0, -event.clientY);
    (internals as unknown as { lastGround: Vector3 }).lastGround = point;
    return point;
  };
  return { controller, document, internals, controls, canvas, captures };
}

function pointer(canvas: object, clientX: number, clientY = 0, extras: Record<string, unknown> = {}): PointerEvent {
  return {
    target: canvas, pointerId: 7, pointerType: 'mouse', button: 0,
    clientX, clientY, altKey: false, shiftKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    ...extras,
  } as unknown as PointerEvent;
}

function key(value: string, target: EventTarget | null = null, repeat = false): KeyboardEvent {
  return {
    key: value, target, repeat, metaKey: false, ctrlKey: false, altKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe('direct authored-actor manipulation', () => {
  it('keeps a normal click as selection and begins move after the hold threshold', async () => {
    const first = await fixture();
    const revision = first.document.revision;
    const frame = vi.spyOn(first.controller, 'frameActor').mockImplementation(() => undefined);
    first.internals.onPointerDown(pointer(first.canvas, 0));
    first.internals.onPointerUp(pointer(first.canvas, 0));
    expect(first.internals.selection).toEqual(['cone']);
    expect(frame).toHaveBeenCalledWith('cone');
    expect(first.document.revision).toBe(revision);
    expect(first.controls.setEnabled).toHaveBeenNthCalledWith(1, false);
    expect(first.controls.setEnabled).toHaveBeenLastCalledWith(true);
    first.controller.dispose(); first.document.dispose();

    const held = await fixture();
    held.internals.onPointerDown(pointer(held.canvas, 0));
    vi.advanceTimersByTime(220);
    expect(held.internals.preview.has('cone')).toBe(true);
    held.internals.onPointerMove(pointer(held.canvas, 14));
    held.internals.onPointerUp(pointer(held.canvas, 14));
    expect(held.document.actor('cone')?.x).toBe(14);
    held.controller.dispose(); held.document.dispose();
  });

  it('starts immediately after drag slop, lifts the actor, commits once, and undoes atomically', async () => {
    const { controller, document, internals, canvas } = await fixture();
    const revision = document.revision;
    const synced: number[] = [];
    vi.spyOn(controller.renderer, 'sync').mockImplementation((views) => { synced.push(views[0]?.y ?? 0); });
    internals.onPointerDown(pointer(canvas, 0));
    internals.onPointerMove(pointer(canvas, 8));
    expect(internals.preview.get('cone')?.x).toBe(8);
    expect(synced.at(-1)).toBeCloseTo(0.42, 6);
    internals.onPointerUp(pointer(canvas, 8));
    expect(document.revision).toBe(revision + 1);
    expect(document.actor('cone')?.x).toBe(8);
    expect(document.undo()).toBe(true);
    expect(document.actor('cone')?.x).toBe(0);
    controller.dispose(); document.dispose();
  });

  it('restores the exact original pose on Escape and pointer cancellation without history', async () => {
    for (const cancelWithKey of [true, false]) {
      const { controller, document, internals, canvas } = await fixture();
      const revision = document.revision;
      internals.onPointerDown(pointer(canvas, 0));
      internals.onPointerMove(pointer(canvas, 12));
      if (cancelWithKey) internals.onKeyDown(key('Escape'));
      else internals.onPointerCancel(pointer(canvas, 12));
      expect(document.revision).toBe(revision);
      expect(document.actor('cone')).toMatchObject({ x: 0, z: 0, headingRad: 0 });
      expect(internals.preview.size).toBe(0);
      controller.dispose(); document.dispose();
    }
  });

  it('rejects an overlapping drop and leaves no history entry', async () => {
    const { controller, document, internals, canvas } = await fixture([
      { id: 'moving', catalogId: 'construction.traffic_cone', x: 0, z: 0 },
      { id: 'blocker', catalogId: 'construction.traffic_cone', x: 20, z: 0 },
    ]);
    const revision = document.revision;
    const validity = vi.spyOn(internals.ghost, 'setValid');
    internals.onPointerDown(pointer(canvas, 0));
    internals.onPointerMove(pointer(canvas, 20));
    expect(validity).toHaveBeenLastCalledWith(false);
    internals.onPointerUp(pointer(canvas, 20));
    expect(document.revision).toBe(revision);
    expect(document.actor('moving')?.x).toBe(0);
    controller.dispose(); document.dispose();
  });

  it('keeps playback/read-only input out of the direct manipulation state machine', async () => {
    const { controller, document, internals, controls, canvas } = await fixture();
    const revision = document.revision;
    controller.setAuthoringEnabled(false);
    internals.onPointerDown(pointer(canvas, 0, 0, { pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    internals.onPointerMove(pointer(canvas, 30, 0, { pointerType: 'pen' }));
    internals.onPointerUp(pointer(canvas, 30));
    expect(document.revision).toBe(revision);
    expect(internals.preview.size).toBe(0);
    expect(controls.setEnabled).not.toHaveBeenCalled();
    controller.dispose(); document.dispose();
  });

  it('refreshes the transient route and lane pose without mutating the document before release', async () => {
    const { controller, document, internals, canvas } = await fixture([
      { id: 'ego', catalogId: 'vehicle.sedan', x: 10, z: 0, lane: true },
    ]);
    const revision = document.revision;
    internals.onPointerDown(pointer(canvas, 10));
    internals.onPointerMove(pointer(canvas, 100));
    expect(document.revision).toBe(revision);
    expect(document.actor('ego')).toMatchObject({ x: 10, laneRef: { s: 10 } });
    expect(controller.authoringPreviewData.roles[0]).toMatchObject({
      pose: { position: { x: 100 } }, laneRef: { s: 100 }, initialRoute: { lanes: ['1:0:-1'] },
    });
    internals.onPointerUp(pointer(canvas, 100));
    expect(document.actor('ego')).toMatchObject({ x: 100, laneRef: { s: 100 }, routeLaneRsls: ['1:0:-1'] });
    controller.dispose(); document.dispose();
  });
});

describe('static prop Q/E rotation', () => {
  it('rotates placement left/right in repeatable 5° steps and ignores focused fields', async () => {
    const { controller, document, internals } = await fixture();
    controller.togglePlacement('construction.traffic_cone');
    internals.onKeyDown(key('q', { tagName: 'INPUT' } as unknown as EventTarget));
    expect(internals.computeGhostPose('construction.traffic_cone', new Vector3()).headingRad).toBe(0);
    internals.onKeyDown(key('q'));
    internals.onKeyDown(key('q', null, true));
    internals.onKeyDown(key('e'));
    expect(internals.computeGhostPose('construction.traffic_cone', new Vector3()).headingRad)
      .toBeCloseTo(5 * Math.PI / 180, 10);
    internals.publish();
    expect(controller.state.hint).toContain('Q / E rotate 5°');
    controller.dispose(); document.dispose();
  });

  it('applies direct prop rotation to preview and commit, but never rotates a vehicle', async () => {
    const prop = await fixture();
    prop.internals.onPointerDown(pointer(prop.canvas, 0));
    prop.internals.onPointerMove(pointer(prop.canvas, 8));
    prop.internals.onKeyDown(key('q'));
    prop.internals.onKeyDown(key('q'));
    expect(prop.internals.preview.get('cone')?.headingRad).toBeCloseTo(10 * Math.PI / 180, 10);
    prop.internals.onPointerUp(pointer(prop.canvas, 8));
    expect(prop.document.actor('cone')?.headingRad).toBeCloseTo(10 * Math.PI / 180, 5);
    expect(prop.document.undo()).toBe(true);
    expect(prop.document.actor('cone')?.headingRad).toBe(0);
    prop.controller.dispose(); prop.document.dispose();

    const vehicle = await fixture([{ id: 'ego', catalogId: 'vehicle.sedan', x: 10, z: 0, lane: true }]);
    vehicle.internals.onPointerDown(pointer(vehicle.canvas, 10));
    vehicle.internals.onPointerMove(pointer(vehicle.canvas, 20));
    const event = key('q');
    vehicle.internals.onKeyDown(event);
    expect(vehicle.internals.preview.get('ego')?.headingRad).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
    vehicle.internals.onPointerCancel(pointer(vehicle.canvas, 20));
    vehicle.controller.dispose(); vehicle.document.dispose();
  });
});
