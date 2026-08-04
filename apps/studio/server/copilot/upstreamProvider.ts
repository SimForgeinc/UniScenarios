import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type {
  CopilotCandidate,
  CopilotGenerationRequest,
  CopilotGenerationResult,
  CopilotIntent,
  CopilotProgress,
  CopilotProvenance,
  CopilotStage,
} from '../../src/copilot/types.js';
import { compileDirectDraft, directDraftRepairFeedback } from './directCompiler.js';
import { createOpenAIResponsesClient, resolveDirectModel, type DirectModelResponse, type DirectOpenAIClient } from './directOpenAI.js';
import { DirectNativeDraftSchema, type DirectNativeDraft } from './directTypes.js';

const UPSTREAM_SHA = '54264e4e394ff7bd5a72913abe4e323fa06cd37e';
const REQUESTED_MODEL = 'gpt-5.6-luna';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const UPSTREAM_ROOT = path.join(REPO_ROOT, 'research/third_party/Chat2scenic');
const COMPILE_HELPER = path.join(REPO_ROOT, 'research/chat2scenic_adapter/scenic_compile_sample.py');

interface ResearchTextResponse {
  readonly text: string;
  readonly model: string;
  readonly requestId?: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number };
}

interface UpstreamLogical {
  readonly Scenario: string;
  readonly Ego: string;
  readonly Adversarials: readonly string[];
  readonly 'Spatial Relation': string;
  readonly 'Requirement and restrictions': string;
}

interface ScenicEvidence {
  readonly scenicVersion?: string;
  readonly compiled: boolean;
  readonly sampled: boolean;
  readonly iterations?: number;
  readonly durationMs?: number;
  readonly objects?: readonly { readonly index: number; readonly x: number; readonly y: number; readonly headingRad: number; readonly type: string }[];
  readonly error?: string;
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function promptFile(name: string): string {
  return readFileSync(path.join(UPSTREAM_ROOT, 'core/prompts', `${name}.txt`), 'utf8');
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) output = output.replaceAll(`{${key}}`, value);
  return output;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  const parsed = JSON.parse(cleaned) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Upstream stage did not return a JSON object');
  return parsed as Record<string, unknown>;
}

async function generateResearchText(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly json: boolean;
  readonly signal?: AbortSignal;
}): Promise<ResearchTextResponse> {
  const response = await fetch(`${(process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/$/u, '')}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: input.system }] },
        { role: 'user', content: [{ type: 'input_text', text: input.user }] },
      ],
      max_output_tokens: 6_000,
      ...(input.json ? { text: { format: { type: 'json_object' } } } : {}),
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    readonly id?: string; readonly model?: string; readonly output_text?: string;
    readonly output?: readonly { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }[];
    readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number; readonly total_tokens?: number };
    readonly error?: { readonly message?: string; readonly code?: string };
  };
  if (!response.ok) throw new Error(`OpenAI upstream stage failed (${response.status}): ${body.error?.code ?? 'error'} ${(body.error?.message ?? '').slice(0, 240)}`);
  const text = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!text) throw new Error('OpenAI upstream stage returned no text');
  const inputTokens = body.usage?.input_tokens ?? 0;
  const outputTokens = body.usage?.output_tokens ?? 0;
  return {
    text, model: body.model ?? input.model,
    ...(body.id ? { requestId: body.id } : {}),
    usage: { inputTokens, outputTokens, totalTokens: body.usage?.total_tokens ?? inputTokens + outputTokens },
  };
}

function logicalFrom(text: string): UpstreamLogical {
  const raw = parseJsonObject(text);
  const adversarials = Array.isArray(raw['Adversarials']) ? raw['Adversarials'].filter((item): item is string => typeof item === 'string').slice(0, 6) : [];
  if (typeof raw['Scenario'] !== 'string' || typeof raw['Ego'] !== 'string' || typeof raw['Spatial Relation'] !== 'string'
    || typeof raw['Requirement and restrictions'] !== 'string') throw new Error('Upstream interpreter output is incomplete');
  return {
    Scenario: raw['Scenario'], Ego: raw['Ego'], Adversarials: adversarials,
    'Spatial Relation': raw['Spatial Relation'],
    'Requirement and restrictions': raw['Requirement and restrictions'],
  };
}

function compactSlots(request: CopilotGenerationRequest): string {
  return JSON.stringify(request.mapContext.placementSlots.map((slot) => ({
    id: slot.id,
    actorKinds: slot.actorKinds,
    catalogIds: slot.catalogIds ?? [],
    recommendedSpeedKph: slot.recommendedSpeedKph ?? null,
    labels: slot.labels,
    routeBacked: Boolean(slot.laneRef && slot.routeLaneRsls?.length),
  })));
}

function translatorSystem(): string {
  return `You are the safety boundary between an upstream Scenic research pipeline and UniScenarios.
Return a complete native draft using only supplied placement-slot ids and catalog ids. Do not invent coordinates, ids, models, or actions.
Use 1-12 actors and never reuse a slot. Vehicles require routeBacked slots. Supported actions are speed, changeLane (-1 or 1), and laneOffset (-1..1), entirely within 20 seconds.
Faithfully preserve the upstream logical interpretation and generated component intent when representable. Omit unsupported Scenic behavior and summarize every omission in reasoningSummary. Return only the required JSON.`;
}

function intentFrom(logical: UpstreamLogical, draft: DirectNativeDraft): CopilotIntent {
  const actors = draft.actors.map((actor, index) => ({
    id: actor.id,
    role: index === 0 ? 'ego' as const : 'adversary' as const,
    kind: actor.catalogId.startsWith('pedestrian.') ? 'pedestrian' as const : actor.catalogId.startsWith('vehicle.') ? 'vehicle' as const : 'prop' as const,
    catalogId: actor.catalogId,
    behavior: draft.actions.filter((action) => action.actorId === actor.id).map((action) => action.label || action.kind).join(', ') || (index === 0 ? logical.Ego : logical.Adversarials[index - 1] ?? 'Follow the generated route'),
    initialSpeedKph: actor.initialSpeedKph,
  }));
  return {
    scenario: logical.Scenario,
    ego: actors[0]!,
    adversaries: actors.slice(1),
    contextActors: [],
    spatialRelations: [logical['Spatial Relation']],
    restrictions: [logical['Requirement and restrictions'], 'Current UniScenarios map and trusted placement slots only'],
    desiredOutcome: draft.title,
    assumptions: [draft.reasoningSummary],
  };
}

function mapPath(request: CopilotGenerationRequest): string {
  const assets = process.env['UNISCENARIOS_DEV_ASSETS_ROOT']?.trim() || path.join(REPO_ROOT, 'dev-assets');
  const safeMap = request.mapContext.mapId.replace(/[^a-z0-9_-]/giu, '');
  if (safeMap !== request.mapContext.mapId) throw new Error('Map id is not safe for research file lookup');
  const file = path.join(assets, safeMap, 'map.xodr');
  if (!existsSync(file)) throw new Error(`Research OpenDRIVE file is not available for ${request.mapContext.mapId}`);
  return file;
}

function scenicSource(request: CopilotGenerationRequest, draft: DirectNativeDraft, resolvedMapPath = mapPath(request)): string {
  const slots = new Map(request.mapContext.placementSlots.map((slot) => [slot.id, slot]));
  const lines = [
    `param map = ${JSON.stringify(resolvedMapPath)}`,
    'param use2DMap = True',
    'model scenic.domains.driving.model',
  ];
  draft.actors.forEach((actor, index) => {
    const slot = slots.get(actor.slotId);
    if (!slot) throw new Error(`Unknown trusted slot ${actor.slotId}`);
    const scenicType = actor.catalogId.startsWith('pedestrian.') ? 'Pedestrian' : 'Car';
    const name = index === 0 ? 'ego' : `actor${index + 1}`;
    // Scenic and Three.js use different heading conventions. Let Scenic sample
    // the authoritative OpenDRIVE direction at the trusted slot; native
    // lowering retains the lane-index heading from that same map location.
    // UniScenarios' lane-center slots can lie on OpenDRIVE lanes narrower than
    // Scenic's default CARLA vehicle footprint. Disable only Scenic's footprint
    // containment rejection; the point still queries Scenic's map direction,
    // and native lane binding/simulation remain authoritative.
    lines.push(`${name} = new ${scenicType} at ${slot.pose.x.toFixed(6)}@${slot.pose.z.toFixed(6)}, facing roadDirection, with regionContainedIn None, with allowCollisions True, with requireVisible False`);
  });
  return `${lines.join('\n')}\n`;
}

async function compileAndSample(source: string, seed: number, signal?: AbortSignal): Promise<ScenicEvidence> {
  const python = process.env['UNISCENARIOS_SCENIC_PYTHON']?.trim() || 'python3';
  const command = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') ? '/usr/bin/sandbox-exec' : python;
  const args = command === python ? [COMPILE_HELPER] : ['-p', '(version 1)(allow default)(deny network*)', python, COMPILE_HELPER];
  return await new Promise<ScenicEvidence>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        MPLBACKEND: 'Agg',
        PYTHONNOUSERSITE: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 45_000);
    const abort = (): void => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < 1_000_000) stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 32_000) stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        const parsed = JSON.parse(stdout) as ScenicEvidence;
        if (code !== 0 || !parsed.compiled || !parsed.sampled) reject(new Error(`Scenic compile/sample failed: ${parsed.error ?? stderr.slice(0, 400)}`));
        else resolve(parsed);
      } catch (error) {
        reject(error instanceof SyntaxError ? new Error(`Scenic helper returned invalid output: ${stderr.slice(0, 400)}`) : error);
      }
    });
    child.stdin.end(JSON.stringify({ source, seed }));
  });
}

function addUsage(total: { input: number; output: number; all: number }, response: Pick<ResearchTextResponse, 'usage'> | DirectModelResponse): void {
  total.input += response.usage.inputTokens ?? 0;
  total.output += response.usage.outputTokens ?? 0;
  total.all += response.usage.totalTokens ?? 0;
}

export async function generateUpstreamChat2Scenic(
  request: CopilotGenerationRequest,
  options: {
    readonly client?: DirectOpenAIClient;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: CopilotProgress) => void;
    readonly seed?: number;
    readonly compileSample?: (source: string, seed: number, signal?: AbortSignal) => Promise<ScenicEvidence>;
    readonly mapFile?: string;
  } = {},
): Promise<CopilotGenerationResult> {
  if (request.providerId !== 'upstream-chat2scenic') throw new Error('Upstream provider received the wrong provider id');
  if (!process.env['OPENAI_API_KEY'] && request.evaluationMode !== 'deterministic') throw new Error('OPENAI_API_KEY is not configured on the research server');
  const started = performance.now();
  const stageTimes: { name: CopilotStage; durationMs: number }[] = [];
  const usage = { input: 0, output: 0, all: 0 };
  let apiCalls = 0;
  let repairAttempts = 0;
  const progress = (stage: CopilotStage, message: string, completed: number, total = 8): void => options.onProgress?.({ stage, message, completed, total });
  const timed = async <T>(name: CopilotStage, fn: () => Promise<T>): Promise<T> => {
    const before = performance.now();
    try { return await fn(); } finally { stageTimes.push({ name, durationMs: Math.round(performance.now() - before) }); }
  };
  const api = async (system: string, user: string, json: boolean): Promise<ResearchTextResponse> => {
    apiCalls++;
    const response = await generateResearchText({ apiKey: process.env['OPENAI_API_KEY']!, model, system, user, json, signal: options.signal });
    addUsage(usage, response);
    return response;
  };
  let model = request.model?.trim() || process.env['OPENAI_SCENARIO_MODEL']?.trim() || REQUESTED_MODEL;
  const modelClient = options.client ?? (request.evaluationMode === 'deterministic' ? undefined : createOpenAIResponsesClient());
  if (modelClient) model = (await resolveDirectModel(modelClient, model, options.signal)).actualModel;

  progress('interpreting', 'Running the pinned upstream logical interpreter…', 0);
  const logical = request.evaluationMode === 'deterministic'
    ? logicalFrom(JSON.stringify({ Scenario: request.prompt, Ego: 'A car travels forward', Adversarials: ['A car travels forward'], 'Spatial Relation': 'Vehicles occupy separate lanes on the current map.', 'Requirement and restrictions': 'The scenario terminates after the interaction.' }))
    : await timed('interpreting', async () => logicalFrom((await api('Follow the pinned Chat2Scenic interpreter prompt exactly.', fill(promptFile('interpretor'), { scenic_code: request.prompt }), true)).text));

  progress('retrieving', 'Running upstream settings detection and prompt-embedded retrieval substitute…', 1);
  const settings = request.evaluationMode === 'deterministic' ? { weather: 'ClearNoon', blueprint: 'vehicle.lincoln.mkz_2017' }
    : await timed('retrieving', async () => parseJsonObject((await api('Follow the pinned Chat2Scenic settings detector. The current UniScenarios map is authoritative and cannot be changed.', `${promptFile('settings_detector')}\n\nResearch adapter constraint: suggested_map must be ${request.mapContext.mapId}.\nUser query: ${request.prompt}`, true)).text));

  progress('generating', 'Generating upstream header and components in published dependency order…', 2);
  const mapFile = options.mapFile ?? mapPath(request);
  const generatedComponents: { name: string; code: string }[] = [];
  if (request.evaluationMode !== 'deterministic') {
    const header = await timed('generating', async () => parseJsonObject((await api('Follow the pinned header generator, except use the current OpenDRIVE map and generic driving model overlay described after the prompt.', `${fill(promptFile('header_generator'), {
      user_query: request.prompt,
      carla_map: request.mapContext.mapId,
      map_file_path: mapFile,
      blueprint: typeof settings['blueprint'] === 'string' ? settings['blueprint'] : 'vehicle.lincoln.mkz_2017',
      weather: typeof settings['weather'] === 'string' ? settings['weather'] : 'ClearNoon',
    })}\n\nResearch overlay: replace model scenic.simulators.carla.model with model scenic.domains.driving.model; retain all other upstream header semantics.`, true)).text));
    generatedComponents.push({ name: 'Header', code: typeof header['code'] === 'string' ? header['code'] : '' });
    const order: readonly [string, string, string][] = [
      ['Spatial Relation', 'component_generator_spatial', logical['Spatial Relation']],
      ['Ego', 'component_generator_ego', logical.Ego],
      ...logical.Adversarials.map((criteria, index) => [`Adversarial ${index + 1}`, 'component_generator_adv', criteria] as [string, string, string]),
      ['Requirement and restrictions', 'component_generator_requirement', logical['Requirement and restrictions']],
    ];
    for (const [name, promptName, criteria] of order) {
      const ready = generatedComponents.map((component) => `## ${component.name} ##\n${component.code}`).join('\n');
      const original = fill(promptFile(promptName), {
        component_type: name,
        user_criteria: criteria,
        ready_components: ready || 'No components are ready yet.',
        reference_components: '# Upstream Milvus snapshot is not distributed in the pinned Git repository; prompt-embedded examples are the evaluation substitute.',
      });
      const envelope = await timed('generating', async () => parseJsonObject((await api('Follow the pinned component prompt. For transport only, wrap the raw Scenic code in exactly {"code":"..."}; do not alter the code.', original, true)).text));
      generatedComponents.push({ name, code: typeof envelope['code'] === 'string' ? envelope['code'] : '' });
    }
  } else {
    generatedComponents.push({ name: 'Header', code: 'deterministic evaluation header' }, { name: 'Ego', code: 'deterministic evaluation ego' });
  }

  progress('binding', 'Lowering generated Scenic intent into trusted current-map slots…', 5);
  const count = Math.max(1, Math.min(3, request.maxCandidates ?? 1));
  const candidates: CopilotCandidate[] = [];
  let sharedIntent: CopilotIntent | undefined;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    let draft: DirectNativeDraft;
    if (request.evaluationMode === 'deterministic') {
      const slots = request.mapContext.placementSlots.filter((slot) => slot.catalogIds?.length && (slot.actorKinds.includes('vehicle') ? Boolean(slot.laneRef && slot.routeLaneRsls?.length) : true));
      const first = slots[ordinal % slots.length];
      if (!first) throw new Error('No trusted map slot is available for deterministic upstream evaluation');
      draft = { title: 'Upstream Chat2Scenic research draft', description: request.prompt, reasoningSummary: 'Deterministic upstream adapter fixture.', actors: [{ id: 'ego', label: 'Ego vehicle', catalogId: first.catalogIds![0]!, slotId: first.id, initialSpeedKph: first.recommendedSpeedKph ?? 20 }], actions: [] };
    } else {
      const translator = await modelClient!.generate({
        model,
        system: translatorSystem(),
        user: `USER REQUEST:\n${request.prompt}\n\nUPSTREAM LOGICAL INTERPRETATION:\n${JSON.stringify(logical)}\n\nUPSTREAM GENERATED COMPONENTS:\n${generatedComponents.map((component) => `## ${component.name}\n${component.code}`).join('\n').slice(0, 60_000)}\n\nCURRENT MAP SLOTS:\n${compactSlots(request)}\n\nCandidate ${ordinal + 1} of ${count}.`,
        signal: options.signal,
      });
      apiCalls++;
      addUsage(usage, translator);
      try {
        draft = DirectNativeDraftSchema.parse(JSON.parse(translator.text));
        compileDirectDraft(draft, request.mapContext);
      } catch (error) {
        repairAttempts++;
        progress('repairing', `Repairing native lowering for candidate ${ordinal + 1}…`, 6);
        const repaired = await modelClient!.generate({
          model,
          system: translatorSystem(),
          user: `PREVIOUS DRAFT:\n${translator.text.slice(0, 30_000)}\n\n${directDraftRepairFeedback(error)}\n\nCURRENT MAP SLOTS:\n${compactSlots(request)}`,
          signal: options.signal,
        });
        apiCalls++;
        addUsage(usage, repaired);
        draft = DirectNativeDraftSchema.parse(JSON.parse(repaired.text));
      }
    }
    const source = scenicSource(request, draft, mapFile);
    const evidence = await timed('binding', () => (options.compileSample ?? compileAndSample)(source, (options.seed ?? 20260803) + ordinal, options.signal));
    if ((evidence.objects?.length ?? 0) !== draft.actors.length) throw new Error('Scenic sample actor count does not match the native draft');
    const slotById = new Map(request.mapContext.placementSlots.map((slot) => [slot.id, slot]));
    evidence.objects?.forEach((object, index) => {
      const slot = slotById.get(draft.actors[index]!.slotId)!;
      if (Math.hypot(object.x - slot.pose.x, object.y - slot.pose.z) > 0.05) throw new Error(`Scenic sample ${index} diverged from trusted map slot`);
    });
    const scenarioDoc = compileDirectDraft(draft, request.mapContext);
    const intent = intentFrom(logical, draft);
    sharedIntent ??= intent;
    const unsupported = draft.reasoningSummary.toLowerCase().includes('omit') ? [draft.reasoningSummary] : [];
    const provenance: CopilotProvenance = {
      provider: 'upstream-chat2scenic', model, generatedAt: new Date().toISOString(), mapId: request.mapContext.mapId,
      mapHash: request.mapContext.xodrSha256, promptHash: promptHash(request.prompt),
      retrievedExampleIds: ['upstream-prompt-embedded-examples'], stages: [...stageTimes], repairAttempts,
      implementation: 'upstream-chat2scenic-research-adapter',
      researchDetails: {
        upstreamSha: UPSTREAM_SHA, upstreamLicense: 'CC-BY-NC-4.0', apiCalls,
        scenicVersion: evidence.scenicVersion ?? null, scenicCompiled: evidence.compiled, scenicSampled: evidence.sampled,
        scenicIterations: evidence.iterations ?? null, scenicCompileSampleMs: evidence.durationMs ?? null,
        generatedComponentCount: generatedComponents.length,
        ragMode: 'prompt-examples-substitute', unsupportedSemantics: unsupported,
        deviations: [
          'Published Gemini agents are overlaid with OpenAI using the original prompt text.',
          'The undistributed Milvus snapshot is replaced by examples embedded in the pinned prompts.',
          'CARLA header is replaced by Scenic generic driving model for custom OpenDRIVE compilation.',
          'Raw generated Scenic components are not executed; a strict trusted-slot Scenic program is compiled and sampled before native lowering.',
          'Scenic footprint containment is disabled because some current-map lanes are narrower than Scenic CARLA actor defaults; native lane binding remains authoritative.',
          'Only speed, lane-change, and lane-offset actions can lower into the native editor.',
        ],
      },
    };
    candidates.push({
      id: `upstream-${randomUUID()}`, title: draft.title, summary: draft.reasoningSummary, intent, scenarioDoc,
      diagnostics: [
        { severity: 'info', code: 'upstream_pinned', message: `TUM-AVS/Chat2scenic ${UPSTREAM_SHA} · CC BY-NC 4.0 · research only` },
        { severity: 'info', code: 'scenic_compile_sample', message: `Scenic ${evidence.scenicVersion ?? '3.1.0'} compiled and sampled ${draft.actors.length} actor(s) in ${evidence.durationMs ?? 0} ms (${evidence.iterations ?? 0} iterations).` },
        { severity: 'warning', code: 'rag_substitute', message: 'The upstream Milvus volume snapshot is not in the repository; prompt-embedded examples were used instead.' },
      ],
      provenance,
    });
  }
  progress('complete', `${candidates.length} upstream research candidate${candidates.length === 1 ? '' : 's'} ready for canonical simulation.`, 8);
  return {
    runId: `upstream-run-${randomUUID()}`, provider: 'upstream-chat2scenic', model, intent: sharedIntent!, candidates,
    metrics: {
      latencyMs: Math.round(performance.now() - started), inputTokens: usage.input || null, outputTokens: usage.output || null,
      totalTokens: usage.all || null, estimatedCostUsd: null, candidatesRequested: count, candidatesReturned: candidates.length,
    },
    diagnostics: [
      { severity: 'warning', code: 'research_only_license', message: 'Upstream Chat2Scenic is CC BY-NC 4.0 and this provider is enabled only for noncommercial research evaluation.' },
      { severity: 'info', code: 'upstream_workflow', message: `Interpreter, settings, header, and ${generatedComponents.length - 1} component stages completed in the upstream order; ${apiCalls} API calls, ${repairAttempts} repair(s).` },
    ],
    warnings: [
      'Research mode: generated Scenic is constrained to a trusted-slot compile/sample boundary before native simulation.',
      'The original Milvus vector-store snapshot is unavailable from the pinned repository, so retrieval uses prompt-embedded examples only.',
    ],
  };
}
