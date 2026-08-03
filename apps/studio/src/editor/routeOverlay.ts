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
  retargetToLane,
  retargetToNeighbour,
  type Route,
  type RouteSpec,
  type SimActor,
  type SimScenarioInput,
  type SceneTrace,
} from '@uniscenarios/sim-engine';
import type { Interaction, ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { LaneIndex } from './laneIndex';

export type RouteMarkerKind = 'turn-left' | 'turn-right' | 'reroute' | 'lane-change' | 'stop' | 'speed-change';

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

function pointAtProgress(points: readonly RoutePoint[], progress: number): RoutePoint {
  if (points.length === 0) return { x: 0, z: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
    lengths.push(total);
  }
  const target = Math.max(0, Math.min(1, progress)) * total;
  let before = 0;
  for (let i = 1; i < points.length; i++) {
    const after = lengths[i - 1]!;
    if (after >= target) {
      const t = after === before ? 0 : (target - before) / (after - before);
      return { x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t, z: points[i - 1]!.z + (points[i]!.z - points[i - 1]!.z) * t };
    }
    before = after;
  }
  return points.at(-1)!;
}

function authoredActionMarkers(roleId: string, interactions: readonly Interaction[], points: readonly RoutePoint[], clipSeconds: number) {
  return interactions.filter((action) => action.actor === roleId).flatMap((action, ordinal) => {
    if (action.verb !== 'speed' && action.verb !== 'changeLane' && action.verb !== 'route') return [];
    const time = action.trigger.kind === 'at' && typeof action.trigger.t === 'number'
      ? action.trigger.t : (ordinal + 1) / (interactions.length + 1) * clipSeconds;
    let kind: RouteMarkerKind;
    if (action.verb === 'speed') kind = action.target.mode === 'stop' ? 'stop' : 'speed-change';
    else if (action.verb === 'changeLane') kind = 'lane-change';
    else if (action.target.mode === 'lanePath') kind = 'reroute';
    else {
      const text = `${action.label ?? ''} ${JSON.stringify(action.target)}`.toLowerCase();
      kind = text.includes('right') || (action.target.mode === 'acquire' && Number(action.target.pose.laneOffset) < 0)
        ? 'turn-right' : 'turn-left';
    }
    return [{ kind, point: pointAtProgress(points, clipSeconds > 0 ? time / clipSeconds : 0) }];
  });
}

function scenePoint(point: { readonly x: number; readonly y: number }): RoutePoint {
  const x = Object.is(point.x, -0) ? 0 : point.x;
  const rawZ = -point.y;
  return { x, z: Object.is(rawZ, -0) ? 0 : rawZ };
}

function appendRouteSection(
  points: RoutePoint[],
  route: Route,
  fromS: number,
  toS: number,
  lateralM: number,
): void {
  const start = Math.max(0, Math.min(route.lengthM, fromS));
  const end = Math.max(start, Math.min(route.lengthM, toS));
  const add = (s: number) => {
    const point = scenePoint(route.pointWithOffset(s, lateralM));
    const previous = points.at(-1);
    if (!previous || Math.hypot(previous.x - point.x, previous.z - point.z) > 1e-4) points.push(point);
  };
  add(start);
  for (let s = start + 2; s < end; s += 2) add(s);
  add(end);
}

function minimumJerkProgress(progress: number): number {
  const u = Math.max(0, Math.min(1, progress));
  return 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Resolve deterministic trigger times where authoring has enough information.
 * Conditional/arrival triggers deliberately remain unresolved: inventing a
 * firing point would draw a route that playback may never execute. */
function authoredTriggerTimes(interactions: readonly Interaction[]): ReadonlyMap<string, number> {
  const byId = new Map(interactions.map((interaction) => [interaction.id, interaction]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const resolve = (interaction: Interaction): number | null => {
    const cached = memo.get(interaction.id);
    if (cached !== undefined) return cached;
    if (visiting.has(interaction.id)) return null;
    visiting.add(interaction.id);
    let result: number | null = null;
    if (interaction.trigger.kind === 'at') result = numeric(interaction.trigger.t, 0);
    else if (interaction.trigger.kind === 'after') {
      const dependency = byId.get(interaction.trigger.of);
      const dependencyTime = dependency ? resolve(dependency) : null;
      if (dependencyTime !== null) result = dependencyTime + numeric(interaction.trigger.delayS, 0);
    }
    visiting.delete(interaction.id);
    if (result !== null) memo.set(interaction.id, result);
    return result;
  };
  for (const interaction of interactions) resolve(interaction);
  return memo;
}

interface ProjectedRoute {
  readonly points: readonly RoutePoint[];
  readonly rejectedInteractionIds: ReadonlySet<string>;
}

/**
 * Project map-bound authoring actions with the simulator's own route builders
 * and legal-neighbour retargeting. This is intentionally synchronous and only
 * touches one actor's lane graph; timeline dragging therefore does not wait for
 * materialization, simulation, or ambient-traffic regeneration.
 */
function projectAuthoredRoute(
  role: ScenarioTemplateV2['roles'][number],
  roles: readonly ScenarioTemplateV2['roles'][number][],
  interactions: readonly Interaction[],
  index: LaneIndex,
  lanes: readonly string[],
  clipSeconds: number,
): ProjectedRoute {
  const graphDigest = index.stats.xodrSha256 ?? `${index.stats.mapName}:${index.stats.lanes}:${index.stats.segments}`;
  const actorInteractions = interactions.filter((interaction) => interaction.actor === role.id);
  const cacheKey = `${graphDigest}:projection:${contentHash({
    lanes,
    laneRef: role.kind === 'scene_absolute' ? role.laneRef : undefined,
    initialSpeedKph: role.initialSpeedKph,
    clipSeconds,
    interactions: actorInteractions,
  })}`;
  const cached = routeGeometryCache.get(cacheKey);
  if (cached) return { points: cached, rejectedInteractionIds: new Set() };
  const built = buildRoute(index.graph, { kind: 'lanePath', lanes: [...lanes] });
  if (!built.ok || built.route.lengthM <= 0) return { points: [], rejectedInteractionIds: new Set() };
  let route = built.route;
  let routeS = role.kind === 'scene_absolute' && role.laneRef
    ? route.sOfLaneStorage(`${role.laneRef.roadId}:${role.laneRef.section}:${role.laneRef.laneId}`, role.laneRef.s) ?? 0
    : 0;
  let lateralM = 0;
  let time = 0;
  let travelledM = 0;
  let frameK = role.kind === 'lane_offset' ? role.k : 0;
  let speedMps = Math.max(0, numeric(role.initialSpeedKph, 30) / 3.6);
  const points: RoutePoint[] = [];
  const rejected = new Set<string>();
  const triggerTimes = authoredTriggerTimes(interactions);
  const ordered = interactions
    .filter((interaction) => interaction.actor === role.id && triggerTimes.has(interaction.id))
    .map((interaction, ordinal) => ({ interaction, ordinal, time: triggerTimes.get(interaction.id)! }))
    .filter(({ time: triggerTime }) => triggerTime >= 0 && triggerTime <= clipSeconds)
    .sort((a, b) => a.time - b.time || a.ordinal - b.ordinal || a.interaction.id.localeCompare(b.interaction.id));

  appendRouteSection(points, route, routeS, routeS, lateralM);
  for (const { interaction, time: triggerTime } of ordered) {
    const distance = Math.max(0, triggerTime - time) * speedMps;
    travelledM += distance;
    const nextS = Math.min(route.lengthM, routeS + distance);
    appendRouteSection(points, route, routeS, nextS, lateralM);
    routeS = nextS;
    time = triggerTime;

    if (interaction.verb === 'speed') {
      if (interaction.target.mode === 'absolute') speedMps = Math.max(0, numeric(interaction.target.valueKph, speedMps * 3.6) / 3.6);
      else if (interaction.target.mode === 'delta') speedMps = Math.max(0, speedMps + numeric(interaction.target.deltaKph, 0) / 3.6);
      else if (interaction.target.mode === 'factor') speedMps = Math.max(0, speedMps * numeric(interaction.target.factor, 1));
      else if (interaction.target.mode === 'stop') speedMps = 0;
      continue;
    }

    if (interaction.verb === 'route' && interaction.target.mode === 'lanePath') {
      const target = buildRoute(index.graph, { kind: 'lanePath', lanes: [...interaction.target.lanes] });
      if (!target.ok) { rejected.add(interaction.id); continue; }
      const here = route.pointWithOffset(routeS, lateralM);
      const sourceStart = route.poseAt(0).rsl;
      const targetStart = target.route.poseAt(0).rsl;
      // A lanePath authored as a turn choice describes the complete legal
      // branch from the shared approach. Keep that approach in the preview
      // instead of drawing a diagonal from the trigger-time body position.
      if (sourceStart && sourceStart === targetStart) {
        points.length = 0;
        route = target.route;
        routeS = Math.min(route.lengthM, travelledM);
        lateralM = 0;
        appendRouteSection(points, route, 0, routeS, 0);
        continue;
      }
      route = target.route;
      routeS = route.projectPoint(here).s;
      lateralM = route.lateralOffsetAt(routeS, here);
      continue;
    }

    if (interaction.verb === 'laneOffset') {
      const duration = Math.max(.1, numeric(interaction.maneuverDurationS, numeric(interaction.dynamics?.value, 1)));
      const targetOffset = numeric(interaction.target.tFrac, 0) * route.widthAt(routeS);
      const travel = Math.max(.2, speedMps * duration);
      const samples = Math.max(4, Math.ceil(travel / 1.5));
      for (let i = 1; i <= samples; i++) {
        const progress = i / samples;
        const atS = Math.min(route.lengthM, routeS + travel * progress);
        const offset = lateralM + (targetOffset - lateralM) * minimumJerkProgress(progress);
        const point = scenePoint(route.pointWithOffset(atS, offset));
        const previous = points.at(-1);
        if (!previous || Math.hypot(previous.x - point.x, previous.z - point.z) > 1e-4) points.push(point);
      }
      routeS = Math.min(route.lengthM, routeS + travel);
      travelledM += travel;
      lateralM = targetOffset;
      time += duration;
      continue;
    }

    if (interaction.verb !== 'changeLane') continue;
    let retarget: ReturnType<typeof retargetToNeighbour> | ReturnType<typeof retargetToLane> = null;
    if (interaction.target.mode === 'relative' && interaction.target.dk !== 0) {
      let cursorRoute = route;
      let cursorS = routeS;
      let separationM = 0;
      const side = interaction.target.dk > 0 ? 'left' : 'right';
      for (let count = 0; count < Math.abs(interaction.target.dk); count++) {
        const next = retargetToNeighbour(index.graph, cursorRoute, cursorS, side, { legalOnly: true });
        if (!next) { retarget = null; break; }
        cursorRoute = next.route;
        cursorS = next.s;
        separationM += next.separationM;
        retarget = { ...next, route: cursorRoute, s: cursorS, separationM };
      }
    } else if (interaction.target.mode === 'absolute') {
      // Absolute k is site-frame-relative. For map-bound Studio actors, infer
      // the target by walking from the current lane the requested signed count.
      const delta = interaction.target.k - frameK;
      if (delta !== 0) {
        let cursorRoute = route;
        let cursorS = routeS;
        let separationM = 0;
        const side = delta > 0 ? 'left' : 'right';
        for (let count = 0; count < Math.abs(delta); count++) {
          const next = retargetToNeighbour(index.graph, cursorRoute, cursorS, side, { legalOnly: true });
          if (!next) { retarget = null; break; }
          cursorRoute = next.route;
          cursorS = next.s;
          separationM += next.separationM;
          retarget = { ...next, route: cursorRoute, s: cursorS, separationM };
        }
      }
    } else if (interaction.target.mode === 'toRole') {
      const targetRoleId = interaction.target.role;
      const targetRole = roles.find((candidate) => candidate.id === targetRoleId);
      if (targetRole?.kind === 'scene_absolute' && targetRole.laneRef) {
        retarget = retargetToLane(index.graph, route, routeS, `${targetRole.laneRef.roadId}:${targetRole.laneRef.section}:${targetRole.laneRef.laneId}`);
      }
    }
    if (!retarget) { rejected.add(interaction.id); continue; }

    const duration = Math.max(.1, numeric(interaction.maneuverDurationS, numeric(interaction.dynamics?.value, 1)));
    const travel = Math.max(.2, speedMps * duration);
    const samples = Math.max(4, Math.ceil(travel / 1.5));
    for (let i = 1; i <= samples; i++) {
      const progress = i / samples;
      const sourceS = Math.min(route.lengthM, routeS + travel * progress);
      const offset = lateralM + retarget.separationM * minimumJerkProgress(progress);
      const point = scenePoint(route.pointWithOffset(sourceS, offset));
      const previous = points.at(-1);
      if (!previous || Math.hypot(previous.x - point.x, previous.z - point.z) > 1e-4) points.push(point);
    }
    const completed = route.pointWithOffset(Math.min(route.lengthM, routeS + travel), lateralM + retarget.separationM);
    route = retarget.route;
    routeS = route.projectPoint(completed).s;
    lateralM = route.lateralOffsetAt(routeS, completed);
    travelledM += travel;
    if (interaction.target.mode === 'relative') frameK += interaction.target.dk;
    else if (interaction.target.mode === 'absolute') frameK = interaction.target.k;
    time += duration;
  }
  appendRouteSection(points, route, routeS, route.lengthM, lateralM);
  const stable = Object.freeze(points);
  routeGeometryCache.set(cacheKey, stable);
  if (routeGeometryCache.size > ROUTE_CACHE_LIMIT) routeGeometryCache.delete(routeGeometryCache.keys().next().value!);
  return { points: stable, rejectedInteractionIds: rejected };
}

/** Synchronous optimistic projection from the current editor document. */
export function routesFromTemplate(template: ScenarioTemplateV2, index: LaneIndex): VehicleRouteOverlay[] {
  return template.roles.flatMap((role) => {
    if (role.actor.static || role.actor.class === 'pedestrian' || role.actor.class === 'static_object') return [];
    const roleInteractions = template.choreography.interactions.filter((interaction) => interaction.actor === role.id);
    const initialReroute = roleInteractions.find((interaction): interaction is Extract<Interaction, { verb: 'route' }> =>
      interaction.verb === 'route' && interaction.target.mode === 'lanePath');
    const lanes = role.kind === 'scene_absolute' && role.initialRoute?.lanes
      ? role.initialRoute.lanes
      : initialReroute?.target.mode === 'lanePath' ? initialReroute.target.lanes : undefined;
    if (!lanes?.length) return [];
    const geometryInteractions = roleInteractions.filter((interaction) =>
      interaction.verb === 'changeLane' || interaction.verb === 'laneOffset' || interaction.verb === 'route');
    const projected = geometryInteractions.length
      ? projectAuthoredRoute(role, template.roles, template.choreography.interactions, index, lanes, template.choreography.clipSeconds)
      : null;
    const planned = projected?.points ?? resolvedRoutePoints({ kind: 'lanePath', lanes }, index,
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
      markers: [...turnMarkers(planned), ...authoredActionMarkers(role.id, template.choreography.interactions, planned, template.choreography.clipSeconds)],
    }];
  }).sort((a, b) => a.actorId.localeCompare(b.actorId));
}

/** Authored actors are always optimistic; concrete data contributes ambient only. */
export function authoringRoutes(
  template: ScenarioTemplateV2,
  index: LaneIndex,
  concrete?: Pick<SimScenarioInput, 'actors' | 'interactions'>,
  trace?: SceneTrace,
): VehicleRouteOverlay[] {
  const authored = routesFromTemplate(template, index);
  if (!concrete) return authored;
  const ambient = routesFromSimulation(concrete, index, trace).filter((route) => route.ambient);
  return [...authored, ...ambient].sort((a, b) => a.actorId.localeCompare(b.actorId));
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
    const arrowPositions: number[] = [];
    const arrowColors: number[] = [];
    for (const route of visible) {
      const selected = options.selectedActorIds.has(route.actorId);
      const color = new Color(route.color).multiplyScalar(selected ? 1 : .34);
      for (const point of dottedPoints(route.planned)) {
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
