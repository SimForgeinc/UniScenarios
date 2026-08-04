import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gunzipSync } from 'node:zlib';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { SimTrace } from '@uniscenarios/sim-engine';

export interface BirdEyeFailure {
  readonly x: number;
  /** OpenDRIVE-local y coordinate. */
  readonly y: number;
  readonly label: string;
}

export interface BirdEyeRenderInput {
  readonly mapId: string;
  readonly scenarioDoc: ScenarioTemplateV2;
  readonly trace?: SimTrace | null;
  readonly failure?: BirdEyeFailure | null;
  readonly iteration: number;
  readonly width?: number;
  readonly height?: number;
}

export interface BirdEyeRenderResult {
  readonly png: Buffer;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly altText: string;
  readonly legend: readonly string[];
  readonly provenance: {
    readonly renderer: 'uniscenarios-deterministic-birds-eye-v1';
    readonly mapId: string;
    readonly iteration: number;
    readonly includesTrace: boolean;
    readonly includesFailure: boolean;
  };
}

interface Point { readonly x: number; readonly y: number }
interface Lane {
  readonly rsl: string;
  readonly roadId: string;
  readonly laneId: number;
  readonly widthM: number;
  readonly points: readonly Point[];
}
interface Feature {
  readonly kind: 'traffic_light' | 'stop_sign' | 'stop_line' | 'crosswalk';
  readonly point: Point;
  readonly headingRad: number;
  readonly widthM: number;
  readonly lengthM: number;
}
interface MapGeometry { readonly lanes: readonly Lane[]; readonly features: readonly Feature[] }

const MAX_SIDE = 1024;
const MIN_SIDE = 256;
const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../dev-assets');
const mapCache = new Map<string, MapGeometry>();

/**
 * Render a bounded, UI-free PNG from canonical map and simulation data.
 * This intentionally does not capture the browser or access unrelated pixels.
 */
export function renderBirdEye(input: BirdEyeRenderInput): BirdEyeRenderResult {
  const width = boundSide(input.width ?? 1024);
  const height = boundSide(input.height ?? 1024);
  const geometry = loadMapGeometry(input.mapId);
  const trajectories = traceTrajectories(input.trace);
  const actorPoints = actorPlacements(input.scenarioDoc);
  const focus = [...actorPoints.map((actor) => actor.point), ...trajectories.flatMap((track) => track.points), ...(input.failure ? [{ x: input.failure.x, y: input.failure.y }] : [])];
  const bounds = focusBounds(focus.length ? focus : geometry.lanes.flatMap((lane) => lane.points), 42);
  const transform = fitTransform(bounds, width, height, 58);
  const raster = new Raster(width, height, [13, 19, 27, 255]);

  for (const lane of geometry.lanes) {
    if (!polylineTouches(lane.points, bounds)) continue;
    const center = lane.points.map(transform);
    const pixelsPerM = transform.scale;
    raster.polyline(center, [50, 61, 71, 255], Math.max(2, Math.round(lane.widthM * pixelsPerM)));
    raster.polyline(center, [121, 132, 143, 255], 1);
    raster.dashedPolyline(center, [207, 207, 191, 255], 1, 9, 8);
    const arrowAt = center[Math.floor(center.length / 2)];
    const arrowNext = center[Math.min(center.length - 1, Math.floor(center.length / 2) + 1)];
    if (arrowAt && arrowNext) raster.arrow(arrowAt, arrowNext, lane.laneId < 0 ? [112, 188, 255, 255] : [88, 150, 210, 255]);
  }

  for (const feature of geometry.features) {
    if (!inside(feature.point, bounds)) continue;
    const p = transform(feature.point);
    if (feature.kind === 'crosswalk') {
      raster.crosswalk(p, feature.headingRad, feature.widthM * transform.scale, feature.lengthM * transform.scale);
    } else if (feature.kind === 'traffic_light') {
      raster.circle(p.x, p.y, 6, [255, 208, 74, 255]);
      raster.circle(p.x, p.y, 2, [32, 35, 39, 255]);
    } else if (feature.kind === 'stop_sign') {
      raster.square(p.x, p.y, 9, [232, 72, 72, 255]);
    } else {
      raster.line({ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }, [255, 255, 255, 255], 2);
    }
  }

  for (const [index, track] of trajectories.entries()) {
    const color = actorColor(index);
    const points = track.points.map(transform);
    raster.polyline(points, color, 3);
    for (const sample of track.seconds) {
      const p = transform(sample.point);
      raster.circle(p.x, p.y, 3, color);
      raster.text(`${sample.t}s`, p.x + 5, p.y - 8, color, 1);
    }
  }

  if (input.trace) {
    const closest = closestApproachMarker(input.trace);
    if (closest) {
      const p = transform(closest.point);
      raster.circle(p.x, p.y, 7, [255, 228, 90, 255]);
      raster.circle(p.x, p.y, 3, [13, 19, 27, 255]);
      raster.text(`${closest.distanceM.toFixed(1)}M ${closest.t.toFixed(1)}S`, p.x + 10, p.y + 5, [255, 228, 90, 255], 1);
    }
    const conflict = input.trace.metrics.minPathTTC?.conflictPoint ?? input.trace.metrics.minPET?.conflictPoint;
    if (conflict) {
      const p = transform(conflict);
      raster.circle(p.x, p.y, 8, [255, 139, 63, 255]);
      raster.text('CONFLICT', p.x + 11, p.y - 6, [255, 166, 91, 255], 1);
    }
    for (const event of input.trace.events.filter((entry) => entry.kind === 'trigger_fired').slice(0, 12)) {
      const track = input.trace.ticks.actors[event.actorId];
      if (!track) continue;
      const index = nearestTimeIndex(input.trace.ticks.t, event.t);
      if (!track.present[index]) continue;
      const p = transform({ x: track.x[index]!, y: track.y[index]! });
      raster.text(`TRIGGER ${event.t.toFixed(1)}S`, p.x + 7, p.y + 14, [255, 255, 255, 255], 1);
    }
  }

  for (const [index, actor] of actorPoints.entries()) {
    const p = transform(actor.point);
    const color = actorColor(index);
    raster.orientedFootprint(p, actor.headingRad, actor.lengthM * transform.scale, actor.widthM * transform.scale, color);
    raster.text(actor.label.toUpperCase().slice(0, 18), p.x + 8, p.y + 8, color, 1);
  }

  if (input.failure) {
    const p = transform(input.failure);
    raster.line({ x: p.x - 10, y: p.y - 10 }, { x: p.x + 10, y: p.y + 10 }, [255, 65, 92, 255], 3);
    raster.line({ x: p.x + 10, y: p.y - 10 }, { x: p.x - 10, y: p.y + 10 }, [255, 65, 92, 255], 3);
    raster.text('FAIL', p.x + 13, p.y - 8, [255, 101, 122, 255], 1);
  }

  raster.text(`MAP ${input.mapId.toUpperCase()}  ITERATION ${input.iteration}`, 18, 18, [230, 236, 242, 255], 2);
  raster.text('BLUE ARROWS: LANE DIRECTION  WHITE: MARKINGS  GOLD: CONTROLS', 18, height - 26, [186, 197, 207, 255], 1);
  const png = encodePng(width, height, raster.pixels);
  const labels = actorPoints.map((actor, index) => `${actor.label} is color ${colorName(index)}`);
  const legend = ['Blue arrows: lane travel direction', 'White lines: lane markings', 'Gold circles: traffic controls', 'Pink stripes: crosswalks', 'Colored rectangles: actor footprints and headings', 'Colored paths with second labels: simulated trajectories', 'Yellow target: closest approach and time', 'Orange target: predicted conflict point', ...(input.failure ? ['Red X: simulation failure location'] : [])];
  const altText = `Bird's-eye scenario grounding for ${input.mapId}, iteration ${input.iteration}. ${labels.join('. ')}. ${trajectories.length ? `${trajectories.length} simulated trajectories include one-second annotations.` : 'No simulation trajectory is available yet.'}${input.failure ? ` Failure: ${sanitizeLabel(input.failure.label)}.` : ''}`;
  return {
    png,
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width,
    height,
    bytes: png.byteLength,
    sha256: createHash('sha256').update(png).digest('hex'),
    altText,
    legend,
    provenance: {
      renderer: 'uniscenarios-deterministic-birds-eye-v1',
      mapId: input.mapId,
      iteration: input.iteration,
      includesTrace: Boolean(input.trace),
      includesFailure: Boolean(input.failure),
    },
  };
}

function boundSide(value: number): number { return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(value))); }
function sanitizeLabel(value: string): string { return value.replace(/[\r\n\t]+/gu, ' ').slice(0, 160); }

function loadMapGeometry(mapId: string): MapGeometry {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  if (!/^[a-z0-9-]{1,80}$/u.test(mapId)) throw new Error('Bird-eye renderer rejected an unsafe map id');
  const mapDir = path.resolve(ASSET_ROOT, mapId);
  if (!mapDir.startsWith(`${ASSET_ROOT}${path.sep}`)) throw new Error('Bird-eye renderer map path escaped the asset root');
  const topologyPath = path.join(mapDir, 'topology-index.json.gz');
  if (!existsSync(topologyPath)) throw new Error(`Bird-eye renderer has no topology asset for map ${mapId}`);
  const topology = JSON.parse(gunzipSync(readFileSync(topologyPath)).toString('utf8')) as {
    lanes?: Record<string, { roadId?: string | number; laneId?: number; representativeWidthM?: number; polyline?: readonly ({ x?: number; y?: number } | readonly number[])[] }>;
  };
  const lanes: Lane[] = [];
  for (const [rsl, raw] of Object.entries(topology.lanes ?? {})) {
    const points = (raw.polyline ?? []).flatMap((entry) => {
      const x = Array.isArray(entry) ? entry[0] : entry.x;
      const y = Array.isArray(entry) ? entry[1] : entry.y;
      return Number.isFinite(x) && Number.isFinite(y) ? [{ x: Number(x), y: Number(y) }] : [];
    });
    if (points.length < 2) continue;
    lanes.push({ rsl, roadId: String(raw.roadId ?? rsl.split(':')[0]), laneId: raw.laneId ?? Number(rsl.split(':')[2] ?? 0), widthM: Math.max(1.2, Math.min(8, raw.representativeWidthM ?? 3.5)), points: simplify(points, 96) });
  }
  const features = loadFeatures(mapDir, lanes);
  const result = { lanes, features };
  mapCache.set(mapId, result);
  return result;
}

function loadFeatures(mapDir: string, lanes: readonly Lane[]): Feature[] {
  const signalsPath = path.join(mapDir, 'signals.geojson.gz');
  if (!existsSync(signalsPath)) return [];
  const geo = JSON.parse(gunzipSync(readFileSync(signalsPath)).toString('utf8')) as {
    features?: readonly { properties?: Record<string, unknown> }[];
  };
  const result: Feature[] = [];
  for (const raw of geo.features ?? []) {
    const props = raw.properties ?? {};
    const featureKind = String(props['feature_kind'] ?? '');
    const category = String(props['signal_category'] ?? '');
    const roadId = String(props['road_id'] ?? '');
    const roadLanes = lanes.filter((lane) => lane.roadId === roadId);
    if (!roadLanes.length) continue;
    const lane = roadLanes.reduce((best, item) => Math.abs(item.laneId) < Math.abs(best.laneId) ? item : best);
    const pose = pointAt(lane.points, Number(props['s'] ?? 0));
    const t = Number(props['t'] ?? 0);
    const point = { x: pose.point.x - Math.sin(pose.headingRad) * t, y: pose.point.y + Math.cos(pose.headingRad) * t };
    if (featureKind === 'crosswalk') result.push({ kind: 'crosswalk', point, headingRad: Number(props['hdg'] ?? pose.headingRad), widthM: Number(props['width'] ?? 3), lengthM: Math.min(30, Number(props['length'] ?? 8)) });
    else if (category === 'traffic_light' || category === 'stop_sign' || category === 'stop_line') result.push({ kind: category, point, headingRad: pose.headingRad, widthM: 1, lengthM: 1 });
  }
  return result;
}

function pointAt(points: readonly Point[], distance: number): { point: Point; headingRad: number } {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!; const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length || i === points.length - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0;
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, headingRad: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    remaining -= length;
  }
  return { point: points[0] ?? { x: 0, y: 0 }, headingRad: 0 };
}

function simplify(points: readonly Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints) return [...points];
  const out: Point[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.round((i / (maxPoints - 1)) * (points.length - 1))]!);
  return out;
}

function actorPlacements(doc: ScenarioTemplateV2): { label: string; point: Point; headingRad: number; lengthM: number; widthM: number }[] {
  return doc.roles.flatMap((role) => {
    if (role.kind !== 'scene_absolute') return [];
    const actor = role as typeof role & { pose: { x: number; z: number; headingRad: number } };
    const pedestrian = role.actor.class === 'pedestrian';
    const motorcycle = role.actor.class === 'motorcycle' || role.actor.class === 'bicycle';
    return [{ label: role.label || role.id, point: { x: actor.pose.x, y: -actor.pose.z }, headingRad: -actor.pose.headingRad, lengthM: pedestrian ? 0.8 : motorcycle ? 2.2 : 4.7, widthM: pedestrian ? 0.8 : motorcycle ? 0.9 : 1.9 }];
  });
}

function traceTrajectories(trace?: SimTrace | null): { id: string; points: Point[]; seconds: { t: number; point: Point }[] }[] {
  if (!trace) return [];
  const out: { id: string; points: Point[]; seconds: { t: number; point: Point }[] }[] = [];
  for (const [id, actor] of Object.entries(trace.ticks.actors)) {
    const points: Point[] = [];
    const seconds: { t: number; point: Point }[] = [];
    let previousSecond = -1;
    const stride = Math.max(1, Math.floor(trace.ticks.t.length / 240));
    for (let i = 0; i < trace.ticks.t.length; i += stride) {
      if (!actor.present[i]) continue;
      const point = { x: actor.x[i]!, y: actor.y[i]! };
      points.push(point);
      const second = Math.round(trace.ticks.t[i]!);
      if (second !== previousSecond && Math.abs(trace.ticks.t[i]! - second) < 0.08) { seconds.push({ t: second, point }); previousSecond = second; }
    }
    if (points.length) out.push({ id, points, seconds });
  }
  return out;
}

function closestApproachMarker(trace: SimTrace): { point: Point; distanceM: number; t: number } | null {
  const closest = [...trace.metrics.minDistance].sort((a, b) => a.minDistanceM - b.minDistanceM)[0];
  if (!closest) return null;
  const a = trace.ticks.actors[closest.pair[0]]; const b = trace.ticks.actors[closest.pair[1]];
  if (!a || !b) return null;
  const index = nearestTimeIndex(trace.ticks.t, closest.t);
  return { point: { x: (a.x[index]! + b.x[index]!) / 2, y: (a.y[index]! + b.y[index]!) / 2 }, distanceM: closest.minDistanceM, t: closest.t };
}
function nearestTimeIndex(times: readonly number[], target: number): number {
  let best = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - target) < Math.abs(times[best]! - target)) best = i;
  return best;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
function focusBounds(points: readonly Point[], padding: number): Bounds {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  if (!Number.isFinite(minX)) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}
function fitTransform(bounds: Bounds, width: number, height: number, margin: number) {
  const scale = Math.min((width - margin * 2) / Math.max(1, bounds.maxX - bounds.minX), (height - margin * 2) / Math.max(1, bounds.maxY - bounds.minY));
  const usedW = (bounds.maxX - bounds.minX) * scale; const usedH = (bounds.maxY - bounds.minY) * scale;
  const ox = (width - usedW) / 2 - bounds.minX * scale; const oy = (height - usedH) / 2 + bounds.maxY * scale;
  const transform = ((point: Point) => ({ x: Math.round(ox + point.x * scale), y: Math.round(oy - point.y * scale) })) as ((point: Point) => Point) & { scale: number };
  transform.scale = scale;
  return transform;
}
function inside(point: Point, bounds: Bounds): boolean { return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY; }
function polylineTouches(points: readonly Point[], bounds: Bounds): boolean { return points.some((point) => inside(point, bounds)); }

const COLORS = [[80, 207, 255, 255], [255, 172, 64, 255], [118, 236, 155, 255], [211, 129, 255, 255], [255, 107, 144, 255]] as const;
function actorColor(index: number): readonly [number, number, number, number] { return COLORS[index % COLORS.length]!; }
function colorName(index: number): string { return ['cyan', 'orange', 'green', 'purple', 'pink'][index % 5]!; }

class Raster {
  readonly pixels: Uint8Array;
  constructor(readonly width: number, readonly height: number, background: readonly number[]) {
    this.pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < this.pixels.length; i += 4) { this.pixels[i] = background[0]!; this.pixels[i + 1] = background[1]!; this.pixels[i + 2] = background[2]!; this.pixels[i + 3] = background[3]!; }
  }
  pixel(x: number, y: number, color: readonly number[]): void {
    x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4; this.pixels[i] = color[0]!; this.pixels[i + 1] = color[1]!; this.pixels[i + 2] = color[2]!; this.pixels[i + 3] = color[3] ?? 255;
  }
  circle(cx: number, cy: number, radius: number, color: readonly number[]): void { for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) if (x * x + y * y <= radius * radius) this.pixel(cx + x, cy + y, color); }
  square(cx: number, cy: number, size: number, color: readonly number[]): void { for (let y = -size / 2; y <= size / 2; y++) for (let x = -size / 2; x <= size / 2; x++) this.pixel(cx + x, cy + y, color); }
  line(a: Point, b: Point, color: readonly number[], width = 1): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= steps; i++) { const t = i / steps; this.circle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, Math.max(0, Math.floor(width / 2)), color); }
  }
  polyline(points: readonly Point[], color: readonly number[], width = 1): void { for (let i = 1; i < points.length; i++) this.line(points[i - 1]!, points[i]!, color, width); }
  dashedPolyline(points: readonly Point[], color: readonly number[], width: number, dash: number, gap: number): void {
    let phase = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!; const b = points[i]!; const length = Math.hypot(b.x - a.x, b.y - a.y); const steps = Math.max(1, Math.ceil(length));
      for (let j = 0; j <= steps; j++) { if ((phase + j) % (dash + gap) < dash) this.circle(a.x + (b.x - a.x) * j / steps, a.y + (b.y - a.y) * j / steps, Math.floor(width / 2), color); }
      phase = (phase + steps) % (dash + gap);
    }
  }
  arrow(a: Point, b: Point, color: readonly number[]): void {
    const angle = Math.atan2(b.y - a.y, b.x - a.x); const length = 15;
    const tip = { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
    this.line(a, tip, color, 2);
    this.line(tip, { x: tip.x - Math.cos(angle - 0.55) * 7, y: tip.y - Math.sin(angle - 0.55) * 7 }, color, 2);
    this.line(tip, { x: tip.x - Math.cos(angle + 0.55) * 7, y: tip.y - Math.sin(angle + 0.55) * 7 }, color, 2);
  }
  orientedFootprint(center: Point, heading: number, length: number, width: number, color: readonly number[]): void {
    const l = Math.max(8, Math.min(40, length)); const w = Math.max(6, Math.min(20, width));
    const corners = [[l / 2, w / 2], [l / 2, -w / 2], [-l / 2, -w / 2], [-l / 2, w / 2]].map(([x, y]) => ({ x: center.x + x! * Math.cos(heading) - y! * Math.sin(heading), y: center.y + x! * Math.sin(heading) + y! * Math.cos(heading) }));
    for (let i = 0; i < corners.length; i++) this.line(corners[i]!, corners[(i + 1) % corners.length]!, color, 2);
    this.arrow(center, { x: center.x + Math.cos(heading) * l / 2, y: center.y + Math.sin(heading) * l / 2 }, color);
  }
  crosswalk(center: Point, heading: number, width: number, length: number): void {
    const stripeCount = Math.max(3, Math.min(9, Math.round(length / 5)));
    for (let i = 0; i < stripeCount; i++) { const along = ((i / Math.max(1, stripeCount - 1)) - .5) * Math.min(55, length); const cx = center.x + Math.cos(heading) * along; const cy = center.y + Math.sin(heading) * along; const nx = -Math.sin(heading) * Math.min(25, width) / 2; const ny = Math.cos(heading) * Math.min(25, width) / 2; this.line({ x: cx - nx, y: cy - ny }, { x: cx + nx, y: cy + ny }, [242, 151, 202, 255], 3); }
  }
  text(value: string, x: number, y: number, color: readonly number[], scale: number): void {
    let cursor = Math.round(x);
    for (const char of value) { const glyph = FONT[char] ?? FONT['?']!; for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if ((glyph[row]! >> (4 - col)) & 1) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.pixel(cursor + col * scale + sx, y + row * scale + sy, color); cursor += 6 * scale; }
  }
}

const FONT: Record<string, readonly number[]> = {
  ' ': [0,0,0,0,0,0,0], '?':[14,17,1,2,4,0,4], '-':[0,0,0,31,0,0,0], ':':[0,4,0,0,4,0,0], '.':[0,0,0,0,0,4,4],
  A:[14,17,17,31,17,17,17], B:[30,17,17,30,17,17,30], C:[14,17,16,16,16,17,14], D:[30,17,17,17,17,17,30], E:[31,16,16,30,16,16,31], F:[31,16,16,30,16,16,16], G:[14,17,16,23,17,17,15], H:[17,17,17,31,17,17,17], I:[14,4,4,4,4,4,14], J:[7,2,2,2,18,18,12], K:[17,18,20,24,20,18,17], L:[16,16,16,16,16,16,31], M:[17,27,21,21,17,17,17], N:[17,25,21,19,17,17,17], O:[14,17,17,17,17,17,14], P:[30,17,17,30,16,16,16], Q:[14,17,17,17,21,18,13], R:[30,17,17,30,20,18,17], S:[15,16,16,14,1,1,30], T:[31,4,4,4,4,4,4], U:[17,17,17,17,17,17,14], V:[17,17,17,17,17,10,4], W:[17,17,17,21,21,21,10], X:[17,17,10,4,10,17,17], Y:[17,17,10,4,4,4,4], Z:[31,1,2,4,8,16,31],
  '0':[14,17,19,21,25,17,14], '1':[4,12,4,4,4,4,14], '2':[14,17,1,2,4,8,31], '3':[30,1,1,14,1,1,30], '4':[2,6,10,18,31,2,2], '5':[31,16,16,30,1,1,30], '6':[14,16,16,30,17,17,14], '7':[31,1,2,4,8,8,8], '8':[14,17,17,14,17,17,14], '9':[14,17,17,15,1,1,14],
};

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { const row = y * (width * 4 + 1); scanlines[row] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(scanlines, row + 1); }
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(scanlines, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
function pngChunk(type: string, data: Buffer): Buffer { const name = Buffer.from(type, 'ascii'); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
function crc32(data: Buffer): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
