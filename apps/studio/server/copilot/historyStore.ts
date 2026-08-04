import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CopilotCandidate, CopilotGenerationRequest, CopilotGenerationResult } from '../../src/copilot/types.js';
import type { CopilotExperimentRecord, CopilotGenerationHistoryEntry, CopilotGenerationHistoryResponse } from '../../src/copilot/historyTypes.js';
import { COPILOT_EDGE_CASES } from './benchmarkCases.js';

interface BenchmarkArtifact {
  startedAt?: string;
  completedAt?: string;
  rows?: BenchmarkRow[];
  artifactId?: string;
}

interface BenchmarkRow {
  provider?: string; caseId?: string; caseSummary?: string; mapId?: string;
  requestedModel?: string; actualModel?: string; generationLatencyMs?: number;
  reasoningEffort?: string;
  totalTokens?: number; apiCalls?: number; repairCount?: number; actorCount?: number;
  actionCount?: number; semanticPass?: boolean; semanticAssertions?: Array<{ id: string; pass: boolean; evidence: string }>;
  mapBindingPass?: boolean; nativeValidationPass?: boolean; simulationPass?: boolean; simulationDurationS?: number;
  scenicCompilePass?: boolean; scenicSamplePass?: boolean; outcome?: string; failureCategory?: string; safeError?: string;
  providerWarnings?: string[];
  savedResult?: {
    hash?: string; mapId?: string; mapHash?: string | null; scenarioSchemaVersion?: number;
    intent?: unknown; candidate?: CopilotCandidate | null; canonicalTraceSummary?: CopilotGenerationHistoryEntry['canonicalTraceSummary'];
    generatedScenic?: string | null;
    birdEye?: { dataUrl?: string; sha256?: string; width?: number; height?: number; altText?: string; legend?: string[] } | null;
  };
}

const MAX_LIVE_RUNS = 60;

export class CopilotHistoryStore {
  private readonly benchmarks = loadBenchmarks();
  private readonly experiments = loadExperiments();
  private live: CopilotGenerationHistoryEntry[] = [];

  list(): CopilotGenerationHistoryResponse {
    return {
      benchmarkStartedAt: boundaryDate(this.benchmarks.map((item) => item.startedAt), 'first'),
      benchmarkCompletedAt: boundaryDate(this.benchmarks.map((item) => item.completedAt), 'last'),
      entries: [...this.benchmarks.flatMap(benchmarkEntries), ...this.live],
      experiments: this.experiments,
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

function loadBenchmarks(): BenchmarkArtifact[] {
  const root = fileURLToPath(new URL('../../../../research/evaluations/', import.meta.url));
  return discover(root, 'results.json').flatMap((file) => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as BenchmarkArtifact;
      if (!Array.isArray(parsed.rows)) return [];
      return [{ ...parsed, artifactId: path.relative(root, file), rows: parsed.rows }];
    } catch { return []; }
  });
}

function loadExperiments(): CopilotExperimentRecord[] {
  const root = fileURLToPath(new URL('../../../../research/evaluations/', import.meta.url));
  const seen = new Set<string>();
  return discover(root, 'manifest.json').flatMap((file) => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { experiments?: unknown[] };
      return (raw.experiments ?? []).flatMap((item) => {
        if (!isExperiment(item) || seen.has(item.id)) return [];
        seen.add(item.id); return [item];
      });
    } catch { return []; }
  });
}

function discover(root: string, name: string, depth = 4): string[] {
  if (depth < 0) return [];
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
      ? discover(path.join(root, entry.name), name, depth - 1)
      : entry.isFile() && entry.name === name ? [path.join(root, entry.name)] : []);
  } catch { return []; }
}

function benchmarkEntries(artifact: BenchmarkArtifact): CopilotGenerationHistoryEntry[] {
  const cases = new Map(COPILOT_EDGE_CASES.map((item) => [item.id, item]));
  return (artifact.rows ?? []).flatMap((row, index) => {
    const benchmarkCase = cases.get(row.caseId ?? '');
    if (!benchmarkCase || !isProvider(row.provider)) return [];
    return [{
      id: `benchmark:${artifact.artifactId}:${row.caseId}:${row.provider}:${index}`, source: 'benchmark' as const,
      caseId: row.caseId ?? null, caseTitle: row.caseSummary ?? benchmarkCase.summary, prompt: benchmarkCase.prompt,
      expectedRejection: Boolean(benchmarkCase.expectedRejection), provider: row.provider,
      requestedModel: row.requestedModel ?? null, actualModel: row.actualModel ?? null, mapId: row.savedResult?.mapId ?? row.mapId ?? 'not recorded',
      reasoningEffort: parseEffort(row.reasoningEffort), artifactId: artifact.artifactId ?? null,
      mapHash: row.savedResult?.mapHash ?? null, scenarioSchemaVersion: numberOrNull(row.savedResult?.scenarioSchemaVersion),
      savedDraftStatus: row.savedResult?.candidate ? 'original' as const : 'not-recorded' as const, savedResultHash: row.savedResult?.hash ?? null, seed: null,
      generatedAt: artifact.startedAt ?? null, intent: isIntent(row.savedResult?.intent) ? row.savedResult.intent : null, candidate: row.savedResult?.candidate ?? null,
      actorCount: numberOrNull(row.actorCount), actionCount: numberOrNull(row.actionCount), triggerSummary: null,
      semanticPass: boolOrNull(row.semanticPass), semanticAssertions: row.semanticAssertions ?? null,
      mapBindingPass: boolOrNull(row.mapBindingPass), materializationPass: boolOrNull(row.nativeValidationPass),
      simulationPass: boolOrNull(row.simulationPass), simulationDurationS: numberOrNull(row.simulationDurationS),
      canonicalTraceSummary: row.savedResult?.canonicalTraceSummary ?? null,
      scenicCompilePass: boolOrNull(row.scenicCompilePass), scenicSamplePass: boolOrNull(row.scenicSamplePass),
      latencyMs: numberOrNull(row.generationLatencyMs), totalTokens: numberOrNull(row.totalTokens), apiCalls: numberOrNull(row.apiCalls), repairCount: numberOrNull(row.repairCount),
      outcome: row.outcome ?? null, failureCategory: row.failureCategory ?? null,
      diagnostic: row.safeError ?? row.providerWarnings?.join('; ') ?? null,
      provenance: { artifact: artifact.artifactId ?? 'unknown-results.json', benchmarkStartedAt: artifact.startedAt ?? null, savedResultHash: row.savedResult?.hash ?? null },
      generatedScenic: row.savedResult?.generatedScenic ?? null, directTypedDraft: row.savedResult?.candidate ? { intent: row.savedResult.intent ?? null, scenarioDoc: row.savedResult.candidate.scenarioDoc } : null,
      iterationTrace: row.savedResult?.birdEye?.dataUrl ? sanitizeIterationTrace([{
        iteration: 1, summary: 'Saved deterministic bird-eye evidence from the original benchmark result.', toolCalls: [],
        thumbnailDataUrl: row.savedResult.birdEye.dataUrl, altText: row.savedResult.birdEye.altText,
        legend: row.savedResult.birdEye.legend, provenance: { sha256: row.savedResult.birdEye.sha256, width: row.savedResult.birdEye.width, height: row.savedResult.birdEye.height },
      }]) : null,
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
    provider: result.provider, requestedModel: request.model ?? null, actualModel: result.model, mapId: request.mapContext.mapId,
    reasoningEffort: request.agentReasoningEffort ?? 'default-or-unrecorded', artifactId: null,
    mapHash: candidate?.provenance.mapHash ?? request.mapContext.xodrSha256, scenarioSchemaVersion: candidate?.scenarioDoc.schemaVersion ?? null,
    savedDraftStatus: candidate ? 'original' : 'not-recorded', savedResultHash: candidate ? candidate.provenance.promptHash : null, seed: null,
    generatedAt: candidate?.provenance.generatedAt ?? new Date().toISOString(), intent: candidate?.intent ?? result.intent, candidate: safeCandidate,
    actorCount: candidate?.scenarioDoc.roles.length ?? null, actionCount: interactions.length,
    triggerSummary: interactions.map((interaction) => `${interaction.verb} · ${interaction.trigger.kind}`),
    semanticPass: null, semanticAssertions: null, mapBindingPass: candidate ? true : false, materializationPass: candidate ? true : false,
    simulationPass: null, simulationDurationS: null, canonicalTraceSummary: null,
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
    || value === 'simulation-agent' || value === 'simulation-agent-vision' || value === 'relative-goal-optimizer' || value === 'verified-template-search';
}
function isIntent(value: unknown): value is NonNullable<CopilotGenerationHistoryEntry['intent']> {
  return Boolean(value && typeof value === 'object' && typeof (value as { scenario?: unknown }).scenario === 'string');
}
function boolOrNull(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function parseEffort(value: unknown): CopilotGenerationHistoryEntry['reasoningEffort'] { return value === 'low' || value === 'medium' || value === 'high' ? value : 'default-or-unrecorded'; }
function boundaryDate(values: readonly (string | undefined)[], which: 'first' | 'last'): string | null { const dates = values.filter((item): item is string => Boolean(item)).sort(); return (which === 'first' ? dates[0] : dates.at(-1)) ?? null; }
function isExperiment(value: unknown): value is CopilotExperimentRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item['id'] === 'string' && typeof item['title'] === 'string' && typeof item['hypothesis'] === 'string'
    && typeof item['independentVariable'] === 'string' && Array.isArray(item['controls']) && typeof item['sampleCount'] === 'number'
    && ['planned', 'running', 'complete', 'unavailable'].includes(String(item['status'])) && Array.isArray(item['models'])
    && Array.isArray(item['providers']) && Array.isArray(item['artifacts']);
}
