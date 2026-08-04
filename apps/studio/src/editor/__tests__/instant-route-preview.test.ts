import { describe, expect, it } from 'vitest';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { LaneIndex } from '../laneIndex';
import { routesFromTemplate } from '../routeOverlay';

function index(): LaneIndex {
  return LaneIndex.build({
    mapName: 'visual-only-route',
    lanes: {
      '1:0:-1': { roadId: 1, section: 0, laneId: -1, laneType: 'driving', successors: ['2:0:-1'], polyline: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      '2:0:-1': { roadId: 2, section: 0, laneId: -1, laneType: 'driving', predecessors: ['1:0:-1'], polyline: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
      '3:0:-1': { roadId: 3, section: 0, laneId: -1, laneType: 'driving', predecessors: ['1:0:-1'], polyline: [{ x: 10, y: 0 }, { x: 10, y: 10 }] },
    },
  });
}

describe('visual-only authored route affordance', () => {
  it('does not interpret action timing or project future behavior', () => {
    const template = {
      roles: [{
        id: 'ego', kind: 'scene_absolute', actor: { class: 'car', static: false },
        initialRoute: { mode: 'lanePath', lanes: ['1:0:-1', '2:0:-1'] },
      }],
      choreography: {
        clipSeconds: 10,
        interactions: [{
          id: 'future-turn', actor: 'ego', verb: 'route', trigger: { kind: 'at', t: 3 },
          target: { mode: 'lanePath', lanes: ['1:0:-1', '3:0:-1'] },
        }],
      },
    } as unknown as ScenarioTemplateV2;
    const route = routesFromTemplate(template, index())[0]!;
    expect(route.planned.at(-1)).toEqual({ x: 20, z: 0 });
    expect(route.markers.some((marker) => marker.kind === 'reroute')).toBe(false);
  });
});
