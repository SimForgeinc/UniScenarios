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
import { buildRoute, contentHash, type RouteSpec, type SimActor, type SimScenarioInput, type SceneTrace } from '@uniscenarios/sim-engine';
import type { Interaction, ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { LaneIndex } from './laneIndex';

export type RouteMarkerKind = 'turn-left' | 'turn-right' | 'lane-change' | 'stop' | 'speed-change';

export interface RoutePoint { readonly x: number; readonly z: number }
export interface VehicleRouteOverlay {
  readonly actorId: string;
  readonly ambient: boolean;
  readonly color: string;
  readonly planned: readonly RoutePoint[];
  readonly actual: readonly RoutePoint[];
  readonly markers: readonly { kind: RouteMarkerKind; point: RoutePoint }[];
}

export interface RouteOverlayOptions {
  readonly showAmbient: boolean;
  readonly showActual: boolean;
  readonly selectedActorIds: ReadonlySet<string>;
}

const VEHICLE_KINDS = new Set<SimActor['kind']>(['vehicle', 'car', 'truck', 'bus', 'van', 'motorcycle', 'bicycle', 'scooter']);
const PALETTE = ['#55a7ff', '#ff8a65', '#8bd17c', '#d590ef', '#ffd166', '#54d6c4', '#ef6f9b'];
const ROUTE_CACHE_LIMIT = 256;
const routeGeometryCache = new Map<string, readonly RoutePoint[]>();

/** Stable presentation color when an actor has no authored body color. */
export function routeColor(actorId: string, authored?: string): string {
  if (authored && /^#[0-9a-f]{6}$/i.test(authored)) return authored;
  let hash = 2166136261;
  for (let i = 0; i < actorId.length; i++) hash = Math.imul(hash ^ actorId.charCodeAt(i), 16777619);
  return PALETTE[(hash >>> 0) % PALETTE.length]!;
}

/** Resolve through the same Route implementation used to construct RuntimeWorld actors. */
export function resolvedRoutePoints(spec: RouteSpec, index: LaneIndex): readonly RoutePoint[] {
  const graphDigest = index.stats.xodrSha256 ?? `${index.stats.mapName}:${index.stats.lanes}:${index.stats.segments}`;
  const key = `${graphDigest}:${contentHash(spec)}`;
  const cached = routeGeometryCache.get(key);
  if (cached) return cached;
  const built = buildRoute(index.graph, spec);
  if (!built.ok || built.route.lengthM <= 0) return [];
  const points: RoutePoint[] = [];
  // Two-metre samples retain junction curvature while bounding 32 typical
  // routes to a few thousand vertices. Exact leg boundaries are also sampled.
  const samples = new Set<number>([0, built.route.lengthM]);
  for (let s = 2; s < built.route.lengthM; s += 2) samples.add(s);
  for (const leg of built.route.legs) { samples.add(leg.sStart); samples.add(leg.sStart + leg.lengthM); }
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
  return resolvedRoutePoints(actor.behavior.route, index);
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
  input: Pick<SimScenarioInput, 'actors' | 'interactions'>,
  index: LaneIndex,
  trace?: SceneTrace,
  authoredColors: ReadonlyMap<string, string | undefined> = new Map(),
): VehicleRouteOverlay[] {
  return [...input.actors]
    .filter((actor) => !actor.static && VEHICLE_KINDS.has(actor.kind))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((actor) => {
      const planned = routePoints(actor, index);
      const ambient = actor.id.startsWith('ambient-') || actor.tags.some((tag) => tag === 'ambient' || tag.startsWith('ambient:'));
      return {
        actorId: actor.id,
        ambient,
        color: routeColor(actor.id, authoredColors.get(actor.id)),
        planned,
        actual: actualPoints(actor.id, trace),
        markers: [...turnMarkers(planned), ...actionMarkers(actor.id, input.interactions, trace)],
      };
    })
    .filter((route) => route.planned.length > 1);
}

/** Immediate editor fallback until concrete materialization is available. */
export function routesFromTemplate(template: ScenarioTemplateV2, index: LaneIndex): VehicleRouteOverlay[] {
  const byActor = new Map<string, Interaction>();
  for (const interaction of template.choreography.interactions) {
    if (interaction.verb === 'route' && interaction.target.mode === 'lanePath'
      && interaction.trigger.kind === 'at' && typeof interaction.trigger.t === 'number' && interaction.trigger.t <= 0) byActor.set(interaction.actor, interaction);
  }
  return template.roles.flatMap((role) => {
    if (role.actor.static || role.actor.class === 'pedestrian' || role.actor.class === 'static_object') return [];
    const route = byActor.get(role.id);
    if (!route || route.verb !== 'route' || route.target.mode !== 'lanePath') return [];
    const planned = resolvedRoutePoints({ kind: 'lanePath', lanes: route.target.lanes }, index);
    if (planned.length < 2) return [];
    const authoredColor = role.extensions?.['studio.presentation.bodyColor'];
    return [{ actorId: role.id, ambient: false, color: routeColor(role.id, typeof authoredColor === 'string' ? authoredColor : undefined), planned, actual: [], markers: turnMarkers(planned) }];
  }).sort((a, b) => a.actorId.localeCompare(b.actorId));
}

/**
 * Compose the authoring view without waiting for background materialization.
 * Authored routes always come from the live document; the warmed simulation is
 * used only for its persistent ambient population.
 */
export function routesForAuthoringPreview(
  template: ScenarioTemplateV2,
  index: LaneIndex,
  ambientInput?: Pick<SimScenarioInput, 'actors' | 'interactions'>,
  ambientTrace?: SceneTrace,
): VehicleRouteOverlay[] {
  const authored = routesFromTemplate(template, index);
  const ambient = ambientInput
    ? routesFromSimulation(ambientInput, index, ambientTrace).filter((route) => route.ambient)
    : [];
  return [...authored, ...ambient].sort((a, b) => a.actorId.localeCompare(b.actorId));
}

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

function appendArrows(target: number[], points: readonly RoutePoint[], y: number): void {
  let travelled = 0;
  let next = 15;
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
      next += 22;
    }
    travelled += length;
  }
}

export class VehicleRouteOverlayRenderer {
  readonly group = new Group();
  private objects: Array<LineSegments | Points> = [];

  constructor() { this.group.name = 'vehicle-route-overlays'; this.group.renderOrder = 20; }

  sync(routes: readonly VehicleRouteOverlay[], options: RouteOverlayOptions): void {
    this.clear();
    const visible = routes.filter((route) => !route.ambient || options.showAmbient);
    // One vertex-colored draw call for muted planned paths and one for selected paths.
    for (const selected of [false, true]) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const route of visible) {
        if (options.selectedActorIds.has(route.actorId) !== selected) continue;
        const segments = dashedSegments(route.planned);
        appendArrows(segments, route.planned, 0);
        const color = new Color(route.color).multiplyScalar(selected ? 1 : .62);
        for (let i = 0; i < segments.length; i += 3) {
          positions.push(segments[i]!, .22, segments[i + 2]!);
          colors.push(color.r, color.g, color.b);
        }
      }
      if (positions.length) this.addLines(positions, colors, selected ? .96 : .43);
    }
    if (options.showActual) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const route of visible) {
        const color = new Color(route.color);
        for (let i = 1; i < route.actual.length; i++) {
          pushSegment(positions, route.actual[i - 1]!, route.actual[i]!, .29);
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
      if (positions.length) this.addLines(positions, colors, .9);
    }
    const markerPositions: number[] = [];
    const markerColors: number[] = [];
    for (const route of visible) for (const marker of route.markers) {
      markerPositions.push(marker.point.x, .42, marker.point.z);
      const color = marker.kind === 'stop' ? new Color('#ff4d5a') : marker.kind === 'speed-change' ? new Color('#ffd166') : new Color(route.color);
      markerColors.push(color.r, color.g, color.b);
    }
    if (markerPositions.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(Float32Array.from(markerPositions), 3));
      geometry.setAttribute('color', new BufferAttribute(Float32Array.from(markerColors), 3));
      const points = new Points(geometry, new PointsMaterial({ size: .65, vertexColors: true, transparent: true, opacity: .9, depthWrite: false, sizeAttenuation: true }));
      points.frustumCulled = true;
      this.group.add(points); this.objects.push(points);
    }
  }

  dispose(): void { this.clear(); this.group.removeFromParent(); }

  private addLines(positions: number[], colors: number[], opacity: number): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3));
    geometry.computeBoundingSphere();
    const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }));
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
