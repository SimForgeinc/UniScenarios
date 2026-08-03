import { z } from 'zod';

import { contentHash } from '../core/hash.js';
import { Rng } from '../core/rng.js';
import { toSceneXZ } from '../frames.js';
import type { DirectedLane, LaneGraph } from '../map/lane-graph.js';
import { buildRoute } from '../map/route.js';
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
  /** Candidate selection is local to authored choreography, not the whole city. */
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
   * Retained for robustness-evaluator callers. Candidate materialization does
   * not run the clip; the explicit robustness job applies this ceiling.
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
  readonly origin: 'ambient';
  readonly timelineVisible: false;
  readonly editable: false;
}

export interface AmbientTrafficProvenance {
  readonly version: 1;
  readonly profile: ResolvedAmbientTrafficProfile;
  readonly profileHash: string;
  /** Stable population identity. Authored choreography is deliberately absent. */
  readonly candidatePoolKey: string;
  readonly mapGraphDigest: string;
  readonly baseInputHash: string;
  readonly generatedInputHash: string;
  readonly actors: readonly AmbientActorProvenance[];
  readonly rejectedSpawnCount: number;
  readonly eligibleLaneKm: number;
  /** Compatibility summary. Ordinary materialization never executes a screening clip. */
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

export interface AmbientCandidate {
  readonly id: string;
  readonly actor: SimActor;
  readonly laneRsl: string;
  readonly routeLaneRsls: readonly string[];
  readonly seedKey: string;
  readonly footprintRadiusM: number;
  /** Runtime/editor ownership metadata; simulation still receives an ordinary SimActor. */
  readonly origin: 'ambient';
  readonly timelineVisible: false;
  readonly editable: false;
}

export interface AmbientCandidatePool {
  readonly version: 1;
  readonly key: string;
  readonly mapGraphDigest: string;
  readonly profile: ResolvedAmbientTrafficProfile;
  readonly profileHash: string;
  readonly candidates: readonly AmbientCandidate[];
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

/** Generate map-wide candidates once. The key intentionally excludes authored state. */
export function createAmbientCandidatePool(
  graph: LaneGraph,
  rawProfile: AmbientTrafficProfile,
): AmbientCandidatePool {
  const profile = resolveAmbientTrafficProfile(rawProfile);
  const profileHash = contentHash(profile);
  const key = contentHash({ version: 1, mapGraphDigest: graph.topologyDigest, profile });
  if (profile.preset === 'off' || profile.densityVehiclesPerKm === 0 || profile.maxActors === 0) {
    return { version: 1, key, mapGraphDigest: graph.topologyDigest, profile, profileHash, candidates: [] };
  }
  const roadLanes = eligibleDirectedLanes(graph, ['driving'], [], Number.POSITIVE_INFINITY);
  const walkingLanes = eligibleDirectedLanes(graph, ['sidewalk', 'walking'], [], Number.POSITIVE_INFINITY);
  const totalLaneKm = roadLanes.reduce((sum, lane) => sum + graph.lengthOf(lane.rsl), 0) / 1000;
  const candidateBudget = Math.min(4096, Math.max(profile.maxActors * 8, Math.ceil(totalLaneKm * profile.densityVehiclesPerKm * 2)));
  const rng = new Rng(`${key}|ambient-candidate-pool-v1`);
  const candidates: AmbientCandidate[] = [];
  const attemptLimit = Math.max(80, candidateBudget * 4);
  for (let attempt = 0; attempt < attemptLimit && candidates.length < candidateBudget; attempt++) {
    const actorRng = rng.fork(`candidate:${attempt}`);
    const requestedKind = chooseRoadUserKind(profile, actorRng);
    const lanes = requestedKind === 'pedestrian' ? walkingLanes : roadLanes;
    if (lanes.length === 0) continue;
    const lane = lanes[Math.floor(actorRng.next() * lanes.length)]!;
    const geom = graph.requireGeometry(lane.rsl);
    const margin = Math.min(8, geom.lengthM * 0.2);
    const routeS = actorRng.range(margin, Math.max(margin + 0.01, geom.lengthM - margin));
    const pose = graph.sampleDirected(lane, routeS);
    const scene = toSceneXZ(pose.point);
    const laneSpeed = requestedKind === 'pedestrian' ? 1.35 : requestedKind === 'bicycle' ? 5.5 : geom.speedLimitMps;
    const factor = Math.max(0.35, 1 + actorRng.range(-profile.speedVariance, profile.speedVariance));
    const cruise = laneSpeed * factor;
    const routeLaneRsls = walkRoute(graph, lane, profile, actorRng, routeS, 5_000);
    if (routeLaneRsls.length === 0) continue;
    const storageS = lane.reversed ? geom.lengthM - routeS : routeS;
    const seedKey = contentHash({ key, attempt, lane: lane.rsl, storageS }).slice(0, 16);
    const id = `ambient:v1:${seedKey}`;
    const actor = normalizeActor({
      id,
      kind: requestedKind,
      initial: {
        laneRef: { rsl: lane.rsl, s: storageS, tFrac: 0 },
        pose: { x: scene.x, z: scene.z, headingRad: pose.headingRad },
        speedMps: cruise,
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
        route: { kind: 'lanePath', lanes: routeLaneRsls },
        cruiseSpeedMps: cruise,
      },
      presentAtStart: true,
      static: false,
      tags: ['ambient', 'ambient:v1', `ambient-profile:${profileHash.slice(0, 16)}`, `ambient-seed:${seedKey}`],
    });
    candidates.push({
      id,
      actor,
      laneRsl: lane.rsl,
      routeLaneRsls,
      seedKey,
      footprintRadiusM: requestedKind === 'bus' || requestedKind === 'truck' ? 7 : requestedKind === 'pedestrian' ? 1.2 : 3.5,
      origin: 'ambient',
      timelineVisible: false,
      editable: false,
    });
  }
  return { version: 1, key, mapGraphDigest: graph.topologyDigest, profile, profileHash, candidates };
}

/** Select stable candidates around authored geometry and compile them to ordinary SimActors. */
export function materializeAmbientCandidatePool(
  base: SimScenarioInput,
  graph: LaneGraph,
  pool: AmbientCandidatePool,
  options: AmbientTrafficOptions = {},
): AmbientTrafficResult {
  if (pool.mapGraphDigest !== graph.topologyDigest) throw new Error('Ambient candidate pool does not match the lane graph');
  const { profile, profileHash } = pool;
  const baseInputHash = contentHash(base);
  const focus = base.actors.filter((actor) => !actor.static).map((actor) => actor.initial.pose);
  const allFocus = focus.length > 0 ? focus : base.actors.map((actor) => actor.initial.pose);
  const roadLanes = eligibleDirectedLanes(graph, ['driving'], allFocus, profile.radiusM);
  const eligibleRsls = new Set(roadLanes.map((lane) => lane.rsl));
  const eligibleLaneKm = roadLanes.reduce((sum, lane) => sum + graph.lengthOf(lane.rsl), 0) / 1000;
  const target = Math.min(profile.maxActors, Math.round(eligibleLaneKm * profile.densityVehiclesPerKm));
  const reservations: AmbientReservation[] = [
    ...base.actors.map((actor) => ({
      x: actor.initial.pose.x,
      z: actor.initial.pose.z,
      radiusM: profile.exclusionRadiusM + Math.hypot(actor.dims.l, actor.dims.w) * 0.5,
      reason: `authored:${actor.id}`,
    })),
    ...base.props.filter((prop) => prop.collidable && prop.attachment === undefined).map((prop) => ({
      x: prop.pose.x,
      z: prop.pose.z,
      radiusM: profile.exclusionRadiusM + Math.hypot(prop.dims.l * prop.scale, prop.dims.w * prop.scale) * 0.5,
      reason: `authored-prop:${prop.groupId ?? prop.id}`,
    })),
    ...(options.reservations ?? []),
  ];
  const occupied = [...reservations];
  const selected: AmbientCandidate[] = [];
  let rejectedSpawnCount = 0;
  for (const candidate of pool.candidates) {
    if (selected.length >= target) break;
    if (!eligibleRsls.has(candidate.laneRsl)) continue;
    const { x, z } = candidate.actor.initial.pose;
    if (occupied.some((area) => Math.hypot(x - area.x, z - area.z) < area.radiusM + candidate.footprintRadiusM)) {
      rejectedSpawnCount++;
      continue;
    }
    const builtRoute = buildRoute(graph, candidate.actor.behavior.route);
    const laneRef = candidate.actor.initial.laneRef;
    const startOnRoute = builtRoute.ok && laneRef ? builtRoute.route.sOfLaneStorage(laneRef.rsl, laneRef.s) : null;
    const requiredDownstreamM = (candidate.actor.behavior.cruiseSpeedMps ?? candidate.actor.initial.speedMps)
      * (base.warmupSeconds + base.clipSeconds) * 1.1;
    if (!builtRoute.ok || startOnRoute === null || builtRoute.route.lengthM - startOnRoute < requiredDownstreamM) {
      rejectedSpawnCount++;
      continue;
    }
    selected.push(candidate);
    occupied.push({ x, z, radiusM: candidate.footprintRadiusM + 4, reason: candidate.id });
  }
  const actors = selected.map((candidate) => candidate.actor);
  const input = normalizeSimScenarioInput({ ...base, actors: [...base.actors, ...actors] });
  const warnings: string[] = [];
  if (target === 0 && profile.preset !== 'off') warnings.push('No eligible drivable lane length was available near the authored scenario.');
  if (actors.length < target) warnings.push(`Placed ${actors.length}/${target} ambient actors; reservations and route feasibility rejected the remainder.`);
  return {
    input,
    provenance: {
      version: 1,
      profile,
      profileHash,
      candidatePoolKey: pool.key,
      mapGraphDigest: pool.mapGraphDigest,
      baseInputHash,
      generatedInputHash: contentHash(input),
      actors: selected.map(({ id, actor, routeLaneRsls, seedKey, origin, timelineVisible, editable }) => ({
        id,
        kind: actor.kind,
        routeLaneRsls,
        seedKey,
        origin,
        timelineVisible,
        editable,
      })),
      rejectedSpawnCount,
      eligibleLaneKm,
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
  };
}

/** Convenience API: cheap pool construction plus selection; it never runs the clip. */
export function applyAmbientTraffic(
  base: SimScenarioInput,
  graph: LaneGraph,
  rawProfile: AmbientTrafficProfile,
  options: AmbientTrafficOptions = {},
): AmbientTrafficResult {
  return materializeAmbientCandidatePool(base, graph, createAmbientCandidatePool(graph, rawProfile), options);
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
