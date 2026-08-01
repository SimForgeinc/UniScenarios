import {
  AgXToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Texture } from 'three';
import { CameraRig, type CameraMode } from './camera-controls';
import { FrameStats, jsHeapMB } from './frame-stats';
import {
  collectResources,
  estimateResourceBytes,
  getGLTFLoader,
} from './gltf';
import { createSun, loadEnvironment } from './environment';
import { boundsToBox3, normalizeLods, resolveUrl } from './manifest';
import { patchTree, type ShadowPatchOptions } from './materials';
import { ShadowAtlas } from './shadow-atlas';
import {
  TileStreamLayer,
  boxOf,
  type EvictionCandidate,
  type PreparedAsset,
  type StreamTileDef,
} from './streaming';
import { buildVegetation, type VegPrototypeGroup } from './vegetation';
import type {
  BenchResult,
  CityManifest,
  CityViewerOptions,
  CityViewerStats,
  VegetationInstanceFile,
} from './types';

export interface CityViewerLayers {
  city: boolean;
  vegetation: boolean;
}

const DEFAULTS = {
  maxPixelRatio: 2,
  /**
   * Pixel threshold for the LOD selector. The Yale Street geometric errors are
   * a 4x chain (4.6 / 18.2 / 72.9 m for a 76 m cell), so at a 1600 px tall
   * buffer this puts LOD0 inside ~23 m, LOD1 inside ~93 m and LOD2 inside
   * ~370 m — which is what keeps the resident set near the byte budget, since
   * LOD here is really texture resolution (2048 -> 256 px) and one LOD0 tile
   * can cost 900 MB of RGBA.
   */
  maxScreenSpaceError: 300,
  /**
   * Vegetation errors in this manifest are ~16x the city's for the same cell,
   * so they need their own threshold or every tree tile would pin to LOD0.
   */
  vegetationScreenSpaceError: 2000,
  /**
   * Estimated GPU bytes. 1.5 GB, not the 2.5 GB the textures would happily
   * fill: Chrome's GPU process on an M-series MacBook kills the tab somewhere
   * above ~2 GB of live RGBA8 + mips, and the in-flight decode queue adds its
   * own copy on top of whatever is already resident.
   */
  byteBudget: 1.5 * 1024 * 1024 * 1024,
  maxConcurrentLoads: 2,
  uploadBudgetMs: 5,
  /** ~one 2048px texture per frame; the pacer stops as soon as this is spent. */
  uploadPixelsPerFrame: 4.2e6,
  environmentUrl: 'env/sky.hdr',
  /**
   * Sun vs sky balance. The baked lightmap only removes *direct* light, so a
   * sky-dominant balance makes the shadows invisible; 5.0 / 0.6 is where the
   * path-traced shadows read at street level without crushing the ambient.
   */
  sunIntensity: 5,
  environmentIntensity: 0.6,
  exposure: 1,
  vegetationMaxDistance: 260,
  shadowAtlasCellSize: 512,
  shadowStrength: 1,
  debugShadowProjection: false,
};

/**
 * Distance bands for vegetation density, and the `lodKeepCounts` row each band
 * uses. Row 1 is skipped on purpose: this dataset ships it identical to row 0,
 * so bands map to rows 0 / 2 / 3 to actually thin the instances out.
 */
const VEG_BAND_DISTANCES = [80, 170];
const VEG_BAND_KEEP_ROW = [0, 2, 3];

const _rayOrigin = new Vector3();
const _down = new Vector3(0, -1, 0);
const _cameraPos = new Vector3();

/**
 * Streaming 3D city viewer.
 *
 * Owns the renderer, the scene, both streaming layers (city tiles + vegetation)
 * and the camera rig. Framework free — see `./react` for the React wrapper.
 */
export class CityViewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: CameraRig;

  /** Static road/ground layer, also the ground-sampling target. */
  readonly roadGroup = new Group();
  readonly cityGroup = new Group();
  readonly vegetationGroup = new Group();

  private readonly canvas: HTMLCanvasElement;
  private readonly options: Required<CityViewerOptions>;
  private readonly frameStats = new FrameStats(150);
  private readonly raycaster = new Raycaster();
  private readonly abort = new AbortController();

  private manifest: CityManifest | null = null;
  private assetBase = '';
  private atlas: ShadowAtlas | null = null;
  private cityLayer: TileStreamLayer | null = null;
  private vegLayer: TileStreamLayer | null = null;
  private roadLayer: TileStreamLayer | null = null;
  private sun: DirectionalLight | null = null;
  private disposeEnvironment: (() => void) | null = null;
  private vegetationData = new Map<string, VegetationInstanceFile>();
  private sceneBox = new Box3();

  private rafHandle = 0;
  private lastFrameTime = 0;
  private lastStreamUpdate = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private benchmarkActive = false;
  private uploadSkips = 0;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private fps = 0;

  constructor(canvas: HTMLCanvasElement, options: CityViewerOptions = {}) {
    this.canvas = canvas;
    // Explicit undefined must not clobber a default (callers routinely spread
    // partially-filled option objects).
    const provided = Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined),
    ) as CityViewerOptions;
    this.options = { ...DEFAULTS, baseUrl: '', ...provided };

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.options.maxPixelRatio));
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = this.options.exposure;
    this.renderer.shadowMap.enabled = false; // the city ships baked shadows
    this.renderer.info.autoReset = false;

    this.scene.name = 'city';
    this.scene.background = new Color(0x14181e);
    this.scene.environmentIntensity = this.options.environmentIntensity;
    this.cityGroup.name = 'city-tiles';
    this.vegetationGroup.name = 'vegetation';
    this.roadGroup.name = 'road';
    this.scene.add(this.roadGroup, this.cityGroup, this.vegetationGroup);

    this.camera = new PerspectiveCamera(55, this.aspect(), 0.5, 6000);
    this.camera.position.set(0, 200, 400);
    this.controls = new CameraRig(this.camera, canvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    this.lastFrameTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private aspect(): number {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    return w / h;
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.options.maxPixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- loading

  async loadMap(manifestUrl: string): Promise<void> {
    try {
      await this.loadMapInner(manifestUrl);
    } catch (err) {
      // dispose() aborts every in-flight request; that is not a failure.
      if (this.disposed || (err as { name?: string } | null)?.name === 'AbortError') return;
      throw err;
    }
  }

  private async loadMapInner(manifestUrl: string): Promise<void> {
    const url = this.options.baseUrl ? resolveUrl(this.options.baseUrl, manifestUrl) : manifestUrl;
    this.assetBase = url.replace(/[^/]*$/, '');
    const manifest = (await fetch(url, { signal: this.abort.signal }).then((r) => {
      if (!r.ok) throw new Error(`manifest ${r.status} ${url}`);
      return r.json();
    })) as CityManifest;
    if (this.disposed) return;
    this.manifest = manifest;

    this.sceneBox = boundsToBox3(manifest.scene.bounds);
    const center = this.sceneBox.getCenter(new Vector3());
    const size = this.sceneBox.getSize(new Vector3());
    this.frameCamera(center, size);

    const sunDir = manifest.shadowLightmap?.sunDirection ?? [-0.5, -0.6, -0.6];
    this.sun = createSun({
      direction: new Vector3(sunDir[0] ?? -0.5, sunDir[1] ?? -0.6, sunDir[2] ?? -0.6),
      intensity: this.options.sunIntensity,
      target: center,
    });
    this.scene.add(this.sun, this.sun.target);

    this.atlas = new ShadowAtlas(manifest, this.options.shadowAtlasCellSize);

    const environmentUrl = resolveUrl(this.assetBase, this.options.environmentUrl);
    const environmentPromise = loadEnvironment(this.renderer, this.scene, environmentUrl)
      .then((dispose) => {
        if (this.disposed) dispose();
        else this.disposeEnvironment = dispose;
      })
      .catch((err: unknown) => console.error('[city-renderer] environment failed', err));

    const atlasPromise = this.atlas.load(manifest, this.assetBase, this.abort.signal);
    const vegetationPromise = this.loadVegetationInstances(manifest);

    this.createRoadLayer(manifest);
    this.createCityLayer(manifest);
    await vegetationPromise;
    if (this.disposed) return;
    this.createVegetationLayer(manifest);

    await Promise.all([environmentPromise, atlasPromise]);
  }

  /** Whole-city framing: 3/4 view from above the south-west corner. */
  private frameCamera(center: Vector3, size: Vector3): void {
    const span = Math.max(size.x, size.z);
    const position = new Vector3(
      center.x - span * 0.3,
      center.y + span * 0.31,
      center.z + span * 0.42,
    );
    this.controls.minDistance = 3;
    this.controls.maxDistance = span * 4;
    this.controls.setView(position, center);
  }

  private shadowOptions(box: Box3, fadeFrom: number, fadeTo: number): ShadowPatchOptions {
    const atlas = this.atlas;
    if (!atlas) throw new Error('shadow atlas not ready');
    return {
      atlas: atlas.texture,
      rect: atlas.rect,
      strength: this.options.shadowStrength,
      wallWeight: 0.5,
      debug: this.options.debugShadowProjection,
      fadeStartY: box.min.y + fadeFrom,
      fadeEndY: box.min.y + fadeTo,
    };
  }

  private async fetchBuffer(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.arrayBuffer();
  }

  /** Shared per-asset preparation: static matrices, bounds, anisotropy. */
  private prepareTree(root: Object3D): void {
    const maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    root.matrixAutoUpdate = false;
    root.traverse((obj) => {
      obj.matrixAutoUpdate = false;
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
          const tex = value as Texture | null;
          if (tex && (tex as unknown as { isTexture?: boolean }).isTexture) {
            tex.anisotropy = maxAnisotropy;
          }
        }
      }
    });
    root.updateMatrixWorld(true);
  }

  private createRoadLayer(manifest: CityManifest): void {
    const road = manifest.staticLayers?.find((layer) => layer.id === 'road');
    if (!road) return;
    const def: StreamTileDef = {
      id: 'road',
      box: this.sceneBox.clone(),
      lods: [
        {
          level: 0,
          file: road.file,
          triangles: road.triangles,
          fileSize: road.fileSize,
          geometricError: 0,
        },
      ],
    };
    this.roadLayer = new TileStreamLayer({
      name: 'road-layer',
      renderer: this.renderer,
      scene: this.scene,
      defs: [def],
      maxConcurrent: 1,
      memory: this.memory,
      pinCoarsest: true,
      build: async (tileDef, lod, signal) => {
        const buffer = await this.fetchBuffer(resolveUrl(this.assetBase, lod.file), signal);
        const gltf = await getGLTFLoader().parseAsync(buffer, '');
        const root = gltf.scene;
        root.name = tileDef.id;
        this.prepareTree(root);
        const box = new Box3().setFromObject(root);
        // The road is the ground: it takes the shadow term everywhere, and only
        // the electric towers reaching above ~20 m fade out of it.
        patchTree(root, this.shadowOptions(box, 20, 40));
        const resources = collectResources(root);
        return {
          object: root,
          resources,
          bytes: estimateResourceBytes(resources),
          pendingTextures: [...resources.textures],
        } satisfies PreparedAsset;
      },
    });
    this.roadGroup.add(this.roadLayer.group);
  }

  private createCityLayer(manifest: CityManifest): void {
    const defs: StreamTileDef[] = manifest.tiles.map((tile) => ({
      id: tile.id,
      box: boxOf(tile.bounds.min, tile.bounds.max),
      lods: normalizeLods(tile.lods),
    }));
    this.cityLayer = new TileStreamLayer({
      name: 'city-layer',
      renderer: this.renderer,
      scene: this.scene,
      defs,
      maxConcurrent: this.options.maxConcurrentLoads,
      memory: this.memory,
      pinCoarsest: true,
      build: async (def, lod, signal) => {
        const buffer = await this.fetchBuffer(resolveUrl(this.assetBase, lod.file), signal);
        const gltf = await getGLTFLoader().parseAsync(buffer, '');
        const root = gltf.scene;
        root.name = `${def.id}.lod${lod.level}`;
        this.prepareTree(root);
        const box = new Box3().setFromObject(root);
        patchTree(root, this.shadowOptions(box, 20, 40));
        const resources = collectResources(root);
        return {
          object: root,
          resources,
          bytes: estimateResourceBytes(resources),
          pendingTextures: [...resources.textures],
        } satisfies PreparedAsset;
      },
    });
    this.cityGroup.add(this.cityLayer.group);
  }

  private async loadVegetationInstances(manifest: CityManifest): Promise<void> {
    const tiles = manifest.vegetationTiles ?? [];
    await Promise.all(
      tiles.map(async (tile) => {
        try {
          const res = await fetch(resolveUrl(this.assetBase, tile.instanceFile), {
            signal: this.abort.signal,
          });
          if (!res.ok) return;
          this.vegetationData.set(tile.id, (await res.json()) as VegetationInstanceFile);
        } catch {
          /* a tile without instance data simply renders no vegetation */
        }
      }),
    );
  }

  private createVegetationLayer(manifest: CityManifest): void {
    const tiles = manifest.vegetationTiles ?? [];
    if (tiles.length === 0) return;
    const defs: StreamTileDef[] = tiles
      .filter((tile) => this.vegetationData.has(tile.id))
      .map((tile) => ({
        id: tile.id,
        box: boxOf(tile.bounds.min, tile.bounds.max),
        lods: normalizeLods(tile.lods),
      }));

    this.vegLayer = new TileStreamLayer({
      name: 'vegetation-layer',
      renderer: this.renderer,
      scene: this.scene,
      defs,
      maxConcurrent: 2,
      memory: this.memory,
      pinCoarsest: false,
      want: (_def, distance) => distance <= this.options.vegetationMaxDistance,
      build: async (def, lod, signal) => {
        const data = this.vegetationData.get(def.id);
        if (!data) throw new Error(`no instance data for ${def.id}`);
        const buffer = await this.fetchBuffer(resolveUrl(this.assetBase, lod.file), signal);
        const gltf = await getGLTFLoader().parseAsync(buffer, '');
        this.prepareTree(gltf.scene);
        const built = buildVegetation(gltf.scene, data, VEG_BAND_KEEP_ROW);
        built.object.name = `${def.id}.lod${lod.level}`;
        built.object.userData.prototypes = built.prototypes;
        patchTree(built.object, this.shadowOptions(def.box, 6, 14));
        const resources = collectResources(built.object);
        return {
          object: built.object,
          resources,
          bytes: estimateResourceBytes(resources),
          pendingTextures: [...resources.textures],
          dispose: () => {
            for (const proto of built.prototypes) for (const mesh of proto.meshes) mesh.dispose();
            built.object.clear();
          },
        } satisfies PreparedAsset;
      },
      onTick: (_def, asset, distance) => {
        const prototypes = (asset.object.userData.prototypes ?? null) as VegPrototypeGroup[] | null;
        if (!prototypes) return;
        let band = VEG_BAND_DISTANCES.length;
        for (let i = 0; i < VEG_BAND_DISTANCES.length; i++) {
          if (distance <= (VEG_BAND_DISTANCES[i] ?? 0)) {
            band = i;
            break;
          }
        }
        const visible = distance <= this.options.vegetationMaxDistance;
        asset.object.visible = visible;
        if (!visible) return;
        for (const proto of prototypes) {
          const count = proto.keepPerBand[band] ?? proto.keepPerBand[proto.keepPerBand.length - 1];
          for (const mesh of proto.meshes) mesh.count = count ?? mesh.instanceMatrix.count;
        }
      },
    });
    this.vegetationGroup.add(this.vegLayer.group);
  }

  // ------------------------------------------------------------------ frame

  private tick = (): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (!this.benchmarkActive) this.controls.update(dt);

    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(_cameraPos);

    // Streaming decisions are cheap but not free: 10 Hz is plenty responsive.
    if (now - this.lastStreamUpdate > 100) {
      this.lastStreamUpdate = now;
      this.updateStreaming(_cameraPos);
    }
    this.vegLayer?.tickDisplayed();

    // Adaptive upload backoff: a 2048px texture costs ~30 ms of GPU time on
    // this class of machine, so after a frame that already ran long we skip the
    // pacer entirely and let the pipeline drain instead of stacking stalls.
    // The counter guarantees forward progress if frames stay heavy.
    const ceiling = Math.max(14, this.frameStats.percentile(0.5) * 2);
    if (dt * 1000 <= ceiling || this.uploadSkips >= 4) {
      this.uploadSkips = 0;
      const deadline = now + this.options.uploadBudgetMs;
      const pixelBudget = { remaining: this.options.uploadPixelsPerFrame };
      this.roadLayer?.pumpUploads(deadline, pixelBudget, this.camera);
      this.cityLayer?.pumpUploads(deadline, pixelBudget, this.camera);
      this.vegLayer?.pumpUploads(deadline, pixelBudget, this.camera);
    } else {
      this.uploadSkips++;
    }

    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;

    // Wall-clock frame delta (not just our CPU slice) so the HUD reports what
    // the display actually did, including time lost to the compositor.
    this.frameStats.push(Math.min(1000, dt * 1000));
    this.fps = 1000 / Math.max(0.001, this.frameStats.avg());
    this.onFrame?.(dt);
  };

  /** Optional per-frame hook (used by the benchmark and by integrations). */
  onFrame: ((dt: number) => void) | null = null;

  private updateStreaming(cameraPos: Vector3): void {
    const height = this.renderer.domElement.height || 1;
    const sseScale = height / (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2));
    this.roadLayer?.update(cameraPos, sseScale, this.options.maxScreenSpaceError);
    this.cityLayer?.update(cameraPos, sseScale, this.options.maxScreenSpaceError);
    this.vegLayer?.update(cameraPos, sseScale, this.options.vegetationScreenSpaceError);
    this.enforceBudget();
  }

  /**
   * Shared ledger for both layers. In-flight decodes count against the budget
   * too — a parsed-but-not-yet-uploaded LOD0 tile holds its whole texture set
   * as ImageBitmaps, and three concurrent ones are what took the tab down
   * before this existed.
   */
  private readonly memory = {
    admit: (bytes: number, priority: number): boolean => {
      const budget = this.options.byteBudget;
      if (this.totalBytes() + bytes <= budget) return true;
      return this.freeSpace(budget - bytes, priority);
    },
    maxAssetBytes: (): number => this.options.byteBudget * 0.45,
  };

  private enforceBudget(): void {
    this.freeSpace(this.options.byteBudget, Infinity);
  }

  /**
   * Evicts until `this.totalBytes() <= limit`, touching only assets that score
   * worse than `priority`. Returns whether the limit was reached.
   */
  private freeSpace(limit: number, priority: number): boolean {
    let total = this.totalBytes();
    if (total <= limit) return true;
    const candidates: EvictionCandidate[] = [];
    this.cityLayer?.evictionCandidates(candidates);
    this.vegLayer?.evictionCandidates(candidates);
    // Worst score first: out-of-range tiles, then overshoot, then distance.
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates) {
      if (total <= limit) break;
      if (candidate.score <= priority) break; // nothing cheaper left to give up
      total -= candidate.layer.evict(candidate);
    }
    return total <= limit;
  }

  private residentBytes(): number {
    return (
      (this.cityLayer?.residentBytes ?? 0) +
      (this.vegLayer?.residentBytes ?? 0) +
      (this.roadLayer?.residentBytes ?? 0)
    );
  }

  private totalBytes(): number {
    return (
      this.residentBytes() +
      (this.cityLayer?.pendingBytes ?? 0) +
      (this.vegLayer?.pendingBytes ?? 0) +
      (this.roadLayer?.pendingBytes ?? 0)
    );
  }

  // ------------------------------------------------------------- public API

  getStats(): CityViewerStats {
    const city = this.cityLayer?.stats();
    const veg = this.vegLayer?.stats();
    const road = this.roadLayer?.stats();
    const sum = (pick: (s: NonNullable<typeof city>) => number): number =>
      (city ? pick(city) : 0) + (veg ? pick(veg) : 0) + (road ? pick(road) : 0);
    return {
      fps: this.fps,
      frameMsAvg: this.frameStats.avg(),
      frameMsP95: this.frameStats.percentile(0.95),
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      programs: this.renderer.info.programs?.length ?? 0,
      residentTiles: sum((s) => s.residentTiles),
      residentAssets: sum((s) => s.residentAssets),
      residentBytes: this.residentBytes(),
      pendingBytes: this.totalBytes() - this.residentBytes(),
      byteBudget: this.options.byteBudget,
      loading: sum((s) => s.loading),
      queued: sum((s) => s.queued),
      uploading: sum((s) => s.uploading),
      jsHeapMB: jsHeapMB(),
      cameraMode: this.controls.mode,
    };
  }

  setCameraMode(mode: CameraMode): void {
    this.controls.setMode(mode);
  }

  toggleCameraMode(): CameraMode {
    return this.controls.toggleMode();
  }

  setLayerVisible(layer: keyof CityViewerLayers | 'road', visible: boolean): void {
    if (layer === 'city') this.cityGroup.visible = visible;
    else if (layer === 'vegetation') this.vegetationGroup.visible = visible;
    else this.roadGroup.visible = visible;
  }

  setExposure(exposure: number): void {
    this.options.exposure = exposure;
    this.renderer.toneMappingExposure = exposure;
  }

  /**
   * Ground height under a world XZ, or null if nothing is there.
   *
   * Rays are cast downward against the road layer first (it is the actual
   * ground surface and always resident) and fall back to the city tiles for
   * points that sit on a plaza or a building. This is the hook lane overlays
   * will drape on.
   */
  sampleGroundHeight(x: number, z: number): number | null {
    const top = this.sceneBox.max.y + 50;
    _rayOrigin.set(x, top, z);
    this.raycaster.set(_rayOrigin, _down);
    this.raycaster.far = top - this.sceneBox.min.y + 200;
    const targets: Object3D[] = [];
    if (this.roadLayer) targets.push(this.roadLayer.group);
    if (this.cityLayer) targets.push(this.cityLayer.group);
    if (targets.length === 0) return null;
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      if (hit.object.visible) return hit.point.y;
    }
    return null;
  }

  /**
   * Flies a fixed path (orbit sweep, then a street-level pass) and reports what
   * the frame pacing looked like. Camera state is restored afterwards.
   */
  async runBenchmark(durationMs = 15000): Promise<BenchResult> {
    const center = this.sceneBox.getCenter(new Vector3());
    const size = this.sceneBox.getSize(new Vector3());
    const span = Math.max(size.x, size.z);
    const savedPosition = this.camera.position.clone();
    const savedTarget = this.controls.target.clone();
    const savedMode = this.controls.mode;

    const groundY = this.sampleGroundHeight(center.x, center.z) ?? this.sceneBox.min.y;
    const streetA = new Vector3(center.x - span * 0.3, groundY + 2.5, center.z);
    const streetB = new Vector3(center.x + span * 0.3, groundY + 2.5, center.z);

    this.benchmarkActive = true;
    this.controls.setEnabled(false);
    const stats = new FrameStats(Math.ceil(durationMs / 4));
    const start = performance.now();
    let frames = 0;
    let worstFrameMs = 0;
    let drawCallTotal = 0;
    let last = start;

    await new Promise<void>((resolve) => {
      this.onFrame = () => {
        const now = performance.now();
        const elapsed = now - start;
        const frameMs = now - last;
        last = now;
        if (frames > 2) {
          stats.push(frameMs);
          worstFrameMs = Math.max(worstFrameMs, frameMs);
          drawCallTotal += this.lastDrawCalls;
        }
        frames++;

        const t = Math.min(1, elapsed / durationMs);
        if (t < 0.65) {
          // Orbit sweep at altitude.
          const angle = (t / 0.65) * Math.PI * 2;
          const radius = span * 0.62;
          this.camera.position.set(
            center.x + Math.cos(angle) * radius,
            center.y + span * 0.4,
            center.z + Math.sin(angle) * radius,
          );
          this.camera.lookAt(center);
        } else {
          // Street-level pass.
          const k = (t - 0.65) / 0.35;
          this.camera.position.lerpVectors(streetA, streetB, k);
          this.camera.lookAt(streetB.x + 40, streetB.y, streetB.z);
        }
        if (elapsed >= durationMs) resolve();
      };
    });

    this.onFrame = null;
    this.benchmarkActive = false;
    this.controls.setEnabled(true);
    this.controls.setMode(savedMode);
    this.controls.setView(savedPosition, savedTarget);

    const durationSeconds = (performance.now() - start) / 1000;
    return {
      avgFps: frames / durationSeconds,
      p95FrameMs: stats.percentile(0.95),
      minFps: worstFrameMs > 0 ? 1000 / worstFrameMs : 0,
      drawCalls: frames > 3 ? Math.round(drawCallTotal / (frames - 3)) : this.lastDrawCalls,
      residentBytes: this.residentBytes(),
      frames,
      durationMs: durationSeconds * 1000,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls.dispose();
    this.cityLayer?.dispose();
    this.vegLayer?.dispose();
    this.roadLayer?.dispose();
    this.atlas?.dispose();
    this.disposeEnvironment?.();
    this.vegetationData.clear();
    if (this.sun) this.scene.remove(this.sun, this.sun.target);
    this.scene.clear();
    this.renderer.dispose();
  }
}
