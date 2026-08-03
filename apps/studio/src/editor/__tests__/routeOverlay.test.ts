import { describe, expect, it } from 'vitest';
import { Color, type LineBasicMaterial, type LineSegments, type Points, type PointsMaterial } from 'three';
import { parseSimScenarioInput } from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { LaneIndex } from '../laneIndex';
import { dashedSegments, dottedPoints, resolvedRoutePoints, routeColor, routesForAuthoringPreview, routesFromSimulation, VehicleRouteOverlayRenderer } from '../routeOverlay';

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
    initial: { laneRef: { rsl: lanes[0]!, s: lanes[0] === '3:0:1' ? 10 : 0, t: 0 }, pose: { x: 0, z: 0, headingRad: 0 }, speedMps: isStatic ? 0 : 5 },
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

  it('uses the current authored timeline route while retaining warmed ambient routes', () => {
    const template = {
      roles: [{ id: 'ego', actor: { class: 'car', static: false } }],
      choreography: {
        interactions: [{
          id: 'route-ego', actor: 'ego', verb: 'route', trigger: { kind: 'at', t: 0 },
          target: { mode: 'lanePath', lanes: ['3:0:1'] },
        }],
      },
    } as unknown as ScenarioTemplateV2;
    const routes = routesForAuthoringPreview(template, index(), input());
    expect(routes.map((route) => route.actorId)).toEqual(['ambient-1', 'ego']);
    expect(routes.find((route) => route.actorId === 'ego')!.planned[0]).toEqual({ x: 30, z: 0 });
    expect(routes.find((route) => route.actorId === 'ego')!.planned.at(-1)).toEqual({ x: 20, z: 0 });
  });

  it('creates world-length dashes and stable actor colors', () => {
    expect(dashedSegments([{ x: 0, z: 0 }, { x: 10, z: 0 }])).toHaveLength(18);
    expect(dottedPoints([{ x: 0, z: 0 }, { x: 10, z: 0 }])).toHaveLength(7);
    expect(routeColor('ego')).toBe(routeColor('ego'));
    expect(routeColor('other')).not.toBe(routeColor('ego'));
    expect(new Color(routeColor('black-car', '#101114')).getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThanOrEqual(.62);
    const spec = { kind: 'lanePath' as const, lanes: ['1:0:-1', '2:0:-1'] };
    expect(resolvedRoutePoints(spec, index())).toBe(resolvedRoutePoints(spec, index()));
  });

  it('clips an authored guide to the exact actor spawn station', () => {
    const points = resolvedRoutePoints(
      { kind: 'lanePath', lanes: ['1:0:-1', '2:0:-1'] },
      index(),
      { laneRsl: '1:0:-1', storageS: 7 },
    );
    expect(points[0]).toEqual({ x: 7, z: 0 });
    expect(points.at(-1)).toEqual({ x: 10, z: -10 });
  });

  it('batches muted and selected styles and keeps ambient hidden by default', () => {
    const routes = routesFromSimulation(input(), index());
    const renderer = new VehicleRouteOverlayRenderer();
    renderer.sync(routes, { showAmbient: false, showActual: false, selectedActorIds: new Set() });
    expect(renderer.group.children).toHaveLength(3); // dots + arrows + semantic marker batch
    renderer.sync(routes, { showAmbient: true, showActual: false, selectedActorIds: new Set(['ego']) });
    expect(renderer.group.children).toHaveLength(3); // one dots + one arrows + markers
    const arrows = renderer.group.getObjectByName('planned-route-arrows') as LineSegments<import('three').BufferGeometry, LineBasicMaterial>;
    const dots = renderer.group.getObjectByName('planned-route-dots') as Points<import('three').BufferGeometry, PointsMaterial>;
    expect(arrows.material.depthTest).toBe(false);
    expect(dots.material.depthTest).toBe(false);
    renderer.dispose();
    expect(renderer.group.children).toHaveLength(0);
  });

  it('samples terrain elevation and renders guides above occluding road geometry', () => {
    const renderer = new VehicleRouteOverlayRenderer((x, z) => 17 + x * .01 + z * .02);
    renderer.sync(routesFromSimulation(input(), index()), { showAmbient: false, showActual: false, selectedActorIds: new Set(['ego']) });
    const dots = renderer.group.getObjectByName('planned-route-dots') as Points<import('three').BufferGeometry, PointsMaterial>;
    const positions = dots.geometry.getAttribute('position');
    expect(positions.getY(0)).toBeCloseTo(17.38);
    expect(dots.material.depthWrite).toBe(false);
    expect(dots.material.depthTest).toBe(false);
    renderer.dispose();
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
