import { describe, expect, it } from 'vitest';
import { defaultAmbientTrafficProfile, profileForPreset } from './model';
import { ambientCandidatePoolRequestKey, ambientPreviewKey, AmbientPreviewCache } from './candidatePool';

describe('ambient candidate pool preview cache', () => {
  const city = defaultAmbientTrafficProfile();

  it('reuses the exact compiled preview for repeated Play', () => {
    const cache = new AmbientPreviewCache<{ actors: string[] }>();
    const requestKey = ambientCandidatePoolRequestKey('map-a', city);
    const previewKey = ambientPreviewKey(requestKey, 'scenario-a');
    const value = { actors: ['ambient:1'] };
    cache.commit(cache.begin(), { candidatePoolRequestKey: requestKey, previewKey, value });
    expect(cache.playback()).toBe(value);
    expect(cache.playback()).toBe(value);
  });

  it('invalidates candidates only for map/profile/mix/seed changes', () => {
    const key = ambientCandidatePoolRequestKey('map-a', city);
    expect(ambientCandidatePoolRequestKey('map-a', city)).toBe(key);
    expect(ambientPreviewKey(key, 'scenario-a')).not.toBe(ambientPreviewKey(key, 'scenario-b'));
    expect(ambientCandidatePoolRequestKey('map-b', city)).not.toBe(key);
    expect(ambientCandidatePoolRequestKey('map-a', { ...city, seed: 'regenerate' })).not.toBe(key);
    expect(ambientCandidatePoolRequestKey('map-a', profileForPreset('light', city))).not.toBe(key);
  });

  it('retains the visible preview on errors and ignores stale work', () => {
    const cache = new AmbientPreviewCache<string>();
    cache.commit(cache.begin(), { candidatePoolRequestKey: 'a', previewKey: 'a:1', value: 'visible' });
    cache.fail(cache.begin());
    expect(cache.playback()).toBe('visible');
    const stale = cache.begin();
    const current = cache.begin();
    expect(cache.commit(stale, { candidatePoolRequestKey: 'old', previewKey: 'old', value: 'old' })).toBe(false);
    expect(cache.commit(current, { candidatePoolRequestKey: 'new', previewKey: 'new', value: 'new' })).toBe(true);
  });
});
