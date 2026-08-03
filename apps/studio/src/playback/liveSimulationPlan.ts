/**
 * The renderer needs two fixed-step samples around its display playhead.
 * This reserve absorbs worker scheduling and structured-clone jitter after
 * playback has started; it is deliberately not a startup prerequisite.
 */
export const LIVE_LOOKAHEAD_SECONDS = 0.75;
export const LIVE_REFILL_SECONDS = 0.25;

/**
 * The compiled bundle already owns t=0. A resumed warmed session therefore
 * publishes exactly one moving fixed-step sample; a cold fallback includes
 * warmup plus that same first sample.
 */
export function initialLiveTickBudget(warmupSeconds: number, dt: number): number {
  return Math.round(warmupSeconds / dt) + 2;
}

export function liveBatchTickBudget(dt: number, deficitSeconds = LIVE_REFILL_SECONDS): number {
  return Math.max(1, Math.ceil(Math.max(LIVE_REFILL_SECONDS, deficitSeconds) / dt));
}

export interface LiveRefillPlan {
  readonly advanceTicks: number;
  readonly waitMs: number;
}

/** Adapt the post-start producer reserve to the authoritative playhead. */
export function planLiveRefill(recordedUntil: number, playhead: number, dt: number): LiveRefillPlan {
  const lead = Math.max(0, recordedUntil - playhead);
  const missing = Math.max(0, LIVE_LOOKAHEAD_SECONDS - lead);
  if (missing > dt / 2) {
    return { advanceTicks: liveBatchTickBudget(dt, missing), waitMs: 0 };
  }
  // Wake before a refill chunk is consumed. The cap keeps pause and seek
  // responsive without polling at display cadence.
  return { advanceTicks: 0, waitMs: Math.max(16, Math.min(100, (lead - LIVE_REFILL_SECONDS) * 500)) };
}
