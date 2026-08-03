import type { ResolvedAmbientTrafficProfile } from '@uniscenarios/sim-engine';
import type { ActorView } from '../editor/actorRenderer';
import type { MapEntry } from '../maps';
import type { NetworkWorldTransform, TrafficNetworkPayload, TrafficStepResult } from '../playback/traffic-provider/protocol';

export const SUMO_RUNTIME_MODULE_URL = '/dev-assets/sumo-runtime/sumo.mjs';
export const SUMO_RUNTIME_MANIFEST_URL = '/dev-assets/sumo-runtime/runtime-manifest.json';

export interface SumoMapManifest {
  readonly schema: 'uniscenarios.sumo-network.v1';
  readonly mapId: string;
  readonly networkFile: string;
  readonly sha256: string;
  readonly worldFromNetwork: NetworkWorldTransform;
  readonly routeCandidates: readonly (readonly string[])[];
}

export interface SumoRuntimeManifest {
  readonly schema: 'uniscenarios.sumo-runtime.v1';
  readonly sumoVersion: string;
  readonly sumoCommit: string;
  readonly wasmBytes: number;
  readonly wasmGzipBytes: number;
  readonly licenseNotice: string;
  readonly sourceOffer: string;
}

export interface LoadedSumoAssets {
  readonly payload: TrafficNetworkPayload;
  readonly runtime: SumoRuntimeManifest;
}

export async function loadSumoAssets(
  map: MapEntry,
  profile: ResolvedAmbientTrafficProfile,
  fetcher: typeof fetch = fetch,
): Promise<LoadedSumoAssets> {
  const [mapResponse, runtimeResponse] = await Promise.all([
    fetcher(map.sumoManifest),
    fetcher(SUMO_RUNTIME_MANIFEST_URL),
  ]);
  if (!mapResponse.ok) throw new Error(`SUMO is unavailable for ${map.label} (map sidecar ${mapResponse.status})`);
  if (!runtimeResponse.ok) throw new Error(`SUMO runtime is unavailable (${runtimeResponse.status})`);
  const manifest = await mapResponse.json() as SumoMapManifest;
  const runtime = await runtimeResponse.json() as SumoRuntimeManifest;
  validateMapManifest(manifest, map);
  validateRuntimeManifest(runtime);
  const manifestUrl = new URL(map.sumoManifest, globalThis.location?.href ?? 'http://localhost/');
  const networkResponse = await fetcher(new URL(manifest.networkFile, manifestUrl).toString());
  if (!networkResponse.ok) throw new Error(`SUMO network is unavailable for ${map.label} (${networkResponse.status})`);
  const network = await networkResponse.arrayBuffer();
  if (network.byteLength === 0) throw new Error(`SUMO network is empty for ${map.label}`);
  const routeDocument = buildSumoRouteDocument(manifest.routeCandidates, profile);
  return {
    payload: {
      network,
      routes: new TextEncoder().encode(routeDocument).buffer,
      seed: numericSeed(profile.seed),
      stepSeconds: 0.05,
      worldFromNetwork: manifest.worldFromNetwork,
    },
    runtime,
  };
}

export function buildSumoRouteDocument(
  candidates: readonly (readonly string[])[],
  profile: ResolvedAmbientTrafficProfile,
): string {
  if (candidates.length === 0) throw new Error('SUMO map has no usable traffic routes');
  const shuffled = deterministicShuffle(candidates, numericSeed(profile.seed));
  const count = Math.max(0, Math.min(profile.maxActors, shuffled.length));
  const aggression = clamp(profile.aggressiveness, 0, 1);
  const tau = (1.45 - aggression * 0.65).toFixed(2);
  const accel = (2.0 + aggression * 1.2).toFixed(2);
  const sigma = (0.15 + aggression * 0.45).toFixed(2);
  const speedDev = clamp(profile.speedVariance, 0, 0.8).toFixed(2);
  const proxyEdges = candidates[0]!.map(xml).join(' ');
  const vehicles = shuffled.slice(0, count).map((edges, index) =>
    `  <vehicle id="sumo-${numericSeed(profile.seed).toString(16)}-${index}" type="ambient" depart="0" departLane="best" departPos="random_free" departSpeed="max"><route edges="${edges.map(xml).join(' ')}"/></vehicle>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<routes>
  <vType id="ambient" carFollowModel="EIDM" laneChangeModel="SL2015" accel="${accel}" decel="4.5" emergencyDecel="9" sigma="${sigma}" tau="${tau}" speedFactor="1" speedDev="${speedDev}"/>
  <route id="proxy-route" edges="${proxyEdges}"/>
${vehicles}
</routes>`;
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

function validateMapManifest(manifest: SumoMapManifest, map: MapEntry): void {
  if (manifest.schema !== 'uniscenarios.sumo-network.v1') throw new Error('Unsupported SUMO map sidecar');
  if (manifest.mapId !== map.id) throw new Error(`SUMO sidecar belongs to ${manifest.mapId}, not ${map.id}`);
  if (!manifest.networkFile || !manifest.sha256 || manifest.routeCandidates.length === 0) {
    throw new Error(`SUMO sidecar for ${map.label} is incomplete`);
  }
}

function validateRuntimeManifest(manifest: SumoRuntimeManifest): void {
  if (manifest.schema !== 'uniscenarios.sumo-runtime.v1' || manifest.sumoVersion !== '1.27.1') {
    throw new Error('Unsupported SUMO browser runtime');
  }
  if (!manifest.licenseNotice || !manifest.sourceOffer || !(manifest.wasmBytes > 0)) {
    throw new Error('SUMO runtime compliance metadata is incomplete');
  }
}

function deterministicShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed || 1;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = Math.imul(state ^ state >>> 15, 1 | state);
    state ^= state + Math.imul(state ^ state >>> 7, 61 | state);
    const next = ((state ^ state >>> 14) >>> 0) % (index + 1);
    [copy[index], copy[next]] = [copy[next]!, copy[index]!];
  }
  return copy;
}

function numericSeed(seed: string | number): number {
  const source = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function normalizeRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
