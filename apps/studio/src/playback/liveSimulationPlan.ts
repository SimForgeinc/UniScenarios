/** Initial playback lead: enough for first movement, never a full trace. */
export function initialLiveTickBudget(warmupSeconds: number, dt: number): number {
  // Inclusive recording needs one extra tick to contain the 250 ms sample.
  return Math.round(warmupSeconds / dt) + Math.max(2, Math.ceil(0.25 / dt)) + 1;
}

/** Quarter-second chunks keep a modest lead without racing to a full trace. */
export function liveBatchTickBudget(dt: number): number {
  return Math.max(1, Math.ceil(0.25 / dt));
}
