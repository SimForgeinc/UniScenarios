import { describe, expect, it } from 'vitest';
import { evaluateSumoPerformance } from './adaptiveFallback';

const healthy = {
  initMilliseconds: 400,
  wasmBytes: 6_000_000,
  heapBytes: 80_000_000,
  stepP95Milliseconds: 12,
  requestedStepMilliseconds: 100,
};

describe('SUMO-WASM adaptive performance gate', () => {
  it('accepts a worker with at least 2x realtime headroom', () => {
    expect(evaluateSumoPerformance(healthy)).toEqual({ useSumo: true });
  });

  it.each([
    [{ ...healthy, wasmBytes: 13 * 1024 * 1024 }, 'bundle'],
    [{ ...healthy, initMilliseconds: 1_501 }, 'initialization'],
    [{ ...healthy, heapBytes: 257 * 1024 * 1024 }, 'memory'],
    [{ ...healthy, stepP95Milliseconds: 51 }, 'step-headroom'],
  ] as const)('falls back for %s', (sample, reason) => {
    expect(evaluateSumoPerformance(sample)).toEqual({ useSumo: false, reason });
  });
});
