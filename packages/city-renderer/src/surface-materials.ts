import {
  Color,
  Mesh,
  type BufferGeometry,
  type Material,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/** A visual-only surface treatment. It never changes map geometry or transforms. */
export type SurfaceMaterialProfile = 'original' | 'enhanced' | 'presentation';
export type SurfaceClass = 'asphalt' | 'grass' | 'concrete' | 'curb' | 'marking' | 'unknown';
export type SurfaceLayer = 'road' | 'city' | 'vegetation';

export interface MaterialPackProvenance {
  id: string;
  version: string;
  author: string;
  license: string;
  source: string;
  externalAssets: readonly string[];
}

export interface MaterialPack {
  provenance: MaterialPackProvenance;
  classes: Readonly<Record<Exclude<SurfaceClass, 'marking' | 'unknown'>, {
    tint: number;
    tintMix: number;
    roughness: number;
    metresPerCell: number;
    variation: number;
  }>>;
}

/**
 * The built-in pack is authored as code and has no image dependencies. Its
 * world-space procedural detail is physically scaled in metres and cannot swim
 * when a tile LOD or camera changes.
 */
export const BUILTIN_SURFACE_MATERIAL_PACK: MaterialPack = {
  provenance: {
    id: 'uniscenarios-procedural-surfaces',
    version: '1.0.0',
    author: 'UniScenarios',
    license: 'Apache-2.0',
    source: 'packages/city-renderer/src/surface-materials.ts',
    externalAssets: [],
  },
  classes: {
    asphalt: { tint: 0x34383b, tintMix: 0.18, roughness: 0.96, metresPerCell: 0.42, variation: 0.075 },
    grass: { tint: 0x557846, tintMix: 0.20, roughness: 0.99, metresPerCell: 0.24, variation: 0.16 },
    concrete: { tint: 0xb7b3a8, tintMix: 0.12, roughness: 0.91, metresPerCell: 0.72, variation: 0.055 },
    curb: { tint: 0xc3c0b7, tintMix: 0.15, roughness: 0.93, metresPerCell: 0.36, variation: 0.045 },
  },
};

export interface SurfaceIdentity {
  objectPath: string;
  meshName: string;
  materialName: string;
  geometryDigest: string;
  layer: SurfaceLayer;
}

export interface SurfaceClassification {
  kind: SurfaceClass;
  identity: SurfaceIdentity;
  reason: string;
}

export interface SurfaceMaterialReport {
  profile: SurfaceMaterialProfile;
  registeredMaterials: number;
  enhancedMaterials: number;
  preservedMarkings: number;
  unknownMaterials: number;
  conflictingMaterials: number;
  byClass: Record<SurfaceClass, number>;
  unknownExamples: string[];
  lastApplyMs: number;
  shaderVariants: number;
  pack: MaterialPackProvenance;
}

const MARKING = /marking|lane[_ -]?mark|road[_ -]?line|crosswalk|handicap|utility|crack|oilpath|sand1.*mark|brick1.*mark/i;
const CURB = /curb|gutter/i;
const GRASS = /grass|turf|lawn|meadow/i;
const CONCRETE = /sidewalk|concrete|cement|pavement|footpath/i;
const ASPHALT = /asphalt|roads?_road|road_layer|road surface|tarmac/i;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pathFor(object: Object3D): string {
  const parts: string[] = [];
  let current: Object3D | null = object;
  while (current) {
    if (current.name) parts.push(current.name);
    current = current.parent;
  }
  return parts.reverse().join('/');
}

function q(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toFixed(3) : '-';
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Stable across GLTF parses: it deliberately excludes runtime UUIDs. */
export function geometryDigest(geometry: BufferGeometry): string {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const attributes = Object.entries(geometry.attributes)
    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.count}`)
    .sort()
    .join('|');
  const signature = [
    geometry.index?.count ?? 0,
    attributes,
    q(box?.min.x), q(box?.min.y), q(box?.min.z),
    q(box?.max.x), q(box?.max.y), q(box?.max.z),
  ].join(';');
  return fnv1a(signature);
}

export function classifySurface(mesh: Mesh, material: Material, layer: SurfaceLayer): SurfaceClassification {
  const identity: SurfaceIdentity = {
    objectPath: pathFor(mesh),
    meshName: mesh.name,
    materialName: material.name,
    geometryDigest: geometryDigest(mesh.geometry),
    layer,
  };
  const haystack = normalize(`${identity.objectPath} ${identity.meshName} ${identity.materialName}`);
  // Markings win every ambiguity and are explicitly preserved.
  if (MARKING.test(haystack)) return { kind: 'marking', identity, reason: 'semantic marking identity' };
  if (CURB.test(haystack)) return { kind: 'curb', identity, reason: 'semantic curb/gutter identity' };
  if (GRASS.test(haystack)) return { kind: 'grass', identity, reason: 'semantic grass identity' };
  if (CONCRETE.test(haystack)) return { kind: 'concrete', identity, reason: 'semantic sidewalk/concrete identity' };
  if (ASPHALT.test(haystack)) return { kind: 'asphalt', identity, reason: 'semantic road/asphalt identity' };
  return { kind: 'unknown', identity, reason: 'no conservative semantic match' };
}

type Shader = WebGLProgramParametersWithUniforms;
type CompilableMaterial = Material & {
  color?: Color;
  roughness?: number;
  metalness?: number;
};

interface MaterialRecord {
  material: CompilableMaterial;
  classification: SurfaceClassification;
  conflicts: Set<SurfaceClass>;
  originalColor: Color | null;
  originalRoughness: number | undefined;
  originalMetalness: number | undefined;
  originalOnBeforeCompile: Material['onBeforeCompile'];
  originalProgramKey: Material['customProgramCacheKey'];
  refCount: number;
}

const SURFACE_VERTEX_DECL = /* glsl */ `\nvarying vec3 vSurfaceWorldPos;\n`;
const SURFACE_VERTEX_BODY = /* glsl */ `
\tvec4 surfaceWorldPosition = vec4( transformed, 1.0 );
\t#ifdef USE_INSTANCING
\t\tsurfaceWorldPosition = instanceMatrix * surfaceWorldPosition;
\t#endif
\tvSurfaceWorldPos = ( modelMatrix * surfaceWorldPosition ).xyz;
`;
const SURFACE_FRAGMENT_DECL = /* glsl */ `
varying vec3 vSurfaceWorldPos;
float surfaceHash( vec2 p ) {
\tvec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
\tp3 += dot( p3, p3.yzx + 33.33 );
\treturn fract( ( p3.x + p3.y ) * p3.z );
}
`;

function injectProceduralSurface(shader: Shader, cellSize: number, variation: number, presentation: boolean): void {
  const scale = Math.max(0.01, cellSize).toFixed(4);
  const strength = (variation * (presentation ? 1.35 : 1)).toFixed(4);
  shader.vertexShader = SURFACE_VERTEX_DECL + shader.vertexShader.replace(
    '#include <project_vertex>',
    `#include <project_vertex>\n${SURFACE_VERTEX_BODY}`,
  );
  shader.fragmentShader = SURFACE_FRAGMENT_DECL + shader.fragmentShader.replace(
    '#include <map_fragment>',
    /* glsl */ `#include <map_fragment>
\tvec2 surfaceCell = floor( vSurfaceWorldPos.xz / ${scale} );
\tfloat surfaceGrain = surfaceHash( surfaceCell ) - 0.5;
\tfloat surfaceMacro = surfaceHash( floor( vSurfaceWorldPos.xz / (${scale} * 11.0) ) ) - 0.5;
\tdiffuseColor.rgb *= 1.0 + surfaceGrain * ${strength} + surfaceMacro * ${strength} * 0.55;`,
  );
}

function canEnhance(material: CompilableMaterial): boolean {
  return Boolean(material.color?.isColor) && typeof material.roughness === 'number';
}

export class SurfaceMaterialRegistry {
  private readonly records = new Map<Material, MaterialRecord>();
  private readonly treeMaterials = new WeakMap<Object3D, Material[]>();
  private profile: SurfaceMaterialProfile = 'original';
  private lastApplyMs = 0;

  registerTree(root: Object3D, layer: SurfaceLayer): void {
    const start = performance.now();
    const touched: Material[] = [];
    const changed = new Set<MaterialRecord>();
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        touched.push(material);
        const classification = classifySurface(mesh, material, layer);
        const existing = this.records.get(material);
        if (existing) {
          existing.refCount++;
          if (existing.classification.kind !== classification.kind) {
            existing.conflicts.add(classification.kind);
            changed.add(existing);
          }
          continue;
        }
        const compilable = material as CompilableMaterial;
        const record: MaterialRecord = {
          material: compilable,
          classification,
          conflicts: new Set(),
          originalColor: compilable.color?.clone() ?? null,
          originalRoughness: compilable.roughness,
          originalMetalness: compilable.metalness,
          originalOnBeforeCompile: material.onBeforeCompile,
          originalProgramKey: material.customProgramCacheKey,
          refCount: 1,
        };
        this.records.set(material, record);
        changed.add(record);
      }
    });
    this.treeMaterials.set(root, touched);
    // Streaming in one new tile must not re-process every resident material.
    for (const record of changed) this.applyRecord(record, this.profile);
    this.lastApplyMs = performance.now() - start;
  }

  unregisterTree(root: Object3D): void {
    for (const material of this.treeMaterials.get(root) ?? []) {
      const record = this.records.get(material);
      if (!record) continue;
      record.refCount--;
      if (record.refCount <= 0) this.records.delete(material);
    }
    this.treeMaterials.delete(root);
  }

  apply(profile: SurfaceMaterialProfile): SurfaceMaterialReport {
    const start = performance.now();
    this.profile = profile;
    for (const record of this.records.values()) this.applyRecord(record, profile);
    this.lastApplyMs = performance.now() - start;
    return this.report();
  }

  private applyRecord(record: MaterialRecord, profile: SurfaceMaterialProfile): void {
    const { material } = record;
    if (record.originalColor && material.color) material.color.copy(record.originalColor);
    if (record.originalRoughness !== undefined) material.roughness = record.originalRoughness;
    if (record.originalMetalness !== undefined) material.metalness = record.originalMetalness;
    material.onBeforeCompile = record.originalOnBeforeCompile;
    material.customProgramCacheKey = record.originalProgramKey;

    const kind = record.conflicts.size > 0 ? 'unknown' : record.classification.kind;
    if (profile === 'original' || kind === 'unknown' || kind === 'marking' || !canEnhance(material)) {
      material.needsUpdate = true;
      return;
    }
    const style = BUILTIN_SURFACE_MATERIAL_PACK.classes[kind];
    if (record.originalColor && material.color) {
      const mix = profile === 'presentation' ? Math.min(0.32, style.tintMix * 1.35) : style.tintMix;
      material.color.lerp(new Color(style.tint), mix);
    }
    material.roughness = Math.max(material.roughness ?? 0, style.roughness);
    material.metalness = Math.min(material.metalness ?? 0, 0.04);
    const baseCompile = record.originalOnBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      baseCompile(shader, renderer);
      injectProceduralSurface(shader, style.metresPerCell, style.variation, profile === 'presentation');
    };
    const baseKey = record.originalProgramKey.call(material);
    material.customProgramCacheKey = () => `${baseKey}|surface-${profile}-${kind}-v1`;
    material.needsUpdate = true;
  }

  get currentProfile(): SurfaceMaterialProfile { return this.profile; }

  report(): SurfaceMaterialReport {
    const byClass: Record<SurfaceClass, number> = {
      asphalt: 0, grass: 0, concrete: 0, curb: 0, marking: 0, unknown: 0,
    };
    let enhancedMaterials = 0;
    let conflicts = 0;
    const unknownExamples: string[] = [];
    for (const record of this.records.values()) {
      const kind = record.conflicts.size > 0 ? 'unknown' : record.classification.kind;
      byClass[kind]++;
      if (record.conflicts.size > 0) conflicts++;
      if (kind === 'unknown' && unknownExamples.length < 12) {
        unknownExamples.push(`${record.classification.identity.objectPath} :: ${record.material.name || '(unnamed)'} :: ${record.classification.identity.geometryDigest}`);
      }
      if (this.profile !== 'original' && kind !== 'unknown' && kind !== 'marking' && canEnhance(record.material)) enhancedMaterials++;
    }
    return {
      profile: this.profile,
      registeredMaterials: this.records.size,
      enhancedMaterials,
      preservedMarkings: byClass.marking,
      unknownMaterials: byClass.unknown,
      conflictingMaterials: conflicts,
      byClass,
      unknownExamples,
      lastApplyMs: this.lastApplyMs,
      shaderVariants: this.profile === 'original' ? 0 : 4,
      pack: BUILTIN_SURFACE_MATERIAL_PACK.provenance,
    };
  }

  dispose(): void {
    this.apply('original');
    this.records.clear();
  }
}
