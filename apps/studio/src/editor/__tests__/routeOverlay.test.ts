import { describe, expect, it } from 'vitest';
import { Color, type LineBasicMaterial, type LineSegments, type Points, type PointsMaterial } from 'three';
import { parseSimScenarioInput, type SceneTrace } from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { LaneIndex } from '../laneIndex';
import { authoringRoutes, dashedSegments, dottedPoints, resolvedRoutePoints, routeColor, routeExecutionParity, routesForAuthoringPreview, routesFromSimulation, routesFromTemplate, VehicleRouteOverlayRenderer } from '../routeOverlay';

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
    expect(a.map((route) => route.actorId)).toEqual(['ambient-1', 'ego', 'walker']);
    const ego = a.find((route) => route.actorId === 'ego')!.planned;
    expect(ego[0]).toEqual({ x: 0, z: 0 });
    expect(ego).toContainEqual({ x: 10, z: 0 });
    expect(ego.at(-1)).toEqual({ x: 10, z: -10 });
    // Positive lane ids travel against storage order.
    const ambient = a.find((route) => route.actorId === 'ambient-1')!.planned;
    expect(ambient[0]).toEqual({ x: 30, z: 0 });
    expect(ambient.at(-1)).toEqual({ x: 20, z: 0 });
  });

  it('includes canonical pedestrian guides, excludes static objects, and marks ambient routes', () => {
    const routes = routesFromSimulation(input(), index());
    expect(routes.find((route) => route.actorId === 'walker')?.actorKind).toBe('pedestrian');
    expect(routes.some((route) => route.actorId === 'parked')).toBe(false);
    expect(routes.find((route) => route.actorId === 'ambient-1')?.ambient).toBe(true);
  });

  it('renders the hash-covered near-miss clearance envelope at the canonical trace sample', () => {
    const concrete = { ...input(), nearMissCriteria: [{ interactionId: 'near', pedestrianId: 'walker', targetId: 'ego', clearanceM: .6, toleranceM: .15, pass: 'front' as const, planHash: '1234abcd', predictedClosestApproachS: 1, predictedTimeGapS: .25 }] };
    const trace = { header: { clipSeconds: 1 }, ticks: { t: [0, 1], actors: { walker: { x: [0, 3], z: [0, 4], present: [1, 1] } } }, events: [] } as unknown as SceneTrace;
    const walker = routesFromSimulation(concrete, index(), trace).find((route) => route.actorId === 'walker')!;
    expect(walker.triggerPoint).toEqual({ x: 3, z: 4 });
    expect(walker.triggerRadiusM).toBe(.6);
    const renderer = new VehicleRouteOverlayRenderer();
    renderer.sync([walker], { showAmbient: false, showActual: false, selectedActorIds: new Set(['walker']) });
    expect(renderer.group.getObjectByName('pedestrian-trigger-envelopes')).toBeTruthy();
    renderer.dispose();
  });

  it('keeps the authored plan separate from observed simulation geometry', () => {
    const trace = {
      ticks: {
        t: [0, 1],
        actors: {
          ego: { x: [1, 2], z: [7, 8], present: [1, 1] },
        },
      },
      events: [],
    } as unknown as SceneTrace;
    const route = routesFromSimulation(input(), index(), trace).find((item) => item.actorId === 'ego')!;
    expect(route.planned[0]).toEqual({ x: 0, z: 0 });
    expect(route.actual).toEqual([{ x: 1, z: 7 }, { x: 2, z: 8 }]);
    expect(route.actual).not.toEqual(route.planned);
  });

  it('shows no behavioral trajectory while the canonical trace is incomplete', () => {
    const template = {
      roles: [{
        id: 'ego', kind: 'scene_absolute', actor: { class: 'car', static: false },
        laneRef: { roadId: '1', section: 0, laneId: -1, s: 0, t: 0, headingOffsetRad: 0 },
        initialRoute: { mode: 'lanePath', lanes: ['1:0:-1', '2:0:-1'] },
      }],
      choreography: { clipSeconds: 5, interactions: [] },
    } as unknown as ScenarioTemplateV2;
    const trace = {
      ticks: { t: [0, 1], actors: { ego: { x: [0, 5], z: [0, 0], present: [1, 1] } } }, events: [],
    } as unknown as SceneTrace;
    expect(routesForAuthoringPreview(template, index(), input())).toEqual([]);
    expect(authoringRoutes(template, index(), input(), trace)).toEqual([]);
  });

  it('uses a completed canonical preview trace as the authored future path', () => {
    const template = {
      roles: [{ id: 'ego', kind: 'scene_absolute', actor: { class: 'car', static: false }, laneRef: { roadId: '1', section: 0, laneId: -1, s: 0 }, initialRoute: { mode: 'lanePath', lanes: ['1:0:-1', '2:0:-1'] } }],
      choreography: { clipSeconds: 5, interactions: [] },
    } as unknown as ScenarioTemplateV2;
    const exact = [{ x: 0, z: 0 }, { x: 3, z: 1 }, { x: 7, z: 4 }];
    const trace = {
      header: { clipSeconds: 5 },
      ticks: { t: [0, 2.5, 5], actors: { ego: { x: exact.map((p) => p.x), z: exact.map((p) => p.z), present: [1, 1, 1] } } }, events: [],
    } as unknown as SceneTrace;
    const route = authoringRoutes(template, index(), input(), trace).find((candidate) => candidate.actorId === 'ego')!;
    expect(route.planned).toEqual(exact);
    expect(route.actual).toEqual(exact);
  });

  it('fails closed when compiled Play input changes a persisted route plan or explicit maneuver', () => {
    const template = {
      roles: [{
        id: 'ego', kind: 'scene_absolute', actor: { class: 'car', static: false },
        initialRoute: { mode: 'lanePath', lanes: ['1:0:-1', '2:0:-1'] },
      }],
      choreography: { interactions: [
        { id: 'turn', actor: 'ego', trigger: { kind: 'at', t: 1 }, verb: 'route', target: { mode: 'lanePath', lanes: ['1:0:-1', '2:0:-1'] } },
        { id: 'left', actor: 'ego', trigger: { kind: 'at', t: 2 }, verb: 'changeLane', target: { mode: 'relative', dk: 1 } },
      ] },
    } as unknown as ScenarioTemplateV2;
    const concrete = input();
    const actor = concrete.actors.find((candidate) => candidate.id === 'ego')!;
    const matching = {
      actors: concrete.actors,
      interactions: [
        { id: 'turn', actorId: 'ego', trigger: { kind: 'at', t: 1 }, verb: 'route', target: { kind: 'lanePath', lanes: ['1:0:-1', '2:0:-1'] } },
        { id: 'left', actorId: 'ego', trigger: { kind: 'at', t: 2 }, verb: 'changeLane', target: { mode: 'left', count: 1 }, dynamics: { shape: 'linear', duration: 1 } },
      ],
    } as unknown as Pick<ReturnType<typeof input>, 'actors' | 'interactions'>;
    expect(routeExecutionParity(template, matching).ok).toBe(true);
    const changed = {
      ...matching,
      actors: concrete.actors.map((candidate) => candidate.id === actor.id
        ? { ...candidate, behavior: { ...candidate.behavior, route: { kind: 'lanePath' as const, lanes: ['1:0:-1', '3:0:1'] } } }
        : candidate),
    };
    expect(routeExecutionParity(template, changed)).toMatchObject({ ok: false, mismatches: ['ego'] });
  });

  it('does not fall back to authored or warmed route geometry without a complete trace', () => {
    const template = {
      roles: [{ id: 'ego', actor: { class: 'car', static: false } }],
      choreography: {
        interactions: [{
          id: 'route-ego', actor: 'ego', verb: 'route', trigger: { kind: 'at', t: 0 },
          target: { mode: 'lanePath', lanes: ['3:0:1'] },
        }],
      },
    } as unknown as ScenarioTemplateV2;
    expect(routesForAuthoringPreview(template, index(), input())).toEqual([]);
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
    expect(renderer.group.children).toHaveLength(4); // vehicle dots + pedestrian dashes + arrows + semantic markers
    renderer.sync(routes, { showAmbient: true, showActual: false, selectedActorIds: new Set(['ego']) });
    expect(renderer.group.children).toHaveLength(4);
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
