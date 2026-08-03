export type TrafficActorKind = 'vehicle' | 'pedestrian' | 'bicycle' | 'obstacle';

export interface TrafficNetworkPayload {
  readonly network: ArrayBuffer;
  readonly routes: ArrayBuffer;
  readonly seed: number;
  readonly stepSeconds: number;
  /** world = rotate(network * scale) + translation */
  readonly worldFromNetwork: NetworkWorldTransform;
}

export interface NetworkWorldTransform {
  readonly translationX: number;
  readonly translationY: number;
  readonly rotationDegrees: number;
  readonly scale: number;
  /** OpenDRIVE's +y becomes the renderer's -z. */
  readonly invertY: boolean;
}

/**
 * An externally owned actor is mirrored into the traffic engine for perception
 * and right-of-way, but its returned state must never drive the editor actor.
 */
export interface ExternalTrafficActor {
  readonly id: string;
  readonly kind: TrafficActorKind;
  readonly routeId: string;
  readonly x: number;
  readonly y: number;
  readonly headingDegrees: number;
  readonly speedMetersPerSecond: number;
  readonly lengthMeters: number;
  readonly widthMeters: number;
}

export interface TrafficStepRequest {
  readonly sequence: number;
  readonly deltaSeconds: number;
  readonly externalActors: readonly ExternalTrafficActor[];
}

export interface TrafficStepResult {
  readonly sequence: number;
  readonly simulationSeconds: number;
  /** Eight 32-bit words per actor; see SUMO_WASM_STATE_WORDS. */
  readonly states: ArrayBuffer;
  readonly actorCount: number;
  readonly stepMilliseconds: number;
}

export interface TrafficProviderInitialization {
  readonly initMilliseconds: number;
  readonly heapBytes: number;
}

export const SUMO_WASM_STATE_WORDS = 8;

export type SumoWorkerRequest =
  | { readonly kind: 'init'; readonly id: number; readonly moduleUrl: string; readonly payload: TrafficNetworkPayload }
  | { readonly kind: 'step'; readonly id: number; readonly request: TrafficStepRequest }
  | { readonly kind: 'close'; readonly id: number };

export type SumoWorkerResponse =
  | { readonly kind: 'ready'; readonly id: number; readonly initMilliseconds: number; readonly heapBytes: number }
  | ({ readonly kind: 'state'; readonly id: number } & TrafficStepResult)
  | { readonly kind: 'closed'; readonly id: number }
  | { readonly kind: 'error'; readonly id: number; readonly message: string };

export interface TrafficProvider {
  initialize(payload: TrafficNetworkPayload): Promise<TrafficProviderInitialization>;
  step(request: TrafficStepRequest): Promise<TrafficStepResult>;
  close(): Promise<void>;
}
