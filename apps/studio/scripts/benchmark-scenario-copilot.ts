import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadMap } from '@uniscenarios/cli';
import { materializeMapBound } from '@uniscenarios/scenario-materializer';
import { TemplateDocument, type ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { buildFollowRoute, runSimulation, toSceneXZ, type LaneGraph } from '@uniscenarios/sim-engine';
import { COPILOT_EDGE_CASES, evaluateCopilotSemantics, type CopilotBenchmarkCase, type SemanticAssertion } from '../server/copilot/benchmarkCases.js';
import { generateDirectDraft } from '../server/copilot/directProvider.js';
import { generateStagedScenario } from '../server/copilot/stagedProvider.js';
import { generateSimulationAgent } from '../server/copilot/simulationAgentProvider.js';
import { generateSimulationAgentVision } from '../server/copilot/simulationAgentVisionProvider.js';
import { generateRelativeGoalOptimizer } from '../server/copilot/relativeGoalOptimizerProvider.js';
import { generateVerifiedTemplateSearch } from '../server/copilot/verifiedTemplateSearchProvider.js';
import { renderBirdEye } from '../server/copilot/birdsEyeRenderer.js';
import type { CopilotCandidate, CopilotGenerationRequest, CopilotGenerationResult, CopilotMapContext, CopilotPlacementSlot } from '../src/copilot/types.js';

type ProviderName = 'staged-rag' | 'direct-llm' | 'upstream-chat2scenic' | 'simulation-agent' | 'simulation-agent-vision' | 'relative-goal-optimizer' | 'verified-template-search';
type ProviderFn = (request: CopilotGenerationRequest, options?: { signal?: AbortSignal }) => Promise<CopilotGenerationResult>;

interface BenchmarkRow {
  readonly provider: ProviderName;
  readonly caseId: string;
  readonly caseSummary: string;
  readonly mapId: string;
  readonly requestedModel: string;
  readonly actualModel: string | null;
  readonly modelFallback: boolean;
  readonly reasoningEffort: 'low' | 'medium' | 'high' | null;
  readonly seed: number | null;
  readonly providerWarnings: readonly string[];
  readonly outcome: 'success' | 'semantic-mismatch' | 'expected-rejection' | 'unexpected-generation' | 'failure';
  readonly failureCategory: string | null;
  readonly safeError: string | null;
  readonly generationLatencyMs: number | null;
  readonly totalLatencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly apiCalls: number | null;
  readonly repairCount: number | null;
  readonly scenicCompileMs: number | null;
  readonly scenicCompilePass: boolean | null;
  readonly scenicSampleMs: number | null;
  readonly scenicSamplePass: boolean | null;
  readonly scenicCompileSampleMs: number | null;
  readonly mapBindingPass: boolean;
  readonly nativeValidationPass: boolean;
  readonly simulationPass: boolean;
  readonly simulationDurationS: number | null;
  readonly simulationWallMs: number | null;
  readonly simulationHash: string | null;
  readonly actorCount: number | null;
  readonly actionCount: number | null;
  readonly semanticPass: boolean;
  readonly semanticAssertions: readonly SemanticAssertion[];
  readonly editablePass: boolean;
  readonly convergenceIterations: number | null;
  readonly relativeActionCount: number | null;
  readonly relativeTriggerFireCount: number | null;
  readonly relativeTimingPass: boolean | null;
  readonly stopReason: string | null;
  readonly imagesSent: number | null;
  readonly totalImageBytes: number | null;
  readonly imageCostUsd: number | null;
  readonly savedResult: SavedBenchmarkResult | null;
}

interface SavedBenchmarkResult {
  readonly format: 'uniscenarios-copilot-saved-result-v1';
  readonly hash: string;
  readonly status: 'draft-only' | 'simulated' | 'failed-before-draft';
  readonly mapId: string;
  readonly mapHash: string | null;
  readonly scenarioSchemaVersion: number | null;
  readonly intent: CopilotGenerationResult['intent'] | null;
  readonly candidate: CopilotCandidate | null;
  readonly canonicalTraceSummary: {
    readonly traceHash: string; readonly tickCount: number; readonly durationS: number; readonly actorIds: readonly string[];
    readonly eventCounts: Record<string, number>;
    readonly events: readonly { readonly t: number; readonly kind: string; readonly actorId?: string; readonly interactionId?: string }[];
  } | null;
  /** Gzipped canonical SimTrace JSON; the SHA-256 above is over the uncompressed JSON. */
  readonly canonicalTraceGzipBase64: string | null;
  readonly birdEye: { readonly dataUrl: string; readonly sha256: string; readonly width: number; readonly height: number; readonly altText: string; readonly legend: readonly string[] } | null;
  readonly failure: { readonly phase: string; readonly category: string; readonly message: string } | null;
  readonly generatedScenic: null;
}

const MAX_SAVED_RESULT_BYTES = 750_000;

class BenchmarkPhaseError extends Error {
  constructor(readonly phase: string, message: string) { super(message); }
}

const argv = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]!;
  if (key === '--') continue;
  if (!key.startsWith('--')) throw new Error(`Unexpected benchmark argument: ${key}`);
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Benchmark argument ${key} requires a value`);
  argv.set(key, value);
  index++;
}
const requestedModel = argv.get('--model') || 'gpt-5.6-luna';
const reasoningEffort = parseEffort(argv.get('--effort') || 'high');
const mapIds = (argv.get('--maps') || 'richmond-field-station').split(',').filter(Boolean);
const providerNames = (argv.get('--providers') || 'staged-rag,direct-llm,upstream-chat2scenic').split(',').filter(Boolean) as ProviderName[];
const selectedCaseIds = new Set((argv.get('--cases') || COPILOT_EDGE_CASES.map((item) => item.id).join(',')).split(',').filter(Boolean));
const benchmarkCases = COPILOT_EDGE_CASES.filter((item) => selectedCaseIds.has(item.id));
if (benchmarkCases.length !== selectedCaseIds.size) throw new Error('One or more --cases ids are unknown');
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputDirectory = path.resolve(repositoryRoot, argv.get('--out') || `artifacts/research/scenario-copilot-benchmark-${new Date().toISOString().replace(/[:.]/gu, '')}`);
const seedResultsPath = argv.get('--seed-results') ? path.resolve(repositoryRoot, argv.get('--seed-results')!) : null;
const resume = argv.get('--resume') === 'true';
const artifactKind = argv.get('--artifact-kind') || 'benchmark';
const rerunOf = argv.get('--rerun-of') || null;
const evaluationMode = argv.get('--evaluation-mode') === 'deterministic' ? 'deterministic' as const : undefined;
const abortAfterMs = Number(argv.get('--timeout-ms') || 360_000);

if (!process.env['OPENAI_API_KEY']) throw new Error('OPENAI_API_KEY must be injected by the server-side credential boundary');
if (!Number.isFinite(abortAfterMs) || abortAfterMs < 1_000) throw new Error('--timeout-ms must be at least 1000');

await mkdir(outputDirectory, { recursive: true });
const partialPath = path.join(outputDirectory, 'results.partial.json');
const resumePath = resume ? await firstReadable([path.join(outputDirectory, 'results.json'), partialPath]) : null;
const providers = await loadProviders(providerNames);
const seedPath = seedResultsPath ?? resumePath;
const seed = seedPath ? JSON.parse(await readFile(seedPath, 'utf8')) as { startedAt?: string; requestedApiModel?: string; reasoningEffort?: string | null; mapIds?: string[]; rows?: BenchmarkRow[] } : null;
if (seed?.requestedApiModel && seed.requestedApiModel !== requestedModel) throw new Error('Seed results used a different API model');
if (seed?.mapIds && seed.mapIds.join(',') !== mapIds.join(',')) throw new Error('Seed results used different maps');
if (seed && (seed.reasoningEffort ?? null) !== reasoningEffort) throw new Error('Seed results used a different reasoning effort');
const rows: BenchmarkRow[] = [...(seed?.rows ?? [])];
const startedAt = seed?.startedAt ?? new Date().toISOString();
const completedKeys = new Set(rows.map(rowKey));
for (const mapId of mapIds) {
  const bundle = await loadMap(mapId);
  const mapContext = buildMapContext(mapId, bundle.graph);
  for (const providerName of providerNames) {
    const provider = providers.get(providerName);
    if (!provider) throw new Error(`Provider ${providerName} was not loaded`);
    for (const benchmarkCase of benchmarkCases) {
      const key = rowKey({ provider: providerName, mapId, caseId: benchmarkCase.id });
      if (completedKeys.has(key)) { process.stdout.write(`[${providerName}] ${mapId}/${benchmarkCase.id} ... resumed\n`); continue; }
      process.stdout.write(`[${providerName}] ${mapId}/${benchmarkCase.id} ... `);
      const row = await runCase(providerName, provider, benchmarkCase, mapContext, bundle, requestedModel, reasoningEffort, abortAfterMs);
      rows.push(row);
      completedKeys.add(key);
      await writeAtomicJson(partialPath, buildMetadata(rows, null));
      process.stdout.write(`${row.outcome}${row.safeError ? ` (${row.failureCategory})` : ''}\n`);
    }
  }
}

const metadata = buildMetadata(rows, new Date().toISOString());
await writeFile(path.join(outputDirectory, 'results.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
await writeFile(path.join(outputDirectory, 'results.csv'), toCsv(rows), 'utf8');
await writeFile(path.join(outputDirectory, 'evaluation.md'), renderReport(rows, metadata), 'utf8');
console.log(`Benchmark evidence: ${outputDirectory}`);

async function loadProviders(names: readonly ProviderName[]): Promise<Map<ProviderName, ProviderFn>> {
  const out = new Map<ProviderName, ProviderFn>([
    ['staged-rag', generateStagedScenario],
    ['direct-llm', generateDirectDraft],
    ['simulation-agent', generateSimulationAgent],
    ['simulation-agent-vision', generateSimulationAgentVision],
    ['relative-goal-optimizer', generateRelativeGoalOptimizer],
    ['verified-template-search', generateVerifiedTemplateSearch],
  ]);
  if (names.includes('upstream-chat2scenic')) {
    // Kept dynamic so the harness remains independently testable while the
    // pinned research adapter is installed or removed.
    const modulePath = '../server/copilot/upstreamProvider.js';
    const upstream = await import(modulePath) as { generateUpstreamChat2Scenic?: ProviderFn };
    if (typeof upstream.generateUpstreamChat2Scenic !== 'function') throw new Error('Pinned upstream Chat2Scenic provider is not installed');
    out.set('upstream-chat2scenic', upstream.generateUpstreamChat2Scenic);
  }
  return out;
}

function buildMapContext(mapId: string, graph: LaneGraph): CopilotMapContext {
  const slots: CopilotPlacementSlot[] = [];
  const acceptedPoints: { x: number; z: number }[] = [];
  for (const rsl of graph.laneRsls()) {
    const geometry = graph.geometry(rsl);
    // Keep the 15 m spawn inside the first route leg. If it spills onto a
    // successor, laneRef and the lanePath's first leg describe different
    // lanes and the benchmark would be measuring its own fixture bug.
    if (!geometry || geometry.lane.laneType !== 'driving' || geometry.lengthM < 45) continue;
    const built = buildFollowRoute(graph, rsl, [], 700);
    if (!built.ok || built.route.lengthM < 260) continue;
    const sample = built.route.poseAt(15);
    const scene = toSceneXZ(sample.point);
    if (acceptedPoints.some((point) => Math.hypot(point.x - scene.x, point.z - scene.z) < 25)) continue;
    acceptedPoints.push(scene);
    const [roadId, section, laneId] = sample.rsl!.split(':');
    const safeSpeed = Math.max(8, Math.min(45, ((built.route.lengthM - 30) / 21) * 3.6));
    slots.push({
      id: `trusted-${slots.length + 1}`,
      actorKinds: ['vehicle', 'pedestrian'],
      catalogIds: [
        'vehicle.sedan', 'vehicle.pickup', 'vehicle.van', 'vehicle.motorcycle', 'vehicle.bicycle',
        'vehicle.bus', 'pedestrian.adult_walking', 'pedestrian.child_walking', 'pedestrian.adult_standing',
      ],
      pose: { x: scene.x, y: 0, z: scene.z, headingRad: sample.headingRad },
      laneRef: { roadId: roadId!, section: Number(section), laneId: Number(laneId), s: sample.storageS, t: 0, headingOffsetRad: 0 },
      routeLaneRsls: built.route.legs.map((leg) => leg.rsl),
      availableDownstreamM: built.route.lengthM - 15,
      recommendedSpeedKph: safeSpeed,
      labels: [geometry.lane.isJunction ? 'junction' : 'corridor', `road-${roadId}`],
    });
    if (slots.length >= 24) break;
  }
  if (slots.length < 12) throw new Error(`${mapId} exposes only ${slots.length} well-separated benchmark placement slots`);
  const points = slots.map((slot) => slot.pose);
  return {
    mapId,
    mapName: graph.mapName || mapId,
    xodrSha256: graph.topologyDigest || null,
    laneCount: graph.laneRsls().length,
    junctionLaneCount: graph.laneRsls().filter((rsl) => graph.geometry(rsl)?.lane.isJunction).length,
    bounds: {
      minX: Math.min(...points.map((point) => point.x)), minZ: Math.min(...points.map((point) => point.z)),
      maxX: Math.max(...points.map((point) => point.x)), maxZ: Math.max(...points.map((point) => point.z)),
    },
    placementSlots: slots,
  };
}

async function runCase(
  providerName: ProviderName,
  provider: ProviderFn,
  benchmarkCase: CopilotBenchmarkCase,
  mapContext: CopilotMapContext,
  bundle: Awaited<ReturnType<typeof loadMap>>,
  model: string,
  effort: 'low' | 'medium' | 'high' | null,
  timeoutMs: number,
): Promise<BenchmarkRow> {
  const wallStart = performance.now();
  const base = (): Omit<BenchmarkRow, 'outcome' | 'failureCategory' | 'safeError'> => ({
    provider: providerName, caseId: benchmarkCase.id, caseSummary: benchmarkCase.summary, mapId: mapContext.mapId,
    requestedModel: model, actualModel: null, modelFallback: false, reasoningEffort: effort, seed: providerName === 'upstream-chat2scenic' ? 20260803 : null, providerWarnings: [], generationLatencyMs: null, totalLatencyMs: Math.round(performance.now() - wallStart),
    inputTokens: null, outputTokens: null, totalTokens: null, apiCalls: null, repairCount: null,
    scenicCompileMs: null, scenicCompilePass: null, scenicSampleMs: null, scenicSamplePass: null, scenicCompileSampleMs: null,
    mapBindingPass: false, nativeValidationPass: false, simulationPass: false, simulationDurationS: null,
    simulationWallMs: null, simulationHash: null, actorCount: null, actionCount: null,
    semanticPass: false, semanticAssertions: [], editablePass: false,
    convergenceIterations: null, relativeActionCount: null, relativeTriggerFireCount: null, relativeTimingPass: null,
    stopReason: null, imagesSent: null, totalImageBytes: null, imageCostUsd: null, savedResult: null,
  });
  let observed = base();
  let generatedForEvidence: CopilotGenerationResult | null = null;
  let candidateForEvidence: CopilotCandidate | null = null;
  let phase = 'provider-generation';
  try {
    const request = {
      providerId: providerName,
      prompt: benchmarkCase.prompt,
      mapContext,
      maxCandidates: 1,
      model,
      ...(evaluationMode ? { evaluationMode } : {}),
      ...((providerName === 'simulation-agent' || providerName === 'simulation-agent-vision') ? { maxAgentIterations: 4 } : {}),
      ...(providerName === 'relative-goal-optimizer' ? { maxOptimizerEvaluations: 24 } : {}),
      ...(effort ? { agentReasoningEffort: effort } : {}),
    } as unknown as CopilotGenerationRequest;
    const signal = AbortSignal.timeout(timeoutMs);
    const generated = await provider(request, { signal });
    generatedForEvidence = generated;
    const candidate = generated.candidates[0];
    candidateForEvidence = candidate ?? null;
    const repairCount = candidate?.provenance.repairAttempts ?? (generated.agentDetails ? Math.max(0, generated.agentDetails.iterations.length - 1) : 0);
    const research = readResearchDetails(candidate);
    const common = {
      ...base(),
      actualModel: generated.model,
      modelFallback: generated.model !== model,
      providerWarnings: generated.warnings.map((warning) => safeError(warning)),
      generationLatencyMs: generated.metrics.latencyMs,
      inputTokens: generated.metrics.inputTokens,
      outputTokens: generated.metrics.outputTokens,
      totalTokens: generated.metrics.totalTokens,
      apiCalls: research.apiCalls ?? generated.agentDetails?.iterations.length ?? generated.optimizerDetails?.llmCalls ?? (providerName === 'staged-rag' ? 1 : generated.model.includes('deterministic') ? 0 : 1 + repairCount),
      repairCount,
      convergenceIterations: generated.agentDetails?.iterations.length ?? generated.optimizerDetails?.evaluations.length ?? null,
      stopReason: generated.agentDetails?.stopReason ?? generated.optimizerDetails?.stopReason ?? null,
      imagesSent: generated.agentDetails?.visualGrounding?.imagesSent ?? null,
      totalImageBytes: generated.agentDetails?.visualGrounding?.totalImageBytes ?? null,
      imageCostUsd: null,
      scenicCompileMs: research.scenicCompileMs,
      scenicCompilePass: research.scenicCompilePass,
      scenicSampleMs: research.scenicSampleMs,
      scenicSamplePass: research.scenicSamplePass,
      scenicCompileSampleMs: research.scenicCompileSampleMs,
    };
    observed = common;
    if (!candidate) {
      const message = generated.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; ').slice(0, 500) || 'Provider returned no candidate';
      const category = benchmarkCase.expectedRejection ? 'expected-rejection' : 'no-candidate';
      const savedResult = createSavedResult(generated, null, mapContext, null, { phase, category, message });
      if (benchmarkCase.expectedRejection) return { ...common, savedResult, outcome: 'expected-rejection', failureCategory: category, safeError: message, totalLatencyMs: Math.round(performance.now() - wallStart) };
      return { ...common, savedResult, outcome: 'failure', failureCategory: category, safeError: message, totalLatencyMs: Math.round(performance.now() - wallStart) };
    }
    phase = 'schema-editability';
    const editable = TemplateDocument.fromJSON(candidate.scenarioDoc);
    const originalDescription = editable.data.meta.description;
    const changed = editable.setMeta({ description: `${originalDescription} [benchmark edit probe]`.slice(0, 2_000) });
    const undid = editable.undo();
    const editablePass = changed && undid && editable.data.meta.description === originalDescription;
    phase = 'map-binding';
    const product = materializeMapBound(candidate.scenarioDoc, bundle, { drawIndex: -1 });
    const mapBindingPass = product.input.actors.length === candidate.scenarioDoc.roles.length;
    const nativeValidationPass = product.manifest.feasible;
    observed = { ...common, mapBindingPass, nativeValidationPass, editablePass, actorCount: candidate.scenarioDoc.roles.length, actionCount: candidate.scenarioDoc.choreography.interactions.length };
    if (!nativeValidationPass) throw new BenchmarkPhaseError('native-validation', `Materializer rejected candidate: ${JSON.stringify(product.manifest.issues.slice(0, 3))}`);
    phase = 'simulation';
    const simulationStart = performance.now();
    const simulated = runSimulation(product.input, { graph: bundle.graph, guards: 'collect' });
    const simulationWallMs = Math.round(performance.now() - simulationStart);
    const simulationDurationS = simulated.trace.ticks.t.at(-1) ?? 0;
    const simulationPass = simulationDurationS >= 19.9;
    const relativeIds = candidate.scenarioDoc.choreography.interactions.filter((item) => item.trigger.kind === 'when').map((item) => item.id);
    const firedIds = new Set(simulated.trace.events.filter((event) => event.kind === 'trigger_fired').map((event) => event.interactionId));
    const relativeTriggerFireCount = relativeIds.filter((id) => firedIds.has(id)).length;
    const relativeTimingPass = relativeIds.length ? relativeTriggerFireCount === relativeIds.length : null;
    observed = { ...observed, simulationPass, simulationDurationS, simulationWallMs, relativeActionCount: relativeIds.length, relativeTriggerFireCount, relativeTimingPass };
    if (!simulationPass) throw new BenchmarkPhaseError('simulation-incomplete', `Canonical simulation ended at ${simulationDurationS.toFixed(3)} seconds`);
    const semanticAssertions = evaluateCopilotSemantics(benchmarkCase.id, candidate.scenarioDoc);
    const semanticPass = semanticAssertions.every((assertion) => assertion.pass);
    const completed = {
      ...common,
      totalLatencyMs: Math.round(performance.now() - wallStart),
      mapBindingPass,
      nativeValidationPass,
      simulationPass,
      simulationDurationS,
      simulationWallMs,
      simulationHash: traceDigest(simulated.trace),
      actorCount: candidate.scenarioDoc.roles.length,
      actionCount: candidate.scenarioDoc.choreography.interactions.length,
      semanticPass,
      semanticAssertions,
      editablePass,
      convergenceIterations: generated.agentDetails?.iterations.length ?? null,
      relativeActionCount: relativeIds.length,
      relativeTriggerFireCount,
      relativeTimingPass,
      savedResult: createSavedResult(generated, candidate, mapContext, simulated.trace, null),
    };
    if (benchmarkCase.expectedRejection) return { ...completed, outcome: 'unexpected-generation', failureCategory: 'unsupported-request-not-rejected', safeError: 'Provider materialized and simulated an unsupported request' };
    if (!editablePass) return { ...completed, outcome: 'failure', failureCategory: 'apply-editability', safeError: 'Generated document did not pass edit/undo probe' };
    if (!semanticPass) return { ...completed, outcome: 'semantic-mismatch', failureCategory: 'semantic-constraints', safeError: failedAssertions(semanticAssertions) };
    return { ...completed, outcome: 'success', failureCategory: null, safeError: null };
  } catch (error) {
    const failureCategory = error instanceof BenchmarkPhaseError ? error.phase : categorizeError(error, phase);
    const savedResult = createSavedResult(generatedForEvidence, candidateForEvidence, mapContext, null, { phase, category: failureCategory, message: safeError(error) });
    if (benchmarkCase.expectedRejection && phase === 'provider-generation') {
      return { ...observed, savedResult, outcome: 'expected-rejection', failureCategory, safeError: safeError(error), totalLatencyMs: Math.round(performance.now() - wallStart) };
    }
    return { ...observed, savedResult, outcome: 'failure', failureCategory, safeError: safeError(error), totalLatencyMs: Math.round(performance.now() - wallStart) };
  }
}

function readResearchDetails(candidate: CopilotGenerationResult['candidates'][number] | undefined): {
  apiCalls: number | null; scenicCompileMs: number | null; scenicCompilePass: boolean | null; scenicSampleMs: number | null; scenicSamplePass: boolean | null; scenicCompileSampleMs: number | null;
} {
  const looseCandidate = candidate as unknown as { researchDetails?: Record<string, unknown>; provenance?: { researchDetails?: Record<string, unknown> } } | undefined;
  const raw = looseCandidate?.researchDetails ?? looseCandidate?.provenance?.researchDetails ?? {};
  const compile = raw['scenicCompile'] as Record<string, unknown> | undefined;
  const sample = raw['scenicSample'] as Record<string, unknown> | undefined;
  const sharedDuration = numberOrNull(raw['scenicCompileSampleMs']);
  return {
    apiCalls: numberOrNull(raw['apiCalls']),
    scenicCompileMs: numberOrNull(compile?.['durationMs']) ?? numberOrNull(raw['scenicCompileMs']),
    scenicCompilePass: booleanOrNull(compile?.['pass']) ?? booleanOrNull(raw['scenicCompiled']),
    scenicSampleMs: numberOrNull(sample?.['durationMs']) ?? numberOrNull(raw['scenicSampleMs']),
    scenicSamplePass: booleanOrNull(sample?.['pass']) ?? booleanOrNull(raw['scenicSampled']),
    scenicCompileSampleMs: sharedDuration,
  };
}

function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function booleanOrNull(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function failedAssertions(assertions: readonly SemanticAssertion[]): string { return assertions.filter((item) => !item.pass).map((item) => `${item.id}: ${item.evidence}`).join('; ').slice(0, 500); }
function traceDigest(trace: unknown): string { return createHash('sha256').update(JSON.stringify(trace)).digest('hex'); }
function createSavedResult(
  generated: CopilotGenerationResult | null,
  candidate: CopilotCandidate | null,
  mapContext: CopilotMapContext,
  trace: { ticks: { t: readonly number[]; actors: Record<string, unknown> }; events: readonly Record<string, unknown>[] } | null,
  failure: SavedBenchmarkResult['failure'],
): SavedBenchmarkResult {
  const eventCounts: Record<string, number> = {};
  for (const event of trace?.events ?? []) {
    const kind = typeof event['kind'] === 'string' ? event['kind'] : 'unknown';
    eventCounts[kind] = (eventCounts[kind] ?? 0) + 1;
  }
  const safeCandidate: CopilotCandidate | null = candidate ? {
    ...candidate,
    diagnostics: candidate.diagnostics.filter((item) => item.code !== 'openai_request'),
    provenance: { ...candidate.provenance, agentDetails: candidate.provenance.agentDetails ? {
      ...candidate.provenance.agentDetails,
      iterations: candidate.provenance.agentDetails.iterations.map(({ requestId: _requestId, ...iteration }) => iteration),
    } : undefined },
  } : null;
  const traceJson = trace ? JSON.stringify(trace) : null;
  const traceHash = traceJson ? createHash('sha256').update(traceJson).digest('hex') : null;
  let birdEye: SavedBenchmarkResult['birdEye'] = null;
  if (candidate) {
    try {
      const rendered = renderBirdEye({ mapId: mapContext.mapId, scenarioDoc: candidate.scenarioDoc, trace: trace as Parameters<typeof renderBirdEye>[0]['trace'], iteration: 1, width: 640, height: 640 });
      birdEye = { dataUrl: rendered.dataUrl, sha256: rendered.sha256, width: rendered.width, height: rendered.height, altText: rendered.altText, legend: rendered.legend };
    } catch { /* A render failure must not discard the executable draft. */ }
  }
  const withoutHash = {
    format: 'uniscenarios-copilot-saved-result-v1' as const,
    status: trace ? 'simulated' as const : candidate ? 'draft-only' as const : 'failed-before-draft' as const,
    mapId: mapContext.mapId,
    mapHash: mapContext.xodrSha256,
    scenarioSchemaVersion: candidate ? candidate.scenarioDoc.scenarioVersion : null,
    intent: generated?.intent ?? candidate?.intent ?? null,
    candidate: safeCandidate,
    canonicalTraceSummary: trace && traceHash ? {
      traceHash,
      tickCount: trace.ticks.t.length,
      durationS: trace.ticks.t.at(-1) ?? 0,
      actorIds: Object.keys(trace.ticks.actors).sort(),
      eventCounts,
      events: trace.events.slice(0, 256).flatMap((event) => {
        if (typeof event['kind'] !== 'string' || typeof event['t'] !== 'number') return [];
        return [{ t: event['t'], kind: event['kind'], ...(typeof event['actorId'] === 'string' ? { actorId: event['actorId'] } : {}), ...(typeof event['interactionId'] === 'string' ? { interactionId: event['interactionId'] } : {}) }];
      }),
    } : null,
    canonicalTraceGzipBase64: traceJson ? gzipSync(Buffer.from(traceJson)).toString('base64') : null,
    birdEye,
    failure,
    // Upstream Scenic source is not currently returned across the provider
    // boundary. Never reconstruct it or label a derived program as original.
    generatedScenic: null,
  };
  const hash = createHash('sha256').update(JSON.stringify(withoutHash)).digest('hex');
  const saved: SavedBenchmarkResult = { ...withoutHash, hash };
  if (Buffer.byteLength(JSON.stringify(saved), 'utf8') > MAX_SAVED_RESULT_BYTES) {
    return { ...saved, canonicalTraceGzipBase64: null, birdEye: null, hash: createHash('sha256').update(JSON.stringify({ ...withoutHash, canonicalTraceGzipBase64: null, birdEye: null })).digest('hex') };
  }
  return saved;
}
function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/sk-[A-Za-z0-9_-]+/gu, '[redacted]')
    .replace(/req_[A-Za-z0-9_-]+/gu, '[request-id]')
    .slice(0, 500);
}
function categorizeError(error: unknown, phase: string): string {
  const message = safeError(error).toLowerCase();
  if (message.includes('model') && (message.includes('not available') || message.includes('404'))) return 'model-unavailable';
  if (message.includes('api key') || message.includes('401') || message.includes('credential')) return 'credential';
  if (message.includes('timeout') || message.includes('aborted')) return 'timeout';
  if (message.includes('json') || message.includes('schema') || message.includes('parse')) return 'provider-output-schema';
  return phase;
}

function toCsv(rows: readonly BenchmarkRow[]): string {
  const columns: (keyof BenchmarkRow)[] = [
    'provider', 'caseId', 'caseSummary', 'mapId', 'requestedModel', 'actualModel', 'modelFallback', 'reasoningEffort', 'seed', 'outcome', 'failureCategory',
    'generationLatencyMs', 'totalLatencyMs', 'inputTokens', 'outputTokens', 'totalTokens', 'apiCalls', 'repairCount',
    'scenicCompileMs', 'scenicCompilePass', 'scenicSampleMs', 'scenicSamplePass', 'scenicCompileSampleMs', 'mapBindingPass', 'nativeValidationPass',
    'simulationPass', 'simulationDurationS', 'simulationWallMs', 'simulationHash', 'actorCount', 'actionCount',
    'semanticPass', 'editablePass', 'safeError',
    'convergenceIterations', 'relativeActionCount', 'relativeTriggerFireCount', 'relativeTimingPass',
    'stopReason', 'imagesSent', 'totalImageBytes', 'imageCostUsd',
  ];
  const quote = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `${columns.map(quote).join(',')}\n${rows.map((row) => columns.map((column) => quote(row[column])).join(',')).join('\n')}\n`;
}

function renderReport(rows: readonly BenchmarkRow[], metadata: { startedAt: string; completedAt: string | null; requestedApiModel: string; reasoningEffort: string | null; mapIds: readonly string[] }): string {
  const providers = [...new Set(rows.map((row) => row.provider))];
  const lines = [
    '# Scenario Copilot edge-case evaluation', '',
    `- Run: ${metadata.startedAt} to ${metadata.completedAt}`,
    `- Model requested uniformly: \`${metadata.requestedApiModel}\``,
    `- Reasoning effort: \`${metadata.reasoningEffort ?? 'provider default (omitted)'}\``,
    `- Maps: ${metadata.mapIds.join(', ')}`,
    '- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.',
    '', '| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const provider of providers) {
    const selected = rows.filter((row) => row.provider === provider);
    const tokens = selected.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0);
    const apiCalls = selected.reduce((sum, row) => sum + (row.apiCalls ?? 0), 0);
    const relativeTotal = selected.reduce((sum, row) => sum + (row.relativeActionCount ?? 0), 0);
    const relativeFired = selected.reduce((sum, row) => sum + (row.relativeTriggerFireCount ?? 0), 0);
    lines.push(`| ${provider} | ${selected.filter((row) => row.outcome === 'success').length}/${selected.length} | ${selected.filter((row) => row.simulationPass).length}/${selected.length} | ${selected.filter((row) => row.outcome === 'semantic-mismatch' || row.outcome === 'unexpected-generation').length} | ${selected.filter((row) => row.outcome === 'failure').length} | ${selected.filter((row) => row.outcome === 'expected-rejection').length} | ${relativeFired}/${relativeTotal} | ${median(selected.map((row) => row.convergenceIterations))} | ${median(selected.map((row) => row.generationLatencyMs))} | ${median(selected.map((row) => row.totalLatencyMs))} | ${median(selected.map((row) => row.simulationWallMs))} | ${median(selected.map((row) => row.scenicCompileSampleMs))} | ${apiCalls || '—'} | ${tokens || '—'} |`);
  }
  lines.push('', '## Case outcomes', '', '| Case | ' + providers.join(' | ') + ' |', '|---|' + providers.map(() => '---').join('|') + '|');
  for (const benchmarkCase of COPILOT_EDGE_CASES.filter((item) => rows.some((row) => row.caseId === item.id))) {
    lines.push(`| ${benchmarkCase.summary} | ${providers.map((provider) => rows.find((row) => row.provider === provider && row.caseId === benchmarkCase.id)?.outcome ?? 'not run').join(' | ')} |`);
  }
  const failures = rows.filter((row) => row.outcome !== 'success').slice(0, 12);
  lines.push('', '## Representative failures', '');
  for (const row of failures) lines.push(`- **${row.provider} / ${row.caseSummary}:** ${row.failureCategory ?? row.outcome} — ${row.safeError ?? 'no safe diagnostic'}`);
  lines.push('', 'Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.', '');
  return `${lines.join('\n')}\n`;
}

function parseEffort(value: string): 'low' | 'medium' | 'high' | null {
  if (value === 'default' || value === 'omitted') return null;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new Error('--effort must be default, low, medium, or high');
}

function rowKey(row: Pick<BenchmarkRow, 'provider' | 'mapId' | 'caseId'>): string { return `${row.provider}:${row.mapId}:${row.caseId}`; }
async function firstReadable(paths: readonly string[]): Promise<string | null> {
  for (const candidate of paths) { try { await readFile(candidate, 'utf8'); return candidate; } catch { /* continue */ } }
  return null;
}
async function writeAtomicJson(target: string, value: unknown): Promise<void> {
  const temp = `${target}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const { rename } = await import('node:fs/promises'); await rename(temp, target);
}
function buildMetadata(rowsValue: readonly BenchmarkRow[], completedAt: string | null) {
  return {
    schemaVersion: 3, artifactKind, rerunOf, startedAt, completedAt,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
    requestedDisplayName: requestedModel, requestedApiModel: requestedModel, reasoningEffort, evaluationMode: evaluationMode ?? 'live',
    exactDifferencesFromOriginal: artifactKind === 'inspection-rerun' ? [
      'This is a newly generated inspection rerun, not recovery of the original model outputs.',
      'The original prompt corpus, Richmond map, provider adapters, gpt-5.6-luna request, and omitted reasoning-effort setting are retained.',
      'Calls may run concurrently across providers; recorded per-run latency is retained but is not used for historical method-performance conclusions.',
      'Saved native drafts, compressed canonical traces, and deterministic bird-eye thumbnails were added for no-model-call inspection.',
      `The implementation commit is ${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()}; the original benchmark predated this rerun.`,
    ] : [],
    providerNames: [...new Set(rowsValue.map((row) => row.provider))], mapIds,
    cases: benchmarkCases.map(({ id, summary, expectedRejection }) => ({ id, summary, expectedRejection: Boolean(expectedRejection) })),
    rows: rowsValue,
  };
}

function median(values: readonly (number | null)[]): number | '—' {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return '—';
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle]! : Math.round((finite[middle - 1]! + finite[middle]!) / 2);
}
