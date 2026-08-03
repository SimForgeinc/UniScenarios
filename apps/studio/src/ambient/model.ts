import {
  contentHash,
  resolveAmbientTrafficProfile,
  type AmbientTrafficProvenance,
  type AmbientTrafficProfile,
  type ResolvedAmbientTrafficProfile,
} from '@uniscenarios/sim-engine';

export const AMBIENT_TRAFFIC_STORAGE_KEY = 'uniscenarios.studio.ambient-traffic.v1';
/** Canonical per-scenario authoring configuration. Materialization ignores it; the Studio worker consumes it. */
export const AMBIENT_TRAFFIC_EXTENSION_KEY = 'studio.presentation.ambientTraffic.v1';

export type AmbientTrafficPreset = ResolvedAmbientTrafficProfile['preset'];

export function defaultAmbientTrafficProfile(): ResolvedAmbientTrafficProfile {
  return resolveAmbientTrafficProfile({ version: 1, preset: 'city', seed: 'ambient-1' });
}

/** Canonical evidence is reusable only when it represents the editable copy's effective world. */
export function canReuseVerifiedEvidenceForAmbient(
  profile: ResolvedAmbientTrafficProfile,
  evidence: AmbientTrafficProvenance | undefined,
): boolean {
  return profile.preset === 'off' || evidence?.profileHash === contentHash(profile);
}

/**
 * Editable scenarios without a stored choice get the deterministic City
 * population. A stored `off` profile remains authoritative, and malformed
 * values recover to the same visible authoring default.
 */
export function ambientTrafficProfileFromExtensions(
  extensions: Readonly<Record<string, unknown>> | undefined,
): ResolvedAmbientTrafficProfile {
  const value = extensions?.[AMBIENT_TRAFFIC_EXTENSION_KEY];
  if (value === undefined) return defaultAmbientTrafficProfile();
  try {
    return resolveAmbientTrafficProfile(value as AmbientTrafficProfile);
  } catch {
    return defaultAmbientTrafficProfile();
  }
}

export function profileForPreset(
  preset: AmbientTrafficPreset,
  current: AmbientTrafficProfile = defaultAmbientTrafficProfile(),
): ResolvedAmbientTrafficProfile {
  if (preset === 'custom') {
    return resolveAmbientTrafficProfile({ ...current, version: 1, preset });
  }
  return resolveAmbientTrafficProfile({ version: 1, preset, seed: current.seed });
}

export function loadAmbientTrafficProfile(
  storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage,
): ResolvedAmbientTrafficProfile {
  if (!storage) return defaultAmbientTrafficProfile();
  try {
    const raw = storage.getItem(AMBIENT_TRAFFIC_STORAGE_KEY);
    if (!raw) return defaultAmbientTrafficProfile();
    return resolveAmbientTrafficProfile(JSON.parse(raw) as AmbientTrafficProfile);
  } catch {
    return defaultAmbientTrafficProfile();
  }
}

export function saveAmbientTrafficProfile(
  profile: AmbientTrafficProfile,
  storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(AMBIENT_TRAFFIC_STORAGE_KEY, JSON.stringify(resolveAmbientTrafficProfile(profile)));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory preference still works.
  }
}

export function nextAmbientSeed(current: string | number, entropy = Date.now()): string {
  const ordinal = String(current).match(/^(.*?)-(\d+)$/);
  if (ordinal) return `${ordinal[1]}-${Number(ordinal[2]) + 1}`;
  return `ambient-${Math.max(0, Math.trunc(entropy)).toString(36)}`;
}

export interface AmbientPromotionCapability {
  readonly safe: boolean;
  readonly reason: string;
}

/**
 * Promotion must never guess at lane-path semantics. The current v2
 * scene_absolute role stores pose/lane anchoring but has no authored lane-path
 * field, so generated traffic remains preview-only until that contract exists.
 */
export function ambientPromotionCapability(routeLaneRsls: readonly string[]): AmbientPromotionCapability {
  if (routeLaneRsls.length === 0) return { safe: false, reason: 'This generated actor has no materialized lane route.' };
  return {
    safe: false,
    reason: 'Promotion is unavailable because a scene-absolute role cannot yet preserve the generated lane-path route without guessing.',
  };
}
