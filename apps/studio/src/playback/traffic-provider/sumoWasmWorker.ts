/// <reference lib="webworker" />
import type { ExternalTrafficActor, NetworkWorldTransform, SumoWorkerRequest, SumoWorkerResponse } from './protocol';
import { toNetwork, transformPackedStatesToWorld } from './coordinateTransform';

interface SumoModule {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _us_sumo_start(net: number, netLength: number, routes: number, routesLength: number, step: number, seed: number): number;
  _us_sumo_step(deltaSeconds: number): number;
  _us_sumo_upsert_external(
    id: number,
    kind: number,
    routeId: number,
    x: number,
    y: number,
    heading: number,
    speed: number,
    length: number,
    width: number,
  ): number;
  _us_sumo_remove(id: number): number;
  _us_sumo_state_pointer(): number;
  _us_sumo_state_count(): number;
  _us_sumo_time(): number;
  _us_sumo_last_error(): number;
  _us_sumo_close(): void;
  UTF8ToString(pointer: number): string;
  stringToUTF8(value: string, pointer: number, maxBytes: number): void;
  lengthBytesUTF8(value: string): number;
}

type SumoFactory = (options?: { noInitialRun?: boolean; printErr?: (message: string) => void }) => Promise<SumoModule>;

let module: SumoModule | undefined;
let worldFromNetwork: NetworkWorldTransform | undefined;
const mirroredIds = new Set<string>();
const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<SumoWorkerRequest>): void => {
  void handle(event.data).catch((error: unknown) => {
    post({ kind: 'error', id: event.data.id, message: error instanceof Error ? error.message : String(error) });
  });
};

async function handle(message: SumoWorkerRequest): Promise<void> {
  if (message.kind === 'init') {
    const started = performance.now();
    const imported = await import(/* @vite-ignore */ message.moduleUrl) as { default: SumoFactory };
    module = await imported.default({
      noInitialRun: true,
      // The lean browser build intentionally omits localized message catalogs.
      // SUMO reports that packaging choice on stderr even though it is harmless.
      printErr: (message) => {
        if (message.includes('SUMO_HOME is not set')) console.info(message);
        else console.error(message);
      },
    });
    worldFromNetwork = message.payload.worldFromNetwork;
    const net = copyBytes(module, new Uint8Array(message.payload.network));
    const routes = copyBytes(module, new Uint8Array(message.payload.routes));
    try {
      assertOk(module._us_sumo_start(net.pointer, net.length, routes.pointer, routes.length, message.payload.stepSeconds, message.payload.seed));
    } finally {
      module._free(net.pointer);
      module._free(routes.pointer);
    }
    post({ kind: 'ready', id: message.id, initMilliseconds: performance.now() - started, heapBytes: module.HEAPU8.buffer.byteLength });
    return;
  }

  const sumo = requireModule();
  if (message.kind === 'close') {
    sumo._us_sumo_close();
    module = undefined;
    worldFromNetwork = undefined;
    mirroredIds.clear();
    post({ kind: 'closed', id: message.id });
    return;
  }

  const started = performance.now();
  mirrorExternalActors(sumo, message.request.externalActors);
  assertOk(sumo._us_sumo_step(message.request.deltaSeconds));
  const count = sumo._us_sumo_state_count();
  const byteLength = count * 8 * Uint32Array.BYTES_PER_ELEMENT;
  const source = new Uint8Array(sumo.HEAPU8.buffer, sumo._us_sumo_state_pointer(), byteLength);
  const states = source.slice().buffer;
  transformPackedStatesToWorld(states, count, requireTransform());
  post({
    kind: 'state',
    id: message.id,
    sequence: message.request.sequence,
    simulationSeconds: sumo._us_sumo_time(),
    states,
    actorCount: count,
    stepMilliseconds: performance.now() - started,
  }, [states]);
}

function mirrorExternalActors(sumo: SumoModule, actors: readonly ExternalTrafficActor[]): void {
  const transform = requireTransform();
  const current = new Set(actors.map((actor) => actor.id));
  for (const id of mirroredIds) {
    if (!current.has(id)) withString(sumo, id, (idPointer) => assertOk(sumo._us_sumo_remove(idPointer)));
  }
  mirroredIds.clear();
  for (const actor of actors) {
    const position = toNetwork(actor.x, actor.y, transform);
    const worldRelativeHeading = actor.headingDegrees - transform.rotationDegrees;
    const networkHeading = transform.invertY ? 180 - worldRelativeHeading : worldRelativeHeading;
    withString(sumo, actor.id, (idPointer) => withString(sumo, actor.routeId, (routePointer) => {
      assertOk(sumo._us_sumo_upsert_external(
        idPointer,
        kindCode(actor.kind),
        routePointer,
        position.x,
        position.y,
        networkHeading,
        actor.speedMetersPerSecond,
        actor.lengthMeters,
        actor.widthMeters,
      ));
    }));
    mirroredIds.add(actor.id);
  }
}

function withString<T>(sumo: SumoModule, value: string, callback: (pointer: number) => T): T {
  const size = sumo.lengthBytesUTF8(value) + 1;
  const pointer = sumo._malloc(size);
  try {
    sumo.stringToUTF8(value, pointer, size);
    return callback(pointer);
  } finally {
    sumo._free(pointer);
  }
}

function copyBytes(sumo: SumoModule, bytes: Uint8Array): { pointer: number; length: number } {
  const pointer = sumo._malloc(bytes.byteLength);
  sumo.HEAPU8.set(bytes, pointer);
  return { pointer, length: bytes.byteLength };
}

function kindCode(kind: ExternalTrafficActor['kind']): number {
  return kind === 'pedestrian' ? 1 : kind === 'bicycle' ? 2 : kind === 'obstacle' ? 3 : 0;
}

function requireModule(): SumoModule {
  if (!module) throw new Error('SUMO worker is not initialized');
  return module;
}

function requireTransform(): NetworkWorldTransform {
  if (!worldFromNetwork) throw new Error('SUMO coordinate transform is not initialized');
  return worldFromNetwork;
}

function assertOk(code: number): void {
  if (code === 0) return;
  const sumo = requireModule();
  throw new Error(sumo.UTF8ToString(sumo._us_sumo_last_error()) || `SUMO failed (${code})`);
}

function post(message: SumoWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}
