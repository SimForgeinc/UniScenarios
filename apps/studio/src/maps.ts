/**
 * The map registry.
 *
 * Static data on purpose. Every map in `dev-assets/` ships the same five files
 * under the same names, so the registry is a list of slugs plus display copy —
 * not a discovery protocol. When maps start arriving from a server this becomes
 * the shape that endpoint returns, and nothing above it changes.
 *
 * `id` is the `dev-assets/` folder name *and* the `mapId` written into
 * `.scenario.json` (`MapRefSchema.mapId`), so a scenario file names its map the
 * same way the loader does.
 */

/** Where one map's assets live and what to call it. */
export interface MapEntry {
  /** Stable slug: the asset folder, the scenario `mapId`, the autosave key. */
  readonly id: string;
  readonly label: string;
  /** One line of context for the picker. */
  readonly locality: string;
  /** 3D tile manifest (also the viewer's entry point). */
  readonly manifest: string;
  /** OpenDRIVE road network. Only the first 16 KB is ever fetched. */
  readonly xodr: string;
  readonly lanePolygons: string;
  readonly signals: string;
  /** Lane topology index — the substrate for lane snapping. */
  readonly topology: string;
  readonly derivedTopology: string;
  readonly locations: string;
  /** Optional browser-SUMO sidecar. A missing/invalid asset fails closed to native traffic. */
  readonly sumoManifest: string;
}

function entry(id: string, label: string, locality: string): MapEntry {
  const base = `/dev-assets/${id}`;
  return {
    id,
    label,
    locality,
    manifest: `${base}/3d/manifest.json`,
    xodr: `${base}/map.xodr`,
    lanePolygons: `${base}/lane-polygons.geojson.gz`,
    signals: `${base}/signals.geojson.gz`,
    topology: `${base}/topology-index.json.gz`,
    derivedTopology: `${base}/derived/topology-derived.json.gz`,
    locations: `${base}/derived/locations.json.gz`,
    sumoManifest: `${base}/derived/sumo/sumo-network-manifest.json`,
  };
}

/** Every map the studio can open, in picker (and 1-5 hotkey) order. */
export const MAPS: readonly MapEntry[] = [
  entry('yale-street', 'Yale Street', 'Palo Alto · signalised grid'),
  entry('belmont-research-center', 'Belmont Research Center', 'campus loop · low speed'),
  entry('el-camino-road', 'El Camino Road', 'arterial · multi-lane'),
  entry('easterbrook-discovery-school', 'Easterbrook Discovery School', 'school zone · hills'),
  entry('richmond-field-station', 'Richmond Field Station', 'industrial · sparse'),
];

export const DEFAULT_MAP_ID = MAPS[0]!.id;

const LAST_MAP_KEY = 'uniscenarios:last-map';

export function mapById(id: string | null | undefined): MapEntry | undefined {
  return MAPS.find((m) => m.id === id);
}

/**
 * The map to open on load: `?map=<id>` wins (so a verification script can pin
 * one), then the last map used, then the first in the registry.
 */
export function initialMapId(search = globalThis.location?.search ?? ''): string {
  const requested = new URLSearchParams(search).get('map');
  if (mapById(requested)) return requested as string;
  try {
    const remembered = globalThis.localStorage?.getItem(LAST_MAP_KEY);
    if (mapById(remembered)) return remembered as string;
  } catch {
    // Private mode / storage disabled: fall through to the default.
  }
  return DEFAULT_MAP_ID;
}

export function rememberMapId(id: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_MAP_KEY, id);
  } catch {
    // Not worth surfacing: the app works, it just will not remember.
  }
}
