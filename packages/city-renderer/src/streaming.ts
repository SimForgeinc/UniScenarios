import { Box3, Group, Vector3 } from 'three';
import type { Camera, Object3D, Texture, WebGLRenderer, Scene } from 'three';
import type { ManifestLod } from './types';
import type { AssetResources } from './gltf';
import { disposeResources, uploadTexture } from './gltf';

export interface StreamTileDef {
  id: string;
  box: Box3;
  /** LODs sorted coarse-first: index 0 is the cheapest fallback. */
  lods: ManifestLod[];
  /** Anything the asset builder needs (instance data, grid coords, ...). */
  userData?: unknown;
}

export interface PreparedAsset {
  object: Object3D;
  resources: AssetResources;
  bytes: number;
  /** Textures still to be pushed to the GPU, drained by the upload pacer. */
  pendingTextures: Texture[];
  /** Called on eviction, after the object leaves the scene graph. */
  dispose?: () => void;
}

export type AssetBuilder = (
  def: StreamTileDef,
  lod: ManifestLod,
  signal: AbortSignal,
) => Promise<PreparedAsset>;

interface Entry {
  def: StreamTileDef;
  resident: Map<number, PreparedAsset>;
  displayed: number;
  /** Wanted LOD index, or -1 when the tile should not be resident at all. */
  desired: number;
  loading: { index: number; controller: AbortController } | null;
  failures: number;
  /** Pixels of error we would win by loading `desired`. */
  gain: number;
  distance: number;
}

export interface EvictionCandidate {
  layer: TileStreamLayer;
  entryId: string;
  index: number;
  bytes: number;
  score: number;
}

export interface LayerStats {
  residentTiles: number;
  residentAssets: number;
  bytes: number;
  loading: number;
  queued: number;
  uploading: number;
}

export interface TileStreamLayerOptions {
  name: string;
  renderer: WebGLRenderer;
  scene: Scene;
  defs: StreamTileDef[];
  build: AssetBuilder;
  maxConcurrent: number;
  /**
   * Load the coarsest LOD of every tile before anything finer is fetched, and
   * never evict it. Used for the city so the full map is on screen in the first
   * seconds and no tile can ever disappear.
   */
  pinCoarsest: boolean;
  /** Return false to keep a tile unloaded entirely (vegetation range limit). */
  want?: (def: StreamTileDef, distance: number) => boolean;
  /** Called after a new LOD becomes the displayed one. */
  onDisplay?: (def: StreamTileDef, asset: PreparedAsset, index: number) => void;
  /** Called every frame for the displayed asset (vegetation density LOD). */
  onTick?: (def: StreamTileDef, asset: PreparedAsset, distance: number, index: number) => void;
}

const MAX_FAILURES = 2;

/**
 * Screen-space-error driven LOD streaming for one class of tiles.
 *
 * Selection is the 3D-Tiles rule: project a LOD's geometric error to pixels
 * (`error * screenHeight / (distance * 2 * tan(fov/2))`) and take the coarsest
 * LOD whose projected error is under the threshold. Fetches are ordered by the
 * error a tile would *win*, so the tile that is worst on screen goes first.
 * Nothing is removed before its replacement is on the GPU, and with
 * `pinCoarsest` index 0 stays resident forever, so a tile can never become a
 * hole.
 */
export class TileStreamLayer {
  readonly group = new Group();
  readonly entries = new Map<string, Entry>();

  private readonly opts: TileStreamLayerOptions;
  private readonly uploadQueue: { entry: Entry; index: number; asset: PreparedAsset }[] = [];
  private readonly compiling = new Set<PreparedAsset>();
  private bytes = 0;
  private disposed = false;
  private bootstrapped: boolean;

  constructor(opts: TileStreamLayerOptions) {
    this.opts = opts;
    this.group.name = opts.name;
    this.bootstrapped = !opts.pinCoarsest;
    for (const def of opts.defs) {
      this.entries.set(def.id, {
        def,
        resident: new Map(),
        displayed: -1,
        desired: 0,
        loading: null,
        failures: 0,
        gain: Infinity,
        distance: Infinity,
      });
    }
  }

  get residentBytes(): number {
    return this.bytes;
  }

  /** True once every tile has its coarsest LOD on screen. */
  get ready(): boolean {
    return this.bootstrapped;
  }

  stats(): LayerStats {
    let residentTiles = 0;
    let residentAssets = 0;
    let queued = 0;
    let loading = 0;
    for (const entry of this.entries.values()) {
      if (entry.resident.size > 0) residentTiles++;
      residentAssets += entry.resident.size;
      if (entry.loading) loading++;
      else if (entry.desired > this.finestResident(entry)) queued++;
    }
    return {
      residentTiles,
      residentAssets,
      bytes: this.bytes,
      loading,
      queued,
      uploading: this.uploadQueue.length + this.compiling.size,
    };
  }

  private finestResident(entry: Entry): number {
    let best = -1;
    for (const index of entry.resident.keys()) if (index > best) best = index;
    return best;
  }

  /**
   * Refreshes desired LODs, starts/cancels fetches and swaps ready assets in.
   * `sseScale` is `screenHeight / (2 * tan(fov / 2))`.
   */
  update(cameraPos: Vector3, sseScale: number, maxSse: number): void {
    if (this.disposed) return;

    let bootstrapped = true;
    for (const entry of this.entries.values()) {
      const distance = Math.max(1e-3, entry.def.box.distanceToPoint(cameraPos));
      entry.distance = distance;
      const lods = entry.def.lods;

      const wanted = this.opts.want ? this.opts.want(entry.def, distance) : true;
      let desired = -1;
      if (wanted && entry.failures < MAX_FAILURES) {
        desired = lods.length - 1;
        for (let i = 0; i < lods.length; i++) {
          const err = lods[i]?.geometricError ?? 0;
          if ((err * sseScale) / distance <= maxSse) {
            desired = i;
            break;
          }
        }
        if (!this.bootstrapped) desired = 0;
      }
      entry.desired = desired;

      if (this.opts.pinCoarsest && !entry.resident.has(0) && entry.failures < MAX_FAILURES) {
        bootstrapped = false;
      }

      const finest = this.finestResident(entry);
      const currentErr = finest >= 0 ? (lods[finest]?.geometricError ?? 0) : Infinity;
      const desiredErr = desired >= 0 ? (lods[desired]?.geometricError ?? 0) : 0;
      entry.gain = ((currentErr - desiredErr) * sseScale) / distance;

      // A queued fetch nobody wants any more (camera moved away) is dropped
      // instead of finished — it would only burn budget on an evictable LOD.
      if (entry.loading && entry.loading.index > Math.max(desired, finest)) {
        entry.loading.controller.abort();
        entry.loading = null;
      }
    }
    this.bootstrapped = this.bootstrapped || bootstrapped;

    this.pumpFetches();
  }

  private pumpFetches(): void {
    let active = 0;
    for (const entry of this.entries.values()) if (entry.loading) active++;
    if (active >= this.opts.maxConcurrent) return;

    const wanted: Entry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.loading || entry.desired < 0) continue;
      if (entry.desired <= this.finestResident(entry)) continue;
      if (entry.resident.has(entry.desired)) continue;
      wanted.push(entry);
    }
    if (wanted.length === 0) return;
    // Biggest screen-space win first; not-yet-loaded tiles (gain Infinity) lead.
    wanted.sort((a, b) => b.gain - a.gain || a.distance - b.distance);

    for (const entry of wanted) {
      if (active >= this.opts.maxConcurrent) break;
      active++;
      this.startLoad(entry, entry.desired);
    }
  }

  private startLoad(entry: Entry, index: number): void {
    const lod = entry.def.lods[index];
    if (!lod) return;
    const controller = new AbortController();
    entry.loading = { index, controller };
    this.opts
      .build(entry.def, lod, controller.signal)
      .then((asset) => {
        entry.loading = null;
        if (this.disposed || controller.signal.aborted) {
          asset.dispose?.();
          disposeResources(asset.resources);
          return;
        }
        this.uploadQueue.push({ entry, index, asset });
      })
      .catch((err: unknown) => {
        entry.loading = null;
        if (!controller.signal.aborted && !this.disposed) {
          entry.failures++;
          console.error(`[city-renderer] ${entry.def.id} lod${lod.level} failed`, err);
        }
      });
  }

  /**
   * Pushes queued textures to the GPU under a per-frame time budget so a 140 MB
   * LOD0 tile cannot stall a frame, then compiles and swaps the asset in.
   */
  pumpUploads(deadline: number, camera: Camera): void {
    if (this.disposed || this.uploadQueue.length === 0) return;
    this.uploadQueue.sort(
      (a, b) => b.entry.gain - a.entry.gain || a.entry.distance - b.entry.distance,
    );
    while (this.uploadQueue.length > 0 && performance.now() < deadline) {
      const job = this.uploadQueue[0];
      if (!job) break;
      const tex = job.asset.pendingTextures.pop();
      if (tex) {
        uploadTexture(this.opts.renderer, tex);
        continue;
      }
      this.uploadQueue.shift();
      this.finishAsset(job.entry, job.index, job.asset, camera);
    }
  }

  private finishAsset(entry: Entry, index: number, asset: PreparedAsset, camera: Camera): void {
    asset.object.updateMatrixWorld(true);
    this.compiling.add(asset);
    void this.opts.renderer
      .compileAsync(asset.object, camera, this.opts.scene)
      .catch(() => undefined)
      .then(() => {
        this.compiling.delete(asset);
        if (this.disposed) {
          asset.dispose?.();
          disposeResources(asset.resources);
          return;
        }
        this.swapIn(entry, index, asset);
      });
  }

  private swapIn(entry: Entry, index: number, asset: PreparedAsset): void {
    if (entry.resident.has(index)) {
      asset.dispose?.();
      disposeResources(asset.resources);
      return;
    }
    entry.resident.set(index, asset);
    this.bytes += asset.bytes;

    if (index > entry.displayed) {
      const old = entry.displayed >= 0 ? entry.resident.get(entry.displayed) : undefined;
      this.group.add(asset.object);
      if (old) this.group.remove(old.object);
      entry.displayed = index;
      this.opts.onDisplay?.(entry.def, asset, index);
    }

    // Keep at most the pinned fallback plus whatever is on screen.
    for (const [level, resident] of [...entry.resident]) {
      if (level === entry.displayed) continue;
      if (level === 0 && this.opts.pinCoarsest) continue;
      entry.resident.delete(level);
      this.bytes -= resident.bytes;
      this.group.remove(resident.object);
      resident.dispose?.();
      disposeResources(resident.resources);
    }
  }

  /** Per-frame hook for LOD behaviour that needs no reload (veg density/range). */
  tickDisplayed(): void {
    const onTick = this.opts.onTick;
    if (!onTick) return;
    for (const entry of this.entries.values()) {
      if (entry.displayed < 0) continue;
      const asset = entry.resident.get(entry.displayed);
      if (asset) onTick(entry.def, asset, entry.distance, entry.displayed);
    }
  }

  evictionCandidates(out: EvictionCandidate[]): void {
    for (const entry of this.entries.values()) {
      for (const [index, asset] of entry.resident) {
        if (index === 0 && this.opts.pinCoarsest) continue; // never evicted
        const unwanted = entry.desired < 0 ? 100 : index > entry.desired ? 5 : 1;
        out.push({
          layer: this,
          entryId: entry.def.id,
          index,
          bytes: asset.bytes,
          score: entry.distance * unwanted,
        });
      }
    }
  }

  evict(candidate: EvictionCandidate): number {
    const entry = this.entries.get(candidate.entryId);
    const asset = entry?.resident.get(candidate.index);
    if (!entry || !asset) return 0;
    entry.resident.delete(candidate.index);
    this.bytes -= asset.bytes;
    this.group.remove(asset.object);
    if (entry.displayed === candidate.index) {
      const fallback = entry.resident.get(0);
      if (fallback) {
        this.group.add(fallback.object);
        entry.displayed = 0;
      } else {
        entry.displayed = -1;
      }
    }
    asset.dispose?.();
    disposeResources(asset.resources);
    return asset.bytes;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.loading?.controller.abort();
      for (const asset of entry.resident.values()) {
        this.group.remove(asset.object);
        asset.dispose?.();
        disposeResources(asset.resources);
      }
      entry.resident.clear();
    }
    for (const job of this.uploadQueue) {
      job.asset.dispose?.();
      disposeResources(job.asset.resources);
    }
    this.uploadQueue.length = 0;
    this.group.clear();
    this.entries.clear();
    this.bytes = 0;
  }
}

export function boxOf(min: number[], max: number[]): Box3 {
  return new Box3(
    new Vector3(min[0] ?? 0, min[1] ?? 0, min[2] ?? 0),
    new Vector3(max[0] ?? 0, max[1] ?? 0, max[2] ?? 0),
  );
}

export type { Object3D };
