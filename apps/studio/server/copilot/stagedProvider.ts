import { randomUUID } from 'node:crypto';
import type { CopilotGenerationRequest, CopilotGenerationResult, CopilotIntent, CopilotProgress, CopilotProvenance, CopilotStage } from '../../src/copilot/types.js';
import { compileNativeCandidate, heuristicIntent, normalizeIntent, promptHash } from './nativeCompiler.js';
import { configuredOpenAI, CopilotModelUnavailableError, generateJsonText } from './openaiClient.js';
import { CopilotMapContextSchema } from './directTypes.js';
import { retrieveOwnedExamples } from './retrieval.js';

const INTERPRETER_INSTRUCTIONS = `You are a driving-scenario interpreter. Return JSON only. Never return code.
Convert the request into this exact structure: {"scenario":string,"ego":Actor,"adversaries":Actor[],"contextActors":Actor[],"spatialRelations":string[],"restrictions":string[],"desiredOutcome":string,"assumptions":string[]}.
Actor is {"id":string,"role":"ego"|"adversary"|"context","kind":"vehicle"|"pedestrian"|"prop","catalogId":string,"behavior":string,"initialSpeedKph"?:number}.
Allowed catalogId values: vehicle.sedan, vehicle.pickup, vehicle.van, vehicle.motorcycle, vehicle.bicycle, vehicle.bus, pedestrian.adult_walking, pedestrian.child_walking, pedestrian.adult_standing. Use at most 12 actors.`;

const ACTOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'role', 'kind', 'catalogId', 'behavior', 'initialSpeedKph'],
  properties: {
    id: { type: 'string' },
    role: { type: 'string', enum: ['ego', 'adversary', 'context'] },
    kind: { type: 'string', enum: ['vehicle', 'pedestrian', 'prop'] },
    catalogId: { type: 'string' },
    behavior: { type: 'string' },
    initialSpeedKph: { type: ['number', 'null'] },
  },
} as const;

const INTENT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scenario', 'ego', 'adversaries', 'contextActors', 'spatialRelations', 'restrictions', 'desiredOutcome', 'assumptions'],
  properties: {
    scenario: { type: 'string' },
    ego: ACTOR_SCHEMA,
    adversaries: { type: 'array', maxItems: 11, items: ACTOR_SCHEMA },
    contextActors: { type: 'array', maxItems: 11, items: ACTOR_SCHEMA },
    spatialRelations: { type: 'array', maxItems: 12, items: { type: 'string' } },
    restrictions: { type: 'array', maxItems: 12, items: { type: 'string' } },
    desiredOutcome: { type: 'string' },
    assumptions: { type: 'array', maxItems: 12, items: { type: 'string' } },
  },
} as const;

export async function generateStagedScenario(
  request: CopilotGenerationRequest,
  options: { readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void } = {},
): Promise<CopilotGenerationResult> {
  CopilotMapContextSchema.parse(request.mapContext);
  const started = performance.now();
  const stages: { name: CopilotStage; durationMs: number }[] = [];
  const progress = (stage: CopilotStage, message: string, completed: number, total = 6): void => options.onProgress?.({ stage, message, completed, total });
  const runStage = async <T>(name: CopilotStage, fn: () => Promise<T> | T): Promise<T> => {
    const before = performance.now();
    try { return await fn(); } finally { stages.push({ name, durationMs: Math.round(performance.now() - before) }); }
  };
  progress('interpreting', 'Separating ego, adversaries, relationships, and restrictions…', 0);
  const examples = await runStage('retrieving', () => retrieveOwnedExamples(request.prompt));
  const config = configuredOpenAI();
  const warnings: string[] = [];
  let model = 'deterministic-clean-room-fallback';
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let repairAttempts = 0;
  let intent: CopilotIntent;
  if (request.confirmedIntent) {
    intent = await runStage('interpreting', () => normalizeIntent(request.confirmedIntent!));
  } else if (request.evaluationMode === 'deterministic') {
    intent = await runStage('interpreting', () => heuristicIntent(request.prompt));
  } else {
    if (!config.apiKey) throw new Error('OPENAI_API_KEY is not configured; live staged generation will not silently use a deterministic fallback.');
    const requested = request.model?.trim() || config.requestedModel;
    const context = compactContext(request, examples);
    try {
      const generated = await runStage('interpreting', () => generateJsonText({ apiKey: config.apiKey, model: requested, instructions: INTERPRETER_INSTRUCTIONS, prompt: context, signal: options.signal, responseSchema: { name: 'uniscenarios_copilot_intent', schema: INTENT_JSON_SCHEMA } }));
      model = generated.model;
      usage = addUsage(usage, generated.usage);
      intent = parseIntent(generated.text);
    } catch (error) {
      if (error instanceof CopilotModelUnavailableError && config.fallbackModel && config.fallbackModel !== requested) {
        warnings.push(`Requested model "${requested}" was unavailable; the run used the configured fallback "${config.fallbackModel}".`);
        const generated = await runStage('interpreting', () => generateJsonText({ apiKey: config.apiKey, model: config.fallbackModel!, instructions: INTERPRETER_INSTRUCTIONS, prompt: context, signal: options.signal, responseSchema: { name: 'uniscenarios_copilot_intent', schema: INTENT_JSON_SCHEMA } }));
        model = generated.model;
        usage = addUsage(usage, generated.usage);
        intent = parseIntent(generated.text);
      } else {
        throw new Error(`The staged language-model interpreter failed; no deterministic result was substituted (${safeError(error)}).`);
      }
    }
  }
  progress('generating', 'Generating components in dependency order…', 2);
  // The clean-room pipeline keeps the paper's component boundary explicit even
  // when deterministic fallback is used: spatial relation → ego → adversaries → restrictions.
  intent = await runStage('generating', async () => normalizeIntent({
    ...intent,
    spatialRelations: await componentStrings('spatial relations', intent.spatialRelations),
    ego: { ...intent.ego },
    adversaries: intent.adversaries.map((actor) => ({ ...actor })),
    restrictions: await componentStrings('restrictions', intent.restrictions),
  }));
  progress('binding', `Binding ${1 + intent.adversaries.length + intent.contextActors.length} actors to ${request.mapContext.mapName}…`, 4);
  const maxCandidates = Math.max(1, Math.min(3, request.maxCandidates ?? 2));
  const provenanceBase = {
    provider: 'staged-rag' as const,
    model,
    generatedAt: new Date().toISOString(),
    mapId: request.mapContext.mapId,
    mapHash: request.mapContext.xodrSha256,
    promptHash: promptHash(request.prompt),
    retrievedExampleIds: examples.map((example) => example.id),
    repairAttempts,
    implementation: 'clean-room-chat2scenic-inspired' as const,
  };
  const candidates = await runStage('binding', () => Array.from({ length: maxCandidates }, (_, ordinal) => {
    const provenance: CopilotProvenance = { ...provenanceBase, stages: [...stages] };
    return compileNativeCandidate(request, intent, provenance, ordinal);
  }));
  progress('complete', `${candidates.length} native candidate${candidates.length === 1 ? '' : 's'} ready for canonical validation.`, 6);
  const latencyMs = Math.round(performance.now() - started);
  return {
    runId: randomUUID(), provider: 'staged-rag', model, intent, candidates,
    metrics: {
      latencyMs,
      inputTokens: usage.totalTokens ? usage.inputTokens : null,
      outputTokens: usage.totalTokens ? usage.outputTokens : null,
      totalTokens: usage.totalTokens || null,
      estimatedCostUsd: null,
      candidatesRequested: maxCandidates,
      candidatesReturned: candidates.length,
    },
    diagnostics: [
      { severity: 'info', code: 'research_faithful_clean_room', message: 'Structured interpretation, owned-example retrieval, component generation, current-map binding, and provenance completed without copying Chat2Scenic code, prompts, or data.' },
      { severity: 'info', code: 'typed_native_output', message: 'Output is a native ScenarioDoc; generated executable Scenic/Python is prohibited.' },
    ],
    warnings,
  };
}

async function componentStrings(_name: string, values: readonly string[]): Promise<string[]> {
  return values.map((value) => value.trim()).filter(Boolean).slice(0, 12);
}

function compactContext(request: CopilotGenerationRequest, examples: ReturnType<typeof retrieveOwnedExamples>): string {
  const map = request.mapContext;
  return JSON.stringify({
    userRequest: request.prompt,
    currentMap: { id: map.mapId, name: map.mapName, lanes: map.laneCount, junctionLanes: map.junctionLaneCount, safePlacementSlots: map.placementSlots.length },
    retrievedUniScenariosExamples: examples.map(({ id, fact }) => ({ id, fact })),
    constraints: ['Current map is locked.', 'Do not invent coordinates, lane ids, APIs, or executable code.', 'Component order is spatial relations, ego, adversaries, restrictions.'],
  });
}

function parseIntent(text: string): CopilotIntent {
  const raw = JSON.parse(text) as Partial<CopilotIntent>;
  if (!raw || typeof raw.scenario !== 'string' || !raw.ego || !Array.isArray(raw.adversaries) || !Array.isArray(raw.contextActors)
    || !Array.isArray(raw.spatialRelations) || !Array.isArray(raw.restrictions) || typeof raw.desiredOutcome !== 'string' || !Array.isArray(raw.assumptions)) {
    throw new Error('Interpreter JSON did not satisfy the typed intent boundary.');
  }
  const cleanActor = (actor: CopilotIntent['ego']): CopilotIntent['ego'] => {
    const { initialSpeedKph, ...rest } = actor;
    return typeof initialSpeedKph === 'number' ? { ...rest, initialSpeedKph } : rest;
  };
  return {
    ...(raw as CopilotIntent),
    ego: cleanActor(raw.ego as CopilotIntent['ego']),
    adversaries: raw.adversaries.map((actor) => cleanActor(actor as CopilotIntent['ego'])),
    contextActors: raw.contextActors.map((actor) => cleanActor(actor as CopilotIntent['ego'])),
  };
}

function addUsage(a: typeof usageShape, b: typeof usageShape): typeof usageShape {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, totalTokens: a.totalTokens + b.totalTokens };
}
const usageShape = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 240);
}
