import { describe, expect, it } from 'vitest';
import {
  LIVE_LOOKAHEAD_SECONDS,
  LIVE_REFILL_SECONDS,
  initialLiveTickBudget,
  liveBatchTickBudget,
  planLiveRefill,
} from '../liveSimulationPlan';

describe('live simulation pacing', () => {
  it('publishes the first moving sample without building a startup lead', () => {
    const warmupTicks = Math.round(2 / 0.05);
    expect(initialLiveTickBudget(2, 0.05) - warmupTicks).toBe(2);
  });

  it('uses quarter-second post-start batches and expands to recover a deficit', () => {
    expect(liveBatchTickBudget(0.05, 0.05)).toBe(5);
    expect(liveBatchTickBudget(0.05, 0.3)).toBe(6);
    expect(liveBatchTickBudget(0.01, 0.3)).toBe(30);
    expect(liveBatchTickBudget(0.05) * 0.05).toBeCloseTo(LIVE_REFILL_SECONDS);
  });

  it('refills immediately before the display playhead can reach a batch boundary', () => {
    const urgent = planLiveRefill(1, 0.6, 0.05);
    expect(urgent.waitMs).toBe(0);
    expect(urgent.advanceTicks * 0.05).toBeGreaterThanOrEqual(LIVE_LOOKAHEAD_SECONDS - 0.4);

    const buffered = planLiveRefill(1, 0.2, 0.05);
    expect(buffered.advanceTicks).toBe(0);
    expect(buffered.waitMs).toBeGreaterThan(0);
    expect(buffered.waitMs).toBeLessThanOrEqual(100);
  });
});
