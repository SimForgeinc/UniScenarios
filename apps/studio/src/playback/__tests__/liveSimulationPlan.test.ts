import { describe, expect, it } from 'vitest';
import { initialLiveTickBudget, liveBatchTickBudget } from '../liveSimulationPlan';

describe('live simulation pacing', () => {
  it('starts after only a 250 ms lead on the normal 20 Hz fixed step', () => {
    const warmupTicks = Math.round(2 / 0.05);
    expect(initialLiveTickBudget(2, 0.05) - warmupTicks).toBe(6);
  });

  it('bounds each yielded producer batch to a quarter simulated second', () => {
    expect(liveBatchTickBudget(0.05)).toBe(5);
    expect(liveBatchTickBudget(0.01)).toBe(25);
  });
});
