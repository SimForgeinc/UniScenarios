/**
 * Types for the tiled 3D city manifest (schema version 1.x) plus the public
 * option/stat shapes of {@link CityViewer}.
 */

export interface ManifestBounds {
  min: number[];
  max: number[];
}

export interface ManifestLod {
  level: number;
  file: string;
  triangles: number;
  fileSize: number;
  /** Object-space error in metres this LOD introduces vs. LOD0. LOD0 is always 0. */
  geometricError: number;
}

export interface ManifestShadowLightmap {
  lod: number;
  file: string;
}

export interface ManifestTile {
  id: string;
  gridX: number;
  gridZ: number;
  bounds: ManifestBounds;
  lods: ManifestLod[];
  shadowLightmaps?: ManifestShadowLightmap[];
}

export interface ManifestVegPrototype {
  meshName: string;
  triangles: number;
  instanceCount: number;
}

export interface ManifestVegetationTile {
  id: string;
  gridX: number;
  gridZ: number;
  bounds: ManifestBounds;
  lods: ManifestLod[];
  prototypes: ManifestVegPrototype[];
  instanceFile: string;
}

export interface ManifestStaticLayer {
  id: string;
  file: string;
  triangles: number;
  fileSize: number;
}

export interface ManifestScene {
  bounds: ManifestBounds;
  totalTriangles: number;
  gridDimensions: number[];
  cellSize: number[];
  origin: number[];
  lodLevels: number;
  coordinateSystem: string;
}

export interface CityManifest {
  version: string;
  scene: ManifestScene;
  tiles: ManifestTile[];
  staticLayers?: ManifestStaticLayer[];
  vegetationTiles?: ManifestVegetationTile[];
  shadowLightmap?: {
    /** Direction the sunlight *travels* (i.e. points away from the sun). */
    sunDirection: number[];
    bakedAt?: string;
    method?: string;
  };
  actorCounts?: Record<string, number>;
}

/**
 * Payload of `tiles/veg_X_Z.instances.json`.
 *
 * `transforms` is a flat run of 16-float column-major matrices (translation at
 * offsets 12/13/14 — verified against the Yale Street data), grouped by
 * prototype in `prototypes` order with `counts[i]` entries per group.
 * `lodKeepCounts[lod][i]` is how many of group `i` to draw at that LOD.
 */
export interface VegetationInstanceFile {
  prototypes: string[];
  counts: number[];
  transforms: number[];
  lodKeepCounts?: number[][];
}

export interface CityViewerOptions {
  /** Base URL that manifest-relative asset paths resolve against. */
  baseUrl?: string;
  /** Device pixel ratio cap. Retina at 2.0 is ~4x the fill cost of 1.0. */
  maxPixelRatio?: number;
  /** Screen-space-error threshold in pixels; smaller = more aggressive streaming. */
  maxScreenSpaceError?: number;
  /** Separate threshold for vegetation tiles (their errors use a different scale). */
  vegetationScreenSpaceError?: number;
  /** Resident geometry+texture budget in bytes (estimated GPU footprint). */
  byteBudget?: number;
  /** Concurrent tile fetch/parse slots. */
  maxConcurrentLoads?: number;
  /** Per-frame milliseconds spent pushing new textures to the GPU. */
  uploadBudgetMs?: number;
  /** HDRI environment, relative to baseUrl. */
  environmentUrl?: string;
  /** Directional light intensity. */
  sunIntensity?: number;
  /** Environment (IBL) intensity. */
  environmentIntensity?: number;
  /** Tone mapping exposure. */
  exposure?: number;
  /** Max distance (m) at which vegetation tiles are drawn. */
  vegetationMaxDistance?: number;
  /** Resolution (px) of one grid cell inside the stitched shadow atlas. */
  shadowAtlasCellSize?: number;
  /** 0 disables the baked shadow term entirely. */
  shadowStrength?: number;
}

export interface CityViewerStats {
  fps: number;
  frameMsAvg: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  /** Tiles with at least one resident LOD. */
  residentTiles: number;
  /** Resident (tile, lod) assets across city + vegetation. */
  residentAssets: number;
  residentBytes: number;
  byteBudget: number;
  loading: number;
  queued: number;
  /** Assets parsed and waiting on the paced GPU upload. */
  uploading: number;
  jsHeapMB: number | null;
  cameraMode: 'orbit' | 'fly';
}

export interface BenchResult {
  avgFps: number;
  p95FrameMs: number;
  minFps: number;
  drawCalls: number;
  residentBytes: number;
  frames: number;
  durationMs: number;
}
