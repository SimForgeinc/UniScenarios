import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CopilotGenerationRequest } from '../../src/copilot/types.js';
import { configuredOpenAI, generateJsonText } from './openaiClient.js';
import { generateStagedScenario } from './stagedProvider.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('staged OpenAI structured response boundary', () => {
  it('uses the exact API model id by default', () => {
    vi.stubEnv('UNISCENARIOS_COPILOT_MODEL', '');
    expect(configuredOpenAI().requestedModel).toBe('gpt-5.6-luna');
  });

  it('sends a strict json_schema payload instead of the fragile json_object request', async () => {
    let payload: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output_text: '{}', model: 'test-model', usage: {} }), { status: 200 });
    };
    await generateJsonText({
      apiKey: 'test-key', model: 'test-model', instructions: 'Return the requested object.', prompt: 'scenario request', fetchImpl,
      responseSchema: { name: 'intent', schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } },
    });
    expect(payload).toMatchObject({
      model: 'test-model',
      text: { format: { type: 'json_schema', name: 'intent', strict: true } },
    });
  });

  it('fails live staged generation truthfully instead of substituting a deterministic result after HTTP 400', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('UNISCENARIOS_COPILOT_MODEL', 'test-model');
    vi.stubEnv('UNISCENARIOS_COPILOT_FALLBACK_MODEL', '');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_request', message: 'bad structured request' } }), { status: 400 })));
    const request: CopilotGenerationRequest = {
      providerId: 'staged-rag', prompt: 'Create a sedan encounter on the current road.',
      mapContext: {
        mapId: 'test', mapName: 'Test', xodrSha256: null, laneCount: 2, junctionLaneCount: 0,
        bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 10 },
        placementSlots: [0, 1].map((index) => ({
          id: `slot-${index}`, actorKinds: ['vehicle'], catalogIds: ['vehicle.sedan'],
          pose: { x: index * 20, y: 0, z: 0, headingRad: 0 },
          laneRef: { roadId: '1', section: 0, laneId: -1, s: index * 20, t: 0, headingOffsetRad: 0 },
          routeLaneRsls: ['1:0:-1'], availableDownstreamM: 200 - index * 20, recommendedSpeedKph: 25, labels: [],
        })),
      },
    };
    await expect(generateStagedScenario(request)).rejects.toThrow(/no deterministic result was substituted/u);
  });
});
