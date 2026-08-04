import type { MapOverlayLayer } from '../mapOverlays';

export const STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v5';
export const PREVIOUS_STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v4';
export const LEGACY_SENSITIVITY_STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v3';
export const REVERSE_ONLY_STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v2';
export const LEGACY_STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v1';

export interface StudioCameraControlSettings {
  version: 3;
  reverseHorizontalLook: boolean;
  reverseVerticalLook: boolean;
  reverseHorizontalPan: boolean;
  reverseVerticalPan: boolean;
  horizontalLookSensitivity: number;
  verticalLookSensitivity: number;
  middlePanSensitivity: number;
  rightPanSensitivity: number;
  wheelZoomSensitivity: number;
  keyboardMoveSensitivity: number;
  keyboardTurnSensitivity: number;
}

export interface StudioViewSettings {
  layers: {
    city: boolean;
    vegetation: boolean;
    road: boolean;
  };
  overlays: Record<MapOverlayLayer, boolean>;
  signalOrbs: {
    visible: boolean;
    xray: boolean;
  };
  debugGraphics: boolean;
  routes: {
    visible: boolean;
    ambient: boolean;
    actual: boolean;
    duringPlayback: boolean;
  };
  controls: StudioCameraControlSettings;
}

export const DEFAULT_STUDIO_VIEW_SETTINGS: StudioViewSettings = Object.freeze({
  layers: Object.freeze({ city: true, vegetation: true, road: true }),
  overlays: Object.freeze({ lanes: false, signals: false }),
  signalOrbs: Object.freeze({ visible: true, xray: true }),
  debugGraphics: false,
  routes: Object.freeze({ visible: true, ambient: false, actual: false, duringPlayback: true }),
  controls: Object.freeze({
    version: 3,
    reverseHorizontalLook: false,
    reverseVerticalLook: false,
    reverseHorizontalPan: false,
    reverseVerticalPan: false,
    horizontalLookSensitivity: 100,
    verticalLookSensitivity: 100,
    middlePanSensitivity: 100,
    rightPanSensitivity: 100,
    wheelZoomSensitivity: 100,
    keyboardMoveSensitivity: 100,
    keyboardTurnSensitivity: 100,
  }),
});

export function parseStudioViewSettings(value: unknown): StudioViewSettings {
  if (!value || typeof value !== 'object') return cloneDefaults();
  const input = value as Partial<StudioViewSettings>;
  const layers: Partial<StudioViewSettings['layers']> = input.layers && typeof input.layers === 'object' ? input.layers : {};
  const overlays: Partial<StudioViewSettings['overlays']> = input.overlays && typeof input.overlays === 'object' ? input.overlays : {};
  const rawControls = input.controls && typeof input.controls === 'object'
    ? input.controls as Partial<StudioCameraControlSettings> & Record<string, unknown>
    : null;
  const controlVersion: unknown = rawControls?.version;
  const controls = controlVersion === 1 || controlVersion === 2 || controlVersion === 3 ? rawControls : null;
  const sensitivity = (value: unknown, fallback = 100): number => typeof value === 'number' && Number.isFinite(value)
    ? Math.min(300, Math.max(25, value))
    : fallback;
  const lookSensitivity = (axisValue: unknown): number => {
    const singleValue = controls?.['lookSensitivity'] ?? controls?.['lookSpeed'];
    const value = typeof axisValue === 'number' ? axisValue : singleValue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
    // v1/v2 persisted the renderer's internal multiplier as a percentage:
    // 40 meant 0.4. v3 is user-facing, where 100 means the same 0.4.
    const displayed = controlVersion === 3 ? value : value / 0.4;
    return Math.min(750, Math.max(25, displayed));
  };
  const legacyPan = typeof controls?.['reversePan'] === 'boolean'
    ? controls['reversePan']
    : typeof controls?.['reversePanDirection'] === 'boolean'
      ? controls['reversePanDirection']
      : false;
  return {
    layers: {
      city: typeof layers.city === 'boolean' ? layers.city : true,
      vegetation: typeof layers.vegetation === 'boolean' ? layers.vegetation : true,
      road: typeof layers.road === 'boolean' ? layers.road : true,
    },
    overlays: {
      lanes: typeof overlays.lanes === 'boolean' ? overlays.lanes : false,
      signals: typeof overlays.signals === 'boolean' ? overlays.signals : false,
    },
    signalOrbs: {
      visible: typeof input.signalOrbs?.visible === 'boolean' ? input.signalOrbs.visible : true,
      xray: typeof input.signalOrbs?.xray === 'boolean' ? input.signalOrbs.xray : true,
    },
    debugGraphics: typeof input.debugGraphics === 'boolean' ? input.debugGraphics : false,
    routes: {
      visible: typeof input.routes?.visible === 'boolean' ? input.routes.visible : true,
      ambient: typeof input.routes?.ambient === 'boolean' ? input.routes.ambient : false,
      actual: typeof input.routes?.actual === 'boolean' ? input.routes.actual : false,
      duringPlayback: typeof input.routes?.duringPlayback === 'boolean' ? input.routes.duringPlayback : true,
    },
    controls: {
      version: 3,
      reverseHorizontalLook: typeof controls?.reverseHorizontalLook === 'boolean' ? controls.reverseHorizontalLook : false,
      reverseVerticalLook: typeof controls?.reverseVerticalLook === 'boolean' ? controls.reverseVerticalLook : false,
      reverseHorizontalPan: typeof controls?.reverseHorizontalPan === 'boolean' ? controls.reverseHorizontalPan : legacyPan,
      reverseVerticalPan: typeof controls?.reverseVerticalPan === 'boolean' ? controls.reverseVerticalPan : legacyPan,
      horizontalLookSensitivity: lookSensitivity(controls?.horizontalLookSensitivity),
      verticalLookSensitivity: lookSensitivity(controls?.verticalLookSensitivity),
      middlePanSensitivity: sensitivity(controls?.middlePanSensitivity),
      rightPanSensitivity: sensitivity(controls?.rightPanSensitivity),
      wheelZoomSensitivity: sensitivity(controls?.wheelZoomSensitivity),
      keyboardMoveSensitivity: sensitivity(controls?.keyboardMoveSensitivity),
      keyboardTurnSensitivity: sensitivity(controls?.keyboardTurnSensitivity),
    },
  };
}

export function loadStudioViewSettings(storage: Pick<Storage, 'getItem'> | null = browserStorage()): StudioViewSettings {
  if (!storage) return cloneDefaults();
  try {
    const raw = storage.getItem(STUDIO_VIEW_SETTINGS_KEY)
      ?? storage.getItem(PREVIOUS_STUDIO_VIEW_SETTINGS_KEY)
      ?? storage.getItem(LEGACY_SENSITIVITY_STUDIO_VIEW_SETTINGS_KEY)
      ?? storage.getItem(REVERSE_ONLY_STUDIO_VIEW_SETTINGS_KEY)
      ?? storage.getItem(LEGACY_STUDIO_VIEW_SETTINGS_KEY);
    return raw ? parseStudioViewSettings(JSON.parse(raw)) : cloneDefaults();
  } catch {
    return cloneDefaults();
  }
}

export function saveStudioViewSettings(
  settings: StudioViewSettings,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  try {
    storage?.setItem(STUDIO_VIEW_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A full or privacy-restricted browser store must not break the editor.
  }
}

export function cloneDefaults(): StudioViewSettings {
  return {
    layers: { ...DEFAULT_STUDIO_VIEW_SETTINGS.layers },
    overlays: { ...DEFAULT_STUDIO_VIEW_SETTINGS.overlays },
    signalOrbs: { ...DEFAULT_STUDIO_VIEW_SETTINGS.signalOrbs },
    debugGraphics: DEFAULT_STUDIO_VIEW_SETTINGS.debugGraphics,
    routes: { ...DEFAULT_STUDIO_VIEW_SETTINGS.routes },
    controls: { ...DEFAULT_STUDIO_VIEW_SETTINGS.controls },
  };
}

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}
