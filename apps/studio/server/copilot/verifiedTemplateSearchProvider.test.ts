import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMap } from '@uniscenarios/cli';
import { buildFollowRoute, toSceneXZ } from '@uniscenarios/sim-engine';
import type { CopilotGenerationRequest, CopilotPlacementSlot } from '../../src/copilot/types.js';
import { generateVerifiedTemplateSearch, type TemplateRanker } from './verifiedTemplateSearchProvider.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const HAS_RICHMOND = existsSync(path.join(ROOT, 'dev-assets/richmond-field-station/topology-index.json.gz'));

describe.skipIf(!HAS_RICHMOND)('verified template search', () => {
  it('ranks one owned template and deterministically produces a simulation-verified draft', async () => {
    const bundle = await loadMap('richmond-field-station');
    const slots: CopilotPlacementSlot[] = [];
    for (const rsl of bundle.graph.laneRsls()) {
      const geometry = bundle.graph.geometry(rsl); if (!geometry || geometry.lane.laneType !== 'driving' || geometry.lengthM < 45) continue;
      const built = buildFollowRoute(bundle.graph, rsl, [], 700); if (!built.ok || built.route.lengthM < 260) continue;
      const pose = built.route.poseAt(15); const scene = toSceneXZ(pose.point); const [roadId, section, laneId] = pose.rsl!.split(':');
      slots.push({ id: `slot-${slots.length}`, actorKinds: ['vehicle', 'pedestrian'], catalogIds: ['vehicle.sedan', 'vehicle.pickup', 'vehicle.van', 'vehicle.bus', 'vehicle.bicycle', 'pedestrian.adult_walking', 'pedestrian.child_walking'], pose: { x: scene.x, y: 0, z: scene.z, headingRad: pose.headingRad }, laneRef: { roadId: roadId!, section: Number(section), laneId: Number(laneId), s: pose.storageS, t: 0, headingOffsetRad: 0 }, routeLaneRsls: built.route.legs.map((leg) => leg.rsl), availableDownstreamM: built.route.lengthM - 15, recommendedSpeedKph: 25, labels: ['corridor'] });
      if (slots.length >= 4) break;
    }
    const ranker: TemplateRanker = { rank: async () => ({ value: { templateId: 'ec-stalled-vehicle', intentSummary: 'Lead car braking', semanticGoals: ['lead stops'] }, inputTokens: 5, outputTokens: 3, totalTokens: 8 }) };
    const request: CopilotGenerationRequest = { providerId: 'verified-template-search', prompt: 'Create a 20 second scenario with an ego sedan following a lead car. At 6 seconds the lead car brakes hard to a complete stop while the ego continues approaching.', mapContext: { mapId: 'richmond-field-station', mapName: 'Richmond', xodrSha256: bundle.graph.topologyDigest, laneCount: bundle.graph.laneRsls().length, junctionLaneCount: 0, bounds: { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 }, placementSlots: slots }, model: 'gpt-5.6-luna', agentReasoningEffort: 'high' };
    const result = await generateVerifiedTemplateSearch(request, { ranker });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.provenance.templateSearchDetails).toMatchObject({ sourceTemplateId: 'ec-stalled-vehicle', searchBudget: 24 });
    expect(result.candidates[0]!.scenarioDoc.roles).toHaveLength(2);
    expect(result.candidates[0]!.scenarioDoc.choreography.interactions.some((item) => item.verb === 'speed')).toBe(true);
  });

  it('rejects contradictory requests before model ranking', async () => {
    const ranker: TemplateRanker = { rank: async () => { throw new Error('must not be called'); } };
    await expect(generateVerifiedTemplateSearch({ providerId: 'verified-template-search', prompt: 'Make them collide while always staying at least 10 meters apart.', mapContext: { mapId: 'richmond-field-station', mapName: 'Richmond', xodrSha256: null, laneCount: 1, junctionLaneCount: 0, bounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, placementSlots: [] } }, { ranker })).rejects.toThrow('contradictory');
  });
});
