import { describe, expect, it } from 'vitest';
import type { LineBasicMaterial, LineSegments } from 'three';
import { parseSimScenarioInput } from '@uniscenarios/sim-engine';
import { LaneIndex } from '../laneIndex';
import { dashedSegments, resolvedRoutePoints, routeColor, routesFromSimulation, VehicleRouteOverlayRenderer } from '../routeOverlay';

function index(): LaneIndex {
  return LaneIndex.build({
    mapName: 'route-test',
    lanes: {
      '1:0:-1': { roadId: 1, section: 0, laneId: -1, laneType: 'driving', successors: ['2:0:-1'], polyline: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      '2:0:-1': { roadId: 2, section: 0, laneId: -1, laneType: 'driving', predecessors: ['1:0:-1'], polyline: [{ x: 10, y: 0 }, { x: 10, y: 10 }] },
      '3:0:1': { roadId: 3, section: 0, laneId: 1, laneType: 'driving', polyline: [{ x: 20, y: 0 }, { x: 30, y: 0 }] },
    },
  });
}

function input() {
  const actor = (id: string, kind: 'car' | 'pedestrian' | 'static_object', lanes: string[], tags: string[] = [], isStatic = false) => ({
    id, kind, dims: { l: 4, w: 2, h: 1.5 },
    initial: { laneRef: { rsl: lanes[0]!, s: 0, t: 0 }, pose: { x: 0, z: 0, headingRad: 0 }, speedMps: isStatic ? 0 : 5 },
    behavior: { route: { kind: 'lanePath' as const, lanes }, rules: { obeySignals: true, yield: true, yieldToVehicles: true, yieldToPedestrians: true, collisionAvoidance: true, aggression: .5, speedFactor: 1 } },
    presentAtStart: true, static: isStatic, tags,
  });
  return parseSimScenarioInput({
    mapId: 'test', clipSeconds: 5, warmupSeconds: 0, dt: .1, seed: 'stable', signalPrograms: [], interactions: [],
    operationalConditions: { weather: 'clear', timeOfDay: 'day', traffic: 'moderate', visibility: 'unrestricted', effects: { visibilityRangeM: 10000, frictionScale: 1, trafficSpeedFactor: 1 } },
    physics: { mode: 'dynamic-v1' },
    actors: [
      actor('ego', 'car', ['1:0:-1', '2:0:-1']),
      actor('ambient-1', 'car', ['3:0:1'], ['ambient']),
      actor('walker', 'pedestrian', ['1:0:-1']),
      actor('parked', 'static_object', ['1:0:-1'], [], true),
    ],
  });
}

describe('vehicle route overlays', () => {
  it('uses lane travel order and scene transform deterministically', () => {
    const a = routesFromSimulation(input(), index());
    const b = routesFromSimulation(input(), index());
    expect(a).toEqual(b);
    expect(a.map((route) => route.actorId)).toEqual(['ambient-1', 'ego']);
    const ego = a.find((route) => route.actorId === 'ego')!.planned;
    expect(ego[0]).toEqual({ x: 0, z: 0 });
    expect(ego).toContainEqual({ x: 10, z: 0 });
    expect(ego.at(-1)).toEqual({ x: 10, z: -10 });
    // Positive lane ids travel against storage order.
    const ambient = a.find((route) => route.actorId === 'ambient-1')!.planned;
    expect(ambient[0]).toEqual({ x: 30, z: 0 });
    expect(ambient.at(-1)).toEqual({ x: 20, z: 0 });
  });

  it('never produces guides for pedestrians or static objects and marks ambient routes', () => {
    const routes = routesFromSimulation(input(), index());
    expect(routes.some((route) => route.actorId === 'walker' || route.actorId === 'parked')).toBe(false);
    expect(routes.find((route) => route.actorId === 'ambient-1')?.ambient).toBe(true);
  });

  it('creates world-length dashes and stable actor colors', () => {
    expect(dashedSegments([{ x: 0, z: 0 }, { x: 10, z: 0 }])).toHaveLength(18);
    expect(routeColor('ego')).toBe(routeColor('ego'));
    expect(routeColor('other')).not.toBe(routeColor('ego'));
    const spec = { kind: 'lanePath' as const, lanes: ['1:0:-1', '2:0:-1'] };
    expect(resolvedRoutePoints(spec, index())).toBe(resolvedRoutePoints(spec, index()));
  });

  it('batches muted and selected styles and keeps ambient hidden by default', () => {
    const routes = routesFromSimulation(input(), index());
    const renderer = new VehicleRouteOverlayRenderer();
    renderer.sync(routes, { showAmbient: false, showActual: false, selectedActorIds: new Set() });
    expect(renderer.group.children).toHaveLength(2); // path batch + semantic marker batch
    renderer.sync(routes, { showAmbient: true, showActual: false, selectedActorIds: new Set(['ego']) });
    expect(renderer.group.children).toHaveLength(3); // muted + selected + markers
    const selected = renderer.group.children[1] as LineSegments<import('three').BufferGeometry, LineBasicMaterial>;
    expect(selected.material.opacity).toBe(.96);
    renderer.dispose();
    expect(renderer.group.children).toHaveLength(0);
  });

  it('stays inside the interactive budget for 32 cached routes', () => {
    const base = routesFromSimulation(input(), index()).find((route) => route.actorId === 'ego')!;
    const routes = Array.from({ length: 32 }, (_, i) => ({ ...base, actorId: `vehicle-${i}` }));
    const renderer = new VehicleRouteOverlayRenderer();
    // Warm Three.js constructors and isolate steady-state route-overlay work.
    renderer.sync(routes, { showAmbient: false, showActual: false, selectedActorIds: new Set() });
    const start = performance.now();
    renderer.sync(routes, { showAmbient: false, showActual: false, selectedActorIds: new Set(['vehicle-0']) });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(8);
    expect(renderer.group.children.length).toBeLessThanOrEqual(3);
    renderer.dispose();
  });
});
