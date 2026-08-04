import type { VariationCandidate } from '@uniscenarios/anchor-matcher';

export const DEFAULT_VARIATION_CANDIDATE_BUDGET = 50;
export const MAX_VARIATION_CANDIDATE_BUDGET = 500;
export const MAX_VARIATION_DRAWS_PER_LOCATION = 32;
export const DEFAULT_VARIATION_WORKERS = 4;
export const VARIATION_PREFERENCES_KEY = 'uniscenarios.studio.variations.preferences.v1';

export interface VariationPlan {
  axisCombinations: 1;
  drawsPerLocation: number;
  candidateBudget: number;
  potentialCandidates: number;
  limitedByParameters: boolean;
}

export interface VariationPreferences {
  axisCombinations: 1;
  drawsPerLocation: number;
  candidateBudget: number;
  workerCount: number;
}

export function deriveDefaultVariationPlan(
  compatibleLocations: number,
  hasSampledParameters: boolean,
  candidateBudget = DEFAULT_VARIATION_CANDIDATE_BUDGET,
): VariationPlan {
  const locations = Math.max(0, Math.floor(compatibleLocations));
  const budget = clampInt(candidateBudget, 1, MAX_VARIATION_CANDIDATE_BUDGET);
  const draws = locations > 0 && hasSampledParameters
    ? clampInt(Math.ceil(budget / locations), 1, MAX_VARIATION_DRAWS_PER_LOCATION)
    : 1;
  return {
    axisCombinations: 1,
    drawsPerLocation: draws,
    candidateBudget: budget,
    potentialCandidates: Math.min(budget, locations * draws),
    limitedByParameters: !hasSampledParameters && locations < budget,
  };
}

export interface PlannedCandidate {
  candidate: VariationCandidate;
  drawIndex: number;
}

/** Deterministic, location-major expansion with a fail-closed hard cap. */
export function enumerateVariationCandidates(
  candidates: readonly VariationCandidate[],
  drawsPerLocation: number,
  candidateBudget: number,
): PlannedCandidate[] {
  const draws = clampInt(drawsPerLocation, 1, MAX_VARIATION_DRAWS_PER_LOCATION);
  const budget = clampInt(candidateBudget, 1, MAX_VARIATION_CANDIDATE_BUDGET);
  const out: PlannedCandidate[] = [];
  const ordered = [...candidates].sort((a, b) => a.rank - b.rank);
  // Draw-major order covers every compatible location once before spending
  // additional budget on parameter diversity at already-covered locations.
  for (let drawIndex = 0; drawIndex < draws && out.length < budget; drawIndex++) {
    for (const source of ordered) {
      const rank = out.length + 1;
      out.push({
        drawIndex: draws === 1 ? -1 : drawIndex,
        candidate: {
          ...source,
          rank,
          permutationKey: draws === 1 ? source.permutationKey : `${source.permutationKey}:draw-${drawIndex}`,
        },
      });
      if (out.length >= budget) break;
    }
  }
  return out;
}

export function loadVariationPreferences(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): VariationPreferences | null {
  try {
    const parsed = JSON.parse(storage?.getItem(VARIATION_PREFERENCES_KEY) ?? 'null') as Partial<VariationPreferences> | null;
    if (!parsed) return null;
    return {
      axisCombinations: 1,
      drawsPerLocation: clampInt(parsed.drawsPerLocation ?? 1, 1, MAX_VARIATION_DRAWS_PER_LOCATION),
      candidateBudget: clampInt(parsed.candidateBudget ?? DEFAULT_VARIATION_CANDIDATE_BUDGET, 1, MAX_VARIATION_CANDIDATE_BUDGET),
      workerCount: clampInt(parsed.workerCount ?? DEFAULT_VARIATION_WORKERS, 2, 4),
    };
  } catch { return null; }
}

export function saveVariationPreferences(value: VariationPreferences, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(VARIATION_PREFERENCES_KEY, JSON.stringify(value)); } catch { /* session state still applies */ }
}

export function clampInt(value: number | string, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || min)));
}
