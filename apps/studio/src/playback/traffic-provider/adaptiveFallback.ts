export interface SumoPerformanceSample {
  readonly initMilliseconds: number;
  readonly wasmBytes: number;
  readonly heapBytes: number;
  readonly stepP95Milliseconds: number;
  readonly requestedStepMilliseconds: number;
}
export interface SumoPerformanceLimits {
  readonly maxInitMilliseconds: number;
  readonly maxWasmBytes: number;
  readonly maxHeapBytes: number;
  /** 0.5 means the worker must sustain at least 2x realtime. */
  readonly maxStepFraction: number;
}

export const DEFAULT_SUMO_LIMITS: SumoPerformanceLimits = {
  maxInitMilliseconds: 1_500,
  maxWasmBytes: 12 * 1024 * 1024,
  maxHeapBytes: 256 * 1024 * 1024,
  maxStepFraction: 0.5,
};

export type SumoGateDecision =
  | { readonly useSumo: true }
  | { readonly useSumo: false; readonly reason: 'bundle' | 'initialization' | 'memory' | 'step-headroom' };

export function evaluateSumoPerformance(
  sample: SumoPerformanceSample,
  limits: SumoPerformanceLimits = DEFAULT_SUMO_LIMITS,
): SumoGateDecision {
  if (sample.wasmBytes > limits.maxWasmBytes) return { useSumo: false, reason: 'bundle' };
  if (sample.initMilliseconds > limits.maxInitMilliseconds) return { useSumo: false, reason: 'initialization' };
  if (sample.heapBytes > limits.maxHeapBytes) return { useSumo: false, reason: 'memory' };
  if (sample.stepP95Milliseconds > sample.requestedStepMilliseconds * limits.maxStepFraction) {
    return { useSumo: false, reason: 'step-headroom' };
  }
  return { useSumo: true };
}
