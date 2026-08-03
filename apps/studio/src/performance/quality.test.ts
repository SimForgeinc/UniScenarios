import { describe, expect, it } from 'vitest';
import { QUALITY_STORAGE_KEY, defaultQualityPreference, loadQualityPreference, preferenceForPreset, saveQualityPreference } from './quality';

describe('render quality preferences', () => {
  it('falls back to Balanced when storage is empty or corrupt', () => {
    expect(loadQualityPreference({ getItem: () => null }).preset).toBe('balanced');
    expect(loadQualityPreference({ getItem: () => '{oops' }).preset).toBe('balanced');
  });

  it('creates independent preset values', () => {
    const first = preferenceForPreset('performance');
    first.live.maxPixelRatio = 9;
    expect(preferenceForPreset('performance').live.maxPixelRatio).toBe(1);
  });

  it('offers a true no-render mode and an aggressive minimal mode', () => {
    const simulation = preferenceForPreset('simulation-only');
    expect(simulation.runtime.renderScene).toBe(false);
    expect(simulation.runtime.vegetation).toBe(false);
    const minimal = preferenceForPreset('minimal');
    expect(minimal.runtime.renderScene).toBe(true);
    expect(minimal.runtime.vegetation).toBe(false);
    expect(minimal.live.maxPixelRatio).toBeLessThan(1);
    expect(minimal.recreate.antialias).toBe(false);
  });

  it('keeps Ultra Low as real 3D while removing expensive fidelity', () => {
    const ultra = preferenceForPreset('ultra-low-3d');
    expect(ultra.runtime.renderScene).toBe(true);
    expect(ultra.runtime.ultraLow3d).toBe(true);
    expect(ultra.runtime.vegetation).toBe(false);
    expect(ultra.live.maxPixelRatio).toBeLessThan(0.75);
    // Yale's conservative road estimate is ~465 MiB (~487 MB). Ground must fit before
    // any optional city detail, even though Ultra skips its texture uploads.
    expect(ultra.live.byteBudget).toBeGreaterThanOrEqual(512 * 1024 * 1024);
    expect(ultra.recreate.antialias).toBe(false);
  });

  it('round trips a custom preference separately from scenario data', () => {
    let stored = '';
    const preference = defaultQualityPreference();
    preference.preset = 'custom';
    preference.live.vegetationMaxDistance = 120;
    saveQualityPreference(preference, { setItem: (key, value) => { expect(key).toBe(QUALITY_STORAGE_KEY); stored = value; } });
    expect(loadQualityPreference({ getItem: () => stored })).toEqual(preference);
  });
});
