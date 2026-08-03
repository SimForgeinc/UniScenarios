import { describe, expect, it } from 'vitest';
import { initialLiveTickBudget, liveBatchTickBudget, liveDemandUntil } from '../liveSimulationPlan';

describe('live simulation pacing', () => {
  it('publishes the first moving sample after one 20 Hz fixed step', () => {
    const warmupTicks = Math.round(2 / 0.05);
    expect(initialLiveTickBudget(2, 0.05) - warmupTicks).toBe(2);
  });

  it('uses small normal batches but catches up faster after a slow-CPU underrun', () => {
    expect(liveBatchTickBudget(0.05, 0.05)).toBe(1);
    expect(liveBatchTickBudget(0.05, 0.3)).toBe(5);
    expect(liveBatchTickBudget(0.01, 0.3)).toBe(25);
  });

  it('requests a bounded lookahead and never simulates past the clip', () => {
    expect(liveDemandUntil(4, 20)).toBeCloseTo(4.3);
    expect(liveDemandUntil(19.9, 20)).toBe(20);
  });
});
