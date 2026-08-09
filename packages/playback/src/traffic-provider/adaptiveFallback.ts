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

export interface SumoStepTimingSample {
  readonly stepMilliseconds: number;
  readonly requestedStepMilliseconds: number;
}

export interface SumoStepWindowDecision {
  readonly useSumo: boolean;
  readonly stepP95Milliseconds: number;
  readonly headroomP95Fraction: number;
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

/**
 * Evaluate live steps by their individual real-time budget. A raw duration
 * percentile is not sufficient because playback batches may contain 40-50 ms
 * ticks while resets and capture use longer intervals. Comparing a mixed raw
 * percentile with only the most recent interval can reject a healthy worker.
 */
export function evaluateSumoStepWindow(
  samples: readonly SumoStepTimingSample[],
  limits: SumoPerformanceLimits = DEFAULT_SUMO_LIMITS,
): SumoStepWindowDecision {
  const valid = samples.filter(
    (sample) =>
      Number.isFinite(sample.stepMilliseconds) &&
      sample.stepMilliseconds >= 0 &&
      Number.isFinite(sample.requestedStepMilliseconds) &&
      sample.requestedStepMilliseconds > 0,
  );
  if (valid.length === 0) {
    return {
      useSumo: true,
      stepP95Milliseconds: 0,
      headroomP95Fraction: 0,
    };
  }
  const stepP95Milliseconds = percentile(
    valid.map((sample) => sample.stepMilliseconds),
    0.95,
  );
  const headroomP95Fraction = percentile(
    valid.map(
      (sample) =>
        sample.stepMilliseconds / sample.requestedStepMilliseconds,
    ),
    0.95,
  );
  return {
    useSumo: headroomP95Fraction <= limits.maxStepFraction,
    stepP95Milliseconds,
    headroomP95Fraction,
  };
}

export function sumoPerformanceFallbackReason(
  stepP95Milliseconds: number,
): string {
  return `Traffic simulation is too slow on this device (${stepP95Milliseconds.toFixed(1)} ms p95) and would cause lag. Use a lighter density preset or turn SUMO off.`;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))
  ]!;
}
