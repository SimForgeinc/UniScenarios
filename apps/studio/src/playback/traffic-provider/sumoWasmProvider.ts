import type {
  SumoWorkerRequest,
  SumoWorkerResponse,
  TrafficNetworkPayload,
  TrafficProvider,
  TrafficProviderInitialization,
  TrafficStepRequest,
  TrafficStepResult,
} from './protocol';

interface PendingRequest {
  readonly resolve: (value: SumoWorkerResponse) => void;
  readonly reject: (reason: Error) => void;
}
/** Lazy, opt-in provider. Constructing it does not download SUMO. */
export class SumoWasmTrafficProvider implements TrafficProvider {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly moduleUrl = '/vendor/sumo/sumo.mjs') {}

  async initialize(payload: TrafficNetworkPayload): Promise<TrafficProviderInitialization> {
    const network = payload.network.slice(0);
    const routes = payload.routes.slice(0);
    const response = await this.send(
      { kind: 'init', id: this.nextId++, moduleUrl: this.moduleUrl, payload: { ...payload, network, routes } },
      [network, routes],
    );
    if (response.kind !== 'ready') throw new Error(`Unexpected SUMO response: ${response.kind}`);
    return { initMilliseconds: response.initMilliseconds, heapBytes: response.heapBytes };
  }

  async step(request: TrafficStepRequest): Promise<TrafficStepResult> {
    const response = await this.send({ kind: 'step', id: this.nextId++, request });
    if (response.kind !== 'state') throw new Error(`Unexpected SUMO response: ${response.kind}`);
    return response;
  }

  async close(): Promise<void> {
    if (!this.worker) return;
    try {
      await this.send({ kind: 'close', id: this.nextId++ });
    } finally {
      this.worker.terminate();
      this.worker = undefined;
      for (const pending of this.pending.values()) pending.reject(new Error('SUMO worker closed'));
      this.pending.clear();
    }
  }

  private send(message: SumoWorkerRequest, transfer: Transferable[] = []): Promise<SumoWorkerResponse> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      worker.postMessage(message, transfer);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./sumoWasmWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SumoWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.kind === 'error') pending.reject(new Error(event.data.message));
      else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'SUMO worker failed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }
}
