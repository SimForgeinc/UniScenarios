import {
  buildSumoRoadOccupancyIndex,
  buildSumoRouteDocument as buildSharedSumoRouteDocument,
  sumoNumericSeed,
  validateSumoNetworkManifest,
  validateSumoRuntimeManifest,
  type ResolvedAmbientTrafficProfile,
  type SumoNetworkManifest,
  type SumoRuntimeManifest,
  type SumoRoadOccupancyIndex,
} from '@uniscenarios/sim-engine';
import type { ActorView } from '../editor/actorRenderer';
import type { MapEntry } from '../maps';
import type { NetworkWorldTransform, TrafficNetworkPayload, TrafficStepResult } from '../playback/traffic-provider/protocol';
import { toNetwork } from '../playback/traffic-provider/coordinateTransform';
import {
  fitSumoSignalProgramsToScenario,
  parseSumoSignalTopology,
  type SumoSignalTopology,
} from '../playback/traffic-provider/signalState';

export const SUMO_RUNTIME_MODULE_URL = '/dev-assets/sumo-runtime/sumo.mjs';
export const SUMO_RUNTIME_MANIFEST_URL = '/dev-assets/sumo-runtime/runtime-manifest.json';

export type SumoMapManifest = SumoNetworkManifest;
export type { SumoRuntimeManifest };

export interface LoadedSumoAssets {
  readonly payload: TrafficNetworkPayload;
  readonly runtime: SumoRuntimeManifest;
  readonly demand: SumoDemandSummary;
  readonly signalTopology: SumoSignalTopology;
  readonly adjustedSignalControllers: number;
  readonly occupancyRoads: SumoRoadOccupancyIndex;
}

export interface SumoDemandFocus { readonly x: number; readonly z: number }
export interface SumoDemandSummary {
  readonly requestedActors: number;
  readonly selectedRoutes: number;
  readonly focus: SumoDemandFocus | null;
  readonly nearbyRouteStarts: number;
  readonly replenishmentPeriodSeconds: number;
  readonly warmupSeconds: number;
}

export async function loadSumoAssets(
  map: MapEntry,
  profile: ResolvedAmbientTrafficProfile,
  fetcher: typeof fetch = fetch,
  focus: SumoDemandFocus | null = null,
): Promise<LoadedSumoAssets> {
  const [mapResponse, runtimeResponse] = await Promise.all([
    fetcher(map.sumoManifest),
    fetcher(SUMO_RUNTIME_MANIFEST_URL),
  ]);
  if (!mapResponse.ok) throw new Error(`SUMO is unavailable for ${map.label} (map sidecar ${mapResponse.status})`);
  if (!runtimeResponse.ok) throw new Error(`SUMO runtime is unavailable (${runtimeResponse.status})`);
  const manifest = await mapResponse.json() as SumoMapManifest;
  const runtime = await runtimeResponse.json() as SumoRuntimeManifest;
  validateSumoNetworkManifest(manifest, map.id);
  validateSumoRuntimeManifest(runtime);
  const manifestUrl = new URL(map.sumoManifest, globalThis.location?.href ?? 'http://localhost/');
  const networkResponse = await fetcher(new URL(manifest.networkFile, manifestUrl).toString());
  if (!networkResponse.ok) throw new Error(`SUMO network is unavailable for ${map.label} (${networkResponse.status})`);
  const rawNetwork = await networkResponse.arrayBuffer();
  if (rawNetwork.byteLength === 0) throw new Error(`SUMO network is empty for ${map.label}`);
  const networkXml = new TextDecoder().decode(rawNetwork);
  const signalTopology = parseSumoSignalTopology(networkXml);
  // Fit imported programs inside the standard scenario so editor previews show
  // an observable queue/release transition while preserving the link topology.
  const synchronized = fitSumoSignalProgramsToScenario(networkXml, 20);
  const network = new TextEncoder().encode(synchronized.xml).buffer;
  const localized = localizeSumoRouteCandidates(
    manifest.routeCandidates,
    networkXml,
    manifest.worldFromNetwork,
    focus,
  );
  // Keep a small deterministic choice pool around the focus. Shuffling this
  // local pool provides route diversity without scattering demand map-wide.
  const demandCandidates = focus
    ? localized.candidates.slice(0, Math.min(localized.candidates.length, Math.max(profile.maxActors, profile.maxActors * 2)))
    : localized.candidates;
  const routeDocument = buildSumoRouteDocument(demandCandidates, profile);
  const selectedRoutes = Math.max(0, Math.min(profile.maxActors, demandCandidates.length));
  return {
    payload: {
      network,
      routes: new TextEncoder().encode(routeDocument).buffer,
      seed: sumoNumericSeed(profile.seed),
      stepSeconds: 0.05,
      worldFromNetwork: manifest.worldFromNetwork,
      maxActorStates: profile.maxActors,
    },
    runtime,
    demand: {
      requestedActors: profile.maxActors,
      selectedRoutes,
      focus,
      nearbyRouteStarts: localized.nearbyRouteStarts,
      replenishmentPeriodSeconds: SUMO_REPLENISHMENT_PERIOD_SECONDS,
      warmupSeconds: SUMO_DEMAND_WARMUP_SECONDS,
    },
    signalTopology,
    adjustedSignalControllers: synchronized.adjustedControllers,
    occupancyRoads: buildSumoRoadOccupancyIndex(networkXml, manifest.worldFromNetwork),
  };
}

const SUMO_REPLENISHMENT_PERIOD_SECONDS = 40;
export const SUMO_DEMAND_WARMUP_SECONDS = 1;
const SUMO_LOCAL_RADIUS_METERS = 300;

export function buildSumoRouteDocument(
  candidates: readonly (readonly string[])[],
  profile: ResolvedAmbientTrafficProfile,
): string {
  return buildSharedSumoRouteDocument(candidates, profile, {
    departureWindowSeconds: SUMO_DEMAND_WARMUP_SECONDS,
    replenishmentPeriodSeconds: SUMO_REPLENISHMENT_PERIOD_SECONDS,
    replenishmentStride: 4,
    flowEndSeconds: 3600,
  });
}

/**
 * Prefer routes whose departure edge is close to the authored action/camera.
 * This is intentionally an offline XML scan during provider initialization;
 * no network conversion or route finding is moved onto the main frame loop.
 */
export function localizeSumoRouteCandidates(
  candidates: readonly (readonly string[])[],
  networkXml: string,
  transform: NetworkWorldTransform,
  focus: SumoDemandFocus | null,
): { candidates: readonly (readonly string[])[]; nearbyRouteStarts: number } {
  const geometry = parseEdgeGeometry(networkXml);
  if (!focus) return { candidates, nearbyRouteStarts: 0 };
  const networkFocus = toNetwork(focus.x, focus.z, transform);
  const ranked = candidates.map((candidate, ordinal) => {
    const point = geometry.centers.get(candidate[0] ?? '');
    const distance = point ? Math.hypot(point.x - networkFocus.x, point.y - networkFocus.y) * transform.scale : Number.POSITIVE_INFINITY;
    return { candidate, ordinal, distance };
  }).sort((left, right) => left.distance - right.distance || left.ordinal - right.ordinal);
  return {
    candidates: ranked.map((item) => item.candidate),
    nearbyRouteStarts: ranked.filter((item) => item.distance <= SUMO_LOCAL_RADIUS_METERS).length,
  };
}

function parseEdgeGeometry(networkXml: string): { centers: Map<string, { x: number; y: number }> } {
  const centers = new Map<string, { x: number; y: number }>();
  const edgePattern = /<edge\b[^>]*\bid="([^"]+)"[^>]*\bshape="([^"]+)"[^>]*>/g;
  for (const match of networkXml.matchAll(edgePattern)) {
    if (match[1]!.startsWith(':')) continue;
    const coordinates = match[2]!.trim().split(/\s+/).map((entry) => entry.split(',').map(Number));
    const valid = coordinates.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (valid.length === 0) continue;
    centers.set(match[1]!, {
      x: valid.reduce((sum, point) => sum + point[0]!, 0) / valid.length,
      y: valid.reduce((sum, point) => sum + point[1]!, 0) / valid.length,
    });
  }
  return { centers };
}

export function decodeSumoActorViews(
  result: TrafficStepResult,
  sampleHeight: (x: number, z: number) => number | null,
): readonly ActorView[] {
  const view = new DataView(result.states);
  const actors: ActorView[] = [];
  for (let offset = 0; offset < result.actorCount * 32; offset += 32) {
    const idHash = view.getUint32(offset, true).toString(16).padStart(8, '0');
    const x = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    const angle = view.getFloat32(offset + 12, true);
    const signals = view.getUint32(offset + 28, true);
    actors.push({
      id: `sumo:${idHash}`,
      catalogId: 'vehicle.sedan',
      catalogIdAuthored: true,
      kind: 'car',
      dims: { l: 4.55, w: 1.82, h: 1.48 },
      x,
      y: sampleHeight(x, z) ?? 0,
      z,
      headingRad: normalizeRadians((angle - 90) * Math.PI / 180),
      indicator: (signals & 3) === 3 ? 'hazard' : (signals & 1) !== 0 ? 'right' : (signals & 2) !== 0 ? 'left' : 'off',
    });
  }
  return actors;
}

function normalizeRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
