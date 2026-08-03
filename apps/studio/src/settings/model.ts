import type { MapOverlayLayer } from '../mapOverlays';

export const STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v3';
export const REVERSE_ONLY_STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v2';
export const LEGACY_STUDIO_VIEW_SETTINGS_KEY = 'uniscenarios.studio.view-settings.v1';

export interface StudioCameraControlSettings {
  version: 2;
  reverseHorizontalLook: boolean;
  reverseVerticalLook: boolean;
  reversePanDirection: boolean;
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
  debugGraphics: boolean;
  controls: StudioCameraControlSettings;
}

export const DEFAULT_STUDIO_VIEW_SETTINGS: StudioViewSettings = Object.freeze({
  layers: Object.freeze({ city: true, vegetation: true, road: true }),
  overlays: Object.freeze({ lanes: false, signals: false }),
  debugGraphics: false,
  controls: Object.freeze({
    version: 2,
    reverseHorizontalLook: true,
    reverseVerticalLook: false,
    reversePanDirection: true,
    horizontalLookSensitivity: 50,
    verticalLookSensitivity: 50,
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
    ? input.controls as Partial<StudioCameraControlSettings>
    : null;
  const controlVersion: unknown = rawControls?.version;
  const controls = controlVersion === 1 || controlVersion === 2 ? rawControls : null;
  const sensitivity = (value: unknown, fallback = 100): number => typeof value === 'number' && Number.isFinite(value)
    ? Math.min(300, Math.max(25, value))
    : fallback;
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
    debugGraphics: typeof input.debugGraphics === 'boolean' ? input.debugGraphics : false,
    controls: {
      version: 2,
      reverseHorizontalLook: typeof controls?.reverseHorizontalLook === 'boolean' ? controls.reverseHorizontalLook : true,
      reverseVerticalLook: typeof controls?.reverseVerticalLook === 'boolean' ? controls.reverseVerticalLook : false,
      reversePanDirection: typeof controls?.reversePanDirection === 'boolean' ? controls.reversePanDirection : true,
      horizontalLookSensitivity: sensitivity(controls?.horizontalLookSensitivity, 50),
      verticalLookSensitivity: sensitivity(controls?.verticalLookSensitivity, 50),
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
    debugGraphics: DEFAULT_STUDIO_VIEW_SETTINGS.debugGraphics,
    controls: { ...DEFAULT_STUDIO_VIEW_SETTINGS.controls },
  };
}

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}
