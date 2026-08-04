import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CopilotCandidate, CopilotGenerationRequest, CopilotGenerationResult } from '../../src/copilot/types.js';
import type { CopilotGenerationHistoryEntry, CopilotGenerationHistoryResponse } from '../../src/copilot/historyTypes.js';
import { COPILOT_EDGE_CASES } from './benchmarkCases.js';

interface BenchmarkArtifact {
  startedAt?: string;
  completedAt?: string;
  rows?: BenchmarkRow[];
}

interface BenchmarkRow {
  provider?: string; caseId?: string; caseSummary?: string; mapId?: string;
  requestedModel?: string; actualModel?: string; generationLatencyMs?: number;
  totalTokens?: number; apiCalls?: number; repairCount?: number; actorCount?: number;
  actionCount?: number; semanticPass?: boolean; semanticAssertions?: Array<{ id: string; pass: boolean; evidence: string }>;
  mapBindingPass?: boolean; nativeValidationPass?: boolean; simulationPass?: boolean; simulationDurationS?: number;
  scenicCompilePass?: boolean; scenicSamplePass?: boolean; outcome?: string; failureCategory?: string; safeError?: string;
  providerWarnings?: string[];
}

const MAX_LIVE_RUNS = 60;

export class CopilotHistoryStore {
  private readonly benchmark = loadBenchmark();
  private live: CopilotGenerationHistoryEntry[] = [];

  list(): CopilotGenerationHistoryResponse {
    return {
      benchmarkStartedAt: this.benchmark.startedAt ?? null,
      benchmarkCompletedAt: this.benchmark.completedAt ?? null,
      entries: [...benchmarkEntries(this.benchmark), ...this.live],
    };
  }

  record(request: CopilotGenerationRequest, result: CopilotGenerationResult): void {
    const entries = result.candidates.length ? result.candidates.map((candidate) => liveEntry(request, result, candidate)) : [liveEntry(request, result, null)];
    this.live = [...entries, ...this.live].slice(0, MAX_LIVE_RUNS);
  }

  updateValidation(runId: string, candidateId: string, validation: { valid: boolean; message: string; actorCount: number; durationS: number }): boolean {
    let found = false;
    this.live = this.live.map((entry) => {
      if (entry.id !== `live:${runId}:${candidateId}`) return entry;
      found = true;
      return { ...entry, materializationPass: validation.valid, simulationPass: validation.valid, simulationDurationS: validation.durationS, diagnostic: validation.message };
    });
    return found;
  }

  clearLive(): void { this.live = []; }
}

function loadBenchmark(): BenchmarkArtifact {
  try {
    const path = fileURLToPath(new URL('../../../../research/evaluations/chat2scenic-20260803/results.json', import.meta.url));
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BenchmarkArtifact;
    return { ...parsed, rows: Array.isArray(parsed.rows) ? parsed.rows : [] };
  } catch {
    return { rows: [] };
  }
}

function benchmarkEntries(artifact: BenchmarkArtifact): CopilotGenerationHistoryEntry[] {
  const cases = new Map(COPILOT_EDGE_CASES.map((item) => [item.id, item]));
  return (artifact.rows ?? []).flatMap((row, index) => {
    const benchmarkCase = cases.get(row.caseId ?? '');
    if (!benchmarkCase || !isProvider(row.provider)) return [];
    return [{
      id: `benchmark:${row.caseId}:${row.provider}:${index}`, source: 'benchmark' as const,
      caseId: row.caseId ?? null, caseTitle: row.caseSummary ?? benchmarkCase.summary, prompt: benchmarkCase.prompt,
      expectedRejection: Boolean(benchmarkCase.expectedRejection), provider: row.provider,
      requestedModel: row.requestedModel ?? null, actualModel: row.actualModel ?? null, mapId: row.mapId ?? 'not recorded', seed: null,
      generatedAt: artifact.startedAt ?? null, intent: null, candidate: null,
      actorCount: numberOrNull(row.actorCount), actionCount: numberOrNull(row.actionCount), triggerSummary: null,
      semanticPass: boolOrNull(row.semanticPass), semanticAssertions: row.semanticAssertions ?? null,
      mapBindingPass: boolOrNull(row.mapBindingPass), materializationPass: boolOrNull(row.nativeValidationPass),
      simulationPass: boolOrNull(row.simulationPass), simulationDurationS: numberOrNull(row.simulationDurationS),
      scenicCompilePass: boolOrNull(row.scenicCompilePass), scenicSamplePass: boolOrNull(row.scenicSamplePass),
      latencyMs: numberOrNull(row.generationLatencyMs), totalTokens: numberOrNull(row.totalTokens), apiCalls: numberOrNull(row.apiCalls), repairCount: numberOrNull(row.repairCount),
      outcome: row.outcome ?? null, failureCategory: row.failureCategory ?? null,
      diagnostic: row.safeError ?? row.providerWarnings?.join('; ') ?? null,
      provenance: { artifact: 'chat2scenic-20260803/results.json', benchmarkStartedAt: artifact.startedAt ?? null },
      generatedScenic: null, directTypedDraft: null,
      iterationTrace: null,
    }];
  });
}

function liveEntry(request: CopilotGenerationRequest, result: CopilotGenerationResult, candidate: CopilotCandidate | null): CopilotGenerationHistoryEntry {
  const interactions = candidate?.scenarioDoc.choreography.interactions ?? [];
  // Provider request IDs are useful during the immediate response but are not
  // persisted in session history. Stored drafts contain only editor data and
  // public provenance needed to reproduce the run.
  const safeCandidate = candidate ? { ...candidate, diagnostics: candidate.diagnostics.filter((item) => item.code !== 'openai_request') } : null;
  return {
    id: `live:${result.runId}:${candidate?.id ?? 'none'}`, source: 'live', caseId: null,
    caseTitle: candidate?.title ?? 'Live generation', prompt: request.prompt, expectedRejection: false,
    provider: result.provider, requestedModel: request.model ?? null, actualModel: result.model, mapId: request.mapContext.mapId, seed: null,
    generatedAt: candidate?.provenance.generatedAt ?? new Date().toISOString(), intent: candidate?.intent ?? result.intent, candidate: safeCandidate,
    actorCount: candidate?.scenarioDoc.roles.length ?? null, actionCount: interactions.length,
    triggerSummary: interactions.map((interaction) => `${interaction.verb} · ${interaction.trigger.kind}`),
    semanticPass: null, semanticAssertions: null, mapBindingPass: candidate ? true : false, materializationPass: candidate ? true : false,
    simulationPass: null, simulationDurationS: null,
    scenicCompilePass: candidate?.provenance.researchDetails?.scenicCompiled ?? null,
    scenicSamplePass: candidate?.provenance.researchDetails?.scenicSampled ?? null,
    latencyMs: result.metrics.latencyMs, totalTokens: result.metrics.totalTokens,
    apiCalls: candidate?.provenance.researchDetails?.apiCalls ?? candidate?.provenance.optimizerDetails?.llmCalls ?? 1, repairCount: candidate?.provenance.repairAttempts ?? null,
    outcome: candidate ? 'generated' : 'failure', failureCategory: candidate ? null : 'generation',
    diagnostic: [...result.diagnostics, ...(candidate?.diagnostics ?? [])].map((item) => item.message).join('; ') || null,
    provenance: candidate ? { ...candidate.provenance } : { provider: result.provider, model: result.model },
    generatedScenic: null,
    directTypedDraft: candidate ? { intent: candidate.intent, scenarioDoc: candidate.scenarioDoc } : null,
    iterationTrace: sanitizeIterationTrace(
      (candidate?.provenance as unknown as Record<string, unknown> | undefined)?.['iterationTrace']
      ?? result.iterationTrace
      ?? traceFromAgentDetails(candidate?.provenance.agentDetails ?? result.agentDetails),
    ),
  };
}

function traceFromAgentDetails(details: CopilotCandidate['provenance']['agentDetails'] | undefined): unknown[] | null {
  if (!details) return null;
  return details.iterations.map((iteration) => ({
    iteration: iteration.iteration,
    summary: `Draft changes: ${iteration.draftDiff.join('; ') || 'none'}. ${iteration.semanticChecks.filter((check) => !check.pass).map((check) => `${check.id}: ${check.evidence}`).join('; ') || 'All recorded semantic checks passed.'}`,
    toolCalls: iteration.toolCalls.map((call) => ({ name: call.name, status: call.ok ? 'success' : 'failure', summary: call.outputSummary })),
    thumbnailDataUrl: null,
    provenance: { draftHash: iteration.draftHash, durationMs: iteration.durationMs, totalTokens: iteration.totalTokens, simulation: iteration.simulation ?? null },
  }));
}

function sanitizeIterationTrace(value: unknown): CopilotGenerationHistoryEntry['iterationTrace'] {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 12).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const calls = Array.isArray(item['toolCalls']) ? item['toolCalls'].slice(0, 20).flatMap((rawCall) => {
      if (!rawCall || typeof rawCall !== 'object') return [];
      const call = rawCall as Record<string, unknown>;
      const status = call['status'];
      if (typeof call['name'] !== 'string' || (status !== 'success' && status !== 'failure' && status !== 'skipped')) return [];
      return [{ name: call['name'].slice(0, 100), status, summary: typeof call['summary'] === 'string' ? call['summary'].slice(0, 500) : '' }];
    }) : [];
    const thumbnail = typeof item['thumbnailDataUrl'] === 'string' && item['thumbnailDataUrl'].startsWith('data:image/') && item['thumbnailDataUrl'].length < 350_000 ? item['thumbnailDataUrl'] : null;
    const legend = Array.isArray(item['legend']) ? item['legend'].filter((entry): entry is string => typeof entry === 'string').slice(0, 16).map((entry) => entry.slice(0, 200)) : undefined;
    const provenance = item['provenance'] && typeof item['provenance'] === 'object' ? item['provenance'] as Record<string, unknown> : undefined;
    return [{ iteration: typeof item['iteration'] === 'number' ? item['iteration'] : index + 1, summary: typeof item['summary'] === 'string' ? item['summary'].slice(0, 1_000) : 'No summary recorded.', toolCalls: calls, thumbnailDataUrl: thumbnail, ...(typeof item['altText'] === 'string' ? { altText: item['altText'].slice(0, 2_000) } : {}), ...(legend ? { legend } : {}), ...(provenance ? { provenance } : {}) }];
  });
}

function isProvider(value: unknown): value is CopilotGenerationHistoryEntry['provider'] {
  return value === 'staged-rag' || value === 'direct-llm' || value === 'upstream-chat2scenic'
    || value === 'simulation-agent' || value === 'simulation-agent-vision' || value === 'relative-goal-optimizer';
}
function boolOrNull(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
