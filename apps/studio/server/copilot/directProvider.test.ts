import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFollowRoute, runSimulation, toSceneXZ } from '@uniscenarios/sim-engine';
import { materializeMapBound } from '@uniscenarios/scenario-materializer';
import { loadMap } from '../../../../packages/cli/src/maps.js';
import type { CopilotGenerationRequest, CopilotMapContext } from '../../src/copilot/types.js';
import { COPILOT_MAX_RUNWAY_M } from '../../src/copilot/types.js';
import { buildCopilotMapContext } from '../../src/copilot/mapContext.js';
import { LaneIndex } from '../../src/editor/laneIndex.js';
import { compileDirectDraft } from './directCompiler.js';
import { CopilotMapContextSchema } from './directTypes.js';
import type { DirectOpenAIClient } from './directOpenAI.js';
import { generateDirectDraft } from './directProvider.js';

const context: CopilotMapContext = {
  mapId: 'test-map', mapName: 'Test Map', xodrSha256: null, laneCount: 1, junctionLaneCount: 0,
  bounds: { minX: 0, minZ: 0, maxX: 500, maxZ: 20 },
  placementSlots: [{
    id: 'lane-a-10', actorKinds: ['vehicle'], catalogIds: ['vehicle.sedan'],
    pose: { x: 10, y: 0, z: 0, headingRad: 0 },
    laneRef: { roadId: '1', section: 0, laneId: -1, s: 10, t: 0, headingOffsetRad: 0 },
    routeLaneRsls: ['1:0:-1'], availableDownstreamM: 300, recommendedSpeedKph: 30, labels: ['straight lane', 'upstream'],
  }, {
    id: 'lane-a-200', actorKinds: ['vehicle'], catalogIds: ['vehicle.sedan'],
    pose: { x: 200, y: 0, z: 0, headingRad: 0 },
    laneRef: { roadId: '1', section: 0, laneId: -1, s: 200, t: 0, headingOffsetRad: 0 },
    routeLaneRsls: ['1:0:-1'], availableDownstreamM: 110, recommendedSpeedKph: 15, labels: ['straight lane', 'downstream'],
  }],
};

const request = (overrides: Partial<CopilotGenerationRequest> = {}): CopilotGenerationRequest => ({
  providerId: 'direct-llm', prompt: 'Place one sedan driving straight on the current road.', mapContext: context,
  maxCandidates: 1, ...overrides,
});

const validDraft = JSON.stringify({
  title: 'Straight sedan', description: 'A sedan follows the current lane.', reasoningSummary: 'Uses the only route-backed vehicle slot.',
  actors: [{ id: 'ego', label: 'Sedan 1', catalogId: 'vehicle.sedan', slotId: 'lane-a-10', initialSpeedKph: 30 }],
  actions: [],
});

describe('direct native Scenario Copilot provider', () => {
  it('accepts the actual browser map-context builder output and reaches the model layer', async () => {
    const laneIndex = LaneIndex.build({
      mapName: 'Contract Map', source: { xodrSha256: 'fixture-hash' },
      lanes: {
        '1:0:-1': {
          roadId: 1, section: 0, laneId: -1, laneType: 'driving', speedLimitKph: 30,
          successors: ['2:0:-1'], polyline: [{ x: 0, y: 0 }, { x: 160, y: 0 }],
        },
        '2:0:-1': {
          roadId: 2, section: 0, laneId: -1, laneType: 'driving', speedLimitKph: 30,
          predecessors: ['1:0:-1'], successors: ['3:0:-1'], polyline: [{ x: 160, y: 0 }, { x: 320, y: 0 }],
        },
        '3:0:-1': {
          roadId: 3, section: 0, laneId: -1, laneType: 'driving', speedLimitKph: 30,
          predecessors: ['2:0:-1'], polyline: [{ x: 320, y: 0 }, { x: 480, y: 0 }],
        },
      },
    });
    const mapContext = buildCopilotMapContext({
      id: 'contract-map', label: 'Contract Map', locality: 'test', manifest: '', xodr: '', lanePolygons: '',
      signals: '', topology: '', derivedTopology: '', locations: '', sumoManifest: '',
    }, laneIndex);
    expect(() => CopilotMapContextSchema.parse(mapContext)).not.toThrow();
    expect(mapContext.placementSlots.every((slot) => typeof slot.availableDownstreamM === 'number' && slot.availableDownstreamM >= 0)).toBe(true);

    let generateCalls = 0;
    const first = mapContext.placementSlots[0]!;
    const client: DirectOpenAIClient = {
      verifyModel: async () => true,
      generate: async ({ model }) => {
        generateCalls++;
        return {
          model, usage: {}, text: JSON.stringify({
            title: 'Builder contract', description: 'Uses a builder slot.', reasoningSummary: 'Contract parsed before model invocation.',
            actors: [{ id: 'ego', label: 'Sedan 1', catalogId: 'vehicle.sedan', slotId: first.id, initialSpeedKph: first.recommendedSpeedKph ?? 10 }],
            actions: [],
          }),
        };
      },
    };
    const result = await generateDirectDraft(request({ mapContext, model: 'test-model' }), { client });
    expect(generateCalls).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it('bounds runway without weakening strict unknown-field validation', () => {
    expect(CopilotMapContextSchema.safeParse(context).success).toBe(true);
    const negative = { ...context, placementSlots: context.placementSlots.map((slot, index) => index ? slot : { ...slot, availableDownstreamM: -1 }) };
    expect(CopilotMapContextSchema.safeParse(negative).success).toBe(false);
    const excessive = { ...context, placementSlots: context.placementSlots.map((slot, index) => index ? slot : { ...slot, availableDownstreamM: COPILOT_MAX_RUNWAY_M + 1 }) };
    expect(CopilotMapContextSchema.safeParse(excessive).success).toBe(false);
    const unknown = { ...context, placementSlots: context.placementSlots.map((slot, index) => index ? slot : { ...slot, inventedRunway: 300 }) };
    expect(CopilotMapContextSchema.safeParse(unknown).success).toBe(false);
  });
  it('materializes a deterministic evaluation candidate without touching an API', async () => {
    const result = await generateDirectDraft(request({ evaluationMode: 'deterministic' }), {
      client: { verifyModel: async () => { throw new Error('must not probe'); }, generate: async () => { throw new Error('must not generate'); } },
      now: () => new Date('2026-08-03T12:00:00.000Z'),
    });
    expect(result.provider).toBe('direct-llm');
    expect(result.model).toBe('deterministic-evaluation');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.scenarioDoc.roles[0]).toMatchObject({
      id: 'ego', kind: 'scene_absolute', actor: { catalogId: 'vehicle.sedan' }, initialRoute: { lanes: ['1:0:-1'] },
    });
  });

  it('repairs one invalid model draft and accounts for both responses', async () => {
    const responses = [
      JSON.stringify({ ...JSON.parse(validDraft), actors: [{ id: 'ego', label: 'Sedan 1', catalogId: 'vehicle.sedan', slotId: 'invented', initialSpeedKph: 30 }] }),
      validDraft,
    ];
    const client: DirectOpenAIClient = {
      verifyModel: async (model) => model === '5.6 LUNA',
      generate: async ({ model }) => ({ text: responses.shift()!, model, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }),
    };
    const result = await generateDirectDraft(request({ model: '5.6 LUNA' }), { client });
    expect(result.candidates).toHaveLength(1);
    expect(result.metrics).toMatchObject({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
    expect(result.candidates[0]!.provenance.repairAttempts).toBe(1);
    expect(responses).toHaveLength(0);
  });

  it('fails closed on invented catalog entries and unsnapped vehicle slots', () => {
    const draft = JSON.parse(validDraft);
    draft.actors[0].catalogId = 'vehicle.invented';
    expect(() => compileDirectDraft(draft, context)).toThrow(/unknown catalog id/u);
    const unsnapped = { ...context, placementSlots: context.placementSlots.map((slot, index) => index === 0 ? { ...slot, laneRef: undefined, routeLaneRsls: undefined } : slot) };
    expect(() => compileDirectDraft(JSON.parse(validDraft), unsnapped)).toThrow(/lacks a snapped lane route/u);
  });

  it('does not silently substitute an unavailable requested model', async () => {
    const priorFallback = process.env['OPENAI_SCENARIO_FALLBACK_MODEL'];
    delete process.env['OPENAI_SCENARIO_FALLBACK_MODEL'];
    const client: DirectOpenAIClient = { verifyModel: async () => false, generate: async () => { throw new Error('unreachable'); } };
    await expect(generateDirectDraft(request({ model: '5.6 LUNA' }), { client })).rejects.toThrow(/not available/u);
    if (priorFallback) process.env['OPENAI_SCENARIO_FALLBACK_MODEL'] = priorFallback;
  });
});

const RICHMOND_TOPOLOGY = new URL('../../../../dev-assets/richmond-field-station/topology-index.json.gz', import.meta.url);

describe.skipIf(!existsSync(RICHMOND_TOPOLOGY))('direct draft canonical simulation on a real map', () => {
  it('creates a native actor, materializes it and simulates the full clip', async () => {
    const map = await loadMap('richmond-field-station');
    const rsl = map.graph.laneRsls().find((candidate) => {
      const geometry = map.graph.geometry(candidate)!;
      if (geometry.lane.laneType !== 'driving' || geometry.lane.isJunction) return false;
      const route = buildFollowRoute(map.graph, candidate, [], 600);
      return route.ok && route.route.lengthM > 220;
    });
    expect(rsl).toBeTruthy();
    const route = buildFollowRoute(map.graph, rsl!, [], 600);
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    const sample = route.route.poseAt(15);
    const scene = toSceneXZ(sample.point);
    const [roadId, section, laneId] = sample.rsl!.split(':');
    const mapContext: CopilotMapContext = {
      mapId: 'richmond-field-station', mapName: 'Richmond Field Station', xodrSha256: null,
      laneCount: map.graph.laneRsls().length, junctionLaneCount: 0,
      bounds: { minX: scene.x - 100, minZ: scene.z - 100, maxX: scene.x + 100, maxZ: scene.z + 100 },
      placementSlots: [{
        id: 'real-richmond-slot', actorKinds: ['vehicle'], catalogIds: ['vehicle.sedan'], labels: ['real route-backed lane'],
        pose: { x: scene.x, y: 0, z: scene.z, headingRad: sample.headingRad },
        laneRef: { roadId: roadId!, section: Number(section), laneId: Number(laneId), s: sample.storageS, t: 0, headingOffsetRad: 0 },
        routeLaneRsls: route.route.legs.map((leg) => leg.rsl), availableDownstreamM: route.route.lengthM, recommendedSpeedKph: 25,
      }, {
        id: 'real-richmond-slot-two', actorKinds: ['vehicle'], catalogIds: ['vehicle.sedan'], labels: ['second route-backed lane'],
        pose: { x: scene.x, y: 0, z: scene.z, headingRad: sample.headingRad },
        laneRef: { roadId: roadId!, section: Number(section), laneId: Number(laneId), s: sample.storageS, t: 0, headingOffsetRad: 0 },
        routeLaneRsls: route.route.legs.map((leg) => leg.rsl), availableDownstreamM: route.route.lengthM, recommendedSpeedKph: 25,
      }],
    };
    const generated = await generateDirectDraft(request({ mapContext, evaluationMode: 'deterministic' }));
    const product = materializeMapBound(generated.candidates[0]!.scenarioDoc, map, { drawIndex: -1 });
    expect(product.manifest.feasible).toBe(true);
    const simulated = runSimulation(product.input, { graph: map.graph, guards: 'throw' });
    expect(simulated.trace.header.actorIds).toEqual(['ego']);
    expect(simulated.trace.ticks.t.at(-1)).toBeGreaterThanOrEqual(19.9);
    expect(simulated.trace.ticks.actors['ego']!.x.length).toBeGreaterThan(900);
  }, 30_000);
});
