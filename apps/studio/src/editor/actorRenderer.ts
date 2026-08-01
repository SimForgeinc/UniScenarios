/**
 * Drawing placed actors.
 *
 * ## The draw-call problem
 *
 * `prop-catalog` builds every prop from primitives, which is what makes it
 * parametric and asset-free — and leaves a sedan as **19 separate meshes**.
 * Thirty actors placed naively is ~570 extra draw calls on top of the city's
 * ~970, i.e. a 60% increase to draw 30 cars. Two passes fix that:
 *
 * 1. **Merge by material, once per catalog id.** A built prop is baked into one
 *    `BufferGeometry` per distinct material (a sedan: 19 meshes -> 7 parts).
 *    `prop-catalog` caches materials globally, so props of the same kind already
 *    share them; the merged geometries are cached here alongside.
 * 2. **Instance across actors.** Every actor of one catalog id shares those
 *    geometries, so each part becomes a single `InstancedMesh`. Ten sedans, ten
 *    SUVs and five pedestrians draw in 7 + 7 + 5 = 19 calls regardless of count.
 *
 * Contact shadows are a thirty-first draw call for any number of actors: one
 * instanced quad with a radial-gradient texture, laid 3 cm above the ground.
 * Deliberately not a shadow map — the city ships baked lighting and a real
 * shadow pass is a separate quality lane.
 *
 * ## Picking
 *
 * Instances have no names. Each batch carries `userData.actorIds` indexed by
 * `instanceId`, so a raycast resolves to an actor id in O(1) — see
 * {@link ActorRenderer.actorIdForHit}.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Intersection,
  type Material,
  type Object3D,
} from 'three';
import { buildProp, getEntry, type CatalogId, type Dims } from '@scenario-studio/prop-catalog';

/** What the renderer needs to draw one actor. */
export interface ActorView {
  readonly id: string;
  readonly catalogId: CatalogId;
  /** Ground-contact position in scene metres (prop origins are ground-centred). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingRad: number;
  readonly dims: Dims;
}

/** One material's worth of a merged prop. */
interface TemplatePart {
  geometry: BufferGeometry;
  material: Material;
}

interface PropTemplate {
  parts: TemplatePart[];
  dims: Dims;
}

const templates = new Map<string, PropTemplate>();

/**
 * Build (or fetch) the merged geometry set for a catalog id.
 *
 * Geometries are cloned into world space and concatenated per material, keeping
 * only `position` and `normal` — the only attributes `prop-catalog`'s materials
 * read (nothing in the palette enables `vertexColors` or maps).
 */
export function propTemplate(catalogId: CatalogId): PropTemplate {
  const cached = templates.get(catalogId);
  if (cached) return cached;

  const root = buildProp(catalogId);
  root.updateMatrixWorld(true);

  const byMaterial = new Map<string, { material: Material; positions: number[]; normals: number[] }>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const material = materials[0];
    if (!material) return;
    const flat = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    flat.applyMatrix4(mesh.matrixWorld);
    if (!flat.attributes.normal) flat.computeVertexNormals();
    const position = flat.attributes.position as BufferAttribute;
    const normal = flat.attributes.normal as BufferAttribute;

    let bucket = byMaterial.get(material.uuid);
    if (!bucket) {
      bucket = { material, positions: [], normals: [] };
      byMaterial.set(material.uuid, bucket);
    }
    for (let i = 0; i < position.count; i++) {
      bucket.positions.push(position.getX(i), position.getY(i), position.getZ(i));
      bucket.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    flat.dispose();
  });

  // The source prop was scratch: its geometries are not referenced again.
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });

  const parts: TemplatePart[] = [];
  for (const bucket of byMaterial.values()) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(bucket.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(bucket.normals), 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    parts.push({ geometry, material: bucket.material });
  }

  const template: PropTemplate = { parts, dims: getEntry(catalogId).dims };
  templates.set(catalogId, template);
  return template;
}

/** Drop every merged geometry. Materials belong to `prop-catalog` and stay. */
export function disposePropTemplates(): void {
  for (const template of templates.values()) {
    for (const part of template.parts) part.geometry.dispose();
  }
  templates.clear();
}

/** A soft dark blob, used as the contact shadow under every actor. */
function contactShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Soft-edged rather than linear: a linear falloff reads as a hard disc.
    gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    gradient.addColorStop(0.8, 'rgba(0,0,0,0.08)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

interface Batch {
  mesh: InstancedMesh;
  capacity: number;
}

const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);

/** Height of the contact shadow above the ground, metres. */
const SHADOW_LIFT = 0.03;

/** Selection colour — amber, the one hue the city never produces. */
export const SELECTION_COLOR = 0xffb020;

/**
 * Instanced renderer for the placed-actor layer.
 *
 * Owns one `Group` (`actors`) that the caller adds to the viewer's scene.
 * {@link sync} is idempotent and cheap enough to call on every pointer move
 * during a drag.
 */
export class ActorRenderer {
  readonly group = new Group();

  private readonly batches = new Map<string, Batch>();
  /** Actor id per instance slot, shared by every batch of one catalog id. */
  private readonly slots = new Map<string, string[]>();
  private readonly shadowTexture: CanvasTexture;
  private readonly shadowMaterial: MeshBasicMaterial;
  private readonly shadowGeometry: PlaneGeometry;
  private shadows: InstancedMesh | null = null;
  private shadowCapacity = 0;
  private readonly selection: LineSegments;
  private drawCalls = 0;

  constructor() {
    this.group.name = 'actors';

    this.shadowTexture = contactShadowTexture();
    this.shadowMaterial = new MeshBasicMaterial({
      map: this.shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      toneMapped: false,
    });
    // A unit quad in the XZ plane, so the instance matrix carries footprint size.
    this.shadowGeometry = new PlaneGeometry(1, 1);
    this.shadowGeometry.rotateX(-Math.PI / 2);

    this.selection = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: SELECTION_COLOR,
        toneMapped: false,
        // Editors need the selection visible even when it is behind a parked
        // van; that is worth more than depth correctness on an overlay.
        depthTest: false,
        transparent: true,
      }),
    );
    this.selection.name = 'actor-selection';
    this.selection.renderOrder = 30;
    this.selection.frustumCulled = false;
    this.group.add(this.selection);
  }

  /** Draw calls this layer contributes when everything is visible. */
  get stats(): { batches: number; drawCalls: number } {
    return { batches: this.batches.size, drawCalls: this.drawCalls };
  }

  /** Rebuild every instance matrix from `actors`. */
  sync(actors: readonly ActorView[]): void {
    const byCatalog = new Map<CatalogId, ActorView[]>();
    for (const actor of actors) {
      let list = byCatalog.get(actor.catalogId);
      if (!list) {
        list = [];
        byCatalog.set(actor.catalogId, list);
      }
      list.push(actor);
    }

    let draws = 0;
    for (const [catalogId, list] of byCatalog) {
      const template = propTemplate(catalogId);
      const ids = list.map((a) => a.id);
      this.slots.set(catalogId, ids);
      for (let part = 0; part < template.parts.length; part++) {
        const key = `${catalogId}#${part}`;
        const spec = template.parts[part] as TemplatePart;
        const batch = this.ensureBatch(key, spec, list.length);
        batch.mesh.userData.actorIds = ids;
        batch.mesh.count = list.length;
        list.forEach((actor, index) => {
          batch.mesh.setMatrixAt(index, poseMatrix(actor));
        });
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.mesh.computeBoundingSphere();
        batch.mesh.visible = list.length > 0;
        draws++;
      }
    }

    // Catalog ids that no longer have actors: keep the batch (placing one again
    // is common) but draw nothing.
    for (const [key, batch] of this.batches) {
      const catalogId = key.slice(0, key.lastIndexOf('#')) as CatalogId;
      if (!byCatalog.has(catalogId)) {
        batch.mesh.count = 0;
        batch.mesh.visible = false;
      }
    }

    this.syncShadows(actors);
    this.drawCalls = draws + (actors.length > 0 ? 1 : 0);
  }

  /** Highlight boxes around the selected actors. */
  setSelection(actors: readonly ActorView[]): void {
    const verts: number[] = [];
    for (const actor of actors) {
      pushBoxEdges(verts, actor);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geometry.computeBoundingSphere();
    this.selection.geometry.dispose();
    this.selection.geometry = geometry;
    this.selection.visible = verts.length > 0;
  }

  /** Objects a picking raycast should test. */
  pickables(): Object3D[] {
    const out: Object3D[] = [];
    for (const batch of this.batches.values()) {
      if (batch.mesh.count > 0) out.push(batch.mesh);
    }
    return out;
  }

  /** Resolve a raycast hit against {@link pickables} to an actor id. */
  actorIdForHit(hit: Intersection): string | null {
    const ids = hit.object.userData.actorIds as string[] | undefined;
    if (!ids || hit.instanceId === undefined) return null;
    return ids[hit.instanceId] ?? null;
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      batch.mesh.dispose();
      this.group.remove(batch.mesh);
    }
    this.batches.clear();
    this.slots.clear();
    this.shadows?.dispose();
    this.shadows = null;
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.shadowTexture.dispose();
    this.selection.geometry.dispose();
    (this.selection.material as Material).dispose();
    this.group.clear();
    this.group.removeFromParent();
  }

  private ensureBatch(key: string, spec: TemplatePart, needed: number): Batch {
    const existing = this.batches.get(key);
    if (existing && existing.capacity >= needed) return existing;
    if (existing) {
      this.group.remove(existing.mesh);
      existing.mesh.dispose();
    }
    // Grow in powers of two so a run of placements does not reallocate on every
    // click.
    const capacity = Math.max(8, 1 << Math.ceil(Math.log2(Math.max(1, needed))));
    const mesh = new InstancedMesh(spec.geometry, spec.material, capacity);
    mesh.name = `actor-batch.${key}`;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const batch: Batch = { mesh, capacity };
    this.batches.set(key, batch);
    this.group.add(mesh);
    return batch;
  }

  private syncShadows(actors: readonly ActorView[]): void {
    if (actors.length === 0) {
      if (this.shadows) this.shadows.count = 0;
      return;
    }
    if (!this.shadows || this.shadowCapacity < actors.length) {
      this.shadows?.dispose();
      if (this.shadows) this.group.remove(this.shadows);
      this.shadowCapacity = Math.max(16, 1 << Math.ceil(Math.log2(actors.length)));
      this.shadows = new InstancedMesh(
        this.shadowGeometry,
        this.shadowMaterial,
        this.shadowCapacity,
      );
      this.shadows.name = 'actor-contact-shadows';
      this.shadows.renderOrder = 9;
      this.group.add(this.shadows);
    }
    this.shadows.count = actors.length;
    actors.forEach((actor, index) => {
      _position.set(actor.x, actor.y + SHADOW_LIFT, actor.z);
      _quaternion.setFromAxisAngle(_up, actor.headingRad);
      // Wider than the body: a hard-edged blob the size of the footprint reads
      // as a decal, a slightly larger soft one reads as ambient occlusion.
      _scale.set(actor.dims.l * 1.3, 1, actor.dims.w * 1.7);
      this.shadows?.setMatrixAt(index, _matrix.compose(_position, _quaternion, _scale));
    });
    this.shadows.instanceMatrix.needsUpdate = true;
    this.shadows.computeBoundingSphere();
  }
}

function poseMatrix(actor: ActorView): Matrix4 {
  _position.set(actor.x, actor.y, actor.z);
  _quaternion.setFromAxisAngle(_up, actor.headingRad);
  _scale.set(1, 1, 1);
  return _matrix.compose(_position, _quaternion, _scale);
}

/** The 12 edges of an actor's oriented bounding box, as line-segment pairs. */
function pushBoxEdges(out: number[], actor: ActorView): void {
  const c = Math.cos(actor.headingRad);
  const s = Math.sin(actor.headingRad);
  const hl = actor.dims.l / 2;
  const hw = actor.dims.w / 2;
  const h = actor.dims.h;
  // Local (forward, lateral) -> scene: forward is (cos, -sin), left is (-sin, -cos).
  const corner = (f: number, l: number): [number, number] => [
    actor.x + c * f - s * l,
    actor.z - s * f - c * l,
  ];
  const [x0, z0] = corner(hl, hw);
  const [x1, z1] = corner(hl, -hw);
  const [x2, z2] = corner(-hl, -hw);
  const [x3, z3] = corner(-hl, hw);
  const yLo = actor.y + 0.02;
  const yHi = actor.y + h;
  const ring = [
    [x0, z0],
    [x1, z1],
    [x2, z2],
    [x3, z3],
  ] as const;
  for (let i = 0; i < 4; i++) {
    const a = ring[i] as readonly [number, number];
    const b = ring[(i + 1) % 4] as readonly [number, number];
    // bottom, top, and the vertical at this corner
    out.push(a[0], yLo, a[1], b[0], yLo, b[1]);
    out.push(a[0], yHi, a[1], b[0], yHi, b[1]);
    out.push(a[0], yLo, a[1], a[0], yHi, a[1]);
  }
}

/**
 * The translucent preview that follows the cursor during placement.
 *
 * Reuses the merged template geometry so entering placement mode costs one
 * `Group`, not a prop build — and swaps only the *material reference* on its own
 * meshes, never mutating `prop-catalog`'s shared materials.
 */
export class GhostActor {
  readonly group = new Group();

  private readonly validMaterial: MeshBasicMaterial;
  private readonly invalidMaterial: MeshBasicMaterial;
  private readonly meshes: Mesh[] = [];
  private readonly arrow: LineSegments;
  private catalogId: CatalogId | null = null;
  private valid = true;

  constructor() {
    this.group.name = 'placement-ghost';
    this.group.visible = false;
    this.group.renderOrder = 25;
    const base = {
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    };
    this.validMaterial = new MeshBasicMaterial({ ...base, color: 0x35d07f });
    this.invalidMaterial = new MeshBasicMaterial({ ...base, color: 0xf05252 });

    this.arrow = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false }),
    );
    this.arrow.renderOrder = 26;
    this.arrow.frustumCulled = false;
    this.group.add(this.arrow);
  }

  /** Swap the previewed prop. No-op when it is already showing. */
  show(catalogId: CatalogId): void {
    if (this.catalogId !== catalogId) {
      for (const mesh of this.meshes) this.group.remove(mesh);
      this.meshes.length = 0;
      const template = propTemplate(catalogId);
      for (const part of template.parts) {
        const mesh = new Mesh(part.geometry, this.material());
        mesh.frustumCulled = false;
        mesh.renderOrder = 25;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
      this.setArrow(template.dims.l);
      this.catalogId = catalogId;
    }
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  setPose(x: number, y: number, z: number, headingRad: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, headingRad, 0);
  }

  /** Green when the placement is legal, red when it is not. */
  setValid(valid: boolean): void {
    if (valid === this.valid) return;
    this.valid = valid;
    for (const mesh of this.meshes) mesh.material = this.material();
  }

  dispose(): void {
    this.validMaterial.dispose();
    this.invalidMaterial.dispose();
    this.arrow.geometry.dispose();
    (this.arrow.material as Material).dispose();
    this.group.clear();
    this.group.removeFromParent();
  }

  private material(): MeshBasicMaterial {
    return this.valid ? this.validMaterial : this.invalidMaterial;
  }

  /** A facing arrow on the ground, so heading is readable before the click. */
  private setArrow(length: number): void {
    const tip = Math.max(1.2, length * 0.75);
    const back = -Math.max(0.6, length * 0.35);
    const wing = 0.45;
    const y = 0.06;
    const verts = [
      back, y, 0, tip, y, 0,
      tip, y, 0, tip - wing, y, -wing,
      tip, y, 0, tip - wing, y, wing,
    ];
    this.arrow.geometry.dispose();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    this.arrow.geometry = geometry;
  }
}
