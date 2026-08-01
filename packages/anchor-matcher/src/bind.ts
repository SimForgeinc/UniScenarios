/**
 * Role binding — the **structural** pass.
 *
 * The seven `RoleBinding` kinds resolve to a `FeatureBinding` per site: which
 * lane, which gate, which conflict point, which route. What this module
 * deliberately does *not* do is the longitudinal solve — bisection on spawn `s`
 * to hit an arrival invariant is `sim-engine`'s job. This pass hands it the
 * two things it cannot re-derive cheaply: the **conflict point** (with `s` on
 * both routes) and the **route lane chains**.
 */

import { enumerateChains, laneAtS } from './frame.js';
import { crossSectionAt } from './cross-section.js';
import type { ApproachRelation } from './types/anchor.js';
import type { ConflictPair, DerivedMapIndex, LaneRsl } from './types/map-index.js';
import type { RoleBinding } from './types/roles.js';
import type { AnchorFrame, FeatureBinding, FramePose, MatchedSite } from './types/site.js';

/** How far upstream a conflicting actor's route is walked for run-up. */
export const CONFLICT_RUNUP_M = 150;
/** Fallback template crossing angles per relation, when the role declares none. */
export const DEFAULT_TEMPLATE_ANGLE_DEG: Record<ApproachRelation, number> = {
  opposing: 135,
  from_left: 90,
  from_right: 90,
  merge: 20,
};

function laneRslAtK(frame: AnchorFrame, k: number): LaneRsl | undefined {
  return frame.lateralLanes[k];
}

/** Nearest existing lane index to `k` on the same side, for `clamp`. */
function clampK(frame: AnchorFrame, k: number): number | null {
  const available = Object.keys(frame.lateralLanes)
    .map(Number)
    .sort((a, b) => a - b);
  if (available.length === 0) return null;
  const sameSide = available.filter((a) => (k >= 0 ? a >= 0 : a <= 0));
  const pool = sameSide.length > 0 ? sameSide : available;
  let best = pool[0] as number;
  for (const candidate of pool) {
    if (Math.abs(candidate - k) < Math.abs(best - k)) best = candidate;
  }
  return best;
}

function poseAt(k: number, s: number, tFrac: number, headingOffsetRad = 0): FramePose {
  return { k, s, tFrac, headingOffsetRad };
}

function routeFrom(
  index: DerivedMapIndex,
  frame: AnchorFrame,
  laneRsl: LaneRsl | undefined,
  k: number,
): LaneRsl[] {
  if (!laneRsl) return [];
  if (k === 0) {
    // The ego lane already has a route: the reference path from that lane on.
    const idx = frame.referencePath.findIndex((sp) => sp.laneRsl === laneRsl);
    if (idx >= 0) return frame.referencePath.slice(idx).map((sp) => sp.laneRsl);
  }
  const forward = enumerateChains(index, laneRsl, CONFLICT_RUNUP_M, 'forward', 1)[0];
  return [laneRsl, ...(forward?.lanes ?? [])];
}

/** The gate the reference path takes through a given junction, if any. */
export function egoGateForJunction(
  index: DerivedMapIndex,
  frame: AnchorFrame,
  junctionId: string,
): string | undefined {
  if (frame.egoGateId) {
    const gate = index.gates.find((g) => g.id === frame.egoGateId);
    if (gate && gate.junctionId === junctionId) return gate.id;
  }
  for (let i = 1; i < frame.referencePath.length; i += 1) {
    const span = frame.referencePath[i]!;
    const lane = index.lanes[span.laneRsl];
    if (!lane || lane.junctionId !== junctionId) continue;
    const approach = frame.referencePath[i - 1]!;
    const gate = index.gates.find(
      (g) =>
        g.junctionId === junctionId &&
        g.approachLaneRsl === approach.laneRsl &&
        g.connectingLaneRsl === span.laneRsl,
    );
    if (gate) return gate.id;
  }
  return undefined;
}

interface BindContext {
  index: DerivedMapIndex;
  frame: AnchorFrame;
  featureMatches: MatchedSite['featureMatches'];
}

function bindConflictingGate(
  ctx: BindContext,
  role: Extract<RoleBinding, { kind: 'conflicting_gate' }>,
): FeatureBinding {
  const notes: string[] = [];
  const binding: FeatureBinding = {
    role: role.role,
    kind: 'conflicting_gate',
    status: 'failed',
    notes,
  };
  const match = ctx.featureMatches[role.feature];
  const junctionId = match?.mapFeatureId.startsWith('junction:')
    ? match.mapFeatureId.slice('junction:'.length)
    : undefined;
  if (!junctionId) {
    notes.push(`role references feature "${role.feature}", which did not bind to a junction`);
    return binding;
  }
  const descriptor = ctx.index.junctionDescriptors[junctionId];
  const egoGateId = egoGateForJunction(ctx.index, ctx.frame, junctionId);
  if (!descriptor || !egoGateId) {
    notes.push(`no ego gate through junction ${junctionId}`);
    return binding;
  }
  const gateById = new Map(ctx.index.gates.map((g) => [g.id, g]));

  interface Candidate {
    pair: ConflictPair;
    otherGateId: string;
    relation: ApproachRelation;
    angleErrorDeg: number;
  }
  const templateAngle = role.templateCrossingAngleDeg ?? DEFAULT_TEMPLATE_ANGLE_DEG[role.from];
  const candidates: Candidate[] = [];
  for (const pair of descriptor.conflictPairs) {
    if (pair.gateA !== egoGateId && pair.gateB !== egoGateId) continue;
    const otherGateId = pair.gateA === egoGateId ? pair.gateB : pair.gateA;
    const other = gateById.get(otherGateId);
    if (!other) continue;
    const relation: ApproachRelation =
      pair.gateA === egoGateId
        ? pair.relation
        : pair.relation === 'from_left'
          ? 'from_right'
          : pair.relation === 'from_right'
            ? 'from_left'
            : pair.relation;
    if (relation !== role.from) continue;
    if (other.turnRelation !== role.turn) continue;
    candidates.push({
      pair,
      otherGateId,
      relation,
      angleErrorDeg: Math.abs(pair.crossingAngleDeg - templateAngle),
    });
  }
  // Rank by crossing-angle closeness — this is what keeps a T-bone a T-bone.
  candidates.sort(
    (a, b) => a.angleErrorDeg - b.angleErrorDeg || (a.otherGateId < b.otherGateId ? -1 : 1),
  );
  const chosen = candidates[0];
  if (!chosen) {
    notes.push(
      `junction ${junctionId} has no ${role.from} ${role.turn} movement conflicting with the ego path`,
    );
    return binding;
  }

  const otherGate = gateById.get(chosen.otherGateId)!;
  const egoGate = gateById.get(egoGateId)!;
  const approachLane = ctx.index.lanes[otherGate.approachLaneRsl];
  const connectingLane = ctx.index.lanes[otherGate.connectingLaneRsl];
  const upstream = enumerateChains(ctx.index, otherGate.approachLaneRsl, CONFLICT_RUNUP_M, 'backward', 1)[0] ?? {
    lanes: [],
    lengthM: 0,
    contiguous: [],
  };
  const exitChain = enumerateChains(ctx.index, otherGate.connectingLaneRsl, CONFLICT_RUNUP_M, 'forward', 1)[0] ?? {
    lanes: [],
    lengthM: 0,
    contiguous: [],
  };
  const routeLaneChain = [
    ...upstream.lanes,
    otherGate.approachLaneRsl,
    otherGate.connectingLaneRsl,
    ...exitChain.lanes,
  ];

  const sOnB = chosen.pair.gateA === egoGateId ? chosen.pair.sOnB : chosen.pair.sOnA;
  const sOnA = chosen.pair.gateA === egoGateId ? chosen.pair.sOnA : chosen.pair.sOnB;
  const sOnActor = upstream.lengthM + (approachLane?.lengthM ?? 0) + sOnB;
  const egoConnectingS = ctx.frame.sOfLane[egoGate.connectingLaneRsl];
  const sOnEgo = (egoConnectingS ?? 0) + sOnA;

  // Spawn pose: back up along the actor's own route by the run-up we walked.
  const spawnS = -(upstream.lengthM + (approachLane?.lengthM ?? 0));
  binding.status = 'bound';
  binding.laneRsl = upstream.lanes[0] ?? otherGate.approachLaneRsl;
  binding.routeLaneChain = routeLaneChain;
  binding.pose = poseAt(0, spawnS, 0);
  binding.conflict = {
    gateId: otherGate.id,
    egoGateId,
    point: chosen.pair.point,
    sOnEgo,
    sOnActor,
    crossingAngleDeg: chosen.pair.crossingAngleDeg,
    relation: chosen.relation,
    angleErrorDeg: chosen.angleErrorDeg,
  };
  if (role.arriveAtConflict) binding.arrival = { ...role.arriveAtConflict };
  notes.push(
    `bound to gate ${otherGate.id} (${chosen.relation} ${otherGate.turnRelation}), crossing at ${
      Math.round(chosen.pair.crossingAngleDeg * 10) / 10
    }° (template ${templateAngle}°)`,
  );
  if (!connectingLane) notes.push('connecting lane missing from the index');
  return binding;
}

/** Bind every role against one frame. Order is the author's; refs look backwards. */
export function bindRoles(
  index: DerivedMapIndex,
  frame: AnchorFrame,
  roles: RoleBinding[],
  featureMatches: MatchedSite['featureMatches'],
): FeatureBinding[] {
  const ctx: BindContext = { index, frame, featureMatches };
  const bound = new Map<string, FeatureBinding>();
  const out: FeatureBinding[] = [];

  for (const role of roles) {
    const notes: string[] = [];
    let binding: FeatureBinding;

    switch (role.kind) {
      case 'on_reference': {
        const at = laneAtS(frame, role.dsM);
        binding = {
          role: role.role,
          kind: role.kind,
          status: at ? 'bound' : 'failed',
          pose: poseAt(0, role.dsM, role.tFrac),
          notes,
        };
        if (at) {
          binding.laneRsl = at.span.laneRsl;
          binding.routeLaneChain = routeFrom(index, frame, at.span.laneRsl, 0);
        } else {
          notes.push(`s=${role.dsM} m is outside the reference path`);
        }
        break;
      }

      case 'lane_offset': {
        let k = role.k;
        let status: FeatureBinding['status'] = 'bound';
        let laneRsl = laneRslAtK(frame, k);
        if (!laneRsl) {
          if (role.onMissing === 'fail') {
            status = 'failed';
            notes.push(`lane k=${role.k} does not exist at this site (onMissing: fail)`);
          } else if (role.onMissing === 'drop') {
            status = 'dropped';
            notes.push(`lane k=${role.k} does not exist at this site (onMissing: drop)`);
          } else {
            const clamped = clampK(frame, k);
            if (clamped === null) {
              status = 'failed';
              notes.push('no same-direction lanes to clamp to');
            } else {
              k = clamped;
              laneRsl = laneRslAtK(frame, k);
              status = clamped === role.k ? 'bound' : 'clamped';
              if (status === 'clamped') notes.push(`lane k=${role.k} clamped to k=${k}`);
            }
          }
        }
        binding = {
          role: role.role,
          kind: role.kind,
          status,
          onMissing: role.onMissing,
          notes,
        };
        if (status === 'bound' || status === 'clamped') {
          binding.pose = poseAt(k, role.dsM, role.tFrac);
          binding.laneRsl = laneRsl;
          binding.routeLaneChain = routeFrom(index, frame, laneRsl, k);
        }
        break;
      }

      case 'opposing': {
        const laneRsl = frame.opposingLanes[role.index];
        binding = {
          role: role.role,
          kind: role.kind,
          status: laneRsl ? 'bound' : 'failed',
          notes,
        };
        if (laneRsl) {
          // Opposing traffic runs the other way: `s` is measured along the ego
          // frame, so a positive `dsM` is still "ahead of the ego origin".
          binding.pose = poseAt(0, role.dsM, role.tFrac, Math.PI);
          binding.laneRsl = laneRsl;
          binding.routeLaneChain = routeFrom(index, frame, laneRsl, 1);
        } else {
          notes.push(`no opposing lane #${role.index} at this site`);
        }
        break;
      }

      case 'conflicting_gate': {
        binding = bindConflictingGate(ctx, role);
        break;
      }

      case 'on_crossing': {
        const match = featureMatches[role.feature];
        const crossing = match
          ? index.pointFeatures.find((p) => p.id === match.mapFeatureId && p.kind === 'crossing')
          : undefined;
        binding = {
          role: role.role,
          kind: role.kind,
          status: crossing ? 'bound' : 'failed',
          notes,
        };
        if (crossing) {
          const s = (frame.sOfLane[crossing.laneRsl] ?? 0) + crossing.s;
          binding.pose = poseAt(0, s, role.startFrac * 2 - 1, Math.PI / 2);
          binding.laneRsl = crossing.laneRsl;
          notes.push(`walks the crossing ${crossing.id} ${role.direction}`);
        } else {
          notes.push(
            index.capabilities.crossings
              ? `feature "${role.feature}" did not bind to a crossing`
              : 'this map index carries no crossing layer, so a pedestrian cannot be placed on a crossing',
          );
        }
        break;
      }

      case 'in_parking_zone': {
        const match = featureMatches[role.feature];
        const zone = match
          ? index.pointFeatures.find((p) => p.id === match.mapFeatureId && p.kind === 'parking_zone')
          : undefined;
        binding = {
          role: role.role,
          kind: role.kind,
          status: zone ? 'bound' : 'failed',
          notes,
        };
        if (zone) {
          const s = (frame.sOfLane[zone.laneRsl] ?? 0) + zone.s;
          binding.pose = poseAt(0, s, role.side === 'left' ? 1 : -1);
          binding.laneRsl = zone.laneRsl;
          notes.push(`parked in ${zone.id}, slot ${role.slotIndex}`);
        } else {
          notes.push(
            index.capabilities.parkingZones
              ? `feature "${role.feature}" did not bind to a parking zone`
              : 'this map index carries no parking-zone layer',
          );
        }
        break;
      }

      case 'relative_to': {
        const ref = bound.get(role.ref);
        binding = { role: role.role, kind: role.kind, status: 'failed', notes };
        if (!ref || !ref.pose) {
          notes.push(`reference role "${role.ref}" is not bound`);
          break;
        }
        const wantedK = ref.pose.k + role.dLane;
        let k = wantedK;
        let laneRsl = laneRslAtK(frame, k);
        let status: FeatureBinding['status'] = 'bound';
        if (!laneRsl) {
          const clamped = clampK(frame, wantedK);
          if (clamped === null) {
            notes.push(`no lane at k=${wantedK} and nothing to clamp to`);
            break;
          }
          k = clamped;
          laneRsl = laneRslAtK(frame, k);
          status = 'clamped';
          notes.push(`lane k=${wantedK} clamped to k=${k}`);
        }
        binding.status = status;
        binding.pose = poseAt(k, ref.pose.s + role.dsM, role.tFrac ?? ref.pose.tFrac);
        binding.laneRsl = laneRsl;
        binding.routeLaneChain = routeFrom(index, frame, laneRsl, k);
        break;
      }
    }

    // A lane that exists in the frame but not at the actor's `s` is still worth
    // flagging — the solver would otherwise spawn into thin air.
    if (binding.pose && binding.status !== 'dropped' && binding.status !== 'failed') {
      const at = laneAtS(frame, binding.pose.s);
      if (!at && binding.kind !== 'conflicting_gate') {
        binding.notes.push(`pose s=${binding.pose.s} m is outside the reference path`);
      }
      if (binding.laneRsl && !crossSectionAt(index.lanes, binding.laneRsl, 0)) {
        binding.notes.push('lane has no usable cross-section');
      }
    }

    bound.set(role.role, binding);
    out.push(binding);
  }

  return out;
}
