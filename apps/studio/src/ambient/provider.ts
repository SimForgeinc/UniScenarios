export type AmbientTrafficProviderId = 'native' | 'sumo';

export const AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY = 'studio.presentation.ambientTrafficProvider.v1';

export function ambientTrafficProviderFromExtensions(
  extensions: Readonly<Record<string, unknown>> | undefined,
): AmbientTrafficProviderId {
  return extensions?.[AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY] === 'native' ? 'native' : 'sumo';
}

/**
 * SUMO may paint physical signal heads only while it also owns their live
 * controller cycle. An authored map-signal plan or an imported canonical
 * playback transfers that ownership to the playback trace, even when SUMO
 * remains the saved ambient traffic preference.
 */
export function sumoOwnsPhysicalSignalStates(
  provider: AmbientTrafficProviderId,
  fallbackActive: boolean,
  hasAuthoredMapSignals: boolean,
  canonicalPlaybackActive: boolean,
): boolean {
  return provider === 'sumo' && !fallbackActive && !hasAuthoredMapSignals && !canonicalPlaybackActive;
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
  readonly nearbyActorCount?: number;
  readonly queuedActorCount?: number;
  readonly completedActorCount?: number;
  readonly emergencyStoppingActorCount?: number;
  readonly requestedActorCount?: number;
  readonly simulatedActorCount?: number;
  readonly nearbyRouteStarts?: number;
  /** The lean bridge does not currently expose SUMO's teleport/collision counters. */
  readonly detailedSafetyMetricsAvailable?: boolean;
  /** Physical OpenDRIVE head ids normalized from SUMO's live link states. */
  readonly signalStates?: Readonly<Record<string, 'green' | 'yellow' | 'red' | 'off'>>;
  readonly mappedSignalHeads?: number;
  readonly unmappedSignalLinks?: number;
  readonly adjustedSignalControllers?: number;
}

export const DISABLED_SUMO_STATUS: SumoTrafficStatus = Object.freeze({
  phase: 'disabled',
  actorCount: 0,
});
