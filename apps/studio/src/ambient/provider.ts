export type AmbientTrafficProviderId = 'native' | 'sumo';

export const AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY = 'studio.presentation.ambientTrafficProvider.v1';

export function ambientTrafficProviderFromExtensions(
  extensions: Readonly<Record<string, unknown>> | undefined,
): AmbientTrafficProviderId {
  return extensions?.[AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY] === 'sumo' ? 'sumo' : 'native';
}

export type SumoTrafficPhase = 'disabled' | 'loading' | 'ready' | 'running' | 'fallback';

export interface SumoTrafficStatus {
  readonly phase: SumoTrafficPhase;
  readonly actorCount: number;
  readonly initMilliseconds?: number;
  readonly stepP95Milliseconds?: number;
  readonly heapBytes?: number;
  readonly wasmBytes?: number;
  readonly reason?: string;
}

export const DISABLED_SUMO_STATUS: SumoTrafficStatus = Object.freeze({
  phase: 'disabled',
  actorCount: 0,
});
