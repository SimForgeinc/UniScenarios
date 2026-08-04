import type { CopilotCandidate, CopilotIntent, CopilotProviderId } from './types';

export interface CopilotAssertionRecord {
  readonly id: string;
  readonly pass: boolean;
  readonly evidence: string;
}

export interface CopilotGenerationHistoryEntry {
  readonly id: string;
  readonly source: 'benchmark' | 'live';
  readonly caseId: string | null;
  readonly caseTitle: string;
  readonly prompt: string;
  readonly expectedRejection: boolean;
  readonly provider: CopilotProviderId;
  readonly requestedModel: string | null;
  readonly actualModel: string | null;
  readonly mapId: string;
  readonly seed: number | null;
  readonly generatedAt: string | null;
  readonly intent: CopilotIntent | null;
  readonly candidate: CopilotCandidate | null;
  readonly actorCount: number | null;
  readonly actionCount: number | null;
  readonly triggerSummary: readonly string[] | null;
  readonly semanticPass: boolean | null;
  readonly semanticAssertions: readonly CopilotAssertionRecord[] | null;
  readonly mapBindingPass: boolean | null;
  readonly materializationPass: boolean | null;
  readonly simulationPass: boolean | null;
  readonly simulationDurationS: number | null;
  readonly scenicCompilePass: boolean | null;
  readonly scenicSamplePass: boolean | null;
  readonly latencyMs: number | null;
  readonly totalTokens: number | null;
  readonly apiCalls: number | null;
  readonly repairCount: number | null;
  readonly outcome: string | null;
  readonly failureCategory: string | null;
  readonly diagnostic: string | null;
  readonly provenance: Record<string, unknown> | null;
  readonly generatedScenic: string | null;
  readonly directTypedDraft: Record<string, unknown> | null;
  readonly iterationTrace: readonly {
    readonly iteration: number;
    readonly summary: string;
    readonly toolCalls: readonly { readonly name: string; readonly status: 'success' | 'failure' | 'skipped'; readonly summary: string }[];
    readonly thumbnailDataUrl: string | null;
  }[] | null;
}

export interface CopilotGenerationHistoryResponse {
  readonly benchmarkStartedAt: string | null;
  readonly benchmarkCompletedAt: string | null;
  readonly entries: readonly CopilotGenerationHistoryEntry[];
}
