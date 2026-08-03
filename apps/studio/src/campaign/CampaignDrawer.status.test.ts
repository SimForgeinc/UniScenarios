import { describe, expect, it } from 'vitest';

import { campaignAmbientStatus } from './CampaignDrawer';

describe('campaign ambient verification status', () => {
  it('shows curated SUMO smoke evidence as a positive verified state', () => {
    expect(campaignAmbientStatus('sumo-smoke-verified')).toEqual({
      value: 'SUMO smoke verified',
      good: true,
    });
  });

  it('does not promote missing or unknown evidence', () => {
    expect(campaignAmbientStatus('not-verified')).toEqual({ value: 'Not verified', good: false });
  });
});
