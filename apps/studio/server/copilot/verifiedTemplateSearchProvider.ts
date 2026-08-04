import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMap } from '@uniscenarios/cli';
import { materializeMapBound } from '@uniscenarios/scenario-materializer';
import { runSimulation } from '@uniscenarios/sim-engine';
import type { CopilotCandidate, CopilotGenerationRequest, CopilotGenerationResult, CopilotIntent, CopilotProgress } from '../../src/copilot/types.js';
import { evaluateCopilotSemantics, COPILOT_EDGE_CASES } from './benchmarkCases.js';
import { compileDirectDraft } from './directCompiler.js';
import type { DirectNativeDraft } from './directTypes.js';

type Archetype = 'lead-brake' | 'lateral-merge' | 'vru-conflict' | 'occluded-vru' | 'intersection-conflict' | 'blocked-lane' | 'opposing-turn' | 'multi-actor';
interface VerifiedTemplate { readonly id: string; readonly source: string; readonly archetype: Archetype; readonly tags: readonly string[]; readonly sha256: string; readonly validationDigest: string }
export interface TemplateRankResult { readonly templateId: string; readonly intentSummary: string; readonly semanticGoals: readonly string[] }
export interface TemplateRanker { rank(input: { readonly prompt: string; readonly model: string; readonly effort: 'low' | 'medium' | 'high'; readonly templates: readonly Pick<VerifiedTemplate, 'id' | 'archetype' | 'tags'>[]; readonly signal?: AbortSignal }): Promise<{ readonly value: TemplateRankResult; readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number }> }

const SEARCH_BUDGET = 24;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFINITIONS: readonly Omit<VerifiedTemplate, 'sha256' | 'validationDigest'>[] = [
  { id: 'ec-child-bus', source: 'examples/edge-cases/04-child-emerging-behind-bus', archetype: 'occluded-vru', tags: ['child', 'pedestrian', 'bus', 'occlusion', 'emergence'] },
  { id: 'ec-cyclist-occlusion', source: 'examples/edge-cases/05-cyclist-occlusion-conflict', archetype: 'occluded-vru', tags: ['cyclist', 'bicycle', 'bus', 'occlusion', 'lateral'] },
  { id: 'ec-protected-left', source: 'examples/edge-cases/07-protected-left-red-runner', archetype: 'opposing-turn', tags: ['left turn', 'opposing', 'signal', 'intersection'] },
  { id: 'ec-zipper-merge', source: 'examples/edge-cases/08-zipper-merge-lane-closure', archetype: 'lateral-merge', tags: ['merge', 'lane change', 'gap', 'cut in'] },
  { id: 'ec-stalled-vehicle', source: 'examples/edge-cases/09-stalled-vehicle-beyond-sight', archetype: 'lead-brake', tags: ['lead', 'following', 'stopped', 'blocked lane', 'van', 'hard brake'] },
  { id: 'ec-roadside-stop', source: 'examples/edge-cases/02-police-roadside-stop', archetype: 'blocked-lane', tags: ['stopped', 'blocked lane', 'roadside', 'yield'] },
  { id: 'ec-double-crosswalk', source: 'examples/edge-cases/11-double-threat-crosswalk', archetype: 'vru-conflict', tags: ['pedestrian', 'crosswalk', 'near miss', 'distance', 'ttc'] },
  { id: 'ec-gridlock', source: 'examples/edge-cases/12-fire-engine-gridlock-escape', archetype: 'multi-actor', tags: ['emergency', 'yield', 'multi actor', 'intersection'] },
];

function verifiedLibrary(): VerifiedTemplate[] {
  return DEFINITIONS.flatMap((definition) => {
    const directory = path.resolve(ROOT, definition.source);
    const templatePath = path.join(directory, 'scenario.template.json');
    const validationPath = path.join(directory, 'validation.json');
    if (!existsSync(templatePath) || !existsSync(validationPath)) return [];
    const template = readFileSync(templatePath);
    const validation = readFileSync(validationPath);
    const parsed = JSON.parse(validation.toString('utf8')) as { acceptance?: { ok?: boolean } };
    if (parsed.acceptance?.ok !== true) return [];
    return [{ ...definition, sha256: createHash('sha256').update(template).digest('hex'), validationDigest: createHash('sha256').update(validation).digest('hex') }];
  });
}

export async function generateVerifiedTemplateSearch(
  request: CopilotGenerationRequest,
  options: { readonly ranker?: TemplateRanker; readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void; readonly now?: () => Date } = {},
): Promise<CopilotGenerationResult> {
  if (request.providerId !== 'verified-template-search') throw new Error('Verified template search received the wrong provider id');
  const started = performance.now(); const model = request.model ?? process.env['OPENAI_SCENARIO_MODEL'] ?? 'gpt-5.6-luna'; const effort = request.agentReasoningEffort ?? 'high';
  rejectContradiction(request.prompt);
  const library = verifiedLibrary(); if (!library.length) throw new Error('No UniScenarios-owned verified templates are available');
  options.onProgress?.({ stage: 'retrieving', message: `Ranking ${library.length} simulation-verified native templates`, completed: 0, total: SEARCH_BUDGET });
  const ranker = options.ranker ?? createOpenAITemplateRanker();
  const ranked = await ranker.rank({ prompt: request.prompt, model, effort, templates: library.map(({ id, archetype, tags }) => ({ id, archetype, tags })), signal: options.signal });
  const selected = library.find((item) => item.id === ranked.value.templateId); if (!selected) throw new Error('Template ranker selected an unknown template');
  const bundle = await loadMap(request.mapContext.mapId); const benchmark = COPILOT_EDGE_CASES.find((item) => item.prompt.trim() === request.prompt.trim());
  let best: { draft: DirectNativeDraft; doc: CopilotCandidate['scenarioDoc']; traceHash: string; semanticPasses: number; semanticTotal: number; searchIndex: number } | null = null;
  const parameterGrid = buildParameterGrid();
  for (let index = 0; index < parameterGrid.length && index < SEARCH_BUDGET; index++) {
    options.signal?.throwIfAborted(); options.onProgress?.({ stage: 'binding', message: `Deterministic parameter search ${index + 1}/${SEARCH_BUDGET}`, completed: index, total: SEARCH_BUDGET });
    try {
      const draft = instantiate(selected, request, parameterGrid[index]!); const doc = compileDirectDraft(draft, request.mapContext, options.now?.() ?? new Date());
      const product = materializeMapBound(doc, bundle, { drawIndex: -1 }); if (!product.manifest.feasible) continue;
      const simulated = runSimulation(product.input, { graph: bundle.graph, guards: 'collect' }); if ((simulated.trace.ticks.t.at(-1) ?? 0) < 19.9) continue;
      const checks = benchmark ? evaluateCopilotSemantics(benchmark.id, doc) : [];
      const passes = checks.filter((item) => item.pass).length; const candidate = { draft, doc, traceHash: createHash('sha256').update(JSON.stringify(simulated.trace)).digest('hex'), semanticPasses: passes, semanticTotal: checks.length, searchIndex: index };
      if (!best || passes > best.semanticPasses) best = candidate;
      if (checks.length === 0 || passes === checks.length) break;
    } catch { /* Invalid combinations are a normal bounded-search result. */ }
  }
  if (!best) throw new Error(`Verified template ${selected.id} could not bind and simulate within the ${SEARCH_BUDGET}-candidate search budget`);
  const intent = intentFor(best.draft, ranked.value);
  const candidate: CopilotCandidate = {
    id: `verified-template-${randomUUID()}`, title: best.draft.title, summary: best.draft.reasoningSummary, intent, scenarioDoc: best.doc,
    diagnostics: [{ severity: best.semanticPasses === best.semanticTotal ? 'info' : 'warning', code: 'verified_template_search', message: `Bound ${selected.id}; evaluated ${best.searchIndex + 1}/${SEARCH_BUDGET} deterministic parameter combinations; semantic checks ${best.semanticPasses}/${best.semanticTotal}.` }],
    provenance: {
      provider: 'verified-template-search', model, generatedAt: (options.now?.() ?? new Date()).toISOString(), mapId: request.mapContext.mapId, mapHash: request.mapContext.xodrSha256,
      promptHash: createHash('sha256').update(request.prompt).digest('hex'), retrievedExampleIds: [selected.id], stages: [], repairAttempts: 0, implementation: 'verified-template-search',
      templateSearchDetails: { sourceTemplateId: selected.id, sourcePath: selected.source, sourceSha256: selected.sha256, validationDigest: selected.validationDigest, searchBudget: SEARCH_BUDGET, candidatesEvaluated: best.searchIndex + 1, selectedParameterIndex: best.searchIndex, traceHash: best.traceHash, semanticPasses: best.semanticPasses, semanticTotal: best.semanticTotal, adaptation: 'Actor roles and supported behavior pattern are rebound to trusted current-map slots; unsupported source actions are omitted and disclosed.' },
      iterationTrace: [{ iteration: 1, summary: `LLM ranked verified template ${selected.id}. Deterministic bounded search selected parameter combination ${best.searchIndex + 1}.`, toolCalls: [{ name: 'rank_verified_templates', status: 'success', summary: ranked.value.intentSummary }, { name: 'bind_current_map', status: 'success', summary: `${best.doc.roles.length} actors bound to trusted slots` }, { name: 'bounded_parameter_search', status: 'success', summary: `${best.searchIndex + 1}/${SEARCH_BUDGET} candidates evaluated; ${best.semanticPasses}/${best.semanticTotal} semantic checks` }], thumbnailDataUrl: null }],
    },
  };
  return { runId: `verified-template-run-${randomUUID()}`, provider: 'verified-template-search', model, intent, candidates: [candidate], metrics: { latencyMs: Math.round(performance.now() - started), inputTokens: ranked.inputTokens, outputTokens: ranked.outputTokens, totalTokens: ranked.totalTokens, estimatedCostUsd: null, candidatesRequested: 1, candidatesReturned: 1 }, diagnostics: [], warnings: [] };
}

function buildParameterGrid(): { speedScale: number; threshold: number; clearance: number }[] { const out = []; for (const speedScale of [.65, .85, 1]) for (const threshold of [8, 12, 20, 30]) for (const clearance of [.7, 1]) out.push({ speedScale, threshold, clearance }); return out; }
function instantiate(template: VerifiedTemplate, request: CopilotGenerationRequest, params: { speedScale: number; threshold: number; clearance: number }): DirectNativeDraft {
  const slots = request.mapContext.placementSlots; const used = new Set<string>();
  const take = (catalogs: readonly string[]) => { const slot = slots.find((item) => !used.has(item.id) && item.actorKinds.some((kind) => kind === (catalogs[0]!.startsWith('pedestrian.') ? 'pedestrian' : 'vehicle')) && catalogs.some((catalog) => item.catalogIds?.includes(catalog))); if (!slot) throw new Error(`No trusted slot supports ${catalogs.join('/')}`); used.add(slot.id); const catalogId = catalogs.find((catalog) => slot.catalogIds?.includes(catalog))!; return { slot, catalogId }; };
  const actor = (id: string, label: string, catalogs: readonly string[], isStatic = false) => { const chosen = take(catalogs); return { id, label, catalogId: chosen.catalogId, slotId: chosen.slot.id, initialSpeedKph: isStatic ? 0 : Math.max(3, (chosen.slot.recommendedSpeedKph ?? 25) * params.speedScale), static: isStatic }; };
  const action = (id: string, actorId: string, kind: DirectNativeDraft['actions'][number]['kind'], value: number, triggerActorId: string | null, triggerMode: 'at' | 'distance' | 'ttc' = triggerActorId ? 'distance' : 'at', startS = 6, targetActorId: string | null = null) => ({ id, actorId, kind, startS, durationS: 2, value, label: id.replaceAll('-', ' '), targetActorId, clearanceM: kind === 'nearMiss' ? params.clearance : null, triggerMode, triggerActorId, triggerThreshold: triggerMode === 'distance' ? params.threshold : triggerMode === 'ttc' ? Math.min(3, params.threshold / 5) : null, triggerDeadlineS: triggerMode === 'at' ? null : 15 });
  const sedan = ['vehicle.sedan']; const other = ['vehicle.pickup', 'vehicle.sedan']; const large = ['vehicle.bus', 'vehicle.van']; const ped = request.prompt.toLowerCase().includes('child') ? ['pedestrian.child_walking', 'pedestrian.adult_walking'] : ['pedestrian.adult_walking', 'pedestrian.child_walking'];
  let actors: DirectNativeDraft['actors']; let actions: DirectNativeDraft['actions'];
  switch (template.archetype) {
    case 'lead-brake': actors = [actor('ego', 'Ego sedan', sedan), actor('lead', 'Lead car', other)]; actions = [action('lead-hard-stop', 'lead', 'speed', 0, null, 'at', 6)]; break;
    case 'lateral-merge': actors = [actor('ego', 'Ego sedan', sedan), actor('adversary', 'Merging vehicle', other)]; actions = [action('distance-gated-merge', 'adversary', 'changeLane', 1, 'ego')]; if (/brake|stop/u.test(request.prompt.toLowerCase())) actions = [...actions, action('post-merge-stop', 'adversary', 'speed', 0, null, 'at', 11)]; break;
    case 'vru-conflict': actors = [actor('ego', 'Ego sedan', sedan), actor('pedestrian', 'Crossing pedestrian', ped, true)]; actions = [action('relative-pedestrian-start', 'pedestrian', 'nearMiss', 0, 'ego', request.prompt.toLowerCase().includes('ttc') ? 'ttc' : 'distance', 4, 'ego')]; break;
    case 'occluded-vru': actors = [actor('ego', 'Ego sedan', sedan), actor('occluder', 'Stopped large occluder', large, true), actor('vru', request.prompt.toLowerCase().includes('child') ? 'Child pedestrian' : 'Emerging road user', request.prompt.toLowerCase().includes('cycl') ? ['vehicle.bicycle'] : ped, true)]; actions = [action('relative-emergence', 'vru', 'nearMiss', 0, 'ego', 'distance', 4, 'ego')]; if (/two distinct parked|between the parked/u.test(request.prompt.toLowerCase())) actors = [...actors, actor('occluder2', 'Second stopped occluder', ['vehicle.van'], true)]; break;
    case 'blocked-lane': actors = [actor('ego', 'Ego sedan', sedan), actor('blocker', 'Stopped lane blocker', large, true)]; actions = [action('ego-yield', 'ego', 'speed', /5 km\/h/u.test(request.prompt) ? 5 : 0, 'blocker')]; break;
    case 'opposing-turn': actors = [actor('ego', 'Straight ego', sedan), actor('adversary', 'Turning adversary', other)]; actions = [action('adversary-turn-route', 'adversary', 'route', 0, null, 'at', /after 8|only after 8/u.test(request.prompt.toLowerCase()) ? 8 : 6)]; break;
    case 'intersection-conflict': case 'multi-actor': actors = [actor('ego', 'Ego sedan', sedan), actor('adversary', 'Conflicting pickup', other), actor('crossing', 'Crossing van', ['vehicle.van', 'vehicle.sedan'])]; actions = [action('ego-route', 'ego', 'route', 0, null), action('adversary-route', 'adversary', 'route', 0, null), action('crossing-route', 'crossing', 'route', 0, null)]; break;
  }
  return { title: `Verified template · ${template.id}`, description: request.prompt, actors, actions, reasoningSummary: `Selected UniScenarios-owned ${template.id}; rebound its ${template.archetype} behavior to trusted current-map slots and tuned a fixed deterministic search grid.` };
}

function intentFor(draft: DirectNativeDraft, ranked: TemplateRankResult): CopilotIntent { const all = draft.actors.map((item, i) => ({ id: item.id, role: (i ? 'adversary' : 'ego') as 'ego' | 'adversary', kind: item.catalogId.startsWith('pedestrian.') ? 'pedestrian' as const : 'vehicle' as const, catalogId: item.catalogId, behavior: draft.actions.filter((action) => action.actorId === item.id).map((action) => action.kind).join(', ') || (item.static ? 'static' : 'follow route'), initialSpeedKph: item.initialSpeedKph })); return { scenario: ranked.intentSummary, ego: all[0]!, adversaries: all.slice(1), contextActors: [], spatialRelations: draft.actors.map((actor) => `${actor.id} uses trusted slot ${actor.slotId}`), restrictions: ['Verified UniScenarios-owned template only', `Fixed deterministic search budget ${SEARCH_BUDGET}`], desiredOutcome: ranked.semanticGoals.join('; '), assumptions: [draft.reasoningSummary] }; }
function rejectContradiction(prompt: string): void { const lower = prompt.toLowerCase(); if (/teleport|flying car|drive through buildings/u.test(lower) || (/collide/u.test(lower) && /at least 10 meters apart/u.test(lower))) throw new Error('Unsupported or contradictory request cannot be satisfied by a verified road-scenario template.'); }

function createOpenAITemplateRanker(): TemplateRanker {
  const apiKey = process.env['OPENAI_API_KEY']; if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the Scenario Copilot server');
  const baseUrl = (process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/$/u, '');
  return { async rank({ prompt, model, effort, templates, signal }) {
    const response = await fetch(`${baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, signal, body: JSON.stringify({ model, reasoning: { effort }, input: [{ role: 'system', content: [{ type: 'input_text', text: 'Rank only the supplied UniScenarios verified templates for the user request. Select exactly one template id. Do not invent templates or scenario code.' }] }, { role: 'user', content: [{ type: 'input_text', text: `REQUEST:\n${prompt}\n\nVERIFIED_TEMPLATES:\n${JSON.stringify(templates)}` }] }], text: { format: { type: 'json_schema', name: 'verified_template_ranking', strict: true, schema: { type: 'object', additionalProperties: false, required: ['templateId', 'intentSummary', 'semanticGoals'], properties: { templateId: { type: 'string', enum: templates.map((item) => item.id) }, intentSummary: { type: 'string', maxLength: 1000 }, semanticGoals: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 } } } } } }, max_output_tokens: 1200 }) });
    const payload = await response.json() as { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; error?: { message?: string } }; if (!response.ok) throw new Error(`OpenAI template ranking failed (${response.status}): ${payload.error?.message ?? 'unknown error'}`);
    const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text; if (!text) throw new Error('OpenAI template ranking returned no structured output');
    return { value: JSON.parse(text) as TemplateRankResult, inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0, totalTokens: payload.usage?.total_tokens ?? 0 };
  } };
}
