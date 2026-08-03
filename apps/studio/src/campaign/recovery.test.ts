import { describe, expect, it } from 'vitest';
import { dashCameras, type ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { simulationSourceHash } from './recovery';

function template(): ScenarioTemplateV2 {
  return {
    roles: [{
      id: 'ambulance', kind: 'scene_absolute', label: 'Ambulance',
      actor: {
        class: 'car', static: false, catalogId: 'vehicle.ambulance',
        dims: { length: 6.1, width: 2.1, height: 2.65 }, sensors: [],
      },
      pose: { position: { x: 1, y: 0, z: 2 }, headingRad: 0 },
      extensions: { 'studio.presentation.bodyColor': '#ffffff' },
    }],
    props: [],
    choreography: { warmupSeconds: 0, clipSeconds: 20, interactions: [] },
  } as unknown as ScenarioTemplateV2;
}

describe('verified materialization recovery identity', () => {
  it('ignores dash cameras and appearance while retaining physical behavior fields', () => {
    const baseline = template();
    const decorated = template();
    decorated.roles[0]!.label = 'Response unit';
    decorated.roles[0]!.actor.catalogId = 'vehicle.van';
    decorated.roles[0]!.actor.sensors = [{
      id: 'dash-1', type: 'dash_camera', enabled: true,
      mount: { position: { x: 2, y: 1.5, z: 0 }, rotation: { yawRad: 0, pitchRad: 0, rollRad: 0 } },
      camera: { horizontalFovDeg: 90, aspectRatio: 16 / 9, nearM: 0.05, farM: 2_000 },
    }];
    decorated.roles[0]!.extensions = { 'studio.presentation.bodyColor': '#ff0000' };
    expect(simulationSourceHash(decorated)).toBe(simulationSourceHash(baseline));
    expect(dashCameras(decorated.roles[0]!.actor).map((camera) => camera.id)).toEqual(['dash-1']);

    decorated.roles[0]!.actor.dims!.length = 7;
    expect(simulationSourceHash(decorated)).not.toBe(simulationSourceHash(baseline));
  });
});
