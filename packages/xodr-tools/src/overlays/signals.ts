/**
 * Signal overlay builder.
 *
 * Renderer-agnostic: pure functions in, one `THREE.Group` out.
 *
 * ## Draw-call budget
 *
 * The first version drew one `Mesh` per head. Correct, pickable by name, and
 * ~160 draw calls on Yale Street — a 17% bump on a 967-call frame, which is why
 * the layer shipped defaulted *off*. Nothing about the data needs that: heads of
 * one category are the same geometry with the same material at different
 * positions, i.e. the textbook `InstancedMesh` case.
 *
 * So the layer is now:
 *
 * | object | draws | contents |
 * |---|---|---|
 * | `signal-poles` | 1 | every mast, merged, vertex-coloured |
 * | `signal-heads/<category>` | 1 each | every head of that category, instanced |
 * | `crosswalk-outlines` | 1 | every crosswalk ring, merged |
 *
 * Yale Street's 164 features land on **11 draw calls** (9 categories present +
 * poles + crosswalks) instead of 161. Geometry and material sharing is
 * unchanged — it is now structural rather than incidental.
 *
 * ## Picking
 *
 * Instances have no names, so `getObjectByName(signalId)` is gone. Instead every
 * feature has an entry in {@link SignalOverlayUserData.byId} carrying its
 * drawable and instance index, each `InstancedMesh` carries `userData.signalIds`
 * indexed by `instanceId` (so a raycast hit resolves in O(1) — see
 * {@link signalIdForHit}), and {@link signalPlacement} is the reverse lookup.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
  type Intersection,
  type Material,
  type Object3D,
} from 'three';
import type { SignalCategory, SignalFeature } from '../signals.js';
import { createHeightResolver, type HeightOptions } from './height.js';

export type { HeightSampler, MissingHeightPolicy } from './height.js';

/** Default marker colour per category. */
export const SIGNAL_CATEGORY_COLORS: Record<SignalCategory, number> = {
  traffic_light: 0xff3b30,
  stop_sign: 0xd0021b,
  stop_line: 0xff8a65,
  warning_sign: 0xffb300,
  regulatory_sign: 0xe0e0e0,
  turn_restriction_sign: 0xb0bec5,
  parking_sign: 0x2979ff,
  street_name_sign: 0x00c853,
  bus_stop: 0x8e24aa,
  other_sign: 0x9e9e9e,
  unknown: 0x78909c,
};

/** Options for {@link buildSignalOverlay}. */
export interface SignalOverlayOptions extends HeightOptions {
  /**
   * Fallback ground Y when there is no sampler and the feature has none.
   *
   * @deprecated Use {@link HeightOptions.defaultHeight}; this is the same knob
   *   under the old name and is still honoured.
   */
  groundHeight?: number;
  /** Pole colour. Default `0x9aa5b1`. */
  poleColor?: number;
  /** Uniform scale on head markers. Default `1`. */
  headScale?: number;
  /** Override any category colour. */
  categoryColors?: Partial<Record<SignalCategory, number>>;
  /** Draw the crosswalk polygons that share the signals file. Default `true`. */
  includeCrosswalks?: boolean;
  /**
   * Draw features flagged `withinExtents: false` (bad source rows that land far
   * outside the map and would wreck camera framing). Default `false`.
   */
  includeOutOfBounds?: boolean;
  /** Keep only the features you want. */
  filter?: (signal: SignalFeature) => boolean;
}

/** Where one signal ended up, and in which drawable. */
export interface SignalPlacement {
  readonly signal: SignalFeature;
  readonly category: SignalCategory;
  /** Head centre in scene metres. For a crosswalk, the ring centroid at ground + 5 cm. */
  readonly position: [number, number, number];
  /** Ground height under the feature, in scene Y. */
  readonly groundY: number;
  /** The object that draws it: an `InstancedMesh` per category, or the merged crosswalk lines. */
  readonly object: Object3D;
  /** Index within `object`'s instance buffer, or `-1` for the merged crosswalk lines. */
  readonly instanceId: number;
}

/** `userData` attached to the group returned by {@link buildSignalOverlay}. */
export interface SignalOverlayUserData {
  layer: 'signals';
  /** Signal id -> where it was drawn. */
  byId: Record<string, SignalPlacement>;
  signalCount: number;
  /** Crosswalk rings merged into `crosswalk-outlines`. */
  crosswalkCount: number;
  /** Categories that produced an `InstancedMesh`, in build order. */
  categories: SignalCategory[];
  /** Draw calls this overlay adds when fully visible. */
  drawCalls: number;
}

/** `userData` on each per-category `InstancedMesh`. */
export interface SignalHeadUserData {
  layer: 'signals';
  category: SignalCategory;
  /** Signal id per instance index. */
  signalIds: string[];
}

export type TrafficLightVisualPhase = 'green' | 'yellow' | 'red';

export interface TrafficLightStateUserData {
  layer: 'traffic-light-state';
  states: Record<string, TrafficLightVisualPhase>;
  count: number;
}

function srgbBytes(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/** Non-indexed box centred on the origin, as raw position triples. */
function boxTriangles(w: number, h: number, d: number, cy: number): number[] {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const v = [
    [-x, cy - y, -z],
    [x, cy - y, -z],
    [x, cy + y, -z],
    [-x, cy + y, -z],
    [-x, cy - y, z],
    [x, cy - y, z],
    [x, cy + y, z],
    [-x, cy + y, z],
  ];
  const quads = [
    [4, 5, 6, 7], // +z
    [1, 0, 3, 2], // -z
    [5, 1, 2, 6], // +x
    [0, 4, 7, 3], // -x
    [3, 7, 6, 2], // +y
    [4, 0, 1, 5], // -y
  ];
  const out: number[] = [];
  for (const q of quads) {
    const [a, b, c, d2] = q as [number, number, number, number];
    for (const i of [a, b, c, a, c, d2]) out.push(...(v[i] as number[]));
  }
  return out;
}

/**
 * A traffic-light head: three stacked lamps, red on top, coloured with vertex
 * colours so all 59 lights share one geometry and one material.
 */
function trafficLightHeadGeometry(): BufferGeometry {
  const inactiveBrightness = 0.12;
  const lamp = 0.24;
  const gap = 0.28;
  const lamps: Array<[number, number]> = [
    [gap, 0xff3b30],
    [0, 0xffcc00],
    [-gap, 0x34c759],
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  for (const [cy, hex] of lamps) {
    const tri = boxTriangles(lamp, lamp, lamp, cy);
    positions.push(...tri);
    const rgb = srgbBytes(hex).map((channel) => channel * inactiveBrightness) as [number, number, number];
    for (let i = 0; i < tri.length / 3; i++) colors.push(rgb[0], rgb[1], rgb[2]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function signGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const tri = boxTriangles(0.34, 0.34, 0.05, 0);
  g.setAttribute('position', new BufferAttribute(new Float32Array(tri), 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function octagonGeometry(): BufferGeometry {
  // 8-gon standing upright in the XY plane, i.e. facing +Z.
  const g = new CircleGeometry(0.28, 8);
  g.rotateZ(Math.PI / 8);
  return g;
}

interface HeadKit {
  geometry: BufferGeometry;
  material: Material;
}

/**
 * Geometry + material for one category, built lazily so a map with three
 * categories does not allocate eleven geometries.
 */
function makeHeadKit(
  category: SignalCategory,
  colors: Record<SignalCategory, number>,
  shared: { sign?: BufferGeometry; octagon?: BufferGeometry },
): HeadKit {
  if (category === 'traffic_light') {
    return {
      geometry: trafficLightHeadGeometry(),
      material: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    };
  }
  const geometry =
    category === 'stop_sign'
      ? (shared.octagon ??= octagonGeometry())
      : (shared.sign ??= signGeometry());
  return {
    geometry,
    material: new MeshBasicMaterial({
      color: colors[category],
      side: DoubleSide,
      toneMapped: false,
    }),
  };
}

/** One head, resolved but not yet written to an instance buffer. */
interface StagedHead {
  signal: SignalFeature;
  category: SignalCategory;
  x: number;
  z: number;
  groundY: number;
  headY: number;
}

const _matrix = new Matrix4();
const _position = new Vector3();
const _scale = new Vector3();
/** Heads are axis-aligned markers: no rotation, ever. */
const _noRotation = new Quaternion();

/**
 * Build the signal layer: one instanced draw per category, one merged draw for
 * the masts, one for the crosswalk rings.
 *
 * The head sits at `groundY + zOffset`; the pole runs from the ground to it.
 * Features with no meaningful `zOffset` (crosswalks, stop lines painted on the
 * road) get no pole and their marker is laid just above the surface.
 *
 * @returns A `Group` named `signals` containing `signal-poles` (`LineSegments`),
 *   `signal-heads` (a `Group` of per-category `InstancedMesh`es) and
 *   `crosswalk-outlines` (`LineSegments`).
 */
export function buildSignalOverlay(
  signals: SignalFeature[],
  options: SignalOverlayOptions = {},
): Group {
  const {
    poleColor = 0x9aa5b1,
    headScale = 1,
    categoryColors,
    includeCrosswalks = true,
    includeOutOfBounds = false,
    filter,
  } = options;
  const resolveHeight = createHeightResolver({
    ...options,
    ...(options.defaultHeight === undefined && options.groundHeight !== undefined
      ? { defaultHeight: options.groundHeight }
      : {}),
  });

  const colors: Record<SignalCategory, number> = { ...SIGNAL_CATEGORY_COLORS, ...categoryColors };

  const group = new Group();
  group.name = 'signals';

  const heads = new Group();
  heads.name = 'signal-heads';

  const poleVerts: number[] = [];
  const poleColors: number[] = [];
  const poleRgb = srgbBytes(poleColor);
  const byId: Record<string, SignalPlacement> = {};

  // Crosswalk rings, merged into one LineSegments: closed loops emitted as
  // explicit segment pairs so a single geometry can hold all 21 rings.
  const crosswalkVerts: number[] = [];
  const crosswalkPlacements: Array<{ signal: SignalFeature; position: [number, number, number]; groundY: number }> = [];

  const staged = new Map<SignalCategory, StagedHead[]>();
  let count = 0;

  for (const signal of signals) {
    if (filter && !filter(signal)) continue;
    if (signal.withinExtents === false && !includeOutOfBounds) continue;
    const isCrosswalk = signal.featureKind === 'crosswalk';
    if (isCrosswalk && !includeCrosswalks) continue;

    const [x, bakedY, z] = signal.position;
    const groundY = resolveHeight(x, z, bakedY);
    if (groundY === null) continue; // onMissingHeight: 'skip'

    if (isCrosswalk && signal.outline && signal.outline.length >= 6) {
      const n = signal.outline.length / 2;
      const ring: number[] = [];
      let dropped = false;
      for (let i = 0; i < n; i++) {
        const ox = signal.outline[i * 2] as number;
        const oz = signal.outline[i * 2 + 1] as number;
        const oy = resolveHeight(ox, oz, groundY);
        if (oy === null) {
          dropped = true;
          break;
        }
        ring.push(ox, oy + 0.05, oz);
      }
      if (dropped) continue;
      for (let i = 0; i < n; i++) {
        const a = i * 3;
        const b = ((i + 1) % n) * 3;
        crosswalkVerts.push(
          ring[a] as number,
          ring[a + 1] as number,
          ring[a + 2] as number,
          ring[b] as number,
          ring[b + 1] as number,
          ring[b + 2] as number,
        );
      }
      crosswalkPlacements.push({ signal, position: [x, groundY + 0.05, z], groundY });
      count++;
      continue;
    }

    const headY = groundY + Math.max(signal.zOffset, 0.06);
    const category = colors[signal.category] === undefined ? 'unknown' : signal.category;
    let list = staged.get(category);
    if (!list) {
      list = [];
      staged.set(category, list);
    }
    list.push({ signal, category, x, z, groundY, headY });

    if (signal.zOffset > 0.2) {
      poleVerts.push(x, groundY, z, x, headY, z);
      for (let i = 0; i < 2; i++) poleColors.push(poleRgb[0], poleRgb[1], poleRgb[2]);
    }
    count++;
  }

  // --- per-category instanced heads ---------------------------------------
  const shared: { sign?: BufferGeometry; octagon?: BufferGeometry } = {};
  const categories: SignalCategory[] = [];
  _scale.setScalar(headScale);
  for (const [category, list] of staged) {
    const kit = makeHeadKit(category, colors, shared);
    const mesh = new InstancedMesh(kit.geometry, kit.material, list.length);
    mesh.name = `signal-heads.${category}`;
    mesh.renderOrder = 11;
    // Instanced heads are scattered over the whole map, so the base geometry's
    // bounding sphere would cull the batch as soon as one head leaves the
    // frustum. computeBoundingSphere() on the InstancedMesh fixes the extent.
    const signalIds: string[] = [];
    list.forEach((head, index) => {
      _position.set(head.x, head.headY, head.z);
      mesh.setMatrixAt(index, _matrix.compose(_position, _noRotation, _scale));
      signalIds.push(head.signal.id);
      byId[head.signal.id] = {
        signal: head.signal,
        category,
        position: [head.x, head.headY, head.z],
        groundY: head.groundY,
        object: mesh,
        instanceId: index,
      };
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    const userData: SignalHeadUserData = { layer: 'signals', category, signalIds };
    mesh.userData = userData;
    heads.add(mesh);
    categories.push(category);
  }

  if (poleVerts.length > 0) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(poleVerts), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(poleColors), 3));
    g.computeBoundingSphere();
    const poles = new LineSegments(
      g,
      new LineBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    poles.name = 'signal-poles';
    poles.renderOrder = 11;
    group.add(poles);
  }

  if (crosswalkVerts.length > 0) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(crosswalkVerts), 3));
    g.computeBoundingSphere();
    const outlines = new LineSegments(
      g,
      new LineBasicMaterial({ color: colors.unknown, toneMapped: false }),
    );
    outlines.name = 'crosswalk-outlines';
    outlines.renderOrder = 11;
    outlines.userData = { layer: 'signals', category: 'crosswalk' };
    group.add(outlines);
    for (const entry of crosswalkPlacements) {
      byId[entry.signal.id] = {
        signal: entry.signal,
        category: entry.signal.category,
        position: entry.position,
        groundY: entry.groundY,
        object: outlines,
        instanceId: -1,
      };
    }
  }

  group.add(heads);
  const drawCalls =
    categories.length + (poleVerts.length > 0 ? 1 : 0) + (crosswalkVerts.length > 0 ? 1 : 0);
  const userData: SignalOverlayUserData = {
    layer: 'signals',
    byId,
    signalCount: count,
    crosswalkCount: crosswalkPlacements.length,
    categories,
    drawCalls,
  };
  group.userData = userData;
  return group;
}

/** Look up where a signal was drawn. */
export function signalPlacement(group: Object3D, signalId: string): SignalPlacement | null {
  const byId = (group.userData as Partial<SignalOverlayUserData>).byId;
  return byId?.[signalId] ?? null;
}

const TRAFFIC_LIGHT_PHASE_COLOR: Record<TrafficLightVisualPhase, number> = {
  green: 0x34c759,
  yellow: 0xffcc00,
  red: 0xff3b30,
};

const TRAFFIC_LIGHT_PHASE_Y: Record<TrafficLightVisualPhase, number> = {
  green: -0.28,
  yellow: 0,
  red: 0.28,
};

/**
 * Draw the active lamp for each physical map head as one point-cloud draw.
 * Replacing this tiny buffer on a scrub is cheaper and substantially clearer
 * than rebuilding the static instanced furniture.
 */
export function setTrafficLightStates(
  group: Object3D,
  states: Readonly<Record<string, TrafficLightVisualPhase>>,
): number {
  clearTrafficLightStates(group);
  const positions: number[] = [];
  const colors: number[] = [];
  const kept: Record<string, TrafficLightVisualPhase> = {};
  for (const id of Object.keys(states).sort()) {
    const placement = signalPlacement(group, id);
    const phase = states[id]!;
    if (!placement || placement.category !== 'traffic_light') continue;
    positions.push(
      placement.position[0],
      placement.position[1] + TRAFFIC_LIGHT_PHASE_Y[phase],
      placement.position[2] + 0.15,
    );
    colors.push(...srgbBytes(TRAFFIC_LIGHT_PHASE_COLOR[phase]));
    kept[id] = phase;
  }
  if (positions.length === 0) return 0;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.computeBoundingSphere();
  const points = new Points(
    geometry,
    // Fixed screen-space size keeps the active lamp legible at the incident
    // camera's typical 30–120 m range; the dim housing still supplies scale.
    new PointsMaterial({ size: 9, vertexColors: true, toneMapped: false, sizeAttenuation: false }),
  );
  points.name = 'traffic-light-live-state';
  points.renderOrder = 12;
  points.userData = {
    layer: 'traffic-light-state',
    states: kept,
    count: positions.length / 3,
  } satisfies TrafficLightStateUserData;
  group.add(points);
  return positions.length / 3;
}

/** Remove playback state while retaining the map's static signal furniture. */
export function clearTrafficLightStates(group: Object3D): void {
  const existing = group.getObjectByName('traffic-light-live-state') as Points | undefined;
  if (!existing) return;
  existing.removeFromParent();
  existing.geometry.dispose();
  const materials = Array.isArray(existing.material) ? existing.material : [existing.material];
  for (const material of materials) material.dispose();
}

/**
 * Resolve a raycast hit against the overlay back to a signal id.
 *
 * @param hit A `THREE.Intersection` whose `object` is one of the per-category
 *   `InstancedMesh`es.
 */
export function signalIdForHit(hit: Intersection): string | null {
  const data = hit.object.userData as Partial<SignalHeadUserData>;
  if (data.layer !== 'signals' || !data.signalIds) return null;
  const index = hit.instanceId;
  if (index === undefined || index < 0) return null;
  return data.signalIds[index] ?? null;
}
