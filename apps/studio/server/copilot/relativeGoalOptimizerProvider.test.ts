import { describe, expect, it } from 'vitest';
import type { CopilotGenerationRequest, CopilotMapContext } from '../../src/copilot/types.js';
import type { DirectNativeDraft } from './directTypes.js';
import { buildOptimizerVariants, generateRelativeGoalOptimizer } from './relativeGoalOptimizerProvider.js';

const mapContext: CopilotMapContext = {
  mapId: 'richmond-field-station', mapName: 'Richmond', xodrSha256: null, laneCount: 2, junctionLaneCount: 0,
  bounds: { minX: 0, minZ: 0, maxX: 400, maxZ: 20 },
  placementSlots: [0, 1, 2].map((index) => ({
    id: `slot-${index}`, actorKinds: ['vehicle', 'pedestrian'], catalogIds: ['vehicle.sedan', 'pedestrian.adult_walking'],
    pose: { x: index * 80, y: 0, z: 0, headingRad: 0 },
    laneRef: { roadId: '1', section: 0, laneId: -1, s: index * 80, t: 0, headingOffsetRad: 0 },
    routeLaneRsls: ['1:0:-1'], availableDownstreamM: 300, recommendedSpeedKph: 25, labels: ['corridor'],
  })),
};
const request = (prompt: string): CopilotGenerationRequest => ({ providerId: 'relative-goal-optimizer', prompt, mapContext, model: 'gpt-5.6-luna' });
const draft: DirectNativeDraft = {
  title: 'Relative crossing', description: 'A relative crossing.', reasoningSummary: 'Nominal intent.',
  actors: [
    { id: 'ego', label: 'Ego', catalogId: 'vehicle.sedan', slotId: 'slot-0', initialSpeedKph: 24, static: false },
    { id: 'walker', label: 'Walker', catalogId: 'pedestrian.adult_walking', slotId: 'slot-1', initialSpeedKph: 0, static: false },
  ],
  actions: [{ id: 'walk', actorId: 'walker', kind: 'nearMiss', startS: 0, durationS: 6, value: 0, label: 'Cross', targetActorId: 'ego', clearanceM: .8, triggerMode: 'distance', triggerActorId: 'ego', triggerThreshold: 15, triggerDeadlineS: 12 }],
};

describe('relative-goal deterministic optimizer', () => {
  it('builds a deterministic bounded parameter search without model calls', () => {
    const first = buildOptimizerVariants(draft, request('Create a near miss.'), 12);
    const second = buildOptimizerVariants(draft, request('Create a near miss.'), 12);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(4);
    expect(first).toHaveLength(12);
    expect(new Set(first.map((item) => JSON.stringify(item.draft))).size).toBe(first.length);
    expect(first.flatMap((item) => item.changes).join(' ')).toMatch(/speed|threshold|clearance|placement/iu);
  });

  it('rejects contradictory goals before calling the model', async () => {
    let calls = 0;
    await expect(generateRelativeGoalOptimizer(request('Make them collide while always remaining at least 10 meters apart.'), { client: {
      verifyModel: async () => { calls++; return true; }, generate: async () => { calls++; throw new Error('must not run'); },
    } })).rejects.toThrow(/contradictory/iu);
    expect(calls).toBe(0);
  });

  it('uses exactly one high-effort model call and does not repair an invalid intent', async () => {
    const efforts: string[] = [];
    await expect(generateRelativeGoalOptimizer(request('Create an ego sedan and pedestrian relative crossing.'), { client: {
      verifyModel: async () => true,
      generate: async ({ reasoningEffort }) => { efforts.push(reasoningEffort ?? 'unset'); return { text: '{}', model: 'gpt-5.6-luna', usage: { totalTokens: 10 } }; },
    } })).rejects.toThrow(/made no repair call/iu);
    expect(efforts).toEqual(['high']);
  });
});
