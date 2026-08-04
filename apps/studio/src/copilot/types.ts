import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

export type CopilotProviderId = 'staged-rag' | 'direct-llm' | 'upstream-chat2scenic' | 'simulation-agent' | 'simulation-agent-vision' | 'verified-template-search' | 'relative-goal-optimizer';

export type CopilotActorKind = 'vehicle' | 'pedestrian' | 'prop';

/** Hard contract bound for route runway values crossing the browser/server boundary. */
export const COPILOT_MAX_RUNWAY_M = 1_000_000;

export interface CopilotPlacementSlot {
  readonly id: string;
  readonly actorKinds: readonly CopilotActorKind[];
  readonly catalogIds?: readonly string[];
  readonly pose: { readonly x: number; readonly y: number; readonly z: number; readonly headingRad: number };
  readonly laneRef?: { readonly roadId: string; readonly section: number; readonly laneId: number; readonly s: number; readonly t: number; readonly headingOffsetRad: number };
  readonly routeLaneRsls?: readonly string[];
  /** Exact route runway from this spawn, used to bound generated speed. */
  readonly availableDownstreamM?: number;
  readonly recommendedSpeedKph?: number;
  readonly labels: readonly string[];
}

export interface CopilotMapContext {
  readonly mapId: string;
  readonly mapName: string;
  readonly xodrSha256: string | null;
  readonly laneCount: number;
  readonly junctionLaneCount: number;
  readonly bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number };
  readonly placementSlots: readonly CopilotPlacementSlot[];
}

export interface CopilotIntentActor {
  readonly id: string;
  readonly role: 'ego' | 'adversary' | 'context';
  readonly kind: CopilotActorKind;
  readonly catalogId: string;
  readonly behavior: string;
  readonly initialSpeedKph?: number;
}

export interface CopilotIntent {
  readonly scenario: string;
  readonly ego: CopilotIntentActor;
  readonly adversaries: readonly CopilotIntentActor[];
  readonly contextActors: readonly CopilotIntentActor[];
  readonly spatialRelations: readonly string[];
  readonly restrictions: readonly string[];
  readonly desiredOutcome: string;
  readonly assumptions: readonly string[];
}

export type CopilotStage = 'interpreting' | 'retrieving' | 'generating' | 'binding' | 'repairing' | 'complete';

export interface CopilotProgress {
  readonly stage: CopilotStage;
  readonly message: string;
  readonly completed: number;
  readonly total: number;
}

export interface CopilotDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
}

export interface CopilotProvenance {
  readonly provider: CopilotProviderId;
  readonly model: string;
  readonly generatedAt: string;
  readonly mapId: string;
  readonly mapHash: string | null;
  readonly promptHash: string;
  readonly retrievedExampleIds: readonly string[];
  readonly stages: readonly { readonly name: CopilotStage; readonly durationMs: number }[];
  readonly repairAttempts: number;
  readonly implementation: 'clean-room-chat2scenic-inspired' | 'direct-native' | 'upstream-chat2scenic-research-adapter' | 'iterative-simulation-agent' | 'iterative-simulation-agent-vision' | 'verified-template-search' | 'relative-goal-optimizer';
  /** Sanitized agent evidence: tool outcomes and draft deltas, never hidden reasoning or secrets. */
  readonly agentDetails?: {
    readonly reasoningEffort: 'low' | 'medium' | 'high';
    readonly maxIterations: number;
    readonly stopReason: 'verified' | 'iteration-budget-exhausted' | 'unsupported-request';
    readonly visualGrounding?: { readonly imageInputSupported: boolean; readonly renderer: 'uniscenarios-deterministic-birds-eye-v1'; readonly imagesSent: number; readonly totalImageBytes: number; readonly imageSha256: readonly string[] };
    readonly iterations: readonly {
      readonly iteration: number;
      readonly durationMs: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly requestId?: string;
      readonly draftHash: string | null;
      readonly draftDiff: readonly string[];
      readonly toolCalls: readonly {
        readonly name: 'inspect_context' | 'create_or_patch_draft' | 'validate_schema' | 'bind_current_map' | 'simulate_canonical_20s' | 'check_requested_semantics';
        readonly ok: boolean;
        readonly durationMs: number;
        readonly inputSummary: string;
        readonly outputSummary: string;
      }[];
      readonly diagnostics: readonly CopilotDiagnostic[];
      readonly simulation?: {
        readonly durationS: number;
        readonly wallMs: number;
        readonly traceHash: string;
        readonly actorCount: number;
        readonly actionCount: number;
        readonly feedbackMetrics?: {
          readonly eventTimeline: readonly { readonly t: number; readonly kind: string; readonly actorId?: string; readonly interactionId?: string }[];
          readonly actorStarts: readonly { readonly actorId: string; readonly t: number }[];
          readonly closestApproaches: readonly { readonly pair: readonly [string, string]; readonly distanceM: number; readonly t: number }[];
          readonly minTtc: { readonly valueS: number; readonly t: number; readonly pair: readonly [string, string] } | null;
          readonly minPathTtc: { readonly valueS: number; readonly t: number; readonly pair: readonly [string, string] } | null;
          readonly minPet: { readonly valueS: number; readonly t: number; readonly pair: readonly [string, string] } | null;
          readonly collisions: readonly { readonly t: number; readonly a: string; readonly b: string }[];
          readonly routeProgress: readonly { readonly actorId: string; readonly progressM: number; readonly remainingRunwayM: number | null }[];
          readonly maxLaneDeviation: readonly { readonly actorId: string; readonly absoluteM: number }[];
          readonly signalStates: readonly { readonly signalId: string; readonly phases: readonly string[] }[];
          readonly triggerNeverFired: readonly string[];
          readonly occlusion: readonly { readonly observer: string; readonly target: string; readonly status: string; readonly revealToConflictS: number | null }[];
          readonly unavailable: readonly string[];
        };
      };
      readonly semanticChecks: readonly { readonly id: string; readonly pass: boolean; readonly evidence: string }[];
    }[];
  };
  readonly optimizerDetails?: {
    readonly reasoningEffort: 'high';
    readonly llmCalls: 1;
    readonly evaluationBudget: number;
    readonly stopReason: 'verified' | 'evaluation-budget-exhausted' | 'unsupported-request';
    readonly evaluations: readonly {
      readonly index: number;
      readonly draftHash: string;
      readonly parameterChanges: readonly string[];
      readonly score: number;
      readonly schemaPass: boolean;
      readonly mapBindingPass: boolean;
      readonly simulationPass: boolean;
      readonly simulationDurationS: number | null;
      readonly simulationWallMs: number | null;
      readonly semanticChecks: readonly { readonly id: string; readonly pass: boolean; readonly evidence: string }[];
      readonly relativeTriggers: { readonly authored: number; readonly fired: number };
      readonly closestApproach?: { readonly distanceM: number; readonly t: number; readonly pair: readonly [string, string] };
      readonly collisions: number;
      readonly diagnostic: string | null;
    }[];
  };
  readonly iterationTrace?: readonly { readonly iteration: number; readonly summary: string; readonly toolCalls: readonly { readonly name: string; readonly status: 'success' | 'failure' | 'skipped'; readonly summary: string }[]; readonly thumbnailDataUrl: string | null; readonly altText?: string; readonly legend?: readonly string[]; readonly provenance?: Record<string, unknown> }[];
  readonly templateSearchDetails?: { readonly sourceTemplateId: string; readonly sourcePath: string; readonly sourceSha256: string; readonly validationDigest: string; readonly searchBudget: number; readonly candidatesEvaluated: number; readonly selectedParameterIndex: number; readonly traceHash: string; readonly semanticPasses: number; readonly semanticTotal: number; readonly adaptation: string };
  /** Research-only evidence. Never interpreted by the browser as executable code. */
  readonly researchDetails?: {
    readonly upstreamSha: string;
    readonly upstreamLicense: 'CC-BY-NC-4.0';
    readonly apiCalls: number;
    readonly scenicVersion: string | null;
    readonly scenicCompiled: boolean;
    readonly scenicSampled: boolean;
    readonly scenicIterations: number | null;
    readonly scenicCompileSampleMs: number | null;
    readonly scenicCompileMs: number | null;
    readonly scenicSampleMs: number | null;
    readonly generatedComponentCount: number;
    readonly ragMode: 'milvus' | 'prompt-examples-substitute';
    readonly unsupportedSemantics: readonly string[];
    readonly deviations: readonly string[];
  };
}

export interface CopilotCandidate {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly intent: CopilotIntent;
  readonly scenarioDoc: ScenarioTemplateV2;
  readonly diagnostics: readonly CopilotDiagnostic[];
  readonly provenance: CopilotProvenance;
}

export interface CopilotMetrics {
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly estimatedCostUsd: number | null;
  readonly candidatesRequested: number;
  readonly candidatesReturned: number;
}

export interface CopilotGenerationRequest {
  readonly providerId: CopilotProviderId;
  readonly prompt: string;
  readonly mapContext: CopilotMapContext;
  readonly currentScenario?: ScenarioTemplateV2;
  /** User-reviewed structured intent. Staged generation must honor this verbatim after normalization. */
  readonly confirmedIntent?: CopilotIntent;
  readonly maxCandidates?: number;
  readonly model?: string;
  /** Iterative providers only; bounded to 1–4 by the server. */
  readonly maxAgentIterations?: number;
  /** Iterative providers default to high; explicit for controlled comparisons. */
  readonly agentReasoningEffort?: 'low' | 'medium' | 'high';
  /** Deterministic optimizer only; bounded to 1–32 native simulations. */
  readonly maxOptimizerEvaluations?: number;
  /** Test-only deterministic path; production callers never set this. */
  readonly evaluationMode?: 'deterministic';
}

export interface CopilotGenerationResult {
  readonly runId: string;
  readonly provider: CopilotProviderId;
  readonly model: string;
  readonly intent: CopilotIntent;
  readonly candidates: readonly CopilotCandidate[];
  readonly metrics: CopilotMetrics;
  readonly diagnostics: readonly CopilotDiagnostic[];
  readonly warnings: readonly string[];
  /** Present for iterative providers, including failed runs with no candidate. */
  readonly agentDetails?: CopilotProvenance['agentDetails'];
  /** Sanitized public iteration evidence, including visuals for failed runs. */
  readonly iterationTrace?: CopilotProvenance['iterationTrace'];
  readonly optimizerDetails?: CopilotProvenance['optimizerDetails'];
}

export interface CopilotProvider {
  readonly id: CopilotProviderId;
  generate(
    request: CopilotGenerationRequest,
    options?: { readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void },
  ): Promise<CopilotGenerationResult>;
}
