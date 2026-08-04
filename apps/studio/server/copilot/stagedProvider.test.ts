import { describe, expect, it } from 'vitest';
import { TemplateDocument } from '@uniscenarios/scenario-model';
import { generateStagedScenario } from './stagedProvider';
import type { CopilotGenerationRequest, CopilotPlacementSlot } from '../../src/copilot/types';

function slot(id: string, x: number, laneId: number): CopilotPlacementSlot {
  return {
    id,
    actorKinds: ['vehicle', 'pedestrian'],
    pose: { x, y: 0, z: laneId * 4, headingRad: 0 },
    laneRef: { roadId: '1', section: 0, laneId, s: 20 + x, t: 0, headingOffsetRad: 0 },
    routeLaneRsls: [`1:0:${laneId}`, `2:0:${laneId}`],
    recommendedSpeedKph: 30,
    labels: ['corridor'],
  };
}

function request(): CopilotGenerationRequest {
  return {
    providerId: 'staged-rag',
    prompt: 'A child emerges from behind a stopped van while a sedan approaches for a near miss.',
    mapContext: {
      mapId: 'test-map', mapName: 'Test Map', xodrSha256: 'abc', laneCount: 8, junctionLaneCount: 2,
      bounds: { minX: 0, minZ: -20, maxX: 300, maxZ: 20 },
      placementSlots: [slot('one', 0, -1), slot('two', 60, -2), slot('three', 120, -1), slot('four', 180, -2), slot('five', 240, -1)],
    },
    maxCandidates: 2,
    evaluationMode: 'deterministic',
  };
}

describe('clean-room staged Scenario Copilot provider', () => {
  it('preserves structured interpretation, retrieval, component binding, and provenance', async () => {
    const progress: string[] = [];
    const result = await generateStagedScenario(request(), { onProgress: (event) => progress.push(event.stage) });
    expect(result.provider).toBe('staged-rag');
    expect(result.model).toBe('deterministic-clean-room-fallback');
    expect(result.intent.ego.role).toBe('ego');
    expect(result.intent.adversaries[0]?.kind).toBe('pedestrian');
    expect(result.intent.contextActors[0]?.catalogId).toBe('vehicle.van');
    expect(result.candidates).toHaveLength(2);
    expect(progress).toContain('interpreting');
    expect(progress).toContain('binding');
    expect(progress.at(-1)).toBe('complete');
    expect(result.candidates[0]?.provenance.retrievedExampleIds).toContain('EC-04');
  });

  it('produces validated native documents with actors, lane routes, and timed actions', async () => {
    const result = await generateStagedScenario(request());
    const candidate = result.candidates[0]!;
    const parsed = TemplateDocument.fromJSON(candidate.scenarioDoc).data;
    expect(parsed.sourceMap?.mapId).toBe('test-map');
    expect(parsed.anchor.pin?.mapId).toBe('test-map');
    expect(parsed.roles.length).toBe(3);
    expect(parsed.roles.every((role) => role.kind === 'scene_absolute')).toBe(true);
    expect(parsed.roles.every((role) => role.kind !== 'scene_absolute' || (role.initialRoute?.lanes.length ?? 0) >= 2)).toBe(true);
    expect(parsed.choreography.interactions.length).toBe(2);
    expect(parsed.choreography.interactions.some((interaction) => interaction.trigger.kind === 'at' && Number(interaction.trigger.t) >= 4)).toBe(true);
    expect(parsed.extensions?.['scenarioCopilot.currentMapLocked']).toBe(true);
  });

  it('honors user-edited intent through the typed confirmation boundary', async () => {
    const first = await generateStagedScenario(request());
    const edited = { ...first.intent, desiredOutcome: 'User-confirmed controlled stop.', restrictions: [...first.intent.restrictions, 'Ego must remain under 20 kph.'] };
    const result = await generateStagedScenario({ ...request(), confirmedIntent: edited });
    expect(result.intent.desiredOutcome).toBe('User-confirmed controlled stop.');
    expect(result.intent.restrictions).toContain('Ego must remain under 20 kph.');
  });
});
