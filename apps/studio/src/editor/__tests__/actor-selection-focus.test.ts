import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { EditorController } from '../controller';
import type { EditorDocument } from '../document';
import type { LaneIndex } from '../laneIndex';

afterEach(() => vi.unstubAllGlobals());

it('smoothly frames a normally clicked scene actor without coupling framing to selection', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  const actor = {
    id: 'vehicle-1',
    x: 4,
    y: 0,
    z: 8,
    dims: { l: 4.5, w: 1.8, h: 1.5 },
  };
  const document = {
    name: 'Scene click focus',
    actors: [],
    canUndo: false,
    canRedo: false,
    isDirty: false,
    savedAt: null,
    subscribe: () => () => undefined,
    actor: (id: string) => id === actor.id ? actor : undefined,
  } as unknown as EditorDocument;
  const camera = new PerspectiveCamera();
  const viewer = {
    scene: new Scene(),
    camera,
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      },
    },
  } as unknown as CityViewer;
  const controller = new EditorController({
    viewer,
    laneIndex: {} as LaneIndex,
    document,
    sampleHeight: () => 0,
  });
  const internals = controller as unknown as {
    pick: (event: PointerEvent) => void;
    raycaster: { intersectObjects: () => unknown[] };
    renderer: {
      pickables: () => Object3D[];
      actorIdForHit: () => string;
    };
  };
  vi.spyOn(internals.renderer, 'pickables').mockReturnValue([new Object3D()]);
  vi.spyOn(internals.raycaster, 'intersectObjects').mockReturnValue([{}]);
  vi.spyOn(internals.renderer, 'actorIdForHit').mockReturnValue(actor.id);
  const frame = vi.spyOn(controller, 'frameActor').mockImplementation(() => undefined);

  internals.pick({ clientX: 50, clientY: 50, shiftKey: false } as PointerEvent);
  frames.splice(0).forEach((callback) => callback(0));
  expect(controller.state.selection).toEqual([actor.id]);
  expect(frame).toHaveBeenCalledOnce();
  expect(frame).toHaveBeenCalledWith(actor.id);

  // Selection remains a camera-neutral primitive; timeline Speed/Actions and
  // playback can select actors without unexpectedly moving the viewport.
  frame.mockClear();
  controller.setSelection([actor.id]);
  expect(frame).not.toHaveBeenCalled();

  controller.dispose();
});

it('smoothly frames a materialized portable actor that has no scene-absolute editor record', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  const document = {
    name: 'Portable actor focus',
    actors: [],
    canUndo: false,
    canRedo: false,
    isDirty: false,
    savedAt: null,
    subscribe: () => () => undefined,
    actor: () => undefined,
  } as unknown as EditorDocument;
  const setView = vi.fn();
  const viewer = {
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    controls: {
      getView: () => ({ position: [0, 20, 30], target: [0, 0, 0] }),
      setView,
    },
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } },
  } as unknown as CityViewer;
  const controller = new EditorController({
    viewer,
    laneIndex: {} as LaneIndex,
    document,
    sampleHeight: () => 0,
  });

  controller.frameActor('ambulance', {
    id: 'ambulance', catalogId: 'vehicle.van', dims: { l: 5, w: 2, h: 2.2 },
    x: 18, y: 1, z: -9, headingRad: 0,
  });
  frames.shift()?.(0);
  frames.shift()?.(320);

  expect(setView).toHaveBeenCalled();
  const finalTarget = setView.mock.calls.at(-1)?.[1] as Vector3;
  expect(finalTarget.toArray()).toEqual([18, 2.1, -9]);
  expect(controller.state.selection).toEqual([]);

  controller.dispose();
});
