import type { LocationCatalog, StudioLocation } from '@uniscenarios/map-intel';

export const MAP_LAYER_DEFINITIONS = [
  { id: 'parking-lanes', label: 'Parking lanes', color: 0x3b82f6, source: 'Map intelligence', locationTypes: ['parking_lane'], laneTypes: ['parking'] },
  { id: 'parking-spaces', label: 'Parking spaces', color: 0x60a5fa, source: 'Map intelligence', locationTypes: ['parking_space'], laneTypes: [] },
  { id: 'driving-lanes', label: 'Driving lanes', color: 0x22d3ee, source: 'OpenDRIVE lane polygons', locationTypes: [], laneTypes: ['driving', 'bidirectional'] },
  { id: 'sidewalks', label: 'Sidewalks', color: 0xa3e635, source: 'OpenDRIVE lane polygons', locationTypes: [], laneTypes: ['sidewalk'] },
  { id: 'bicycle-lanes', label: 'Bicycle lanes', color: 0xfacc15, source: 'OpenDRIVE lane polygons', locationTypes: [], laneTypes: ['biking'] },
  { id: 'crosswalks', label: 'Crosswalks', color: 0xf472b6, source: 'Road furniture GeoJSON', locationTypes: [], laneTypes: [] },
  { id: 'traffic-lights', label: 'Traffic lights', color: 0xfb7185, source: 'Road furniture GeoJSON', locationTypes: [], laneTypes: [] },
] as const;

export type MapLayerId = (typeof MAP_LAYER_DEFINITIONS)[number]['id'];

export interface MapFeatureBinding {
  quality: 'exact' | 'projected' | 'inferred' | 'unanchored';
  rsl: string | null;
  s: number | null;
  offsetM: number | null;
  headingRad: number | null;
  laneType: string | null;
}

export interface MapFeatureSummary {
  id: string;
  layerId: MapLayerId;
  name: string;
  source: string;
  sourceRef: string;
  position: readonly [number, number, number];
  binding: MapFeatureBinding;
  facts: Readonly<Record<string, unknown>>;
  provenance: readonly { source: string; ref: string; confidence: number }[];
}

export interface MapLayerSummary {
  id: MapLayerId;
  label: string;
  color: number;
  source: string;
  count: number;
  available: boolean;
  visible: boolean;
}

export interface MapCatalogManifest {
  mapId: string;
  mapAssetId: string;
  catalogRevision: string;
  builtAt: string;
  sourceHashes: Readonly<Record<string, string>>;
}

export function featureFromLocation(location: StudioLocation, layerId: MapLayerId): MapFeatureSummary {
  const road = location.anchor.road;
  return {
    id: String(location.id),
    layerId,
    name: location.name || String(location.handle),
    source: 'map-intel',
    sourceRef: String(location.handle),
    position: [location.anchor.scene.x, location.anchor.scene.y + 0.08, location.anchor.scene.z],
    binding: {
      quality: location.quality.anchor,
      rsl: road ? String(road.rsl) : null,
      s: road?.s ?? null,
      offsetM: road?.offsetM ?? null,
      headingRad: road?.headingRad ?? null,
      laneType: road?.laneType ?? null,
    },
    facts: location.facts,
    provenance: location.provenance,
  };
}

export function catalogManifest(catalog: LocationCatalog): MapCatalogManifest {
  return {
    mapId: String(catalog.mapId),
    mapAssetId: catalog.mapAssetId,
    catalogRevision: catalog.catalogRevision,
    builtAt: catalog.builtAt,
    sourceHashes: catalog.sourceHashes,
  };
}

export function parseRoadLaneRef(rsl: string): { roadId: string; section: number; laneId: number } | null {
  const match = /^([^:]+):(\d+):(-?\d+)$/.exec(rsl);
  if (!match) return null;
  return { roadId: match[1]!, section: Number(match[2]), laneId: Number(match[3]) };
}

export function anchorFailure(feature: MapFeatureSummary | null, selectedActorCount: number): string | null {
  if (!feature) return 'Select a map feature first.';
  if (selectedActorCount !== 1) return 'Select exactly one authored actor before using a map anchor.';
  if (feature.binding.quality !== 'exact') {
    return `This feature is ${feature.binding.quality}; only exact road bindings can place actors.`;
  }
  if (!feature.binding.rsl || feature.binding.s === null || feature.binding.headingRad === null) {
    return 'This feature has no complete road binding and cannot place an actor safely.';
  }
  if (!parseRoadLaneRef(feature.binding.rsl)) return 'The feature road binding is malformed.';
  return null;
}

