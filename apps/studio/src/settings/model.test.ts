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
  PREVIOUS_STUDIO_VIEW_SETTINGS_KEY,
} from './model';

describe('Studio view settings', () => {
  it('starts clean sessions with overlays and debug graphics off', () => {
    expect(loadStudioViewSettings({ getItem: () => null })).toEqual({
      layers: { city: true, vegetation: true, road: true },
      overlays: { lanes: false, signals: false },
      signalOrbs: { visible: true, xray: true },
      debugGraphics: false,
      routes: cloneDefaults().routes,
      controls: cloneDefaults().controls,
    });
    expect(cloneDefaults().controls.reverseHorizontalLook).toBe(false);
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
      signalOrbs: { visible: true, xray: true },
      debugGraphics: false,
      routes: cloneDefaults().routes,
      controls: cloneDefaults().controls,
    });
  });

  it('serializes independent axes and migrates legacy pan direction consistently', () => {
    let stored = '';
    const settings = cloneDefaults();
    settings.controls.reverseHorizontalLook = false;
    settings.controls.reverseVerticalLook = true;
    settings.controls.reverseHorizontalPan = true;
    settings.controls.reverseVerticalPan = false;
    settings.controls.horizontalLookSensitivity = 85;
    settings.controls.verticalLookSensitivity = 65;
    saveStudioViewSettings(settings, { setItem: (_key, value) => { stored = value; } });
    expect(loadStudioViewSettings({ getItem: (key) => key === STUDIO_VIEW_SETTINGS_KEY ? stored : null })).toEqual(settings);

    const legacy = JSON.stringify({ layers: { city: false }, debugGraphics: true });
    expect(loadStudioViewSettings({ getItem: (key) => key === LEGACY_STUDIO_VIEW_SETTINGS_KEY ? legacy : null }).controls)
      .toEqual(cloneDefaults().controls);

    const reverseOnly = JSON.stringify({ controls: {
      version: 1,
      reverseHorizontalLook: false,
      reverseVerticalLook: true,
      reversePanDirection: true,
    } });
    expect(loadStudioViewSettings({ getItem: (key) => key === REVERSE_ONLY_STUDIO_VIEW_SETTINGS_KEY ? reverseOnly : null }).controls)
      .toEqual({
        ...cloneDefaults().controls,
        reverseHorizontalLook: false,
        reverseVerticalLook: true,
        reverseHorizontalPan: true,
        reverseVerticalPan: true,
      });
  });

  it('preserves both explicit horizontal-look directions from persisted settings', () => {
    const off = parseStudioViewSettings({ controls: { version: 2, reverseHorizontalLook: false } });
    const on = parseStudioViewSettings({ controls: { version: 2, reverseHorizontalLook: true } });
    expect(off.controls.reverseHorizontalLook).toBe(false);
    expect(on.controls.reverseHorizontalLook).toBe(true);
  });

  it('shows 100% while preserving the historical 0.4 look speed', () => {
    expect(cloneDefaults().controls).toMatchObject({
      horizontalLookSensitivity: 100,
      verticalLookSensitivity: 100,
      middlePanSensitivity: 100,
      rightPanSensitivity: 100,
      wheelZoomSensitivity: 100,
      keyboardMoveSensitivity: 100,
      keyboardTurnSensitivity: 100,
    });
    const legacyV2 = { controls: {
      version: 2,
      horizontalLookSensitivity: 40,
      verticalLookSensitivity: 125,
    } };
    expect(parseStudioViewSettings(legacyV2).controls).toMatchObject({
      horizontalLookSensitivity: 100,
      verticalLookSensitivity: 312.5,
    });
  });

  it('migrates a legacy single look speed to both axes without changing perceived speed', () => {
    expect(parseStudioViewSettings({ controls: {
      version: 1,
      lookSensitivity: 80,
    } }).controls).toMatchObject({
      horizontalLookSensitivity: 200,
      verticalLookSensitivity: 200,
    });
  });

  it('fills only missing normalized look speeds and lets newer pan axes win', () => {
    expect(parseStudioViewSettings({ controls: {
      version: 3,
      horizontalLookSensitivity: 85,
      reversePan: true,
      reverseHorizontalPan: false,
    } }).controls).toMatchObject({
      horizontalLookSensitivity: 85,
      verticalLookSensitivity: 100,
      reverseHorizontalPan: false,
      reverseVerticalPan: true,
    });
  });

  it('loads the v4 storage key and normalizes its internal look scale', () => {
    const previous = JSON.stringify({ controls: {
      version: 2,
      reverseHorizontalLook: false,
      horizontalLookSensitivity: 40,
      verticalLookSensitivity: 60,
    } });
    expect(loadStudioViewSettings({ getItem: (key) => key === PREVIOUS_STUDIO_VIEW_SETTINGS_KEY ? previous : null }).controls)
      .toMatchObject({
        reverseHorizontalLook: false,
        horizontalLookSensitivity: 100,
        verticalLookSensitivity: 150,
      });
  });

  it('fails malformed and unknown control versions closed to defaults', () => {
    expect(parseStudioViewSettings({ controls: 'broken' }).controls).toEqual(cloneDefaults().controls);
    expect(parseStudioViewSettings({ controls: { version: 99, reverseHorizontalLook: false } }).controls).toEqual(cloneDefaults().controls);
    expect(parseStudioViewSettings({ controls: { version: 1, reversePanDirection: 'no' } }).controls).toEqual(cloneDefaults().controls);
  });

  it('clamps finite sensitivity values and falls back for malformed values', () => {
    const controls = parseStudioViewSettings({ controls: {
      version: 3,
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
      verticalLookSensitivity: 750,
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
    reset.signalOrbs.visible = false;
    expect(DEFAULT_STUDIO_VIEW_SETTINGS.overlays.signals).toBe(false);
    expect(DEFAULT_STUDIO_VIEW_SETTINGS.signalOrbs.visible).toBe(true);
    expect(cloneDefaults().overlays.signals).toBe(false);
    expect(cloneDefaults().signalOrbs.visible).toBe(true);
  });
});
