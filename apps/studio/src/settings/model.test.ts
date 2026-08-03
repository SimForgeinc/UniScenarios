import { describe, expect, it } from 'vitest';
import {
  cloneDefaults,
  DEFAULT_STUDIO_VIEW_SETTINGS,
  loadStudioViewSettings,
  parseStudioViewSettings,
  saveStudioViewSettings,
  LEGACY_STUDIO_VIEW_SETTINGS_KEY,
  REVERSE_ONLY_STUDIO_VIEW_SETTINGS_KEY,
  STUDIO_VIEW_SETTINGS_KEY,
} from './model';

describe('Studio view settings', () => {
  it('starts clean sessions with overlays and debug graphics off', () => {
    expect(loadStudioViewSettings({ getItem: () => null })).toEqual({
      layers: { city: true, vegetation: true, road: true },
      overlays: { lanes: false, signals: false },
      debugGraphics: false,
      controls: cloneDefaults().controls,
    });
  });

  it('persists an intentional preference and fills missing fields safely', () => {
    let stored = '';
    const settings = cloneDefaults();
    settings.overlays.lanes = true;
    settings.debugGraphics = true;
    saveStudioViewSettings(settings, {
      setItem: (key, value) => {
        expect(key).toBe(STUDIO_VIEW_SETTINGS_KEY);
        stored = value;
      },
    });
    expect(loadStudioViewSettings({ getItem: () => stored })).toEqual(settings);
    expect(parseStudioViewSettings({ layers: { road: false } })).toEqual({
      layers: { city: true, vegetation: true, road: false },
      overlays: { lanes: false, signals: false },
      debugGraphics: false,
      controls: cloneDefaults().controls,
    });
  });

  it('serializes control preferences and migrates legacy settings to reversed defaults', () => {
    let stored = '';
    const settings = cloneDefaults();
    settings.controls.reverseHorizontalLook = false;
    settings.controls.reverseVerticalLook = true;
    settings.controls.reversePanDirection = false;
    saveStudioViewSettings(settings, { setItem: (_key, value) => { stored = value; } });
    expect(loadStudioViewSettings({ getItem: (key) => key === STUDIO_VIEW_SETTINGS_KEY ? stored : null })).toEqual(settings);

    const legacy = JSON.stringify({ layers: { city: false }, debugGraphics: true });
    expect(loadStudioViewSettings({ getItem: (key) => key === LEGACY_STUDIO_VIEW_SETTINGS_KEY ? legacy : null }).controls)
      .toEqual(cloneDefaults().controls);

    const reverseOnly = JSON.stringify({ controls: {
      version: 1,
      reverseHorizontalLook: false,
      reverseVerticalLook: true,
      reversePanDirection: false,
    } });
    expect(loadStudioViewSettings({ getItem: (key) => key === REVERSE_ONLY_STUDIO_VIEW_SETTINGS_KEY ? reverseOnly : null }).controls)
      .toEqual({
        ...cloneDefaults().controls,
        reverseHorizontalLook: false,
        reverseVerticalLook: true,
        reversePanDirection: false,
      });
  });

  it('preserves explicitly saved look speeds while fresh and reset defaults use 50%', () => {
    expect(cloneDefaults().controls).toMatchObject({
      horizontalLookSensitivity: 50,
      verticalLookSensitivity: 50,
      middlePanSensitivity: 100,
      rightPanSensitivity: 100,
      wheelZoomSensitivity: 100,
      keyboardMoveSensitivity: 100,
      keyboardTurnSensitivity: 100,
    });
    const saved = cloneDefaults();
    saved.controls.horizontalLookSensitivity = 100;
    saved.controls.verticalLookSensitivity = 125;
    expect(parseStudioViewSettings(saved).controls).toMatchObject({
      horizontalLookSensitivity: 100,
      verticalLookSensitivity: 125,
    });
  });

  it('fails malformed and unknown control versions closed to defaults', () => {
    expect(parseStudioViewSettings({ controls: 'broken' }).controls).toEqual(cloneDefaults().controls);
    expect(parseStudioViewSettings({ controls: { version: 99, reverseHorizontalLook: false } }).controls).toEqual(cloneDefaults().controls);
    expect(parseStudioViewSettings({ controls: { version: 1, reversePanDirection: 'no' } }).controls).toEqual(cloneDefaults().controls);
  });

  it('clamps finite sensitivity values and falls back for malformed values', () => {
    const controls = parseStudioViewSettings({ controls: {
      version: 2,
      horizontalLookSensitivity: 0,
      verticalLookSensitivity: 999,
      middlePanSensitivity: 25,
      rightPanSensitivity: 300,
      wheelZoomSensitivity: Number.NaN,
      keyboardMoveSensitivity: 'fast',
      keyboardTurnSensitivity: 155,
    } }).controls;
    expect(controls).toMatchObject({
      horizontalLookSensitivity: 25,
      verticalLookSensitivity: 300,
      middlePanSensitivity: 25,
      rightPanSensitivity: 300,
      wheelZoomSensitivity: 100,
      keyboardMoveSensitivity: 100,
      keyboardTurnSensitivity: 155,
    });
  });

  it('reset defaults returns a fresh mutable copy', () => {
    const reset = cloneDefaults();
    reset.overlays.signals = true;
    expect(DEFAULT_STUDIO_VIEW_SETTINGS.overlays.signals).toBe(false);
    expect(cloneDefaults().overlays.signals).toBe(false);
  });
});
