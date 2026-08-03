/** How far the producer should stay ahead of the sole Studio playhead. */
export const LIVE_TARGET_LOOKAHEAD_SECONDS = 0.3;

/** Do not send a worker demand for every animation frame. */
export const LIVE_DEMAND_QUANTUM_SECONDS = 0.2;

/**
 * Publish the first moving sample as soon as possible. The already-compiled
 * bundle owns t=0, so live startup only needs one fixed step beyond it.
 */
export function initialLiveTickBudget(warmupSeconds: number, dt: number): number {
  return Math.round(warmupSeconds / dt) + 2;
}

/**
 * Adapt producer work to actual demand. Small batches yield quickly on a busy
 * CPU; a large deficit is allowed a larger batch so an underrun recovers rather
 * than remaining permanently one chunk behind.
 */
export function liveBatchTickBudget(dt: number, deficitSeconds: number): number {
  const requested = Math.ceil(Math.max(dt, deficitSeconds) / dt);
  const maxBatch = Math.max(1, Math.ceil(0.25 / dt));
  return Math.max(1, Math.min(requested, maxBatch));
}

export function liveDemandUntil(playhead: number, duration: number): number {
  return Math.min(duration, playhead + LIVE_TARGET_LOOKAHEAD_SECONDS);
}
