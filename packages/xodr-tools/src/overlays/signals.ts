/**
 * Signal overlay builder.
 *
 * Renderer-agnostic: pure functions in, one `THREE.Group` out.
 *
 * Draw-call budget for Yale Street's 164 features: 1 `LineSegments` for every
 * pole (merged, vertex-coloured) + one small `Mesh` per head. Head geometries
 * and materials are cached per category, so the 59 traffic lights share a
 * single 3-lamp geometry and a single material. Each head is `.name`d with the
 * signal id so a raycast resolves straight to a feature.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { SignalCategory, SignalFeature } from '../signals.js';
import type { HeightSampler } from './lanes.js';

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
export interface SignalOverlayOptions {
  /** Ground height in scene space; overrides the Y baked into `signal.position`. */
  heightSampler?: HeightSampler;
  /** Fallback ground Y when there is no sampler and the feature has none. Default `0`. */
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

/** `userData` attached to the group returned by {@link buildSignalOverlay}. */
export interface SignalOverlayUserData {
  layer: 'signals';
  /** Signal id -> the head/outline object that represents it. */
  byId: Record<string, Object3D>;
  signalCount: number;
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
    const rgb = srgbBytes(hex);
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

function makeHeadKits(colors: Record<SignalCategory, number>): Map<SignalCategory, HeadKit> {
  const kits = new Map<SignalCategory, HeadKit>();
  const shared = {
    sign: signGeometry(),
    octagon: octagonGeometry(),
  };
  for (const key of Object.keys(colors) as SignalCategory[]) {
    if (key === 'traffic_light') {
      kits.set(key, {
        geometry: trafficLightHeadGeometry(),
        material: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      });
      continue;
    }
    kits.set(key, {
      geometry: key === 'stop_sign' ? shared.octagon : shared.sign,
      material: new MeshBasicMaterial({
        color: colors[key],
        side: DoubleSide,
        toneMapped: false,
      }),
    });
  }
  return kits;
}

/**
 * Build the signal layer: a pole per feature plus a category-coloured head.
 *
 * The head sits at `groundY + zOffset`; the pole runs from the ground to it.
 * Features with no meaningful `zOffset` (crosswalks, stop lines painted on the
 * road) get no pole and their marker is laid just above the surface.
 *
 * @returns A `Group` named `signals` containing `signal-poles` (`LineSegments`)
 *   and `signal-heads` (a `Group` of per-feature objects named by signal id).
 */
export function buildSignalOverlay(
  signals: SignalFeature[],
  options: SignalOverlayOptions = {},
): Group {
  const {
    heightSampler,
    groundHeight,
    poleColor = 0x9aa5b1,
    headScale = 1,
    categoryColors,
    includeCrosswalks = true,
    includeOutOfBounds = false,
    filter,
  } = options;

  const colors: Record<SignalCategory, number> = { ...SIGNAL_CATEGORY_COLORS, ...categoryColors };
  const kits = makeHeadKits(colors);

  const group = new Group();
  group.name = 'signals';

  const heads = new Group();
  heads.name = 'signal-heads';

  const poleVerts: number[] = [];
  const poleColors: number[] = [];
  const poleRgb = srgbBytes(poleColor);
  const byId: Record<string, Object3D> = {};
  let count = 0;

  for (const signal of signals) {
    if (filter && !filter(signal)) continue;
    if (signal.withinExtents === false && !includeOutOfBounds) continue;
    const isCrosswalk = signal.featureKind === 'crosswalk';
    if (isCrosswalk && !includeCrosswalks) continue;

    const [x, bakedY, z] = signal.position;
    const sampled = heightSampler?.(x, z);
    const groundY =
      sampled === undefined || sampled === null ? (groundHeight ?? bakedY) : sampled;

    let object: Object3D;
    if (isCrosswalk && signal.outline && signal.outline.length >= 6) {
      const n = signal.outline.length / 2;
      const pts = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const ox = signal.outline[i * 2] as number;
        const oz = signal.outline[i * 2 + 1] as number;
        const oy = heightSampler?.(ox, oz);
        pts[i * 3] = ox;
        pts[i * 3 + 1] = (oy === undefined || oy === null ? groundY : oy) + 0.05;
        pts[i * 3 + 2] = oz;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pts, 3));
      g.computeBoundingSphere();
      const loop = new LineLoop(
        g,
        new LineBasicMaterial({ color: colors.unknown, toneMapped: false }),
      );
      object = loop;
    } else {
      const kit = kits.get(signal.category) ?? (kits.get('unknown') as HeadKit);
      const mesh = new Mesh(kit.geometry, kit.material);
      const headY = groundY + Math.max(signal.zOffset, 0.06);
      mesh.position.set(x, headY, z);
      mesh.scale.setScalar(headScale);
      object = mesh;

      if (signal.zOffset > 0.2) {
        poleVerts.push(x, groundY, z, x, headY, z);
        for (let i = 0; i < 2; i++) poleColors.push(poleRgb[0], poleRgb[1], poleRgb[2]);
      }
    }

    object.name = signal.id;
    object.renderOrder = 11;
    object.userData = { layer: 'signals', signalId: signal.id, signal };
    heads.add(object);
    byId[signal.id] = object;
    count++;
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

  group.add(heads);
  const userData: SignalOverlayUserData = { layer: 'signals', byId, signalCount: count };
  group.userData = userData;
  return group;
}
