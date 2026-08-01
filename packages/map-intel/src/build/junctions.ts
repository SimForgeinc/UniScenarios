/**
 * JunctionDescriptors, including the precomputed `conflictPairs`.
 *
 * `conflictPairs` is the highest-value derived fact in the index (Scenic's
 * `conflictingManeuvers`): for every pair of movements through a junction whose
 * connecting-lane centrelines actually cross, we store the crossing point, the
 * arc length along each path, the crossing angle, and the relation from A's
 * point of view. That is what lets "an oncoming car turns left across you"
 * survive being retargeted onto a differently-shaped junction on another map —
 * the solver backs each actor up from the *precomputed* conflict point instead
 * of re-deriving junction geometry it does not have.
 *
 * Two kinds of conflict are emitted:
 *
 * 1. **Crossings** — proper segment intersections between the two connecting
 *    lanes. Endpoint touches are excluded on purpose.
 * 2. **Merges** — movements from different approaches that feed a shared exit
 *    lane. Their centrelines converge rather than cross, so no intersection
 *    exists to find, but the interaction is real. Recorded at the point of
 *    **closest approach** between the two paths, with `sOnA`/`sOnB` at that
 *    point: the midpoint of the two lane *ends* would sit up to a lane-width
 *    off both paths, and a solver backing an actor up from it would aim at
 *    empty asphalt.
 *
 * Control is derived from the signal layer rather than trusted from the search
 * index (whose `control_type` disagrees with the signals on these maps — see
 * `controlEvidence`, which records both).
 */

import { asGateId, asJunctionId, asLaneRef, asLocationId, type GateId, type JunctionId } from '../types/ids.js';
import type { LocationId } from '../types/ids.js';
import type {
  ConflictPair,
  ConflictRelation,
  JunctionApproach,
  JunctionArm,
  JunctionControl,
  JunctionDescriptor,
  TurnOption,
} from '../types/topology.js';
import type { LocationDraft } from './draft.js';
import type { LaneNode } from '../geometry/lane-graph.js';
import {
  angleBetween,
  bearingDegBetween,
  bounds,
  centroid,
  headingToBearingDeg,
  poseAtS,
  projectOnSegment,
  segmentIntersection,
  wrapPi,
  type Point2,
} from '../geometry/vec.js';
import { round } from './anchor-lift.js';
import { type BuildContext, roadNameFor } from './context.js';
import { makeLocationIdString } from './hash.js';
import { compareStrings } from './compare.js';

/** Bearing tolerance for grouping lanes into the same physical arm, degrees. */
const ARM_CLUSTER_DEG = 40;

/** How far from the junction footprint a signal still counts as controlling it. */
const SIGNAL_RADIUS_PAD_M = 22;

/** Above this, two approaches are treated as opposing. */
const OPPOSING_MIN_RAD = (150 * Math.PI) / 180;

/** Below this, two approaches are treated as the same direction. */
const SAME_DIR_MAX_RAD = (30 * Math.PI) / 180;

/** Build a descriptor for every junction in the topology index. */
export function buildJunctionDescriptors(
  ctx: BuildContext,
  crossingDrafts: readonly LocationDraft[],
): JunctionDescriptor[] {
  const out: JunctionDescriptor[] = [];
  const signals = collectSignals(ctx);
  for (const jid of Object.keys(ctx.sources.topology.junctions).sort()) {
    const descriptor = buildOne(ctx, jid, signals, crossingDrafts);
    if (descriptor) out.push(descriptor);
  }
  return out;
}

/** The catalog id a junction location has (derivable without the catalog). */
export function junctionLocationId(mapId: string, junctionId: string): LocationId {
  return asLocationId(makeLocationIdString(mapId, 'junction', `junction:${junctionId}`));
}

interface SignalPoint {
  point: Point2;
  category: string;
  mutcd: string;
  name: string;
}

function collectSignals(ctx: BuildContext): SignalPoint[] {
  const out: SignalPoint[] = [];
  for (const f of ctx.sources.signals?.features ?? []) {
    const coords = f.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords as number[];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    out.push({
      point: ctx.toLocal(lng, lat),
      category: f.properties.signal_category ?? 'undefined',
      mutcd: f.properties.mutcd_code ?? '',
      name: f.properties.name ?? '',
    });
  }
  return out;
}

function buildOne(
  ctx: BuildContext,
  junctionId: string,
  signals: readonly SignalPoint[],
  crossingDrafts: readonly LocationDraft[],
): JunctionDescriptor | null {
  const graph = ctx.graph;
  const raw = ctx.sources.topology.junctions[junctionId];
  if (!raw) return null;

  const internalLanes = raw.internalLaneRsls
    .map((r) => graph.get(r))
    .filter((l): l is LaneNode => l !== undefined);
  const allPoints = internalLanes.flatMap((l) => l.points);
  if (allPoints.length === 0) return null;
  const center = centroid(allPoints);
  const bb = bounds(allPoints);
  const sizeM = round(Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY), 2);

  const gates = ctx.sources.topology.gates
    .filter((g) => g.junctionId === junctionId)
    .sort((a, b) => compareStrings(a.id, b.id));

  // --- arms ---------------------------------------------------------------
  interface ArmSeed {
    bearingDeg: number;
    approach: Set<string>;
    exit: Set<string>;
    roadNames: string[];
  }
  const seeds: ArmSeed[] = [];
  const assign = (bearingDeg: number, rsl: string, kind: 'approach' | 'exit'): number => {
    let best = -1;
    let bestDelta = ARM_CLUSTER_DEG;
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i] as ArmSeed;
      const delta = Math.abs(wrapPi(((bearingDeg - seed.bearingDeg) * Math.PI) / 180)) * (180 / Math.PI);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    }
    if (best < 0) {
      seeds.push({ bearingDeg, approach: new Set(), exit: new Set(), roadNames: [] });
      best = seeds.length - 1;
    }
    const seed = seeds[best] as ArmSeed;
    (kind === 'approach' ? seed.approach : seed.exit).add(rsl);
    const name = roadNameFor(ctx, rsl);
    if (name) seed.roadNames.push(name);
    return best;
  };

  const approachRsls = [...new Set([...raw.approachLaneRsls, ...gates.map((g) => g.approachLaneRsl)])].sort();
  const exitRsls = [...new Set(gates.flatMap((g) => g.exitLaneRsls))].sort();

  const approachArmIndex = new Map<string, number>();
  for (const rsl of approachRsls) {
    const lane = graph.get(rsl);
    if (!lane) continue;
    // The leg direction is from the junction centre out toward where the
    // approach lane meets it — that is what makes an inbound and an outbound
    // lane on the same street land on the same arm.
    const armIdx = assign(bearingDegBetween(center, graph.endOf(lane)), rsl, 'approach');
    approachArmIndex.set(rsl, armIdx);
  }
  for (const rsl of exitRsls) {
    const lane = graph.get(rsl);
    if (!lane) continue;
    assign(bearingDegBetween(center, graph.startOf(lane)), rsl, 'exit');
  }

  const arms: JunctionArm[] = seeds
    .map((seed, index) => ({
      index,
      bearingDeg: round(seed.bearingDeg, 1),
      roadName: mostCommon(seed.roadNames) ?? '',
      approachLaneRefs: [...seed.approach].sort().map((r) => asLaneRef(r)),
      exitLaneRefs: [...seed.exit].sort().map((r) => asLaneRef(r)),
      inboundLaneCount: seed.approach.size,
      outboundLaneCount: seed.exit.size,
    }))
    .sort((a, b) => a.bearingDeg - b.bearingDeg)
    .map((arm, index) => ({ ...arm, index }));

  // Re-map approach → sorted arm index.
  const armIndexByApproach = new Map<string, number>();
  for (const arm of arms) {
    for (const rsl of arm.approachLaneRefs) armIndexByApproach.set(rsl as string, arm.index);
  }

  // --- approaches ---------------------------------------------------------
  const approaches: JunctionApproach[] = [];
  for (const rsl of approachRsls) {
    const lane = graph.get(rsl);
    if (!lane) continue;
    const turnOptions: TurnOption[] = gates
      .filter((g) => g.approachLaneRsl === rsl)
      .map((g) => ({
        gateId: asGateId(g.id),
        turn: g.turnRelation,
        connectingLaneRsl: asLaneRef(g.connectingLaneRsl),
        exitLaneRsls: g.exitLaneRsls.map((e) => asLaneRef(e)),
        headingChangeRad: round(g.headingChangeRad, 6),
      }));
    approaches.push({
      laneRsl: asLaneRef(rsl),
      bearingDeg: round(headingToBearingDeg(graph.endHeading(lane)), 1),
      armIndex: armIndexByApproach.get(rsl) ?? 0,
      roadName: roadNameFor(ctx, rsl),
      speedLimitKph: lane.speedLimitKph ?? 0,
      turnOptions,
    });
  }
  approaches.sort((a, b) => compareStrings(a.laneRsl as string, b.laneRsl as string));

  // --- control ------------------------------------------------------------
  const { control, evidence } = deriveControl(ctx, junctionId, center, sizeM, signals, arms.length);

  // --- conflict pairs -----------------------------------------------------
  const conflictPairs = computeConflictPairs(ctx, gates, center);

  // --- crossings ----------------------------------------------------------
  const radius = sizeM / 2 + 15;
  const crossingLocationIds = crossingDrafts
    .filter((d) => {
      const p = d.anchor.road ? null : null;
      void p;
      const local = ctx.toLocal(d.anchor.geo.lng, d.anchor.geo.lat);
      return Math.hypot(local.x - center.x, local.y - center.y) <= radius;
    })
    .map((d) => d.id)
    .sort();

  return {
    junctionId: asJunctionId(junctionId),
    locationId: junctionLocationId(ctx.sources.mapId as string, junctionId),
    centerXY: [round(center.x, 3), round(center.y, 3)],
    sizeM,
    arms,
    armCount: arms.length,
    approaches,
    control,
    controlEvidence: evidence,
    internalLaneRefs: raw.internalLaneRsls.slice().sort().map((r) => asLaneRef(r)),
    crossingLocationIds,
    conflictPairs,
  };
}

/**
 * Derive control from the signal layer.
 *
 * The search index's own `control_type` is recorded as evidence but not used:
 * on Yale it labels a junction "uncontrolled" that has traffic lights standing
 * in it, because its detector keys off approach count rather than signals.
 */
function deriveControl(
  ctx: BuildContext,
  junctionId: string,
  center: Point2,
  sizeM: number,
  signals: readonly SignalPoint[],
  armCount: number,
): { control: JunctionControl; evidence: string[] } {
  const radius = sizeM / 2 + SIGNAL_RADIUS_PAD_M;
  let lights = 0;
  let stops = 0;
  let yields = 0;
  for (const sig of signals) {
    if (Math.hypot(sig.point.x - center.x, sig.point.y - center.y) > radius) continue;
    if (sig.category === 'traffic_light') lights += 1;
    else if (sig.category === 'stop_sign' || sig.mutcd === 'R1-1') stops += 1;
    else if (sig.category === 'yield_sign' || sig.mutcd === 'R1-2') yields += 1;
  }
  const evidence = [`radius_m=${round(radius, 1)}`, `traffic_light=${lights}`, `stop_sign=${stops}`, `yield_sign=${yields}`];
  const searchObj = ctx.sources.searchIndex?.objects[`junction:${junctionId}`];
  const searchControl = searchObj?.facts?.['control_type'];
  if (typeof searchControl === 'string') evidence.push(`search_index_control_type=${searchControl}`);

  let control: JunctionControl;
  if (lights > 0) control = 'signalized';
  else if (stops > 0 && armCount > 0 && stops >= armCount) control = 'all_way_stop';
  else if (stops > 0) control = 'minor_stop';
  else if (yields > 0) control = 'yield';
  else control = 'uncontrolled';
  return { control, evidence };
}

/** Compute every crossing and merge conflict inside one junction. */
export function computeConflictPairs(
  ctx: BuildContext,
  gates: readonly { id: string; approachLaneRsl: string; connectingLaneRsl: string; exitLaneRsls: string[]; turnRelation: string }[],
  center: Point2,
): ConflictPair[] {
  const graph = ctx.graph;
  const byKey = new Map<string, ConflictPair>();

  // Canonical gate order, so the function depends on the *set* of gates and not
  // on the order they arrive in. Without this, `gateA`/`gateB` — and therefore
  // `relation`, which is stated from A's point of view — would silently flip
  // with the caller's sort.
  const ordered = [...gates].sort((a, b) => compareStrings(a.id, b.id));

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const ga = ordered[i] as (typeof gates)[number];
      const gb = ordered[j] as (typeof gates)[number];
      // Movements from the same approach lane share an origin: a driver picks
      // one of them, so they never conflict with each other.
      if (ga.approachLaneRsl === gb.approachLaneRsl) continue;
      const la = graph.get(ga.connectingLaneRsl);
      const lb = graph.get(gb.connectingLaneRsl);
      if (!la || !lb) continue;

      const approachA = graph.get(ga.approachLaneRsl);
      const approachB = graph.get(gb.approachLaneRsl);
      if (!approachA || !approachB) continue;
      const hA = graph.endHeading(approachA);
      const hB = graph.endHeading(approachB);
      const relation = classifyRelation(hA, hB, center, graph.endOf(approachB));

      const key = `${ga.id}|${gb.id}`;
      const crossing = firstCrossing(la, lb);
      if (crossing) {
        byKey.set(key, {
          gateA: asGateId(ga.id),
          gateB: asGateId(gb.id),
          kind: 'crossing',
          pointXY: [round(crossing.point.x, 3), round(crossing.point.y, 3)],
          sOnA: round(crossing.sA, 3),
          sOnB: round(crossing.sB, 3),
          crossingAngleRad: clampAngle(crossing.angleRad),
          relation,
          turnA: ga.turnRelation,
          turnB: gb.turnRelation,
        });
        continue;
      }
      // Merge: different approaches, shared exit lane, converging centrelines.
      const sharedExit = ga.exitLaneRsls.some((e) => gb.exitLaneRsls.includes(e));
      if (!sharedExit) continue;
      const merge = closestApproach(la, lb);
      if (!merge || merge.distanceM > MERGE_MAX_SEPARATION_M) continue;
      byKey.set(key, {
        gateA: asGateId(ga.id),
        gateB: asGateId(gb.id),
        kind: 'merge',
        pointXY: [round(merge.point.x, 3), round(merge.point.y, 3)],
        sOnA: round(merge.sA, 3),
        sOnB: round(merge.sB, 3),
        crossingAngleRad: clampAngle(merge.angleRad),
        relation,
        turnA: ga.turnRelation,
        turnB: gb.turnRelation,
      });
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      compareStrings(a.gateA as string, b.gateA as string) ||
      compareStrings(a.gateB as string, b.gateB as string),
  );
}

/** Two merging paths further apart than this are not really interacting. */
const MERGE_MAX_SEPARATION_M = 8;

/** Rounded for byte-stable JSON, floored at PI so the value never over-claims. */
function clampAngle(rad: number): number {
  return Math.min(round(rad, 6), Math.PI);
}

/**
 * Closest approach between two connecting-lane centrelines.
 *
 * Every vertex of each path is projected onto every segment of the other, so
 * the result is exact to the polyline sampling (~1 m) rather than to the
 * vertices alone.
 */
function closestApproach(
  la: LaneNode,
  lb: LaneNode,
): { point: Point2; sA: number; sB: number; angleRad: number; distanceM: number } | null {
  let best: { point: Point2; sA: number; sB: number; angleRad: number; distanceM: number } | null = null;

  const consider = (
    sA: number,
    sB: number,
    pa: Point2,
    pb: Point2,
  ): void => {
    const distanceM = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    if (best && distanceM >= best.distanceM) return;
    best = {
      point: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      sA,
      sB,
      angleRad: angleBetween(headingAt(la, sA), headingAt(lb, sB)),
      distanceM,
    };
  };

  for (let i = 0; i < la.points.length; i++) {
    const pa = la.points[i] as Point2;
    for (let j = 0; j + 1 < lb.points.length; j++) {
      const b1 = lb.points[j] as Point2;
      const b2 = lb.points[j + 1] as Point2;
      const proj = projectOnSegment(pa, b1, b2);
      const segB = (lb.cum[j + 1] as number) - (lb.cum[j] as number);
      consider(la.cum[i] as number, (lb.cum[j] as number) + proj.t * segB, pa, proj.point);
    }
  }
  for (let j = 0; j < lb.points.length; j++) {
    const pb = lb.points[j] as Point2;
    for (let i = 0; i + 1 < la.points.length; i++) {
      const a1 = la.points[i] as Point2;
      const a2 = la.points[i + 1] as Point2;
      const proj = projectOnSegment(pb, a1, a2);
      const segA = (la.cum[i + 1] as number) - (la.cum[i] as number);
      consider((la.cum[i] as number) + proj.t * segA, lb.cum[j] as number, proj.point, pb);
    }
  }
  return best;
}

function headingAt(lane: LaneNode, s: number): number {
  return poseAtS(lane.points, lane.cum, s).headingRad;
}

function firstCrossing(
  la: LaneNode,
  lb: LaneNode,
): { point: Point2; sA: number; sB: number; angleRad: number } | null {
  let best: { point: Point2; sA: number; sB: number; angleRad: number } | null = null;
  for (let i = 0; i + 1 < la.points.length; i++) {
    const a1 = la.points[i] as Point2;
    const a2 = la.points[i + 1] as Point2;
    for (let j = 0; j + 1 < lb.points.length; j++) {
      const b1 = lb.points[j] as Point2;
      const b2 = lb.points[j + 1] as Point2;
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (!hit) continue;
      const segA = (la.cum[i + 1] as number) - (la.cum[i] as number);
      const segB = (lb.cum[j + 1] as number) - (lb.cum[j] as number);
      const sA = (la.cum[i] as number) + hit.tA * segA;
      const sB = (lb.cum[j] as number) + hit.tB * segB;
      const angleRad = angleBetween(
        Math.atan2(a2.y - a1.y, a2.x - a1.x),
        Math.atan2(b2.y - b1.y, b2.x - b1.x),
      );
      if (!best || sA < best.sA) best = { point: hit.point, sA, sB, angleRad };
    }
  }
  return best;
}

/**
 * Classify how B relates to A.
 *
 * `from_left` / `from_right` are decided by which side of A's direction of
 * travel B's approach leg lies on — not by signed heading difference, which
 * flips meaning at the ±180° wrap and is exactly the sort of thing that turns a
 * T-bone into a rear-end after retargeting.
 */
export function classifyRelation(
  headingA: number,
  headingB: number,
  center: Point2,
  approachEndB: Point2,
): ConflictRelation {
  const delta = Math.abs(wrapPi(headingB - headingA));
  if (delta >= OPPOSING_MIN_RAD) return 'opposing';
  if (delta <= SAME_DIR_MAX_RAD) return 'same_dir_merge';
  const vx = approachEndB.x - center.x;
  const vy = approachEndB.y - center.y;
  const crossZ = Math.cos(headingA) * vy - Math.sin(headingA) * vx;
  return crossZ > 0 ? 'from_left' : 'from_right';
}

/** Which gates conflict with a given gate, from a descriptor. */
export function conflictingGates(descriptor: JunctionDescriptor, gateId: GateId): GateId[] {
  const out = new Set<string>();
  for (const pair of descriptor.conflictPairs) {
    if (pair.gateA === gateId) out.add(pair.gateB as string);
    else if (pair.gateB === gateId) out.add(pair.gateA as string);
  }
  return [...out].sort().map((g) => asGateId(g));
}

/** Descriptor lookup keyed by junction id. */
export function indexDescriptors(
  descriptors: readonly JunctionDescriptor[],
): Map<string, JunctionDescriptor> {
  const out = new Map<string, JunctionDescriptor>();
  for (const d of descriptors) out.set(d.junctionId as string, d);
  return out;
}

function mostCommon(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]))[0]?.[0];
}

/** Re-export for tests that need the raw junction id brand. */
export type { JunctionId };
