import type { StaticColliderClass, StaticMapCollider, TopologyIndex } from '@uniscenarios/sim-engine';

interface CityManifest {
  readonly created?: string;
  readonly tiles?: readonly {
    readonly id?: string;
    readonly lods?: readonly { readonly level: number; readonly file: string; readonly fileSize?: number }[];
  }[];
}

export interface StaticColliderDiagnostics {
  readonly digest: string;
  readonly status: 'ready' | 'unavailable' | 'skipped';
  readonly warning?: string;
  readonly sourceTiles: number;
  readonly accepted: number;
  readonly rejectedRoadOverlap: number;
  readonly ignored: number;
  readonly classes: Readonly<Record<StaticColliderClass, number>>;
}

export interface StaticColliderBundle {
  readonly colliders: readonly StaticMapCollider[];
  readonly diagnostics: StaticColliderDiagnostics;
}

export function emptyStaticColliderBundle(
  status: 'unavailable' | 'skipped',
  warning: string,
): StaticColliderBundle {
  return {
    colliders: [],
    diagnostics: {
      digest: `glb-obbs-v1-${status}`,
      status,
      warning,
      sourceTiles: 0,
      accepted: 0,
      rejectedRoadOverlap: 0,
      ignored: 0,
      classes: { building: 0, wall: 0, barrier: 0, prop: 0, 'road-boundary': 0 },
    },
  };
}

/** Static-map proxies improve contact fidelity but may never block authoring. */
export async function loadStaticMapCollidersBounded(
  manifestUrl: string,
  topology: TopologyIndex,
  timeoutMs = 8_000,
): Promise<StaticColliderBundle> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      loadStaticMapColliders(manifestUrl, topology),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`static map collider extraction exceeded ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    return emptyStaticColliderBundle('unavailable', error instanceof Error ? error.message : String(error));
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

const cache = new Map<string, Promise<StaticColliderBundle>>();
const SOLID_CATEGORIES = new Set(['building', 'prop']);
const TRAVEL_LANE_TYPES = new Set(['driving', 'biking', 'parking', 'shoulder']);

/**
 * Load only the JSON header from each lowest-detail GLB. Vertex buffers and
 * render triangles are never decoded, so this remains suitable for a worker.
 */
export async function loadStaticMapColliders(
  manifestUrl: string,
  topology: TopologyIndex,
  fetcher: typeof fetch = fetch,
): Promise<StaticColliderBundle> {
  const response = await fetcher(manifestUrl);
  if (!response.ok) throw new Error(`Static collision manifest fetch failed (${response.status})`);
  const manifest = await response.json() as CityManifest;
  const digest = manifestDigest(manifest);
  const key = `${manifestUrl}|${digest}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = buildBundle(manifestUrl, manifest, topology, digest, fetcher);
  cache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function buildBundle(
  manifestUrl: string,
  manifest: CityManifest,
  topology: TopologyIndex,
  digest: string,
  fetcher: typeof fetch,
): Promise<StaticColliderBundle> {
  if (!Array.isArray(manifest.tiles)) throw new Error('Static collision manifest has no tile list');
  const base = new URL('.', new URL(manifestUrl, globalThis.location?.href ?? 'http://localhost/'));
  const selected = manifest.tiles.map((tile, index) => {
    const lod = [...(tile.lods ?? [])].sort((a, b) => b.level - a.level || a.file.localeCompare(b.file))[0];
    if (!lod) throw new Error(`Static collision tile ${tile.id ?? index} has no LOD`);
    return { id: tile.id ?? `tile-${index}`, url: new URL(lod.file, base).toString() };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const classes: Record<StaticColliderClass, number> = {
    building: 0, wall: 0, barrier: 0, prop: 0, 'road-boundary': 0,
  };
  let rejectedRoadOverlap = 0;
  let ignored = 0;
  const colliders: StaticMapCollider[] = [];
  const travelLaneIndex = buildTravelLaneIndex(topology);
  // A small fixed fan-out avoids both sequential latency and a burst of every
  // city tile competing with playback preparation at once.
  for (let start = 0; start < selected.length; start += 6) {
    const batch = selected.slice(start, start + 6);
    const parsed = await Promise.all(batch.map(async (tile) => {
      return extractGlbColliders(await fetchGlbJsonChunk(tile.url, tile.id, fetcher), tile.id);
    }));
    for (const result of parsed) {
      ignored += result.ignored;
      for (const collider of result.colliders) {
        if (overlapsTravelLane(collider, travelLaneIndex)) {
          rejectedRoadOverlap += 1;
          continue;
        }
        classes[collider.class] += 1;
        colliders.push(collider);
      }
    }
  }
  colliders.sort((a, b) => a.id.localeCompare(b.id));
  return {
    colliders,
    diagnostics: {
      digest,
      status: 'ready',
      sourceTiles: selected.length,
      accepted: colliders.length,
      rejectedRoadOverlap,
      ignored,
      classes,
    },
  };
}

async function fetchGlbJsonChunk(url: string, tileId: string, fetcher: typeof fetch): Promise<ArrayBuffer> {
  const headerResponse = await fetcher(url, { headers: { Range: 'bytes=0-19' } });
  if (!headerResponse.ok) throw new Error(`Static collision tile fetch failed: ${tileId} (${headerResponse.status})`);
  const header = await headerResponse.arrayBuffer();
  // A host may ignore Range and return the complete GLB; reuse it rather than
  // fetching twice. Dev assets return 206 and take the bounded path below.
  if (header.byteLength > 20) return header;
  if (header.byteLength !== 20) throw new Error(`Static collision tile ${tileId} returned a truncated GLB header`);
  const view = new DataView(header);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error(`Static collision tile ${tileId} is not GLB v2`);
  }
  const jsonLength = view.getUint32(12, true);
  const end = 19 + jsonLength;
  const jsonResponse = await fetcher(url, { headers: { Range: `bytes=0-${end}` } });
  if (!jsonResponse.ok) throw new Error(`Static collision JSON fetch failed: ${tileId} (${jsonResponse.status})`);
  const jsonChunk = await jsonResponse.arrayBuffer();
  if (jsonChunk.byteLength < end + 1) throw new Error(`Static collision tile ${tileId} returned a truncated JSON chunk`);
  return jsonChunk;
}

interface GltfAccessor { min?: number[]; max?: number[] }
interface GltfPrimitive { attributes?: { POSITION?: number } }
interface GltfMesh { primitives?: GltfPrimitive[] }
interface GltfNode {
  name?: string;
  extras?: { category?: string };
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfJson { accessors?: GltfAccessor[]; meshes?: GltfMesh[]; nodes?: GltfNode[]; scenes?: { nodes?: number[] }[]; scene?: number }

export function extractGlbColliders(
  data: ArrayBuffer,
  tileId: string,
): { colliders: StaticMapCollider[]; ignored: number } {
  const view = new DataView(data);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error(`Static collision tile ${tileId} is not GLB v2`);
  }
  const jsonLength = view.getUint32(12, true);
  if (jsonLength <= 0 || 20 + jsonLength > view.byteLength || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error(`Static collision tile ${tileId} has no valid JSON chunk`);
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength)).replace(/\0+\s*$/, '')) as GltfJson;
  const nodes = json.nodes ?? [];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, index) => index);
  const colliders: StaticMapCollider[] = [];
  let ignored = 0;
  const visit = (index: number, parent: number[]): void => {
    const node = nodes[index];
    if (!node) return;
    const world = multiply4(parent, nodeMatrix(node));
    const collisionClass = classifyNode(node);
    const bounds = node.mesh === undefined ? null : meshBounds(json, node.mesh);
    if (collisionClass && bounds) {
      const obb = projectedObb(bounds, world);
      if (obb.lengthM >= 0.08 && obb.widthM >= 0.08 && Number.isFinite(obb.center.x + obb.center.z)) {
        colliders.push({ id: `${tileId}/${index}`, class: collisionClass, obb });
      } else ignored += 1;
    } else if (node.mesh !== undefined) ignored += 1;
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, IDENTITY);
  return { colliders, ignored };
}

function classifyNode(node: GltfNode): StaticColliderClass | null {
  const category = node.extras?.category?.toLowerCase() ?? '';
  const name = node.name?.toLowerCase() ?? '';
  if (!SOLID_CATEGORIES.has(category) && !/building|fence|wall|barrier|bollard|border|guardrail/.test(name)) return null;
  if (/curb|kerb|guardrail|road[_ -]?edge/.test(name)) return 'road-boundary';
  if (/fence|wall/.test(name)) return 'wall';
  if (/barrier|bollard|border/.test(name)) return 'barrier';
  return category === 'building' || /building/.test(name) ? 'building' : 'prop';
}

function meshBounds(json: GltfJson, meshIndex: number): { min: number[]; max: number[] } | null {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const primitive of json.meshes?.[meshIndex]?.primitives ?? []) {
    const position = primitive.attributes?.POSITION;
    const accessor = position === undefined ? undefined : json.accessors?.[position];
    if (!accessor?.min || !accessor.max || accessor.min.length < 3 || accessor.max.length < 3) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, accessor.min[axis]!);
      max[axis] = Math.max(max[axis]!, accessor.max[axis]!);
    }
    found = true;
  }
  return found ? { min, max } : null;
}

function projectedObb(bounds: { min: number[]; max: number[] }, matrix: number[]): StaticMapCollider['obb'] {
  const centerLocal = bounds.min.map((value, i) => (value + bounds.max[i]!) / 2);
  const center3 = transformPoint(matrix, centerLocal);
  const basis = transformVector(matrix, [1, 0, 0]);
  const headingRad = Math.atan2(-basis[2]!, basis[0]!);
  const forward = [Math.cos(headingRad), -Math.sin(headingRad)];
  const left = [-forward[1]!, forward[0]!];
  let halfLength = 0;
  let halfWidth = 0;
  for (const x of [bounds.min[0]!, bounds.max[0]!]) for (const y of [bounds.min[1]!, bounds.max[1]!]) {
    for (const z of [bounds.min[2]!, bounds.max[2]!]) {
      const p = transformPoint(matrix, [x, y, z]);
      const dx = p[0]! - center3[0]!;
      const dzScene = -(p[2]! - center3[2]!);
      halfLength = Math.max(halfLength, Math.abs(dx * forward[0]! + dzScene * forward[1]!));
      halfWidth = Math.max(halfWidth, Math.abs(dx * left[0]! + dzScene * left[1]!));
    }
  }
  return { center: { x: center3[0]!, z: -center3[2]! }, lengthM: halfLength * 2, widthM: halfWidth * 2, headingRad };
}

interface TravelLaneSample { readonly x: number; readonly z: number; readonly clearance: number }
type TravelLaneIndex = ReadonlyMap<string, readonly TravelLaneSample[]>;
const ROAD_INDEX_CELL_M = 20;

function buildTravelLaneIndex(topology: TopologyIndex): TravelLaneIndex {
  const index = new Map<string, TravelLaneSample[]>();
  for (const lane of Object.values(topology.lanes)) {
    if (!TRAVEL_LANE_TYPES.has(lane.laneType)) continue;
    const clearance = Math.max(1, (lane.representativeWidthM ?? 3.5) / 2 + 0.75);
    for (const point of lane.polyline) {
      const x = Array.isArray(point) ? point[0] : point.x;
      const z = -(Array.isArray(point) ? point[1] : point.y);
      const key = `${Math.floor(x / ROAD_INDEX_CELL_M)},${Math.floor(z / ROAD_INDEX_CELL_M)}`;
      const bucket = index.get(key) ?? [];
      bucket.push({ x, z, clearance });
      index.set(key, bucket);
    }
  }
  return index;
}

function overlapsTravelLane(collider: StaticMapCollider, index: TravelLaneIndex): boolean {
  const { obb } = collider;
  const cos = Math.cos(obb.headingRad);
  const sin = Math.sin(obb.headingRad);
  const radius = Math.hypot(obb.lengthM, obb.widthM) / 2 + 3;
  const x0 = Math.floor((obb.center.x - radius) / ROAD_INDEX_CELL_M);
  const x1 = Math.floor((obb.center.x + radius) / ROAD_INDEX_CELL_M);
  const z0 = Math.floor((obb.center.z - radius) / ROAD_INDEX_CELL_M);
  const z1 = Math.floor((obb.center.z + radius) / ROAD_INDEX_CELL_M);
  for (let gx = x0; gx <= x1; gx += 1) for (let gz = z0; gz <= z1; gz += 1) {
    for (const sample of index.get(`${gx},${gz}`) ?? []) {
      const dx = sample.x - obb.center.x;
      const dz = sample.z - obb.center.z;
      if (
        Math.abs(dx * cos + dz * sin) <= obb.lengthM / 2 + sample.clearance &&
        Math.abs(-dx * sin + dz * cos) <= obb.widthM / 2 + sample.clearance
      ) return true;
    }
  }
  return false;
}

function manifestDigest(manifest: CityManifest): string {
  const text = JSON.stringify({
    created: manifest.created ?? '',
    tiles: (manifest.tiles ?? []).map((tile) => [tile.id ?? '', (tile.lods ?? []).map((lod) => [lod.level, lod.file, lod.fileSize ?? 0])]),
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `glb-obbs-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nodeMatrix(node: GltfNode): number[] {
  if (node.matrix?.length === 16) return [...node.matrix];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const x2 = x! + x!, y2 = y! + y!, z2 = z! + z!;
  const xx = x! * x2, xy = x! * y2, xz = x! * z2;
  const yy = y! * y2, yz = y! * z2, zz = z! * z2;
  const wx = w! * x2, wy = w! * y2, wz = w! * z2;
  return [
    (1 - (yy + zz)) * sx!, (xy + wz) * sx!, (xz - wy) * sx!, 0,
    (xy - wz) * sy!, (1 - (xx + zz)) * sy!, (yz + wx) * sy!, 0,
    (xz + wy) * sz!, (yz - wx) * sz!, (1 - (xx + yy)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

function multiply4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) for (let row = 0; row < 4; row += 1) {
    for (let k = 0; k < 4; k += 1) out[col * 4 + row] = out[col * 4 + row]! + a[k * 4 + row]! * b[col * 4 + k]!;
  }
  return out;
}

function transformPoint(m: number[], p: number[]): number[] {
  return [
    m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
    m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
    m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
  ];
}

function transformVector(m: number[], p: number[]): number[] {
  return [
    m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]!,
    m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]!,
    m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]!,
  ];
}
