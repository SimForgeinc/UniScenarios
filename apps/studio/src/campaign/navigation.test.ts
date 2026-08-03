import { describe, expect, it } from 'vitest';
import { canApplyCampaignOpen } from './navigation';

describe('campaign card navigation identity', () => {
  it('does not import into the stale editor during a cross-map React transition', () => {
    expect(canApplyCampaignOpen('el-camino-road', 'el-camino-road', 'yale-street')).toBe(false);
  });

  it('applies only when request, visible map, and editor ownership agree', () => {
    expect(canApplyCampaignOpen('el-camino-road', 'el-camino-road', 'el-camino-road')).toBe(true);
    expect(canApplyCampaignOpen('yale-street', 'el-camino-road', 'el-camino-road')).toBe(false);
  });
});
