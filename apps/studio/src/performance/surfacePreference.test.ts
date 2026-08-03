import { describe, expect, it } from 'vitest';
import { loadSurfaceProfile, saveSurfaceProfile, SURFACE_PROFILE_STORAGE_KEY } from './surfacePreference';

describe('surface material preference', () => {
  it('defaults to enhanced and rejects unknown persisted values', () => {
    expect(loadSurfaceProfile(null)).toBe('enhanced');
    expect(loadSurfaceProfile({ getItem: () => 'future-mode' })).toBe('enhanced');
  });

  it('round-trips all public profiles', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    saveSurfaceProfile('presentation', storage);
    expect(values.get(SURFACE_PROFILE_STORAGE_KEY)).toBe('presentation');
    expect(loadSurfaceProfile(storage)).toBe('presentation');
  });
});

