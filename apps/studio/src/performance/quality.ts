import type { CityViewerLiveQuality } from '@uniscenarios/city-renderer';

export type QualityPresetId = 'simulation-only' | 'ultra-low-3d' | 'minimal' | 'performance' | 'balanced' | 'high' | 'presentation' | 'custom';

export interface QualityRuntime {
  renderScene: boolean;
  vegetation: boolean;
  ultraLow3d: boolean;
}

export interface QualityPreset {
  id: Exclude<QualityPresetId, 'custom'>;
  label: string;
  description: string;
  live: CityViewerLiveQuality;
  runtime: QualityRuntime;
  /** WebGL context options are persisted now and take effect on the next viewer mount. */
  recreate: { antialias: boolean };
}

const MB = 1024 * 1024;

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  {
    id: 'simulation-only',
    label: 'Simulation Only / No Render',
    description: 'Stops rendering, camera work, streaming, and GPU uploads. Simulation, timeline, and metrics keep running.',
    live: {
      maxPixelRatio: 0.5,
      maxScreenSpaceError: 5000,
      vegetationScreenSpaceError: 10000,
      byteBudget: 256 * MB,
      uploadBudgetMs: 0.25,
      uploadPixelsPerFrame: 128e3,
      vegetationMaxDistance: 0,
      exposure: 1,
    },
    runtime: { renderScene: false, vegetation: false, ultraLow3d: false },
    recreate: { antialias: false },
  },
  {
    id: 'ultra-low-3d',
    label: 'Ultra Low 3D / CPU',
    description: 'Real navigable 3D roads, buildings and actors with flat unlit colors, no textures, lighting, environment, vegetation or nonessential overlays.',
    live: {
      maxPixelRatio: 0.6, maxScreenSpaceError: 2200, vegetationScreenSpaceError: 10000,
      byteBudget: 640 * MB, uploadBudgetMs: 0.5, uploadPixelsPerFrame: 256e3,
      vegetationMaxDistance: 0, exposure: 1,
    },
    runtime: { renderScene: true, vegetation: false, ultraLow3d: true },
    recreate: { antialias: false },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Road and coarse city context only: no vegetation, low resolution, and very restrained streaming.',
    live: {
      maxPixelRatio: 0.75,
      maxScreenSpaceError: 1400,
      vegetationScreenSpaceError: 10000,
      byteBudget: 640 * MB,
      uploadBudgetMs: 0.5,
      uploadPixelsPerFrame: 256e3,
      vegetationMaxDistance: 0,
      exposure: 1,
    },
    runtime: { renderScene: true, vegetation: false, ultraLow3d: false },
    recreate: { antialias: false },
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Prioritizes smooth editing and restrained streaming.',
    live: {
      maxPixelRatio: 1,
      maxScreenSpaceError: 700,
      vegetationScreenSpaceError: 3600,
      byteBudget: 768 * MB,
      uploadBudgetMs: 2,
      uploadPixelsPerFrame: 600e3,
      vegetationMaxDistance: 120,
      exposure: 1,
    },
    runtime: { renderScene: true, vegetation: true, ultraLow3d: false },
    recreate: { antialias: false },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Stable authoring quality for most scenes.',
    live: {
      maxPixelRatio: 1.25,
      maxScreenSpaceError: 400,
      vegetationScreenSpaceError: 2600,
      byteBudget: 1024 * MB,
      uploadBudgetMs: 2,
      uploadPixelsPerFrame: 1.1e6,
      vegetationMaxDistance: 200,
      exposure: 1,
    },
    runtime: { renderScene: true, vegetation: true, ultraLow3d: false },
    recreate: { antialias: false },
  },
  {
    id: 'high',
    label: 'High',
    description: 'Sharper viewport with a larger resident scene.',
    live: {
      maxPixelRatio: 2,
      maxScreenSpaceError: 210,
      vegetationScreenSpaceError: 1500,
      byteBudget: 1.5 * 1024 * MB,
      uploadBudgetMs: 5,
      uploadPixelsPerFrame: 4.2e6,
      vegetationMaxDistance: 340,
      exposure: 1,
    },
    runtime: { renderScene: true, vegetation: true, ultraLow3d: false },
    recreate: { antialias: true },
  },
  {
    id: 'presentation',
    label: 'Presentation',
    description: 'Maximum fidelity for review and capture; may hitch while streaming.',
    live: {
      maxPixelRatio: 2.5,
      maxScreenSpaceError: 120,
      vegetationScreenSpaceError: 900,
      byteBudget: 1.8 * 1024 * MB,
      uploadBudgetMs: 8,
      uploadPixelsPerFrame: 8.4e6,
      vegetationMaxDistance: 500,
      exposure: 1,
    },
    runtime: { renderScene: true, vegetation: true, ultraLow3d: false },
    recreate: { antialias: true },
  },
] as const;

export interface QualityPreference {
  preset: QualityPresetId;
  live: CityViewerLiveQuality;
  runtime: QualityRuntime;
  recreate: { antialias: boolean };
}

export const QUALITY_STORAGE_KEY = 'uniscenarios.studio.render-quality.v1';
export const QUALITY_CHANGE_EVENT = 'uniscenarios:render-quality-change';

export function presetById(id: QualityPresetId): QualityPreset {
  return QUALITY_PRESETS.find((preset) => preset.id === id) ?? QUALITY_PRESETS.find((preset) => preset.id === 'balanced')!;
}

export function defaultQualityPreference(): QualityPreference {
  const preset = presetById('balanced');
  return { preset: preset.id, live: { ...preset.live }, runtime: { ...preset.runtime }, recreate: { ...preset.recreate } };
}

export function preferenceForPreset(id: Exclude<QualityPresetId, 'custom'>): QualityPreference {
  const preset = presetById(id);
  return { preset: preset.id, live: { ...preset.live }, runtime: { ...preset.runtime }, recreate: { ...preset.recreate } };
}

export function loadQualityPreference(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage): QualityPreference {
  if (!storage) return defaultQualityPreference();
  try {
    const raw = storage.getItem(QUALITY_STORAGE_KEY);
    if (!raw) return defaultQualityPreference();
    const parsed = JSON.parse(raw) as Partial<QualityPreference>;
    const base = parsed.preset === 'custom'
      ? defaultQualityPreference()
      : preferenceForPreset(
          QUALITY_PRESETS.some((preset) => preset.id === parsed.preset)
            ? (parsed.preset as Exclude<QualityPresetId, 'custom'>)
            : 'balanced',
        );
    if (parsed.preset !== 'custom') return base;
    const live = { ...base.live };
    for (const key of Object.keys(live) as (keyof CityViewerLiveQuality)[]) {
      const value = parsed.live?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) live[key] = value;
    }
    return {
      preset: 'custom',
      live,
      runtime: {
        renderScene: parsed.runtime?.renderScene !== false,
        vegetation: parsed.runtime?.vegetation !== false,
        ultraLow3d: parsed.runtime?.ultraLow3d === true,
      },
      recreate: { antialias: parsed.recreate?.antialias !== false },
    };
  } catch {
    return defaultQualityPreference();
  }
}

export function saveQualityPreference(
  preference: QualityPreference,
  storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage,
): void {
  try {
    storage?.setItem(QUALITY_STORAGE_KEY, JSON.stringify(preference));
    if (storage === globalThis.localStorage && typeof globalThis.dispatchEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent(QUALITY_CHANGE_EVENT, { detail: preference }));
    }
  } catch {
    // Storage can be unavailable in private/embedded contexts; quality remains live for this session.
  }
}
