import { describe, expect, it } from 'vitest';
import { adaptiveVariationWorkerCount, carlaConformanceEligibility, scenarioRevision } from '../contracts';

const candidate = (overrides: Record<string, unknown> = {}) => ({
  candidate: { mapId: 'yale', site: { siteId: 'site' } },
  acceptance: { status: 'accepted' },
  lineage: { sourceRevision: 'rev-a' },
  ...overrides,
}) as any;

describe('variation operating envelope contracts', () => {
  it('bounds the adaptive verification pool to two through four workers', () => {
    expect(adaptiveVariationWorkerCount(1)).toBe(2);
    expect(adaptiveVariationWorkerCount(6)).toBe(3);
    expect(adaptiveVariationWorkerCount(128)).toBe(4);
  });

  it('creates a content-owned revision independent of object key order', () => {
    expect(scenarioRevision({ meta: { name: 'x' }, roles: [] } as any)).toBe(scenarioRevision({ roles: [], meta: { name: 'x' } } as any));
    expect(scenarioRevision({ meta: { name: 'x' }, roles: [] } as any)).not.toBe(scenarioRevision({ meta: { name: 'y' }, roles: [] } as any));
  });

  it('allows CARLA only after native verification and human shortlist/promotion', () => {
    expect(carlaConformanceEligibility({ candidate: candidate(), currentRevision: 'rev-a' }).code).toBe('CARLA_REVIEW_REQUIRED');
    expect(carlaConformanceEligibility({ candidate: candidate({ acceptance: { status: 'pending_simulation' } }), reviewState: 'shortlisted', currentRevision: 'rev-a' }).code).toBe('CARLA_NATIVE_VERIFICATION_REQUIRED');
    expect(carlaConformanceEligibility({ candidate: candidate(), reviewState: 'shortlisted', currentRevision: 'rev-b' }).code).toBe('CARLA_EVIDENCE_STALE');
    expect(carlaConformanceEligibility({ candidate: candidate(), reviewState: 'promoted', currentRevision: 'rev-a' })).toMatchObject({ eligible: true, code: 'CARLA_ELIGIBLE' });
  });
});
