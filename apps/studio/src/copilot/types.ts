import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

export type CopilotProviderId = 'staged-rag' | 'direct-llm';

export type CopilotActorKind = 'vehicle' | 'pedestrian' | 'prop';

export interface CopilotPlacementSlot {
  readonly id: string;
  readonly actorKinds: readonly CopilotActorKind[];
  readonly catalogIds?: readonly string[];
  readonly pose: { readonly x: number; readonly y: number; readonly z: number; readonly headingRad: number };
  readonly laneRef?: { readonly roadId: string; readonly section: number; readonly laneId: number; readonly s: number; readonly t: number; readonly headingOffsetRad: number };
  readonly routeLaneRsls?: readonly string[];
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
  readonly implementation: 'clean-room-chat2scenic-inspired' | 'direct-native';
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
}

export interface CopilotProvider {
  readonly id: CopilotProviderId;
  generate(
    request: CopilotGenerationRequest,
    options?: { readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void },
  ): Promise<CopilotGenerationResult>;
}
