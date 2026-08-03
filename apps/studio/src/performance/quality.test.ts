import { describe, expect, it } from 'vitest';
import {
  QUALITY_STORAGE_KEY,
  STARTER_QUALITY_CHOICES,
  defaultQualityPreference,
  inspectQualityPreference,
  loadQualityPreference,
  preferenceForPreset,
  saveQualityPreference,
  selectAndSaveQualityPreset,
  shouldDeferWorldLoading,
} from './quality';

describe('render quality preferences', () => {
  it('falls back to Balanced when storage is empty or corrupt', () => {
    expect(loadQualityPreference({ getItem: () => null }).preset).toBe('balanced');
    expect(loadQualityPreference({ getItem: () => '{oops' }).preset).toBe('balanced');
  });

  it('distinguishes a first visit, saved user, invalid value, and unavailable storage', () => {
    expect(inspectQualityPreference({ getItem: () => null }).state).toBe('missing');
    expect(inspectQualityPreference({ getItem: () => '{oops' }).state).toBe('invalid');
    expect(inspectQualityPreference({ getItem: () => { throw new Error('denied'); } }).state).toBe('unavailable');
    const saved = preferenceForPreset('high');
    const result = inspectQualityPreference({ getItem: () => JSON.stringify(saved) });
    expect(result).toEqual({ preference: saved, state: 'stored' });
    expect(shouldDeferWorldLoading('missing')).toBe(true);
    expect(shouldDeferWorldLoading('invalid')).toBe(true);
    expect(shouldDeferWorldLoading('unavailable')).toBe(true);
    expect(shouldDeferWorldLoading('stored')).toBe(false);
  });

  it('retains the three canonical starter presets and adds Roads Only with one recommendation', () => {
    expect(STARTER_QUALITY_CHOICES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'roads-only', label: 'Roads Only' },
      { id: 'ultra-low-3d', label: 'Ultra Low' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'high', label: 'High' },
    ]);
    expect(STARTER_QUALITY_CHOICES.filter((choice) => choice.recommended).map((choice) => choice.id)).toEqual(['minimal']);
    for (const choice of STARTER_QUALITY_CHOICES) {
      expect(choice.label).toBe(preferenceForPreset(choice.id).preset === choice.id
        ? choice.label
        : 'unreachable');
      expect(choice.downloadGuidance).toMatch(/^Measured cold load: \d/);
      expect(choice.gpuMemoryGuidance).toMatch(/^Resident estimate: .* · \d GB GPU recommended$/);
      expect(choice.downloadGuidance).not.toContain('pending');
    }
  });

  it('keeps saved Ultra Low distinct from Roads Only', () => {
    const ultra = preferenceForPreset('ultra-low-3d');
    const roads = preferenceForPreset('roads-only');
    expect(ultra.runtime.roadsOnly).toBe(false);
    expect(roads.runtime).toMatchObject({ renderScene: true, vegetation: false, ultraLow3d: true, roadsOnly: true });
    const legacyUltra = JSON.parse(JSON.stringify(ultra));
    delete legacyUltra.runtime.roadsOnly;
    expect(loadQualityPreference({ getItem: () => JSON.stringify(legacyUltra) }).preset).toBe('ultra-low-3d');
    expect(loadQualityPreference({ getItem: () => JSON.stringify(legacyUltra) }).runtime.roadsOnly).toBe(false);
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

  it('does not block the in-memory selection when persistence fails', () => {
    const selected = selectAndSaveQualityPreset('minimal', { setItem: () => { throw new Error('quota'); } });
    expect(selected.preset).toBe('minimal');
  });

  it('persists and returns the exact selected preset for immediate application', () => {
    let stored = '';
    const selected = selectAndSaveQualityPreset('ultra-low-3d', { setItem: (key, value) => {
      expect(key).toBe(QUALITY_STORAGE_KEY);
      stored = value;
    } });
    expect(selected).toEqual(preferenceForPreset('ultra-low-3d'));
    expect(loadQualityPreference({ getItem: () => stored })).toEqual(selected);
  });
});
