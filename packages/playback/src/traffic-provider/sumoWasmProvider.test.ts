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
    await expect(provider.step({ generation: 0, sequence: 1, deltaSeconds: .05, externalActors: [] }))
      .rejects.toThrow('SUMO provider is closed');
  });

  it('resets through the existing worker without retransferring runtime assets', async () => {
    const worker = new FakeWorker();
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', () => worker as unknown as Worker);
    const initializing = provider.initialize(payload);
    const init = worker.messages[0]!;
    worker.emit({ kind: 'ready', id: init.id, initMilliseconds: 1, heapBytes: 64 });
    await initializing;

    const resetting = provider.reset({ generation: 4, sequence: 0, deltaSeconds: 1, externalActors: [] });
    const reset = worker.messages[1]!;
    expect(reset.kind).toBe('reset');
    expect(worker.transfers[1]).toHaveLength(0);
    worker.emit({
      kind: 'state', id: reset.id, generation: 4, sequence: 0, simulationSeconds: 1,
      states: new ArrayBuffer(0), actorCount: 0, simulatedActorCount: 0,
      signalStates: new ArrayBuffer(0), signalLinkCount: 0, stepMilliseconds: 2,
    });
    await expect(resetting).resolves.toMatchObject({ generation: 4, simulationSeconds: 1 });
    expect(worker.terminated).toBe(false);
    expect(worker.messages.map((message) => message.kind)).toEqual(['init', 'reset']);
  });

  it('sends a precompiled module without copying or transferring the WASM binary', async () => {
    const worker = new FakeWorker();
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', () => worker as unknown as Worker);
    const wasmModule = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const initializing = provider.initialize({ ...payload, wasmModule });
    const init = worker.messages[0]!;
    expect(init.kind).toBe('init');
    expect(init.kind === 'init' ? init.payload.wasmBinary : 'unexpected').toBeUndefined();
    expect(init.kind === 'init' ? init.payload.wasmModule : null).toBe(wasmModule);
    expect(worker.transfers[0]).toHaveLength(2);
    worker.emit({ kind: 'ready', id: init.id, initMilliseconds: 1, heapBytes: 64 });
    await initializing;
  });

  it('reconfigures signal programs through the existing worker without retransferring or recompiling WASM', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker as unknown as Worker);
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', factory);
    const initializing = provider.initialize(payload);
    worker.emit({ kind: 'ready', id: worker.messages[0]!.id, initMilliseconds: 1, heapBytes: 64 });
    await initializing;

    const nextPayload = { ...payload, network: new ArrayBuffer(9), routes: new ArrayBuffer(7), wasmBinary: undefined };
    const resetting = provider.reconfigure(nextPayload, { generation: 5, sequence: 0, deltaSeconds: 1, externalActors: [] });
    const message = worker.messages[1]!;
    expect(message.kind).toBe('reconfigure');
    expect(message.kind === 'reconfigure' ? message.payload.wasmBinary : 'unexpected').toBeUndefined();
    expect(worker.transfers[1]).toHaveLength(2);
    worker.emit({
      kind: 'state', id: message.id, generation: 5, sequence: 0, simulationSeconds: 1,
      states: new ArrayBuffer(0), actorCount: 0, simulatedActorCount: 0,
      signalStates: new ArrayBuffer(0), signalLinkCount: 0, stepMilliseconds: 2,
    });
    await resetting;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(false);
    expect(worker.messages.map((entry) => entry.kind)).toEqual(['init', 'reconfigure']);
  });

  it('keeps one worker across repeated resets and still closes it authoritatively', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker as unknown as Worker);
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', factory);
    const initializing = provider.initialize(payload);
    worker.emit({ kind: 'ready', id: worker.messages[0]!.id, initMilliseconds: 1, heapBytes: 64 });
    await initializing;

    for (let generation = 1; generation <= 20; generation += 1) {
      const resetting = provider.reset({ generation, sequence: 0, deltaSeconds: 1, externalActors: [] });
      const message = worker.messages.at(-1)!;
      worker.emit({
        kind: 'state', id: message.id, generation, sequence: 0, simulationSeconds: 1,
        states: new ArrayBuffer(0), actorCount: 0, simulatedActorCount: 0,
        signalStates: new ArrayBuffer(0), signalLinkCount: 0, stepMilliseconds: 1,
      });
      await resetting;
    }
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(false);

    const closing = provider.close();
    const close = worker.messages.at(-1)!;
    expect(close.kind).toBe('close');
    worker.emit({ kind: 'closed', id: close.id });
    await closing;
    expect(worker.terminated).toBe(true);
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

  it('keeps the watchdog active for a reset that stops responding', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const provider = new SumoWasmTrafficProvider('/sumo.mjs', () => worker as unknown as Worker);
    const initializing = provider.initialize(payload);
    worker.emit({ kind: 'ready', id: worker.messages[0]!.id, initMilliseconds: 1, heapBytes: 64 });
    await initializing;

    const rejection = expect(provider.reset({ generation: 1, sequence: 0, deltaSeconds: 1, externalActors: [] }))
      .rejects.toThrow('SUMO worker reset exceeded 30 seconds');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(worker.terminated).toBe(true);
  });
});
