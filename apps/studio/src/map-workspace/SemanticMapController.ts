import {
  CircleGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
  type Intersection,
  type Material,
  type Object3D,
} from 'three';
import type { CityViewer } from '@uniscenarios/city-renderer';
import type { LocationCatalog } from '@uniscenarios/map-intel';
import {
  buildLaneOverlay,
  buildSignalOverlay,
  CoordinateFrame,
  fetchXodrHeader,
  loadGzipJson,
  loadLanePolygons,
  loadSignals,
  laneIdForFace,
  type LanePolygon,
  type SceneManifestLike,
  type SignalFeature,
} from '@uniscenarios/xodr-tools';
import type { MapEntry } from '../maps';
import type { MapOverlayHandle } from '../mapOverlays';
import {
  MAP_LAYER_DEFINITIONS,
  catalogManifest,
  featureFromLocation,
  type MapCatalogManifest,
  type MapFeatureSummary,
  type MapLayerId,
  type MapLayerSummary,
} from './model';

export interface SemanticMapSnapshot {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  manifest: MapCatalogManifest | null;
  layers: readonly MapLayerSummary[];
  selected: MapFeatureSummary | null;
  hoverStack: readonly MapFeatureSummary[];
  query: string;
  results: readonly MapFeatureSummary[];
  resultCount: number;
  overlayObjects: number;
}

const INITIAL_VISIBILITY: Record<MapLayerId, boolean> = {
  'parking-lanes': false,
  'parking-spaces': false,
  'driving-lanes': false,
  sidewalks: false,
  'bicycle-lanes': false,
  crosswalks: false,
  'traffic-lights': false,
};

const MAX_RESULTS = 120;
const _matrix = new Matrix4();
const _position = new Vector3();
const _scale = new Vector3();
const _rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

function disposeGroup(group: Group): void {
  const geometry = new Set<unknown>();
  const material = new Set<unknown>();
  group.traverse((object) => {
    const item = object as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
    if (item.geometry && !geometry.has(item.geometry)) {
      geometry.add(item.geometry);
      item.geometry.dispose();
    }
    for (const mat of Array.isArray(item.material) ? item.material : item.material ? [item.material] : []) {
      if (!material.has(mat)) {
        material.add(mat);
        mat.dispose();
      }
    }
  });
  group.clear();
}

function laneCenter(lane: LanePolygon, y: number): readonly [number, number, number] {
  const ring = lane.rings[0];
  if (!ring?.length) return [0, y, 0];
  let x = 0;
  let z = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i]!;
    z += ring[i + 1]!;
  }
  return [x / n, y, z / n];
}

function layerForLaneType(type: string): MapLayerId | null {
  if (type === 'parking') return 'parking-lanes';
  if (type === 'driving' || type === 'bidirectional') return 'driving-lanes';
  if (type === 'sidewalk') return 'sidewalks';
  if (type === 'biking') return 'bicycle-lanes';
  return null;
}

function laneFeature(lane: LanePolygon, layerId: MapLayerId, y: number): MapFeatureSummary {
  const rsl = lane.id.split('#')[0] ?? lane.id;
  return {
    id: `lane:${lane.id}`,
    layerId,
    name: `${lane.laneType} lane ${rsl}`,
    source: 'lane-polygons',
    sourceRef: lane.properties.lane_guid ? String(lane.properties.lane_guid) : rsl,
    position: laneCenter(lane, y),
    binding: { quality: 'exact', rsl, s: 0, offsetM: 0, headingRad: 0, laneType: lane.laneType },
    facts: { road_id: lane.roadId, section_id: lane.sectionId, lane_id: lane.laneId, lane_type: lane.laneType, is_junction: lane.isJunction },
    provenance: [{ source: 'lane-polygons', ref: lane.id, confidence: 1 }],
  };
}

function signalFeature(signal: SignalFeature, layerId: MapLayerId): MapFeatureSummary {
  const rsl = signal.roadId ? `${signal.roadId}:0:0` : null;
  return {
    id: `signal:${signal.id}`,
    layerId,
    name: signal.name || (layerId === 'crosswalks' ? 'Crosswalk' : 'Traffic light'),
    source: 'signals-geojson',
    sourceRef: signal.id,
    position: [signal.position[0], signal.position[1] + 0.1, signal.position[2]],
    binding: { quality: 'unanchored', rsl, s: Number.isFinite(signal.s) ? signal.s : null, offsetM: Number.isFinite(signal.t) ? signal.t : null, headingRad: null, laneType: null },
    facts: { category: signal.category, dynamic: signal.dynamic, road_id: signal.roadId, mutcd_code: signal.mutcdCode },
    provenance: [{ source: 'signals-geojson', ref: signal.id, confidence: signal.withinExtents ? 1 : 0 }],
  };
}

/** Scene-graph owner for the Map workspace. Full catalogs remain outside React. */
export class SemanticMapController {
  readonly group = new Group();
  private readonly viewer: CityViewer;
  private readonly map: MapEntry;
  private readonly overlays: MapOverlayHandle | null;
  private readonly abort = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly layerGroups = new Map<MapLayerId, Group>();
  private readonly featureById = new Map<string, MapFeatureSummary>();
  private readonly featureIdsByLayer = new Map<MapLayerId, string[]>();
  private readonly raycaster = new Raycaster();
  private readonly selectionMarker: Mesh;
  private readonly pointer = new Vector2();
  private pointerDown: readonly [number, number] | null = null;
  private hoverFrame = 0;
  private disposed = false;
  private visibility = { ...INITIAL_VISIBILITY };
  private snapshot: SemanticMapSnapshot;

  constructor(viewer: CityViewer, map: MapEntry, overlays: MapOverlayHandle | null) {
    this.viewer = viewer;
    this.map = map;
    this.overlays = overlays;
    this.group.name = `semantic-map:${map.id}`;
    this.group.renderOrder = 30;
    this.selectionMarker = new Mesh(
      new CircleGeometry(2.8, 24),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false }),
    );
    this.selectionMarker.name = 'semantic-selection';
    this.selectionMarker.rotation.x = -Math.PI / 2;
    this.selectionMarker.renderOrder = 36;
    this.selectionMarker.visible = false;
    this.group.add(this.selectionMarker);
    viewer.scene.add(this.group);
    this.snapshot = {
      status: 'loading', error: null, manifest: null, layers: this.emptyLayers(), selected: null,
      hoverStack: [], query: '', results: [], resultCount: 0, overlayObjects: 0,
    };
    const canvas = viewer.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown, true);
    canvas.addEventListener('pointermove', this.onPointerMove, true);
    canvas.addEventListener('pointerup', this.onPointerUp, true);
    void this.load();
  }

  get state(): SemanticMapSnapshot { return this.snapshot; }
  getSnapshot = (): SemanticMapSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  private emptyLayers(): MapLayerSummary[] {
    return MAP_LAYER_DEFINITIONS.map((layer) => ({ ...layer, count: 0, available: false, visible: this.visibility[layer.id] }));
  }

  private async load(): Promise<void> {
    try {
      const { signal } = this.abort;
      const [catalog, header, manifest] = await Promise.all([
        loadGzipJson<LocationCatalog>(this.map.locations, { signal }),
        fetchXodrHeader(this.map.xodr),
        fetch(this.map.manifest, { signal }).then((response) => {
          if (!response.ok) throw new Error(`manifest failed (${response.status})`);
          return response.json() as Promise<SceneManifestLike>;
        }),
      ]);
      if (signal.aborted) return;
      if (String(catalog.mapId) !== this.map.id) throw new Error(`catalog map ${String(catalog.mapId)} does not match ${this.map.id}`);
      const frame = CoordinateFrame.fromHeader(header, manifest);
      const [lanes, signals] = await Promise.all([
        loadLanePolygons(this.map.lanePolygons, frame),
        loadSignals(this.map.signals, frame, this.overlays ? { heightSampler: this.overlays.sampleHeight } : undefined),
      ]);
      if (signal.aborted) return;
      this.build(catalog, lanes, signals);
    } catch (reason) {
      if (this.abort.signal.aborted) return;
      this.patch({ status: 'error', error: reason instanceof Error ? reason.message : String(reason) });
    }
  }

  private build(catalog: LocationCatalog, lanes: LanePolygon[], signals: SignalFeature[]): void {
    for (const definition of MAP_LAYER_DEFINITIONS) {
      const layer = new Group();
      layer.name = `semantic-layer:${definition.id}`;
      layer.visible = this.visibility[definition.id];
      this.layerGroups.set(definition.id, layer);
      this.featureIdsByLayer.set(definition.id, []);
      this.group.add(layer);
    }

    for (const definition of MAP_LAYER_DEFINITIONS) {
      const types = new Set<string>(definition.locationTypes);
      if (!types.size) continue;
      const features = catalog.locations.filter((location) => types.has(location.type)).map((location) => featureFromLocation(location, definition.id));
      this.addFeatures(features, definition.id, definition.color, definition.id === 'parking-spaces' ? 1.3 : 2.2);
    }

    for (const definition of MAP_LAYER_DEFINITIONS) {
      if (!definition.laneTypes.length) continue;
      const accepted = new Set<string>(definition.laneTypes);
      const selected = lanes.filter((lane) => accepted.has(lane.laneType));
      if (this.overlays) {
        const overlay = buildLaneOverlay(selected, {
          heightSampler: this.overlays.sampleHeight,
          color: definition.color,
          opacity: 0.46,
          drapeOffset: 0.09,
        });
        overlay.userData.semanticPickLayer = definition.id;
        this.layerGroups.get(definition.id)!.add(overlay);
      }
      if (!definition.locationTypes.length) {
        for (const lane of selected) {
          const center = laneCenter(lane, 0);
          const y = this.overlays?.sampleHeight(center[0], center[2]) ?? 0;
          this.register(laneFeature(lane, definition.id, y + 0.1));
        }
      }
    }

    const crosswalks = signals.filter((feature) => feature.featureKind === 'crosswalk' && feature.withinExtents);
    const trafficLights = signals.filter((feature) => feature.category === 'traffic_light' && feature.withinExtents);
    if (this.overlays) {
      const crosswalkOverlay = buildSignalOverlay(crosswalks, { heightSampler: this.overlays.sampleHeight, includeCrosswalks: true });
      const lightOverlay = buildSignalOverlay(trafficLights, { heightSampler: this.overlays.sampleHeight, includeCrosswalks: false, headScale: 1.2 });
      this.layerGroups.get('crosswalks')!.add(crosswalkOverlay);
      this.layerGroups.get('traffic-lights')!.add(lightOverlay);
    }
    if (this.overlays) {
      this.addFeatures(crosswalks.map((feature) => signalFeature(feature, 'crosswalks')), 'crosswalks', 0xf472b6, 2.5, false);
      this.addFeatures(trafficLights.map((feature) => signalFeature(feature, 'traffic-lights')), 'traffic-lights', 0xfb7185, 1.7, false);
    } else {
      for (const feature of crosswalks) this.register(signalFeature(feature, 'crosswalks'));
      for (const feature of trafficLights) this.register(signalFeature(feature, 'traffic-lights'));
    }

    this.group.updateMatrixWorld(true);
    const layers = MAP_LAYER_DEFINITIONS.map((definition) => {
      const count = this.featureIdsByLayer.get(definition.id)?.length ?? 0;
      return { ...definition, count, available: count > 0, visible: this.visibility[definition.id] };
    });
    this.patch({ status: 'ready', error: null, manifest: catalogManifest(catalog), layers, overlayObjects: this.group.children.length });
  }

  private register(feature: MapFeatureSummary): void {
    if (this.featureById.has(feature.id)) return;
    this.featureById.set(feature.id, feature);
    this.featureIdsByLayer.get(feature.layerId)?.push(feature.id);
  }

  private addFeatures(features: readonly MapFeatureSummary[], layerId: MapLayerId, color: number, radius: number, register = true): void {
    if (!features.length) return;
    const geometry = new CircleGeometry(1, 12);
    const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.84, depthWrite: false, toneMapped: false });
    const mesh = new InstancedMesh(geometry, material, features.length);
    mesh.name = `semantic-proxies:${layerId}`;
    mesh.renderOrder = 32;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.userData.semanticFeatureIds = features.map((feature) => feature.id);
    for (let index = 0; index < features.length; index++) {
      const feature = features[index]!;
      _position.set(feature.position[0], feature.position[1] + 0.08, feature.position[2]);
      _scale.set(radius, radius, radius);
      _matrix.compose(_position, _rotation, _scale);
      mesh.setMatrixAt(index, _matrix);
      if (register) this.register(feature);
      else if (!this.featureById.has(feature.id)) this.register(feature);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.layerGroups.get(layerId)!.add(mesh);
  }

  setVisible(layerId: MapLayerId, visible: boolean): void {
    this.visibility[layerId] = visible;
    const group = this.layerGroups.get(layerId);
    if (group) group.visible = visible;
    this.patch({ layers: this.snapshot.layers.map((layer) => layer.id === layerId ? { ...layer, visible } : layer) });
  }

  revealLayer(layerId: MapLayerId): void {
    this.setVisible(layerId, true);
    const first = this.featureIdsByLayer.get(layerId)?.[0];
    if (first) this.select(first);
  }

  select(id: string | null): void {
    const selected = id ? this.featureById.get(id) ?? null : null;
    this.selectionMarker.visible = selected !== null;
    if (selected) {
      this.selectionMarker.position.set(selected.position[0], selected.position[1] + 0.16, selected.position[2]);
      this.selectionMarker.updateMatrixWorld(true);
    }
    this.patch({ selected });
  }

  search(query: string): void {
    const needle = query.trim().toLowerCase();
    const all = [...this.featureById.values()];
    const matches = !needle ? [] : all.filter((feature) =>
      `${feature.name} ${feature.sourceRef} ${feature.layerId} ${JSON.stringify(feature.facts)}`.toLowerCase().includes(needle),
    );
    this.patch({ query, results: matches.slice(0, MAX_RESULTS), resultCount: matches.length });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.pointerDown = [event.clientX, event.clientY];
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      this.patch({ hoverStack: this.pick(event.clientX, event.clientY) });
    });
  };

  private onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || event.button !== 0 || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return;
    const stack = this.pick(event.clientX, event.clientY);
    if (!stack.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.patch({ selected: stack[0]!, hoverStack: stack });
  };

  private pick(clientX: number, clientY: number): MapFeatureSummary[] {
    const canvas = this.viewer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera);
    const hits = this.raycaster.intersectObject(this.group, true);
    const features: MapFeatureSummary[] = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      const id = this.idForHit(hit);
      if (!id || seen.has(id)) continue;
      const feature = this.featureById.get(id);
      if (feature) { seen.add(id); features.push(feature); }
      if (features.length >= 8) break;
    }
    return features;
  }

  private idForHit(hit: Intersection): string | null {
    const ids = hit.object.userData.semanticFeatureIds as string[] | undefined;
    if (ids && hit.instanceId !== undefined) return ids[hit.instanceId] ?? null;
    let object: Object3D | null = hit.object;
    while (object && object !== this.group) {
      const layerId = object.userData.semanticPickLayer as MapLayerId | undefined;
      if (layerId && hit.faceIndex != null) {
        const laneId = laneIdForFace(object, hit.faceIndex);
        if (laneId) return `lane:${laneId}`;
      }
      object = object.parent;
    }
    return null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame);
    const canvas = this.viewer.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    canvas.removeEventListener('pointermove', this.onPointerMove, true);
    canvas.removeEventListener('pointerup', this.onPointerUp, true);
    this.viewer.scene.remove(this.group);
    disposeGroup(this.group);
    this.listeners.clear();
  }

  private patch(patch: Partial<SemanticMapSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
