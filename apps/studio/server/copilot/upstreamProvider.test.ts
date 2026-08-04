import { describe, expect, it } from 'vitest';
import type { CopilotGenerationRequest } from '../../src/copilot/types';
import { generateUpstreamChat2Scenic } from './upstreamProvider';

const request: CopilotGenerationRequest = {
  providerId: 'upstream-chat2scenic',
  prompt: 'A car proceeds along a Richmond industrial road.',
  evaluationMode: 'deterministic',
  maxCandidates: 1,
  mapContext: {
    mapId: 'richmond-field-station',
    mapName: 'Richmond Field Station',
    xodrSha256: '80704cd1',
    laneCount: 10,
    junctionLaneCount: 2,
    bounds: { minX: 0, minZ: 0, maxX: 500, maxZ: 500 },
    placementSlots: [{
      id: 'slot-1', actorKinds: ['vehicle'], catalogIds: ['vehicle.sedan'],
      pose: { x: 10, y: 0, z: 20, headingRad: 0 },
      laneRef: { roadId: '1', section: 0, laneId: -1, s: 10, t: 0, headingOffsetRad: 0 },
      routeLaneRsls: ['1:0:-1'], availableDownstreamM: 150, recommendedSpeedKph: 20, labels: ['industrial road'],
    }, {
      id: 'slot-2', actorKinds: ['vehicle'], catalogIds: ['vehicle.pickup'],
      pose: { x: 30, y: 0, z: 40, headingRad: 0 },
      laneRef: { roadId: '2', section: 0, laneId: -1, s: 10, t: 0, headingOffsetRad: 0 },
      routeLaneRsls: ['2:0:-1'], availableDownstreamM: 150, recommendedSpeedKph: 20, labels: ['industrial road'],
    }],
  },
};

describe('upstream Chat2Scenic research provider', () => {
  it('keeps the pinned workflow behind Scenic compile/sample evidence before native lowering', async () => {
    let source = '';
    const result = await generateUpstreamChat2Scenic(request, {
      mapFile: '/research/richmond/map.xodr',
      compileSample: async (program) => {
        source = program;
        return {
          scenicVersion: '3.1.0', compiled: true, sampled: true, iterations: 1, durationMs: 4, compileMs: 3, sampleMs: 1,
          objects: [{ index: 0, x: 10, y: 20, headingRad: Math.PI / 2, type: 'Car' }],
        };
      },
    });

    expect(result.provider).toBe('upstream-chat2scenic');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.scenarioDoc.roles).toHaveLength(1);
    expect(result.candidates[0]!.provenance.researchDetails).toMatchObject({
      upstreamSha: '54264e4e394ff7bd5a72913abe4e323fa06cd37e',
      scenicCompiled: true,
      scenicSampled: true,
      ragMode: 'prompt-examples-substitute',
    });
    expect(source).toContain('model scenic.domains.driving.model');
    expect(source).toContain('facing roadDirection');
    expect(source).toContain('regionContainedIn None');
    expect(source).not.toContain('sk-');
  });
});
