import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';
import {
  buildRoute,
  contentHash,
  type RouteSpec,
  type SimActor,
  type SimScenarioInput,
  type SceneTrace,
} from '@uniscenarios/sim-engine';
import type { Interaction, ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { LaneIndex } from './laneIndex';

export type RouteMarkerKind = 'turn-left' | 'turn-right' | 'reroute' | 'lane-change' | 'stop' | 'speed-change' | 'near-miss';

export interface RoutePoint { readonly x: number; readonly z: number }
export interface VehicleRouteOverlay {
  readonly actorId: string;
  readonly actorKind?: 'vehicle' | 'pedestrian';
  readonly ambient: boolean;
  readonly color: string;
  readonly planned: readonly RoutePoint[];
  readonly actual: readonly RoutePoint[];
  readonly markers: readonly { kind: RouteMarkerKind; point: RoutePoint }[];
  readonly triggerPoint?: RoutePoint;
  readonly triggerRadiusM?: number;
  readonly invalidReason?: string;
}

export interface RouteOverlayOptions {
  readonly showAmbient: boolean;
  readonly showActual: boolean;
  readonly selectedActorIds: ReadonlySet<string>;
}

export type RouteHeightSampler = (x: number, z: number) => number | null;

const VEHICLE_KINDS = new Set<SimActor['kind']>(['vehicle', 'car', 'truck', 'bus', 'van', 'motorcycle', 'bicycle', 'scooter']);
const PALETTE = ['#55a7ff', '#ff8a65', '#8bd17c', '#d590ef', '#ffd166', '#54d6c4', '#ef6f9b'];
const ROUTE_CACHE_LIMIT = 256;
const routeGeometryCache = new Map<string, readonly RoutePoint[]>();

/** Test/diagnostic hook: route edits add one entry without evicting unrelated actors. */
export function routeGeometryCacheSize(): number { return routeGeometryCache.size; }
export function clearRouteGeometryCache(): void { routeGeometryCache.clear(); }

/** Stable presentation color when an actor has no authored body color. */
export function routeColor(actorId: string, authored?: string): string {
  if (authored && /^#[0-9a-f]{6}$/i.test(authored)) {
    // Vehicle paint is often charcoal/black. It is a useful identity cue but a
    // one-pixel black route disappears on asphalt, so preserve its hue while
    // lifting it into a high-contrast guide colour.
    const color = new Color(authored);
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    color.setHSL(hsl.h, Math.max(.72, hsl.s), Math.max(.62, hsl.l));
    return `#${color.getHexString()}`;
  }
  let hash = 2166136261;
  for (let i = 0; i < actorId.length; i++) hash = Math.imul(hash ^ actorId.charCodeAt(i), 16777619);
  return PALETTE[(hash >>> 0) % PALETTE.length]!;
}

/** Resolve through the same Route implementation used to construct RuntimeWorld actors. */
export function resolvedRoutePoints(
  spec: RouteSpec,
  index: LaneIndex,
  start?: { readonly laneRsl: string; readonly storageS: number },
): readonly RoutePoint[] {
  const graphDigest = index.stats.xodrSha256 ?? `${index.stats.mapName}:${index.stats.lanes}:${index.stats.segments}`;
  const key = `${graphDigest}:${contentHash(spec)}:${start ? `${start.laneRsl}@${start.storageS.toFixed(3)}` : 'full'}`;
  const cached = routeGeometryCache.get(key);
  if (cached) return cached;
  const built = buildRoute(index.graph, spec);
  if (!built.ok || built.route.lengthM <= 0) return [];
  const points: RoutePoint[] = [];
  const startS = start && spec.kind === 'lanePath' && spec.lanes[0] === start.laneRsl
    ? built.route.sOfLaneStorage(start.laneRsl, start.storageS) ?? 0
    : 0;
  // Two-metre samples retain junction curvature while bounding 32 typical
  // routes to a few thousand vertices. Exact leg boundaries are also sampled.
  const samples = new Set<number>([startS, built.route.lengthM]);
  for (let s = startS + 2; s < built.route.lengthM; s += 2) samples.add(s);
  for (const leg of built.route.legs) {
    if (leg.sStart >= startS) samples.add(leg.sStart);
    if (leg.sStart + leg.lengthM >= startS) samples.add(leg.sStart + leg.lengthM);
  }
  for (const s of [...samples].sort((a, b) => a - b)) {
    const pose = built.route.poseAt(s);
    const x = Object.is(pose.point.x, -0) ? 0 : pose.point.x;
    const rawZ = -pose.point.y;
    points.push({ x, z: Object.is(rawZ, -0) ? 0 : rawZ });
  }
  const stable = Object.freeze(points);
  routeGeometryCache.set(key, stable);
  if (routeGeometryCache.size > ROUTE_CACHE_LIMIT) routeGeometryCache.delete(routeGeometryCache.keys().next().value!);
  return stable;
}

function routePoints(actor: SimActor, index: LaneIndex): readonly RoutePoint[] {
  const laneRef = actor.initial.laneRef;
  return resolvedRoutePoints(actor.behavior.route, index, laneRef
    ? { laneRsl: laneRef.rsl, storageS: laneRef.s }
    : undefined);
}

function actualPoints(actorId: string, trace?: SceneTrace): RoutePoint[] {
  const track = trace?.ticks.actors[actorId];
  if (!track) return [];
  const out: RoutePoint[] = [];
  for (let i = 0; i < track.x.length; i++) {
    if (track.present[i] === 0) continue;
    const point = { x: track.x[i]!, z: track.z[i]! };
    const last = out.at(-1);
    if (!last || Math.hypot(last.x - point.x, last.z - point.z) >= 0.35) out.push(point);
  }
  return out;
}

function turnMarkers(points: readonly RoutePoint[]): Array<{ kind: RouteMarkerKind; point: RoutePoint }> {
  const result: Array<{ kind: RouteMarkerKind; point: RoutePoint }> = [];
  for (let i = 2; i < points.length - 2; i++) {
    const before = points[i - 2]!;
    const at = points[i]!;
    const after = points[i + 2]!;
    const a = Math.atan2(at.z - before.z, at.x - before.x);
    const b = Math.atan2(after.z - at.z, after.x - at.x);
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    if (Math.abs(delta) < Math.PI / 5) continue;
    if (result.at(-1) && Math.hypot(result.at(-1)!.point.x - at.x, result.at(-1)!.point.z - at.z) < 10) continue;
    result.push({ kind: delta < 0 ? 'turn-left' : 'turn-right', point: at });
  }
  return result;
}

function actionMarkers(actorId: string, interactions: readonly SimScenarioInput['interactions'][number][], trace?: SceneTrace) {
  const track = trace?.ticks.actors[actorId];
  if (!track || !trace) return [];
  const result: Array<{ kind: RouteMarkerKind; point: RoutePoint }> = [];
  for (const action of interactions) {
    if (action.actorId !== actorId || (action.verb !== 'speed' && action.verb !== 'changeLane')) continue;
    const fired = trace.events.find((event) => 'interactionId' in event && event.interactionId === action.id);
    const triggerTime = fired?.t ?? (action.trigger.kind === 'at' ? action.trigger.t : null);
    if (triggerTime === null) continue;
    let tick = 0;
    while (tick + 1 < trace.ticks.t.length && trace.ticks.t[tick + 1]! <= triggerTime) tick++;
    const kind: RouteMarkerKind = action.verb === 'changeLane'
      ? 'lane-change'
      : action.target.mode === 'stop' ? 'stop' : 'speed-change';
    result.push({ kind, point: { x: track.x[tick]!, z: track.z[tick]! } });
  }
  return result;
}

/** Build overlays from the exact concrete simulator input. Static actors and pedestrians are excluded. */
export function routesFromSimulation(
  input: Pick<SimScenarioInput, 'actors' | 'interactions' | 'nearMissCriteria'>,
  index: LaneIndex,
  trace?: SceneTrace,
  authoredColors: ReadonlyMap<string, string | undefined> = new Map(),
): VehicleRouteOverlay[] {
  return [...input.actors]
    .filter((actor) => !actor.static && (VEHICLE_KINDS.has(actor.kind) || actor.kind === 'pedestrian'))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((actor) => {
      const planned = routePoints(actor, index);
      const actual = actualPoints(actor.id, trace);
      const nearMiss = input.nearMissCriteria?.find((criterion) => criterion.pedestrianId === actor.id);
      let nearMissPoint: RoutePoint | undefined;
      if (nearMiss && trace) {
        let tick = 0;
        while (tick + 1 < trace.ticks.t.length && trace.ticks.t[tick + 1]! <= nearMiss.predictedClosestApproachS) tick++;
        const track = trace.ticks.actors[actor.id];
        if (track?.present[tick]) nearMissPoint = { x: track.x[tick]!, z: track.z[tick]! };
      }
      const ambient = actor.id.startsWith('ambient-') || actor.tags.some((tag) => tag === 'ambient' || tag.startsWith('ambient:'));
      return {
        actorId: actor.id,
        actorKind: actor.kind === 'pedestrian' ? 'pedestrian' as const : 'vehicle' as const,
        ambient,
        color: routeColor(actor.id, authoredColors.get(actor.id)),
        planned,
        actual,
        markers: [...turnMarkers(planned), ...actionMarkers(actor.id, input.interactions, trace)],
        ...(nearMissPoint && nearMiss ? { triggerPoint: nearMissPoint, triggerRadiusM: nearMiss.clearanceM } : {}),
      };
    })
    .filter((route) => route.planned.length > 1 || route.actual.length > 1);
}

/**
 * Visual-only authored geometry for placement/edit affordances. This is not a
 * behavioral preview and is never selected by authoringRoutes after a document
 * commit; native fixed-step simulation owns every claimed future trajectory.
 */
export function routesFromTemplate(template: ScenarioTemplateV2, index: LaneIndex): VehicleRouteOverlay[] {
  return template.roles.flatMap((role) => {
    if (role.actor.static || role.actor.class === 'pedestrian' || role.actor.class === 'static_object') return [];
    const lanes = role.kind === 'scene_absolute' ? role.initialRoute?.lanes : undefined;
    if (!lanes?.length) return [];
    const planned = resolvedRoutePoints({ kind: 'lanePath', lanes }, index,
      role.kind === 'scene_absolute' && role.laneRef
        ? { laneRsl: `${role.laneRef.roadId}:${role.laneRef.section}:${role.laneRef.laneId}`, storageS: role.laneRef.s }
        : undefined);
    if (planned.length < 2) return [];
    const authoredColor = role.extensions?.['studio.presentation.bodyColor'];
    return [{
      actorId: role.id,
      ambient: false,
      color: routeColor(role.id, typeof authoredColor === 'string' ? authoredColor : undefined),
      planned,
      actual: [],
      markers: turnMarkers(planned),
    }];
  }).sort((a, b) => a.actorId.localeCompare(b.actorId));
}

export interface RouteExecutionParity {
  readonly ok: boolean;
  readonly authoredHash: string;
  readonly compiledHash: string;
  readonly mismatches: readonly string[];
}

/**
 * Fail-closed contract between the persisted authoring plan and the concrete
 * simulator input installed by Play. It deliberately covers only map-bound
 * route-bearing geometry; appearance, ambient population and signal-engine
 * choices cannot change this hash.
 */
export function routeExecutionParity(
  template: ScenarioTemplateV2,
  input: Pick<SimScenarioInput, 'actors' | 'interactions'>,
): RouteExecutionParity {
  const routeRoles = template.roles
    .flatMap((role) => role.kind === 'scene_absolute' && role.initialRoute?.lanes.length ? [role] : [])
    .sort((a, b) => a.id.localeCompare(b.id));
  const canonicalAuthoredInteraction = (interaction: Interaction): unknown | null => {
    if (interaction.verb === 'route' && interaction.target.mode === 'lanePath') {
      return { id: interaction.id, verb: 'route', lanes: interaction.target.lanes };
    }
    if (interaction.verb === 'changeLane') {
      const target = interaction.target.mode === 'relative'
        ? { mode: interaction.target.dk > 0 ? 'left' : 'right', count: Math.abs(interaction.target.dk) }
        : interaction.target.mode === 'absolute'
          ? { mode: 'lane' }
          : { mode: 'actorLane', actorId: interaction.target.role };
      return { id: interaction.id, verb: 'changeLane', target };
    }
    if (interaction.verb === 'laneOffset') {
      return { id: interaction.id, verb: 'laneOffset', target: { mode: 'fraction', value: interaction.target.tFrac } };
    }
    return null;
  };
  const authored = routeRoles.map((role) => ({
    id: role.id,
    initialRoute: role.initialRoute!.lanes,
    interactions: template.choreography.interactions
      .filter((interaction) => interaction.actor === role.id)
      .map(canonicalAuthoredInteraction)
      .filter((interaction) => interaction !== null),
  }));
  const canonicalCompiledInteraction = (interaction: SimScenarioInput['interactions'][number]): unknown | null => {
    if (interaction.verb === 'route' && interaction.target.kind === 'lanePath') {
      return { id: interaction.id, verb: 'route', lanes: interaction.target.lanes };
    }
    if (interaction.verb === 'changeLane') {
      const target = interaction.target.mode === 'lane'
        ? { mode: 'lane' }
        : interaction.target.mode === 'actorLane'
          ? { mode: 'actorLane', actorId: interaction.target.actorId }
          : { mode: interaction.target.mode, count: interaction.target.count };
      return { id: interaction.id, verb: 'changeLane', target };
    }
    if (interaction.verb === 'laneOffset') {
      return { id: interaction.id, verb: 'laneOffset', target: interaction.target };
    }
    return null;
  };
  const compiled = routeRoles.map((role) => {
    const actor = input.actors.find((candidate) => candidate.id === role.id);
    return {
      id: role.id,
      initialRoute: actor?.behavior.route.kind === 'lanePath' ? actor.behavior.route.lanes : null,
      interactions: input.interactions
        .filter((interaction) => interaction.actorId === role.id)
        .map(canonicalCompiledInteraction)
        .filter((interaction) => interaction !== null),
    };
  });
  const mismatches = authored.flatMap((plan, index) =>
    contentHash(plan) === contentHash(compiled[index]) ? [] : [plan.id]);
  return {
    ok: mismatches.length === 0,
    authoredHash: contentHash(authored),
    compiledHash: contentHash(compiled),
    mismatches,
  };
}

/**
 * Canonical authoring overlay. While a new document revision is compiling,
 * return no behavioral trajectory. Once complete, both the preview line and
 * Play are driven by the exact same native fixed-step samples.
 */
export function authoringRoutes(
  template: ScenarioTemplateV2,
  index: LaneIndex,
  concrete?: Pick<SimScenarioInput, 'actors' | 'interactions' | 'nearMissCriteria'>,
  trace?: SceneTrace,
): VehicleRouteOverlay[] {
  const traceComplete = Boolean(trace && (trace.ticks.t.at(-1) ?? -Infinity) >= (trace.header?.clipSeconds ?? Infinity) - 1e-9);
  if (!concrete || !trace || !traceComplete) return [];
  const authoredColors = new Map(template.roles.map((role) => [
    role.id,
    typeof role.extensions?.['studio.presentation.bodyColor'] === 'string'
      ? role.extensions['studio.presentation.bodyColor'] as string
      : undefined,
  ]));
  return routesFromSimulation(concrete, index, trace, authoredColors).map((route) => ({
    ...route,
    planned: route.actual,
  }));
}

/** Backwards-compatible name for callers outside the editor shell. */
export const routesForAuthoringPreview = authoringRoutes;

function pushSegment(target: number[], a: RoutePoint, b: RoutePoint, y: number): void {
  target.push(a.x, y, a.z, b.x, y, b.z);
}

/** Converts a polyline into fixed-world-length dashes, independent of source sampling density. */
export function dashedSegments(points: readonly RoutePoint[], dashM = 2.2, gapM = 1.4): number[] {
  const out: number[] = [];
  let phase = 0;
  let drawing = true;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-5) continue;
    let cursor = 0;
    while (cursor < length) {
      const remaining = (drawing ? dashM : gapM) - phase;
      const end = Math.min(length, cursor + remaining);
      if (drawing) pushSegment(out,
        { x: a.x + (b.x - a.x) * cursor / length, z: a.z + (b.z - a.z) * cursor / length },
        { x: a.x + (b.x - a.x) * end / length, z: a.z + (b.z - a.z) * end / length }, 0);
      phase += end - cursor;
      cursor = end;
      if (phase >= (drawing ? dashM : gapM) - 1e-6) { drawing = !drawing; phase = 0; }
    }
  }
  return out;
}

/** Fixed-world-spacing route dots, stable across source sampling density. */
export function dottedPoints(points: readonly RoutePoint[], spacingM = 1.8): RoutePoint[] {
  if (points.length === 0) return [];
  const out: RoutePoint[] = [points[0]!];
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-5) continue;
    let at = spacingM - carried;
    while (at <= length + 1e-6) {
      const t = Math.min(1, at / length);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      at += spacingM;
    }
    carried = (carried + length) % spacingM;
  }
  const last = points.at(-1)!;
  if (Math.hypot(out.at(-1)!.x - last.x, out.at(-1)!.z - last.z) > spacingM * .45) out.push(last);
  return out;
}

function appendArrows(target: number[], points: readonly RoutePoint[], y: number): void {
  let travelled = 0;
  // Put the first arrow close enough to a newly placed actor to be visible
  // when it is framed, then repeat frequently enough to communicate direction.
  let next = 6;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    while (travelled + length >= next && length > 0) {
      const t = (next - travelled) / length;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const ux = (b.x - a.x) / length;
      const uz = (b.z - a.z) / length;
      const tip = { x: x + ux * 1.1, z: z + uz * 1.1 };
      pushSegment(target, tip, { x: x - ux * .65 - uz * .7, z: z - uz * .65 + ux * .7 }, y);
      pushSegment(target, tip, { x: x - ux * .65 + uz * .7, z: z - uz * .65 - ux * .7 }, y);
      next += 16;
    }
    travelled += length;
  }
}

export class VehicleRouteOverlayRenderer {
  readonly group = new Group();
  private objects: Array<LineSegments | Points> = [];

  constructor(private readonly sampleHeight?: RouteHeightSampler) {
    this.group.name = 'vehicle-route-overlays';
    this.group.renderOrder = 20;
  }

  sync(routes: readonly VehicleRouteOverlay[], options: RouteOverlayOptions): void {
    this.clear();
    const visible = routes.filter((route) => !route.ambient || options.showAmbient);
    // One dot batch and one arrow batch for all paths. Selection is encoded in
    // vertex colour so adding actors never adds draw calls.
    const plannedPositions: number[] = [];
    const plannedColors: number[] = [];
    const pedestrianPositions: number[] = [];
    const pedestrianColors: number[] = [];
    const arrowPositions: number[] = [];
    const arrowColors: number[] = [];
    for (const route of visible) {
      const selected = options.selectedActorIds.has(route.actorId);
      const color = new Color(route.invalidReason ? '#ff5568' : route.color).multiplyScalar(selected ? 1 : .45);
      if (route.actorKind === 'pedestrian') {
        const segments = dashedSegments(route.planned, 1.1, .65);
        for (let i = 0; i < segments.length; i += 3) {
          const x = segments[i]!; const z = segments[i + 2]!;
          pedestrianPositions.push(x, (this.sampleHeight?.(x, z) ?? 0) + (selected ? .46 : .34), z);
          pedestrianColors.push(color.r, color.g, color.b);
        }
      } else for (const point of dottedPoints(route.planned)) {
          plannedPositions.push(point.x, (this.sampleHeight?.(point.x, point.z) ?? 0) + (selected ? .38 : .27), point.z);
          plannedColors.push(color.r, color.g, color.b);
        }
      const arrows: number[] = [];
      appendArrows(arrows, route.planned, 0);
      for (let i = 0; i < arrows.length; i += 3) {
        const x = arrows[i]!;
        const z = arrows[i + 2]!;
        arrowPositions.push(x, (this.sampleHeight?.(x, z) ?? 0) + (selected ? .4 : .29), z);
        arrowColors.push(color.r, color.g, color.b);
      }
    }
    if (pedestrianPositions.length) this.addLines(pedestrianPositions, pedestrianColors, .98, 'pedestrian-projected-paths');
    if (plannedPositions.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(Float32Array.from(plannedPositions), 3));
      geometry.setAttribute('color', new BufferAttribute(Float32Array.from(plannedColors), 3));
      geometry.computeBoundingSphere();
      const points = new Points(geometry, new PointsMaterial({ size: .48, vertexColors: true, transparent: true, opacity: .98, depthTest: false, depthWrite: false, sizeAttenuation: true }));
      points.name = 'planned-route-dots';
      points.renderOrder = 21;
      this.group.add(points); this.objects.push(points);
    }
    if (arrowPositions.length) this.addLines(arrowPositions, arrowColors, .98, 'planned-route-arrows');
    if (options.showActual) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const route of visible) {
        const color = new Color(route.color);
        for (let i = 1; i < route.actual.length; i++) {
          const a = route.actual[i - 1]!;
          const b = route.actual[i]!;
          positions.push(
            a.x, (this.sampleHeight?.(a.x, a.z) ?? 0) + .38, a.z,
            b.x, (this.sampleHeight?.(b.x, b.z) ?? 0) + .38, b.z,
          );
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
      if (positions.length) this.addLines(positions, colors, .9);
    }
    const markerPositions: number[] = [];
    const markerColors: number[] = [];
    for (const route of visible) for (const marker of route.markers) {
      markerPositions.push(marker.point.x, (this.sampleHeight?.(marker.point.x, marker.point.z) ?? 0) + .52, marker.point.z);
      const color = marker.kind === 'stop' ? new Color('#ff4d5a') : marker.kind === 'speed-change' ? new Color('#ffd166') : new Color(route.color);
      markerColors.push(color.r, color.g, color.b);
    }
    if (markerPositions.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(Float32Array.from(markerPositions), 3));
      geometry.setAttribute('color', new BufferAttribute(Float32Array.from(markerColors), 3));
      const points = new Points(geometry, new PointsMaterial({ size: .9, vertexColors: true, transparent: true, opacity: 1, depthTest: false, depthWrite: false, sizeAttenuation: true }));
      points.name = 'route-action-markers';
      points.renderOrder = 23;
      points.frustumCulled = true;
      this.group.add(points); this.objects.push(points);
    }
    const triggerPositions: number[] = [];
    const triggerColors: number[] = [];
    for (const route of visible) {
      if (!route.triggerPoint) continue;
      const color = new Color(route.invalidReason ? '#ff5568' : '#ffe08a');
      const radius = Math.max(.5, route.triggerRadiusM ?? .65);
      const steps = Math.max(16, Math.min(64, Math.ceil(radius * 3)));
      for (let i = 0; i < steps; i++) {
        const a = i / steps * Math.PI * 2; const b = (i + 1) / steps * Math.PI * 2;
        for (const angle of [a, b]) {
          const x = route.triggerPoint.x + Math.cos(angle) * radius;
          const z = route.triggerPoint.z + Math.sin(angle) * radius;
          triggerPositions.push(x, (this.sampleHeight?.(x, z) ?? 0) + .32, z);
          triggerColors.push(color.r, color.g, color.b);
        }
      }
    }
    if (triggerPositions.length) this.addLines(triggerPositions, triggerColors, .82, 'pedestrian-trigger-envelopes');
  }

  dispose(): void { this.clear(); this.group.removeFromParent(); }

  private addLines(positions: number[], colors: number[], opacity: number, name = 'route-lines'): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3));
    geometry.computeBoundingSphere();
    const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthTest: false, depthWrite: false }));
    lines.name = name;
    lines.renderOrder = opacity > .9 ? 22 : 21;
    lines.frustumCulled = true;
    this.group.add(lines); this.objects.push(lines);
  }

  private clear(): void {
    for (const object of this.objects) {
      object.removeFromParent(); object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
    this.objects = [];
  }
}
