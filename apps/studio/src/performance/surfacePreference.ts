import type { SurfaceMaterialProfile } from '@uniscenarios/city-renderer';

export const SURFACE_PROFILE_STORAGE_KEY = 'uniscenarios.studio.surface-profile.v1';

export function loadSurfaceProfile(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage): SurfaceMaterialProfile {
  if (!storage) return 'enhanced';
  try {
    const value = storage.getItem(SURFACE_PROFILE_STORAGE_KEY);
    return value === 'original' || value === 'presentation' || value === 'enhanced' ? value : 'enhanced';
  } catch {
    return 'enhanced';
  }
}

export function saveSurfaceProfile(
  profile: SurfaceMaterialProfile,
  storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage,
): void {
  try { storage?.setItem(SURFACE_PROFILE_STORAGE_KEY, profile); } catch { /* optional preference */ }
}

