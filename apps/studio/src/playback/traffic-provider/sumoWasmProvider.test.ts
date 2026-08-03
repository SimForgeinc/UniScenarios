import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SumoWorkerRequest, SumoWorkerResponse, TrafficNetworkPayload } from './protocol';
import { SumoWasmTrafficProvider } from './sumoWasmProvider';

class FakeWorker {
  onmessage: ((event: MessageEvent<SumoWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: SumoWorkerRequest[] = [];
  terminated = false;
  transfers: Transferable[][] = [];

  postMessage(message: SumoWorkerRequest, transfer: Transferable[] = []): void {
    this.messages.push(message);
    this.transfers.push(transfer);
  }
  terminate(): void { this.terminated = true; }
  emit(message: SumoWorkerResponse): void { this.onmessage?.({ data: message } as MessageEvent<SumoWorkerResponse>); }
}

const payload: TrafficNetworkPayload = {
  network: new ArrayBuffer(1), routes: new ArrayBuffer(1), seed: 1, stepSeconds: .05,
  wasmBinary: new ArrayBuffer(2),
  worldFromNetwork: { translationX: 0, translationY: 0, rotationDegrees: 0, scale: 1, invertY: false },
  maxActorStates: 8,
};

describe('SUMO provider lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('makes close idempotent while initialization is still in flight', async () => {
    const worker = new FakeWorker();
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', () => worker as unknown as Worker);
    const initializing = provider.initialize(payload);
    const closing = provider.close();
    expect(provider.close()).toBe(closing);
    expect(worker.messages.map((message) => message.kind)).toEqual(['init', 'close']);
    const transferredInit = worker.messages[0];
    expect(transferredInit?.kind === 'init' ? transferredInit.payload.wasmBinary?.byteLength : 0).toBe(2);
    expect(worker.transfers[0]).toHaveLength(3);

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

  it('terminates a worker that stops responding instead of leaving it alive behind fallback', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', () => worker as unknown as Worker);
    const rejection = expect(provider.initialize(payload)).rejects.toThrow('SUMO worker init exceeded 30 seconds');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(worker.terminated).toBe(true);
  });
});
