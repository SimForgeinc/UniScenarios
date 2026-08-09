import { describe, expect, it } from 'vitest';
import {
  evaluateSumoPerformance,
  evaluateSumoStepWindow,
  sumoPerformanceFallbackReason,
} from './adaptiveFallback';

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

  it('compares each live step with the simulated interval it advanced', () => {
    const decision = evaluateSumoStepWindow([
      { stepMilliseconds: 26.8, requestedStepMilliseconds: 1_000 },
      ...Array.from({ length: 39 }, () => ({
        stepMilliseconds: 18,
        requestedStepMilliseconds: 50,
      })),
    ]);

    expect(decision.useSumo).toBe(true);
    expect(decision.stepP95Milliseconds).toBe(18);
    expect(decision.headroomP95Fraction).toBeCloseTo(.36);
  });

  it('rejects sustained live steps without 2x realtime headroom', () => {
    const decision = evaluateSumoStepWindow(
      Array.from({ length: 40 }, () => ({
        stepMilliseconds: 26.8,
        requestedStepMilliseconds: 50,
      })),
    );

    expect(decision.useSumo).toBe(false);
    expect(decision.stepP95Milliseconds).toBe(26.8);
    expect(decision.headroomP95Fraction).toBeCloseTo(.536);
  });

  it('explains a sustained slowdown without exposing an internal gate error', () => {
    expect(sumoPerformanceFallbackReason(26.84)).toBe(
      'Traffic simulation is too slow on this device (26.8 ms p95) and would cause lag. Use a lighter density preset or turn SUMO off.',
    );
  });
});
