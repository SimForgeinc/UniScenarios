import { describe, expect, it } from 'vitest';

import type { SumoWorkerRequest, SumoWorkerResponse, TrafficNetworkPayload } from './protocol';
import { SumoWasmTrafficProvider } from './sumoWasmProvider';

class FakeWorker {
  onmessage: ((event: MessageEvent<SumoWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: SumoWorkerRequest[] = [];
  terminated = false;

  postMessage(message: SumoWorkerRequest): void { this.messages.push(message); }
  terminate(): void { this.terminated = true; }
  emit(message: SumoWorkerResponse): void { this.onmessage?.({ data: message } as MessageEvent<SumoWorkerResponse>); }
}

const payload: TrafficNetworkPayload = {
  network: new ArrayBuffer(1), routes: new ArrayBuffer(1), seed: 1, stepSeconds: .05,
  worldFromNetwork: { translationX: 0, translationY: 0, rotationDegrees: 0, scale: 1, invertY: false },
  maxActorStates: 8,
};

describe('SUMO provider lifecycle', () => {
  it('makes close idempotent while initialization is still in flight', async () => {
    const worker = new FakeWorker();
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', () => worker as unknown as Worker);
    const initializing = provider.initialize(payload);
    const closing = provider.close();
    expect(provider.close()).toBe(closing);
    expect(worker.messages.map((message) => message.kind)).toEqual(['init', 'close']);

    const init = worker.messages[0]!;
    worker.emit({ kind: 'ready', id: init.id, initMilliseconds: 1, heapBytes: 64 });
    await expect(initializing).resolves.toEqual({ initMilliseconds: 1, heapBytes: 64 });
    const close = worker.messages[1]!;
    worker.emit({ kind: 'closed', id: close.id });
    await closing;
    expect(worker.terminated).toBe(true);
    await expect(provider.step({ sequence: 1, deltaSeconds: .05, externalActors: [] }))
      .rejects.toThrow('SUMO provider is closed');
  });
});
