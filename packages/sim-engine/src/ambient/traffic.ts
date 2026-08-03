import { z } from 'zod';

import { contentHash } from '../core/hash.js';
import { Rng } from '../core/rng.js';
import { toSceneXZ } from '../frames.js';
import type { DirectedLane, LaneGraph } from '../map/lane-graph.js';
import { buildRoute } from '../map/route.js';
import { runSimulation } from '../sim/engine.js';
import { phaseForbidsEntry, SignalBook } from '../sim/signals.js';
import { DEFAULT_MAX_DECEL_MPS2 } from '../trace/evaluate.js';
import {
  actorSchema,
  normalizeSimScenarioInput,
  type ActorKind,
  type SimActor,
  type SimScenarioInput,
} from '../schema/input.js';

/** Versioned, browser-safe configuration for generated background road users. */
export const ambientTrafficProfileSchema = z.object({
  version: z.literal(1).default(1),
  preset: z.enum(['off', 'light', 'moderate', 'city', 'heavy', 'custom']).default('off'),
  /** Target moving road users per kilometre of eligible lane near the scenario. */
  densityVehiclesPerKm: z.number().finite().min(0).max(80).optional(),
  flows: z.object({
    through: z.number().finite().min(0).default(0.7),
    left: z.number().finite().min(0).default(0.12),
    right: z.number().finite().min(0).default(0.16),
    uTurn: z.number().finite().min(0).default(0.02),
  }).default({ through: 0.7, left: 0.12, right: 0.16, uTurn: 0.02 }),
  vehicleMix: z.object({
    car: z.number().finite().min(0).default(0.72),
    van: z.number().finite().min(0).default(0.1),
    truck: z.number().finite().min(0).default(0.08),
    bus: z.number().finite().min(0).default(0.04),
    motorcycle: z.number().finite().min(0).default(0.06),
  }).default({ car: 0.72, van: 0.1, truck: 0.08, bus: 0.04, motorcycle: 0.06 }),
  pedestrianShare: z.number().finite().min(0).max(1).default(0),
  cyclistShare: z.number().finite().min(0).max(1).default(0.04),
  aggressiveness: z.number().finite().min(0).max(1).default(0.35),
  speedVariance: z.number().finite().min(0).max(0.8).default(0.12),
  seed: z.union([z.string().min(1), z.number().int()]).default('ambient'),
  maxActors: z.number().int().min(0).max(128).default(40),
  /** Generation is local to the authored choreography, not the whole city. */
  radiusM: z.number().finite().min(25).max(2000).default(250),
  /** Empty road around authored starts and explicit reservations. */
  exclusionRadiusM: z.number().finite().min(2).max(100).default(12),
}).refine((profile) => profile.pedestrianShare + profile.cyclistShare <= 1, {
  path: ['cyclistShare'],
  message: 'pedestrianShare + cyclistShare must not exceed 1',
});

export type AmbientTrafficProfile = z.input<typeof ambientTrafficProfileSchema>;
export type ResolvedAmbientTrafficProfile = z.output<typeof ambientTrafficProfileSchema> & {
  densityVehiclesPerKm: number;
};

export interface AmbientReservation {
  readonly x: number;
  readonly z: number;
  readonly radiusM: number;
  readonly reason?: string;
}

export interface AmbientTrafficOptions {
  readonly reservations?: readonly AmbientReservation[];
  /**
   * Exact evaluator deceleration ceiling. When omitted, generation uses the
   * same scenario-friction policy as `evaluateTrace`: `0.8g * frictionScale`.
   */
  readonly maxAchievableDecelMps2?: number;
}

export interface AmbientScreeningReason {
  readonly actorId: string;
  readonly reason: 'collision' | 'required_decel';
  readonly detail?: string;
  readonly requiredDecelMps2?: number;
  readonly maxAchievableDecelMps2?: number;
}

export interface AmbientActorProvenance {
  readonly id: string;
  readonly kind: ActorKind;
  readonly routeLaneRsls: readonly string[];
  readonly seedKey: string;
}

export interface AmbientTrafficProvenance {
  readonly version: 1;
  readonly profile: ResolvedAmbientTrafficProfile;
  readonly profileHash: string;
  readonly baseInputHash: string;
  readonly generatedInputHash: string;
  readonly actors: readonly AmbientActorProvenance[];
  readonly rejectedSpawnCount: number;
  readonly eligibleLaneKm: number;
  /** Ambient actors removed by deterministic full-clip feasibility screening. */
  readonly screening: {
    readonly evaluated: boolean;
    readonly passes: number;
    readonly maxAchievableDecelMps2: number | null;
    readonly count: number;
    readonly actorIds: readonly string[];
    readonly reasons: readonly AmbientScreeningReason[];
  };
  readonly warnings: readonly string[];
}

export interface AmbientTrafficResult {
  readonly input: SimScenarioInput;
  readonly provenance: AmbientTrafficProvenance;
}

const PRESET_DENSITY: Record<ResolvedAmbientTrafficProfile['preset'], number> = {
  off: 0,
  light: 3,
  moderate: 8,
  city: 8,
  heavy: 16,
  custom: 8,
};

/**
 * The City preset is deliberately car-heavy while still making sidewalks feel
 * inhabited. These are applied only when a field was not explicitly authored,
 * so a stored City profile remains a stable, editable scenario setting.
 */
const CITY_PRESET_DEFAULTS = {
  pedestrianShare: 0.06,
  cyclistShare: 0.02,
  aggressiveness: 0.25,
  speedVariance: 0.1,
  maxActors: 32,
  radiusM: 275,
  exclusionRadiusM: 16,
} as const;

/** Resolve defaults once so hashes and worker messages have one canonical shape. */
export function resolveAmbientTrafficProfile(profile: AmbientTrafficProfile): ResolvedAmbientTrafficProfile {
  const withPresetDefaults = profile.preset === 'city'
    ? { ...CITY_PRESET_DEFAULTS, ...profile }
    : profile;
  const parsed = ambientTrafficProfileSchema.parse(withPresetDefaults);
  return {
    ...parsed,
    densityVehiclesPerKm: parsed.densityVehiclesPerKm ?? PRESET_DENSITY[parsed.preset],
  };
}

/**
 * Deterministically add ambient actors to a concrete scenario. The authored
 * input is never mutated, and remains the authority for interactions/metrics.
 */
export function applyAmbientTraffic(
  base: SimScenarioInput,
  graph: LaneGraph,
  rawProfile: AmbientTrafficProfile,
  options: AmbientTrafficOptions = {},
): AmbientTrafficResult {
  const profile = resolveAmbientTrafficProfile(rawProfile);
  const baseInputHash = contentHash(base);
  const profileHash = contentHash(profile);
  const empty = (warnings: string[] = []): AmbientTrafficResult => ({
    input: base,
    provenance: {
      version: 1,
      profile,
      profileHash,
      baseInputHash,
      generatedInputHash: baseInputHash,
      actors: [],
      rejectedSpawnCount: 0,
      eligibleLaneKm: 0,
      screening: {
        evaluated: false,
        passes: 0,
        maxAchievableDecelMps2: null,
        count: 0,
        actorIds: [],
        reasons: [],
      },
      warnings,
    },
  });
  if (profile.preset === 'off' || profile.densityVehiclesPerKm === 0 || profile.maxActors === 0) {
    return empty();
  }

  const rng = new Rng(`${String(profile.seed)}|${baseInputHash}|ambient-v1`);
  const focus = base.actors.filter((actor) => !actor.static).map((actor) => ({
    x: actor.initial.pose.x,
    z: actor.initial.pose.z,
  }));
  const allFocus = focus.length > 0 ? focus : base.actors.map((actor) => actor.initial.pose);
  const reservations: AmbientReservation[] = [
    ...base.actors.map((actor) => ({
      x: actor.initial.pose.x,
      z: actor.initial.pose.z,
      radiusM: profile.exclusionRadiusM + Math.hypot(actor.dims.l, actor.dims.w) * 0.5,
      reason: `authored:${actor.id}`,
    })),
    ...base.props
      .filter((prop) => prop.collidable && prop.attachment === undefined)
      .map((prop) => ({
        x: prop.pose.x,
        z: prop.pose.z,
        radiusM: profile.exclusionRadiusM
          + Math.hypot(prop.dims.l * prop.scale, prop.dims.w * prop.scale) * 0.5,
        reason: `authored-prop:${prop.groupId ?? prop.id}`,
      })),
    ...(options.reservations ?? []),
  ];

  const roadLanes = eligibleDirectedLanes(graph, ['driving'], allFocus, profile.radiusM);
  const walkingLanes = eligibleDirectedLanes(graph, ['sidewalk', 'walking'], allFocus, profile.radiusM);
  const eligibleLaneKm = roadLanes.reduce((sum, lane) => sum + graph.lengthOf(lane.rsl), 0) / 1000;
  const target = Math.min(profile.maxActors, Math.round(eligibleLaneKm * profile.densityVehiclesPerKm));
  if (target === 0) return empty(['No eligible drivable lane length was available near the authored scenario.']);

  const actors: SimActor[] = [];
  const actorProvenance: AmbientActorProvenance[] = [];
  const occupied = [...reservations];
  const warnings: string[] = [];
  let rejectedSpawnCount = 0;
  let pedestrianMisses = 0;
  const queueSeeds = buildQueueSeeds(base, graph, roadLanes, target);

  // A finite attempt budget makes generation time independent of map size and
  // prevents dense profiles from hanging on a fully reserved site.
  const attemptLimit = Math.max(40, target * 24);
  for (let attempt = 0; attempt < attemptLimit && actors.length < target; attempt++) {
    const actorRng = rng.fork(`actor:${attempt}`);
    const queueSeed = queueSeeds[attempt] ?? null;
    const requestedKind = queueSeed ? chooseVehicleKind(profile, actorRng) : chooseRoadUserKind(profile, actorRng);
    const wantsWalkingLane = requestedKind === 'pedestrian';
    const lanes = wantsWalkingLane ? walkingLanes : roadLanes;
    if (lanes.length === 0) {
      if (wantsWalkingLane) pedestrianMisses++;
      rejectedSpawnCount++;
      continue;
    }
    const lane = queueSeed?.lane ?? lanes[Math.floor(actorRng.next() * lanes.length)]!;
    const geom = graph.requireGeometry(lane.rsl);
    const margin = Math.min(8, geom.lengthM * 0.2);
    const routeS = queueSeed?.routeS
      ?? actorRng.range(margin, Math.max(margin + 0.01, geom.lengthM - margin));
    const pose = graph.sampleDirected(lane, routeS);
    const scene = toSceneXZ(pose.point);
    const footprint = requestedKind === 'bus' || requestedKind === 'truck' ? 7 : requestedKind === 'pedestrian' ? 1.2 : 3.5;
    if (occupied.some((area) => Math.hypot(scene.x - area.x, scene.z - area.z) < area.radiusM + footprint)) {
      rejectedSpawnCount++;
      continue;
    }
    const laneSpeed = requestedKind === 'pedestrian'
      ? 1.35
      : requestedKind === 'bicycle'
        ? 5.5
        : geom.speedLimitMps;
    const factor = Math.max(0.35, 1 + actorRng.range(-profile.speedVariance, profile.speedVariance));
    const cruise = laneSpeed * factor;
    // A queue generated at a red physical head is already settled at t=0.
    // Its ordinary cruise target remains intact, so it releases smoothly when
    // that same deterministic controller turns green.
    const speed = queueSeed ? 0 : cruise;
    // Ambient actors exist during warm-up as well as the recorded clip. Build
    // enough route from the actual spawn (rather than from the lane entrance),
    // otherwise a perfectly valid preview can fail the simulator's runway
    // guard as soon as a scenario has non-zero warm-up.
    const requiredDownstreamM = cruise * (base.warmupSeconds + base.clipSeconds) * 1.1;
    const routeLaneRsls = walkRoute(
      graph,
      lane,
      profile,
      actorRng,
      routeS,
      requiredDownstreamM,
      queueSeed?.connectingLaneRsl,
    );
    if (routeLaneRsls.length === 0) {
      rejectedSpawnCount++;
      continue;
    }
    const storageS = lane.reversed ? geom.lengthM - routeS : routeS;
    const builtRoute = buildRoute(graph, { kind: 'lanePath', lanes: routeLaneRsls });
    const startOnRoute = builtRoute.ok ? builtRoute.route.sOfLaneStorage(lane.rsl, storageS) : null;
    if (!builtRoute.ok || startOnRoute === null || builtRoute.route.lengthM - startOnRoute < requiredDownstreamM) {
      rejectedSpawnCount++;
      continue;
    }
    const seedKey = contentHash({ profileHash, attempt, lane: lane.rsl, storageS }).slice(0, 16);
    const id = `ambient:v1:${seedKey}:${String(actors.length).padStart(3, '0')}`;
    const actor = {
      id,
      kind: requestedKind,
      initial: {
        laneRef: { rsl: lane.rsl, s: storageS, tFrac: 0 },
        pose: { x: scene.x, z: scene.z, headingRad: pose.headingRad },
        speedMps: speed,
      },
      behavior: {
        rules: {
          obeySignals: true,
          yield: true,
          yieldToVehicles: true,
          yieldToPedestrians: true,
          collisionAvoidance: true,
          aggression: profile.aggressiveness,
          speedFactor: factor,
        },
        route: { kind: 'lanePath' as const, lanes: routeLaneRsls },
        cruiseSpeedMps: cruise,
      },
      presentAtStart: true,
      static: false,
      tags: [
        'ambient',
        'ambient:v1',
        ...(queueSeed ? [`ambient:signal-queue:${queueSeed.controlId}`] : []),
        `ambient-profile:${profileHash.slice(0, 16)}`,
        `ambient-seed:${seedKey}`,
      ],
    } satisfies Parameters<typeof normalizeActor>[0];
    const normalized = normalizeActor(actor);
    actors.push(normalized);
    actorProvenance.push({ id, kind: normalized.kind, routeLaneRsls, seedKey });
    occupied.push({ x: scene.x, z: scene.z, radiusM: footprint + 4, reason: id });
  }

  if (pedestrianMisses > 0 && walkingLanes.length === 0) {
    warnings.push('Pedestrian share requested, but this map exposes no sidewalk/walking lanes; no pedestrians were placed on vehicle lanes.');
  }
  if (actors.length < target) {
    warnings.push(`Placed ${actors.length}/${target} ambient actors; reservations and route feasibility rejected the remainder.`);
  }

  const maxAchievableDecelMps2 = options.maxAchievableDecelMps2
    ?? DEFAULT_MAX_DECEL_MPS2 * base.operationalConditions.effects.frictionScale;
  const screened = removeUnsafeAmbientActors(base, actors, graph, maxAchievableDecelMps2);
  if (screened.reasons.length > 0) {
    rejectedSpawnCount += screened.reasons.length;
    const collisionCount = screened.reasons.filter((reason) => reason.reason === 'collision').length;
    const decelCount = screened.reasons.filter((reason) => reason.reason === 'required_decel').length;
    warnings.push(
      `Removed ${screened.reasons.length} ambient actor(s) during full-clip safety screening (${collisionCount} collision, ${decelCount} required-deceleration).`,
    );
  }
  const survivingIds = new Set(screened.actors.map((actor) => actor.id));
  const survivingProvenance = actorProvenance.filter((actor) => survivingIds.has(actor.id));
  const input = normalizeSimScenarioInput({ ...base, actors: [...base.actors, ...screened.actors] });
  return {
    input,
    provenance: {
      version: 1,
      profile,
      profileHash,
      baseInputHash,
      generatedInputHash: contentHash(input),
      actors: survivingProvenance,
      rejectedSpawnCount,
      eligibleLaneKm,
      screening: {
        evaluated: true,
        passes: screened.passes,
        maxAchievableDecelMps2,
        count: screened.reasons.length,
        actorIds: screened.reasons.map((reason) => reason.actorId),
        reasons: screened.reasons,
      },
      warnings,
    },
  };
}

/**
 * Geometry-only spawn checks cannot prove safety over an authored clip: actors
 * accelerate, stop, change lane and cross junctions, while attached props move
 * with their owners. Run the same deterministic engine that will execute the
 * scenario and fail closed by pruning every generated participant in a
 * collision. Repeating reaches a stable set because removing one actor can
 * expose a later conflict that was previously hidden by car-following.
 */
function removeUnsafeAmbientActors(
  base: SimScenarioInput,
  generated: readonly SimActor[],
  graph: LaneGraph,
  maxAchievableDecelMps2: number,
): { actors: SimActor[]; reasons: AmbientScreeningReason[]; passes: number } {
  let actors = [...generated];
  const reasons: AmbientScreeningReason[] = [];
  let passes = 0;
  while (actors.length > 0) {
    passes++;
    const ambientIds = new Set(actors.map((actor) => actor.id));
    const input = normalizeSimScenarioInput({ ...base, actors: [...base.actors, ...actors] });
    const trace = runSimulation(input, { graph, guards: 'collect' }).trace;
    const unsafe = new Map<string, AmbientScreeningReason>();
    for (const collision of trace.metrics.collisions) {
      if (ambientIds.has(collision.a)) {
        unsafe.set(collision.a, {
          actorId: collision.a,
          reason: 'collision',
          detail: `collision with ${collision.b}`,
        });
      }
      if (ambientIds.has(collision.b)) {
        unsafe.set(collision.b, {
          actorId: collision.b,
          reason: 'collision',
          detail: `collision with ${collision.a}`,
        });
      }
    }
    for (const actorId of [...ambientIds].sort()) {
      if (unsafe.has(actorId)) continue;
      const requiredDecelMps2 = trace.metrics.requiredDecelMax[actorId] ?? 0;
      if (requiredDecelMps2 > maxAchievableDecelMps2) {
        unsafe.set(actorId, {
          actorId,
          reason: 'required_decel',
          requiredDecelMps2,
          maxAchievableDecelMps2,
          detail: `${requiredDecelMps2.toFixed(3)} m/s² exceeds ${maxAchievableDecelMps2.toFixed(3)} m/s²`,
        });
      }
    }
    if (unsafe.size === 0) break;
    const orderedUnsafe = [...unsafe.values()].sort((a, b) => a.actorId.localeCompare(b.actorId));
    reasons.push(...orderedUnsafe);
    actors = actors.filter((actor) => !unsafe.has(actor.id));
  }
  return { actors, reasons, passes };
}

/** Remove ambient provenance so an editor can adopt the actor as authored. */
export function promoteAmbientActor(actor: SimActor, authoredId: string): SimActor {
  if (!actor.tags.includes('ambient')) throw new Error(`${actor.id} is not an ambient actor`);
  return {
    ...actor,
    id: authoredId,
    tags: actor.tags.filter((tag) => tag !== 'ambient' && !tag.startsWith('ambient:') && !tag.startsWith('ambient-')),
  };
}

function normalizeActor(actor: z.input<typeof actorSchema>): SimActor {
  return actorSchema.parse(actor);
}

function eligibleDirectedLanes(
  graph: LaneGraph,
  laneTypes: readonly string[],
  focus: readonly { x: number; z: number }[],
  radiusM: number,
): DirectedLane[] {
  const out: DirectedLane[] = [];
  for (const rsl of graph.laneRsls()) {
    const geom = graph.requireGeometry(rsl);
    if (geom.lane.isJunction || !laneTypes.includes(geom.lane.laneType)) continue;
    const reversed = graph.nominalReversed(rsl);
    if (reversed === null) continue;
    if (focus.length > 0) {
      let nearby = false;
      for (const point of focus) {
        const local = { x: point.x, y: -point.z };
        const projection = graph.projectOnto(rsl, local);
        if (projection && projection.d <= radiusM) { nearby = true; break; }
      }
      if (!nearby) continue;
    }
    out.push({ rsl, reversed });
  }
  return out.sort((a, b) => a.rsl.localeCompare(b.rsl));
}

interface AmbientQueueSeed {
  readonly lane: DirectedLane;
  /** Arc length in the lane's travel direction. */
  readonly routeS: number;
  readonly connectingLaneRsl: string | undefined;
  readonly controlId: string;
}

/** Create a compact, deterministic standing queue at physical controls that
 * forbid entry at t=0. This makes a signalized city read like traffic rather
 * than a uniform scatter while keeping every queue attached to a real stop
 * line and route movement. */
function buildQueueSeeds(
  base: SimScenarioInput,
  graph: LaneGraph,
  roadLanes: readonly DirectedLane[],
  target: number,
): AmbientQueueSeed[] {
  if (target <= 0 || (base.signalPrograms.length === 0 && base.roadControls.length === 0)) return [];
  const lanesByRsl = new Map(roadLanes.map((lane) => [lane.rsl, lane]));
  const book = new SignalBook(base.signalPrograms, base.warmupSeconds, base.roadControls);
  const controlled = book.stopLines
    .filter((line) => {
      if (!lanesByRsl.has(line.rsl)) return false;
      if (line.kind === 'stop') return true;
      const phase = line.signalId === null ? null : book.phaseAt(line.signalId, 0);
      return phase !== null && phaseForbidsEntry(phase) && phase !== 'yellow';
    })
    .sort(
      (a, b) =>
        a.controlId.localeCompare(b.controlId) ||
        a.rsl.localeCompare(b.rsl) ||
        a.s - b.s ||
        (a.connectingLaneRsls[0] ?? '').localeCompare(b.connectingLaneRsls[0] ?? ''),
    );
  if (controlled.length === 0) return [];

  // Reserve most, but not all, of the City population for junction queues.
  // Round-robin by depth gives every controlled approach one waiting vehicle
  // before a second is added to any approach.
  const queueTarget = Math.min(target, Math.max(controlled.length, Math.round(target * 0.7)));
  const out: AmbientQueueSeed[] = [];
  for (let depth = 0; out.length < queueTarget && depth < 4; depth++) {
    for (const line of controlled) {
      if (out.length >= queueTarget) break;
      const lane = lanesByRsl.get(line.rsl)!;
      const geom = graph.requireGeometry(line.rsl);
      const stopTravelS = lane.reversed ? geom.lengthM - line.s : line.s;
      // 3.5 m keeps the first vehicle's nose behind the line; 12 m centres
      // provide a comfortable visible queue gap for mixed vehicle lengths.
      const routeS = stopTravelS - 3.5 - depth * 12;
      if (routeS < Math.min(2, geom.lengthM * 0.1)) continue;
      out.push({
        lane,
        routeS,
        connectingLaneRsl: line.connectingLaneRsls[0],
        controlId: line.controlId,
      });
    }
  }
  return out;
}

function walkRoute(
  graph: LaneGraph,
  start: DirectedLane,
  profile: ResolvedAmbientTrafficProfile,
  rng: Rng,
  startRouteS: number,
  requiredDownstreamM: number,
  preferredFirstSuccessor?: string,
): string[] {
  const lanes = [start.rsl];
  let current = start;
  // `startRouteS` is measured in travel direction by `sampleDirected`.
  let lengthM = Math.max(0, graph.lengthOf(start.rsl) - startRouteS);
  const needM = Math.max(80, requiredDownstreamM);
  const visited = new Set([`${start.rsl}:${start.reversed ? 1 : 0}`]);
  while (lengthM < needM && lanes.length < 32) {
    const successors = graph.successors(current).filter((candidate) => !visited.has(`${candidate.rsl}:${candidate.reversed ? 1 : 0}`));
    if (successors.length === 0) break;
    const preferred = lanes.length === 1 && preferredFirstSuccessor
      ? successors.find((candidate) => candidate.rsl === preferredFirstSuccessor)
      : undefined;
    const next = preferred ?? weightedSuccessor(graph, successors, profile, rng);
    current = next;
    visited.add(`${next.rsl}:${next.reversed ? 1 : 0}`);
    lanes.push(next.rsl);
    lengthM += graph.lengthOf(next.rsl);
  }
  const built = buildRoute(graph, { kind: 'lanePath', lanes });
  return built.ok ? lanes : [];
}

function weightedSuccessor(
  graph: LaneGraph,
  candidates: readonly DirectedLane[],
  profile: ResolvedAmbientTrafficProfile,
  rng: Rng,
): DirectedLane {
  const weights = candidates.map((candidate) => {
    const relation = graph.turnRelationOf(candidate.rsl);
    if (relation === 'Left') return profile.flows.left;
    if (relation === 'Right') return profile.flows.right;
    if (relation === 'UTurnLeft' || relation === 'UTurnRight') return profile.flows.uTurn;
    return profile.flows.through;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return candidates[0]!;
  let draw = rng.range(0, total);
  for (let i = 0; i < candidates.length; i++) {
    draw -= weights[i]!;
    if (draw <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

function chooseRoadUserKind(profile: ResolvedAmbientTrafficProfile, rng: Rng): ActorKind {
  const shareDraw = rng.next();
  if (shareDraw < profile.pedestrianShare) return 'pedestrian';
  if (shareDraw < profile.pedestrianShare + profile.cyclistShare) return 'bicycle';
  return chooseVehicleKind(profile, rng);
}

function chooseVehicleKind(profile: ResolvedAmbientTrafficProfile, rng: Rng): ActorKind {
  const entries = Object.entries(profile.vehicleMix) as Array<[Exclude<ActorKind, 'vehicle' | 'bicycle' | 'pedestrian' | 'scooter' | 'animal' | 'static_object'>, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return 'car';
  let draw = rng.range(0, total);
  for (const [kind, weight] of entries) {
    draw -= weight;
    if (draw <= 0) return kind;
  }
  return 'car';
}
