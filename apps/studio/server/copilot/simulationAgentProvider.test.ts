import { describe, expect, it } from 'vitest';
import type { CopilotGenerationRequest, CopilotMapContext } from '../../src/copilot/types.js';
import { compileDirectDraft } from './directCompiler.js';
import { createOpenAIResponsesClient } from './directOpenAI.js';
import { generateSimulationAgent } from './simulationAgentProvider.js';

const context: CopilotMapContext = {
  mapId: 'richmond-field-station', mapName: 'Richmond Field Station', xodrSha256: null, laneCount: 2, junctionLaneCount: 0,
  bounds: { minX: 0, minZ: 0, maxX: 500, maxZ: 10 },
  placementSlots: [0, 1].map((index) => ({
    id: `slot-${index}`, actorKinds: ['vehicle', 'pedestrian'], catalogIds: ['vehicle.sedan', 'pedestrian.adult_walking'],
    pose: { x: index * 100, y: 0, z: 0, headingRad: 0 },
    laneRef: { roadId: '1', section: 0, laneId: -1, s: index * 100, t: 0, headingOffsetRad: 0 },
    routeLaneRsls: ['1:0:-1'], availableDownstreamM: 300, recommendedSpeedKph: 25, labels: ['corridor'],
  })),
};

describe('iterative simulation agent boundaries', () => {
  it('rejects impossible native capabilities before invoking the model', async () => {
    let calls = 0;
    const request: CopilotGenerationRequest = {
      providerId: 'simulation-agent', prompt: 'Teleport a flying car through buildings above the road.', mapContext: context,
    };
    await expect(generateSimulationAgent(request, { client: {
      verifyModel: async () => { calls++; return true; },
      generate: async () => { calls++; throw new Error('must not run'); },
    } })).rejects.toThrow(/unsupported request/iu);
    expect(calls).toBe(0);
  });

  it('sends explicit high effort and optional trusted images to Responses', async () => {
    let payload: Record<string, unknown> = {};
    const client = createOpenAIResponsesClient({ apiKey: 'test-only', fetchImpl: async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output_text: '{}', model: 'gpt-5.6-luna', usage: {} }), { status: 200 });
    } });
    await client.generate({
      model: 'gpt-5.6-luna', system: 'system', user: 'user', reasoningEffort: 'high',
      images: [{ dataUrl: 'data:image/png;base64,AA==', detail: 'low' }],
    });
    expect(payload).toMatchObject({ model: 'gpt-5.6-luna', reasoning: { effort: 'high' } });
    expect(JSON.stringify(payload)).toContain('input_image');
  });

  it('compiles actor-relative distance triggers into the native DSL', () => {
    const doc = compileDirectDraft({
      title: 'Relative pedestrian start', description: 'Pedestrian begins when ego is close.', reasoningSummary: 'Uses engine timing.',
      actors: [
        { id: 'ego', label: 'Sedan', catalogId: 'vehicle.sedan', slotId: 'slot-0', initialSpeedKph: 25, static: false },
        { id: 'walker', label: 'Walker', catalogId: 'pedestrian.adult_walking', slotId: 'slot-1', initialSpeedKph: 0, static: false },
      ],
      actions: [{
        id: 'walk', actorId: 'walker', kind: 'speed', startS: 0, durationS: 2, value: 5, label: 'Start walking',
        targetActorId: null, clearanceM: null, triggerMode: 'distance', triggerActorId: 'ego', triggerThreshold: 15, triggerDeadlineS: 12,
      }],
    }, context);
    expect(doc.choreography.interactions[0]?.trigger).toMatchObject({
      kind: 'when', condition: { kind: 'distance', from: 'ego', to: { role: 'walker' }, valueM: 15 }, byLatest: 12,
    });
  });
});
