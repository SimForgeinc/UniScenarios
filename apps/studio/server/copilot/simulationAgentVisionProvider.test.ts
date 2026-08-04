import { describe, expect, it, vi } from 'vitest';
import type { CopilotGenerationRequest } from '../../src/copilot/types.js';
import type { DirectOpenAIClient } from './directOpenAI.js';
import { generateSimulationAgentVision } from './simulationAgentVisionProvider.js';

const RICHMOND_SLOT = { id: 'slot-1', actorKinds: ['vehicle'] as const, catalogIds: ['vehicle.sedan'], pose: { x: 20, y: 0, z: -360, headingRad: 1.2 }, laneRef: { roadId: '0', section: 0, laneId: -1, s: 5, t: 0, headingOffsetRad: 0 }, routeLaneRsls: ['0:0:-1'], availableDownstreamM: 100, recommendedSpeedKph: 20, labels: ['corridor'] };

describe('visual simulation agent', () => {
  it('sends a server-rendered PNG through the same medium-effort graph', async () => {
    const generate = vi.fn(async (args: Parameters<DirectOpenAIClient['generate']>[0]) => ({ text: JSON.stringify({ title: 'Visual draft', description: 'A sedan follows the road', reasoningSummary: 'Bound to the trusted lane', actors: [{ id: 'ego', label: 'Sedan 1', catalogId: 'vehicle.sedan', slotId: 'slot-1', initialSpeedKph: 20, static: false }], actions: [] }), model: args.model, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }));
    const client: DirectOpenAIClient = { verifyModel: vi.fn(async () => true), generate };
    const request: CopilotGenerationRequest = { providerId: 'simulation-agent-vision', prompt: 'Create a moving sedan scenario on the current road.', maxAgentIterations: 1, mapContext: { mapId: 'richmond-field-station', mapName: 'Richmond', xodrSha256: null, laneCount: 1, junctionLaneCount: 0, bounds: { minX: 0, minZ: -500, maxX: 100, maxZ: 0 }, placementSlots: [RICHMOND_SLOT, { ...RICHMOND_SLOT, id: 'slot-2', pose: { ...RICHMOND_SLOT.pose, x: 22 } }] } };
    await generateSimulationAgentVision(request, { client });
    const args = generate.mock.calls[0]![0]; expect(args.reasoningEffort).toBe('medium'); expect(args.images).toHaveLength(1); expect(args.images![0]!.dataUrl).toMatch(/^data:image\/png;base64,/u);
  });
});
