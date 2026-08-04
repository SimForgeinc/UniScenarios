import type {
  BehaviorSignature,
  MatchedSite,
  VariationAcceptanceReport,
  VariationCandidate,
  VariationIssue,
} from '@uniscenarios/anchor-matcher';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { PortableLiftIssue } from '@uniscenarios/scenario-materializer';
import type { SimScenarioInput, SimTrace } from '@uniscenarios/sim-engine';

export interface VariationMapSource {
  id: string;
  label: string;
  topology: string;
  derivedTopology: string;
  locations: string;
  xodr: string;
  signals: string;
}

export interface PortableVariationBinding {
  /** The portable template whose semantic bindings must be preserved. */
  template: ScenarioTemplateV2;
  /** Exact source site accepted by the author. No world-pose inference occurs downstream. */
  sourceSite: MatchedSite;
}

export interface PortableBindingResult {
  ok: boolean;
  binding?: PortableVariationBinding;
  issues: PortableLiftIssue[];
}

/**
 * Typed seam for the map-bound → portable binding adapter. Implementations must
 * either return a complete binding or a blocking explanation; callers never
 * guess a portable anchor from world positions.
 */
export interface PortableBindingAdapter {
  readonly contractVersion: string;
  bind(template: ScenarioTemplateV2, sourceMap: VariationMapSource): Promise<PortableBindingResult>;
}

export interface VariationPreview {
  actors: Array<{
    id: string;
    points: Array<{ x: number; z: number }>;
    start: { x: number; z: number };
  }>;
  conflicts: Array<{ x: number; z: number; role: string }>;
  mirrored: boolean;
  permutationKey: string;
}

export interface VariationCandidateResult {
  candidate: VariationCandidate;
  acceptance: VariationAcceptanceReport;
  behavior?: BehaviorSignature;
  instance?: {
    kind: 'scenario-instance';
    version: 1;
    manifest: Record<string, unknown>;
    input: SimScenarioInput;
  };
  trace?: SimTrace;
  preview?: VariationPreview;
  error?: string;
  stage?: VariationCandidateStage;
  lineage?: VariationLineageManifest;
}

export type VariationCandidateStage = 'enumerated' | 'materializing' | 'simulating' | 'gating' | 'verified' | 'failed';

export type VariationReviewState = 'shortlisted' | 'rejected' | 'promoted';

export interface VariationLineageManifest {
  kind: 'variation-lineage';
  version: 1;
  sourceRevision: string;
  sourcePatternId: string;
  sourceMapId: string;
  targetMapId: string;
  siteId: string;
  permutationKey: string;
  nativeVerificationToken: string;
  generatedAt: string;
}

export interface VariationRequirement {
  kind: 'actor' | 'road' | 'junction' | 'signal' | 'runway' | 'route';
  label: string;
  detail: string;
}

export type EligibilityReasonCode =
  | 'EXACT_STRUCTURAL_MATCH'
  | 'DEGRADED_STRUCTURAL_MATCH'
  | 'REQUIRED_CLAUSE_FAILED'
  | 'CAPABILITY_MISSING'
  | 'INTERNAL_LANE_AMBIGUOUS'
  | 'TERMINAL_LANE_NO_CONNECTED_APPROACH'
  | 'SOURCE_BINDING_INVALID';

export interface EligibilityReasonGroup {
  code: EligibilityReasonCode;
  count: number;
  message: string;
  repair?: string;
}

/** Simulation-free current-map compatibility report. */
export interface EligibilityReport {
  kind: 'variation-eligibility';
  version: 1;
  mapId: string;
  sourceRevision: string;
  computedInMs: number;
  actorCount: number;
  actors: Array<{ id: string; label: string; type: string; required: boolean }>;
  referenceActorId: string | null;
  requirements: VariationRequirement[];
  locations: { exact: number; degraded: number; rejected: number; compatible: number };
  reasons: EligibilityReasonGroup[];
  axisCombinations: number;
  drawsPerLocation: number;
  candidateBudget: number;
  potentialCandidates: number;
  formula: string;
  structuralOnly: true;
  patternId?: string;
  resumeToken?: string;
  candidates: VariationCandidate[];
  issues: VariationIssue[];
}

export interface VariationFunnelCounts {
  enumerated: number;
  materialized: number;
  simulated: number;
  gated: number;
  deduplicated: number;
  ranked: number;
  verified: number;
  failed: number;
}

export interface VariationProgress {
  jobId: string;
  sourceRevision: string;
  counts: VariationFunnelCounts;
  candidate?: VariationCandidateResult;
}

export interface VariationSearchPayload {
  sourceBehavior: BehaviorSignature;
  sourceSite: MatchedSite;
  patternId: string;
  resumeToken: string;
  candidates: VariationCandidateResult[];
  issues: VariationIssue[];
  reports: Record<string, { matches: number; rejected: number; failureSummary: string; warnings: string[] }>;
}

export interface VariationDecision {
  key: string;
  sourcePatternId: string;
  mapId: string;
  siteId: string;
  decision: VariationReviewState | 'accepted';
  decidedAt: string;
  resumeToken: string;
  reason?: string;
  projectName?: string;
}

export interface AcceptedVariationProject {
  key: string;
  name: string;
  mapId: string;
  siteId: string;
  sourcePatternId: string;
  createdAt: string;
  template: ScenarioTemplateV2;
  instance: VariationCandidateResult['instance'];
  acceptance: VariationAcceptanceReport;
  lineage?: VariationLineageManifest;
}

export interface CarlaConformanceEligibility {
  eligible: boolean;
  code: 'CARLA_ELIGIBLE' | 'CARLA_REVIEW_REQUIRED' | 'CARLA_NATIVE_VERIFICATION_REQUIRED' | 'CARLA_EVIDENCE_STALE';
  message: string;
}
