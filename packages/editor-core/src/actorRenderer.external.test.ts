import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  VectorKeyframeTrack,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  clearExternalCatalogEntries,
  registerExternalCatalogEntry,
  type ExternalModelBinding,
} from '@uniscenarios/prop-catalog';
import { ActorRenderer, type ActorView } from './actorRenderer';
import {
  disposeExternalModels,
  onExternalModelChange,
  requestExternalModel,
  setExternalModelLoader,
} from './externalModel';

const CONTENT_HASH = 'a'.repeat(64);
const CATALOG_ID = 'gallery.11111111-2222-3333-4444-555555555555.v1';

/**
 * The renderer builds its contact-shadow texture from a canvas. Nothing in this
 * test reads pixels, so a shim keeps the suite in the default node environment
 * instead of pulling jsdom in for one texture.
 */
beforeAll(() => {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') return;
  (globalThis as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  };
});

/** Head slides 0 -> 2 m over the clip; locomotion moves twice as far. */
function animatedGltf(): GLTF {
  const scene = new Group();
  const head = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  head.name = 'Head';
  scene.add(head);
  return {
    scene,
    scenes: [scene],
    cameras: [],
    asset: {},
    animations: [
      new AnimationClip('idle', 2, [
        new VectorKeyframeTrack('Head.position', [0, 2], [0, 0, 0, 0, 2, 0]),
      ]),
      new AnimationClip('locomotion', 2, [
        new VectorKeyframeTrack('Head.position', [0, 2], [0, 0, 0, 0, 4, 0]),
      ]),
    ],
  } as unknown as GLTF;
}

const BINDING: ExternalModelBinding = {
  kind: 'glb',
  url: 'https://example.test/model.glb',
  contentHash: CONTENT_HASH,
  animated: true,
  clips: { idle: 'idle', locomotion: 'locomotion' },
};

function actor(overrides: Partial<ActorView> = {}): ActorView {
  return {
    id: 'gallery-actor-1',
    catalogId: CATALOG_ID as ActorView['catalogId'],
    catalogIdAuthored: true,
    x: 0,
    y: 0,
    z: 0,
    headingRad: 0,
    dims: { l: 1, w: 1, h: 1 },
    ...overrides,
  } as ActorView;
}

async function loadedRenderer(): Promise<ActorRenderer> {
  registerExternalCatalogEntry({
    id: CATALOG_ID,
    label: 'Gallery rover',
    class: 'sidewalk_robot',
    actorClass: 'sidewalk_robot',
    description: 'Uploaded gallery model.',
    dims: { l: 1, w: 1, h: 1 },
    tags: [],
    defaultParams: {},
    model: BINDING,
  });
  setExternalModelLoader(async () => animatedGltf());
  const ready = new Promise<void>((resolve) => {
    const unsubscribe = onExternalModelChange((hash) => {
      if (hash !== CONTENT_HASH) return;
      unsubscribe();
      resolve();
    });
  });
  requestExternalModel(BINDING);
  await ready;
  return new ActorRenderer();
}

function headOf(renderer: ActorRenderer, actorId: string): Object3D {
  let container: Object3D | null = null;
  renderer.group.traverse((object) => {
    if (object.name === `animated-actor.${actorId}`) container = object;
  });
  if (container === null) throw new Error(`no animated clone for ${actorId}`);
  let head: Object3D | null = null;
  (container as Object3D).traverse((object) => {
    if (object.name === 'Head') head = object;
  });
  if (head === null) throw new Error('cloned model has no Head node');
  return head;
}

describe('ActorRenderer external animated models', () => {
  afterEach(() => {
    clearExternalCatalogEntries();
    disposeExternalModels();
  });

  it('scrubs a clip from absolute animation time rather than frame deltas', async () => {
    const renderer = await loadedRenderer();

    renderer.sync([actor({ animationTimeS: 0, speedMps: 0 })]);
    const atZero = headOf(renderer, 'gallery-actor-1').position.y;
    renderer.sync([actor({ animationTimeS: 1, speedMps: 0 })]);
    const atOne = headOf(renderer, 'gallery-actor-1').position.y;
    // Replaying the earlier time must return the earlier pose: recorded frames
    // are produced by seeking, so an accumulating mixer would drift instead.
    renderer.sync([actor({ animationTimeS: 0, speedMps: 0 })]);
    const backAtZero = headOf(renderer, 'gallery-actor-1').position.y;

    expect(atZero).toBeCloseTo(0, 5);
    expect(atOne).toBeCloseTo(1, 5);
    expect(backAtZero).toBeCloseTo(0, 5);

    renderer.dispose();
  });

  it('selects the locomotion clip once the actor is moving', async () => {
    const renderer = await loadedRenderer();

    renderer.sync([actor({ animationTimeS: 1, speedMps: 0 })]);
    const idlePose = headOf(renderer, 'gallery-actor-1').position.y;
    renderer.sync([actor({ animationTimeS: 1, speedMps: 3 })]);
    const movingPose = headOf(renderer, 'gallery-actor-1').position.y;

    expect(idlePose).toBeCloseTo(1, 5);
    expect(movingPose).toBeCloseTo(2, 5);

    renderer.dispose();
  });

  it('releases the clone when its actor leaves the scene', async () => {
    const renderer = await loadedRenderer();

    renderer.sync([actor({ animationTimeS: 0, speedMps: 0 })]);
    expect(() => headOf(renderer, 'gallery-actor-1')).not.toThrow();

    renderer.sync([]);
    expect(() => headOf(renderer, 'gallery-actor-1')).toThrow();

    renderer.dispose();
  });
});
