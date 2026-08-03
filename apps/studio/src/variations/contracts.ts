import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { CarlaConformanceEligibility, VariationCandidateResult, VariationReviewState } from './model';

export const VARIATION_STUDIO_CONTRACT_VERSION = 'studio.variations.v2';

export function scenarioRevision(template: ScenarioTemplateV2): string {
  const source = stable(template);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `rev-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function adaptiveVariationWorkerCount(hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 4): number {
  return Math.max(2, Math.min(4, Math.floor(hardwareConcurrency / 2) || 2));
}

/** Future CARLA surfaces must call this gate; it never dispatches work. */
export function carlaConformanceEligibility(input: {
  candidate: VariationCandidateResult;
  reviewState?: VariationReviewState | 'accepted';
  currentRevision: string;
}): CarlaConformanceEligibility {
  if (input.reviewState !== 'shortlisted' && input.reviewState !== 'promoted' && input.reviewState !== 'accepted') {
    return { eligible: false, code: 'CARLA_REVIEW_REQUIRED', message: 'Shortlist or promote this candidate before requesting expensive CARLA validation.' };
  }
  if (input.candidate.acceptance.status !== 'accepted' || !input.candidate.lineage) {
    return { eligible: false, code: 'CARLA_NATIVE_VERIFICATION_REQUIRED', message: 'A successful native simulation is required before CARLA validation.' };
  }
  if (input.candidate.lineage.sourceRevision !== input.currentRevision) {
    return { eligible: false, code: 'CARLA_EVIDENCE_STALE', message: 'The source scenario changed after verification. Regenerate this candidate.' };
  }
  return { eligible: true, code: 'CARLA_ELIGIBLE', message: 'Eligible for optional CARLA conformance validation (~75 s for a 20 s scenario).' };
}
