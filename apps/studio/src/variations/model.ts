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
  decision: 'accepted' | 'rejected';
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
}
