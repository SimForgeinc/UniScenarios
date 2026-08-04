import { loadMap } from '@uniscenarios/cli';
import { materializeMapBound } from '@uniscenarios/scenario-materializer';
import { runSimulation, type SimTrace } from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { CopilotGenerationRequest, CopilotGenerationResult, CopilotProgress } from '../../src/copilot/types.js';
import { renderBirdEye, type BirdEyeRenderResult } from './birdsEyeRenderer.js';
import { compileDirectDraft } from './directCompiler.js';
import type { DirectOpenAIClient } from './directOpenAI.js';
import { type DirectNativeDraft } from './directTypes.js';
import { generateSimulationAgent } from './simulationAgentProvider.js';

interface VisualIteration {
  readonly iteration: number;
  readonly render: BirdEyeRenderResult;
  readonly source: 'current-scenario' | 'prior-candidate';
}

/** Same bounded graph as the text agent; the sole model-facing difference is a deterministic bird-eye PNG. */
export async function generateSimulationAgentVision(
  request: CopilotGenerationRequest,
  options: { readonly client?: DirectOpenAIClient; readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void; readonly now?: () => Date } = {},
): Promise<CopilotGenerationResult> {
  if (request.providerId !== 'simulation-agent-vision') throw new Error('Visual simulation agent received the wrong provider id');
  const visualIterations: VisualIteration[] = [];
  const coreRequest: CopilotGenerationRequest = { ...request, providerId: 'simulation-agent' };
  const result = await generateSimulationAgent(coreRequest, {
    ...options,
    getIterationImages: async ({ iteration, previousDraft }) => {
      const rendered = await renderIteration(coreRequest, previousDraft, iteration);
      visualIterations.push(rendered);
      return [{ dataUrl: rendered.render.dataUrl, detail: 'high' }];
    },
  });
  const candidates = await Promise.all(result.candidates.map(async (candidate) => {
    const finalRender = await renderDocumentWithSimulation(request.mapContext.mapId, candidate.scenarioDoc, visualIterations.length + 1);
    const allVisuals = [...visualIterations, { iteration: visualIterations.length + 1, render: finalRender, source: 'prior-candidate' as const }];
    const agentIterations = candidate.provenance.agentDetails?.iterations ?? [];
    return {
      ...candidate,
      id: candidate.id.replace(/^simulation-agent-/u, 'simulation-agent-vision-'),
      provenance: {
        ...candidate.provenance,
        provider: 'simulation-agent-vision' as const,
        implementation: 'iterative-simulation-agent-vision' as const,
        agentDetails: candidate.provenance.agentDetails ? {
          ...candidate.provenance.agentDetails,
          visualGrounding: {
            imageInputSupported: true, renderer: 'uniscenarios-deterministic-birds-eye-v1' as const,
            imagesSent: visualIterations.length, totalImageBytes: visualIterations.reduce((sum, item) => sum + item.render.bytes, 0),
            imageSha256: visualIterations.map((item) => item.render.sha256),
          },
        } : undefined,
        iterationTrace: allVisuals.map((item, index) => ({
          iteration: item.iteration,
          summary: index < agentIterations.length ? `Visual grounding for agent iteration ${item.iteration}; ${item.source.replace('-', ' ')}. ${item.render.altText}` : `Final simulation-verified visual. ${item.render.altText}`,
          toolCalls: index < agentIterations.length ? agentIterations[index]!.toolCalls.map((call) => ({ name: call.name, status: call.ok ? 'success' as const : 'failure' as const, summary: call.outputSummary })) : [{ name: 'render_final_verified_candidate', status: 'success' as const, summary: `${item.render.width}×${item.render.height}; ${item.render.bytes} bytes; sha256 ${item.render.sha256.slice(0, 12)}` }],
          thumbnailDataUrl: item.render.dataUrl, altText: item.render.altText, legend: item.render.legend, provenance: item.render.provenance,
        })),
      },
    };
  }));
  return {
    ...result, runId: result.runId.replace(/^simulation-agent-run-/u, 'simulation-agent-vision-run-'), provider: 'simulation-agent-vision', candidates,
    diagnostics: [...result.diagnostics, ...(candidates.length ? [{ severity: 'info' as const, code: 'visual_input_verified', message: `The configured model accepted ${visualIterations.length} deterministic PNG image input${visualIterations.length === 1 ? '' : 's'} at ${result.agentDetails?.reasoningEffort ?? request.agentReasoningEffort ?? 'high'} reasoning effort.` }] : [])],
    ...(result.agentDetails ? { agentDetails: {
      ...result.agentDetails,
      visualGrounding: {
        imageInputSupported: visualIterations.length > 0,
        renderer: 'uniscenarios-deterministic-birds-eye-v1' as const,
        imagesSent: visualIterations.length,
        totalImageBytes: visualIterations.reduce((sum, item) => sum + item.render.bytes, 0),
        imageSha256: visualIterations.map((item) => item.render.sha256),
      },
    } } : {}),
  };
}

async function renderIteration(request: CopilotGenerationRequest, previousDraft: DirectNativeDraft | null, iteration: number): Promise<VisualIteration> {
  if (!previousDraft) return { iteration, source: 'current-scenario', render: renderBirdEye({ mapId: request.mapContext.mapId, scenarioDoc: request.currentScenario ?? emptyDocument(request.mapContext.mapId), iteration }) };
  const doc = compileDirectDraft(previousDraft, request.mapContext, new Date(0));
  return { iteration, source: 'prior-candidate', render: await renderDocumentWithSimulation(request.mapContext.mapId, doc, iteration) };
}

async function renderDocumentWithSimulation(mapId: string, doc: ScenarioTemplateV2, iteration: number): Promise<BirdEyeRenderResult> {
  let trace: SimTrace | null = null;
  try {
    const bundle = await loadMap(mapId); const product = materializeMapBound(doc, bundle, { drawIndex: -1 });
    if (product.manifest.feasible) trace = runSimulation(product.input, { graph: bundle.graph, guards: 'collect' }).trace;
  } catch { /* Exact text error comes from the shared trusted graph; do not invent a spatial location. */ }
  const failure = trace?.metrics.collisions[0]; const marker = failure ? collisionPoint(trace!, failure.t, failure.a, failure.b) : null;
  return renderBirdEye({ mapId, scenarioDoc: doc, trace, iteration, ...(marker ? { failure: { ...marker, label: `Collision ${failure!.a}/${failure!.b} at ${failure!.t.toFixed(2)} seconds` } } : {}) });
}

function collisionPoint(trace: SimTrace, t: number, actorA: string, actorB: string): { x: number; y: number } | null {
  const a = trace.ticks.actors[actorA]; const b = trace.ticks.actors[actorB]; if (!a || !b) return null;
  let index = 0; for (let i = 1; i < trace.ticks.t.length; i++) if (Math.abs(trace.ticks.t[i]! - t) < Math.abs(trace.ticks.t[index]! - t)) index = i;
  return { x: (a.x[index]! + b.x[index]!) / 2, y: (a.y[index]! + b.y[index]!) / 2 };
}

function emptyDocument(mapId: string): ScenarioTemplateV2 {
  return { schemaVersion: 2, meta: { id: 'visual-grounding-empty', name: 'Empty visual grounding', description: 'Current map before the first candidate draft', tags: [] }, map: { mapId, mode: 'anchored' }, parameters: [], roles: [], props: [], trafficControls: [], mapSignalPlans: [], choreography: { clip: { start: 0, end: 20 }, interactions: [] }, invariants: [], variants: [], validation: { rules: [] } } as ScenarioTemplateV2;
}
