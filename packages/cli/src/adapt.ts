/**
 * The template → matcher adapter.
 *
 * `scenario-model` v2 and `anchor-matcher` each declare their own
 * `LogicalAnchor` / `RoleBinding`. That duplication was deliberate (see the
 * header of `anchor-matcher/src/types/anchor.ts`) — it kept two in-flight lanes
 * from serialising on each other — and this module is the seam where it is paid
 * back. Nothing else in the CLI knows both vocabularies.
 *
 * Every place the two shapes genuinely differ is handled here rather than by
 * changing a shipped package, because the two shapes differ *on purpose*: the
 * authored document is richer (open ranges, expressions, per-kind feature
 * predicates) than the matcher's evaluation vocabulary. Where the authored
 * document says something the matcher cannot evaluate, this module drops the
 * clause and records a `note` — never silently, because a dropped `required`
 * clause is a scenario testing something it no longer tests.
 *
 * | authored (v2) | matcher | how |
 * |---|---|---|
 * | `Range = [number\|null, number\|null]` | `[number, number]` | open ends become ±`OPEN_END_M` |
 * | `runway*M: Range` | `runway*M: number` | the range's lower bound is the requirement |
 * | feature kinds hoisted per union member | `{kind, junction?}` | junction predicates are re-nested |
 * | `egoTurn: Turn[]` | `egoTurn: Turn` | first entry; a note when more were offered |
 * | `from: 'same'` | (absent) | mapped to `merge` with a note |
 * | `adjacent: 'bike'\|'bus'\|'rail'\|'none'` | `'biking'\|'opposing'\|…` | `bike`→`biking`; `bus`/`rail`/`none` dropped |
 * | `policy.diversity: strict\|moderate\|off` | `junction\|road_direction\|none` | positional map |
 * | `pose.s: number \| Expr` | `dsM: number` | evaluated at param defaults (structural only — the materializer re-evaluates against the site) |
 * | `direction: near_to_far` | `left_to_right` | positional map |
 */

import {
  evaluateExpr,
  paramDefault,
  type Expr,
  type ExprScope,
  type NumberOrExpr,
  type Range as V2Range,
  type ScenarioTemplateV2,
  type AnchorFeature as V2Feature,
  type RoleBinding as V2Role,
} from '@uniscenarios/scenario-model';
import {
  type AdjacentKind as MAdjacentKind,
  type ApproachRelation as MApproachRelation,
  type Clause as MClause,
  type FeatureKind as MFeatureKind,
  type LogicalAnchor as MAnchor,
  type MatchPolicy as MPolicy,
  type Range as MRange,
  type RoleBinding as MRole,
  type Turn as MTurn,
} from '@uniscenarios/anchor-matcher';

/**
 * Sentinel for an open range end. The matcher's `Range` is a closed
 * `[min, max]`; 1e9 m is unreachable on any map and keeps the tuple numeric
 * (an `Infinity` would survive zod but poison every `slack` arithmetic).
 */
export const OPEN_END_M = 1e9;

export interface AdaptNote {
  readonly path: string;
  readonly reason: string;
}

export interface AdaptedAnchor {
  readonly anchor: MAnchor;
  readonly roles: MRole[];
  readonly notes: AdaptNote[];
}

/** Scope used to turn authored expressions into the numbers the matcher wants. */
export function templateStaticScope(template: ScenarioTemplateV2): ExprScope {
  const params: Record<string, number> = {};
  for (const decl of template.params.declarations) {
    const value = paramDefault(decl);
    if (value !== undefined) params[decl.id] = value;
  }
  return { params, clip: { seconds: template.choreography.clipSeconds } };
}

/**
 * Best-effort numeric value of an authored `number | Expr`.
 *
 * Site-dependent expressions (`lane.speedLimitKph`, `junction.sizeM`) are
 * genuinely unknowable before a site exists, so they fall back to `fallback`
 * *for the structural pass only*. `materialize.ts` re-evaluates every one of
 * them against the bound site, which is where the number actually matters.
 */
export function numberish(
  value: NumberOrExpr | undefined,
  scope: ExprScope,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  try {
    return evaluateExpr(value as Expr | number, scope);
  } catch {
    return fallback;
  }
}

function closeRange(range: V2Range): MRange {
  const [lo, hi] = range;
  return [lo ?? -OPEN_END_M, hi ?? OPEN_END_M];
}

interface V2Clause<T> {
  value: T;
  essentiality: 'required' | 'preferred' | 'cosmetic';
  weight?: number | undefined;
}

function clauseOf<A, B>(
  clause: V2Clause<A> | undefined,
  map: (value: A) => B,
): MClause<B> | undefined {
  if (!clause) return undefined;
  return {
    value: map(clause.value),
    essentiality: clause.essentiality,
    ...(clause.weight === undefined ? {} : { weight: clause.weight }),
  };
}

const ADJACENT_MAP: Record<string, MAdjacentKind | null> = {
  parking: 'parking',
  bike: 'biking',
  sidewalk: 'sidewalk',
  shoulder: 'shoulder',
  median: 'median',
  bus: null,
  rail: null,
  none: null,
};

const DIVERSITY_MAP: Record<string, MPolicy['diversity']> = {
  strict: 'junction',
  moderate: 'road_direction',
  off: 'none',
};

/** Feature kinds the matcher can actually look for along a reference path. */
const FEATURE_KIND_MAP: Record<string, MFeatureKind | null> = {
  junction: 'junction',
  crossing: 'crossing',
  parking_zone: 'parking_zone',
  merge: 'merge',
  lane_drop: 'lane_drop',
  driveway: 'driveway',
  bus_stop: 'bus_stop',
  diverge: null,
  school_zone: null,
  work_zone_suitable: null,
  crest: null,
  curve: null,
  rail_crossing: null,
};

function approachRelation(
  from: string,
  path: string,
  notes: AdaptNote[],
): MApproachRelation {
  if (from === 'same') {
    notes.push({
      path,
      reason: "approach relation 'same' has no matcher equivalent; matched as 'merge'",
    });
    return 'merge';
  }
  return from as MApproachRelation;
}

function adaptCorridor(
  template: ScenarioTemplateV2,
  notes: AdaptNote[],
): MAnchor['corridor'] {
  const c = template.anchor.corridor;
  if (!c) return undefined;

  const adjacent = (
    clause: V2Clause<readonly string[]> | undefined,
    path: string,
  ): MClause<MAdjacentKind[]> | undefined => {
    if (!clause) return undefined;
    const kept: MAdjacentKind[] = [];
    for (const kind of clause.value) {
      const mapped = ADJACENT_MAP[kind];
      if (mapped) kept.push(mapped);
      else notes.push({ path, reason: `adjacent kind "${kind}" is not evaluable by the matcher` });
    }
    if (kept.length === 0) return undefined;
    return {
      value: kept.sort(),
      essentiality: clause.essentiality,
      ...(clause.weight === undefined ? {} : { weight: clause.weight }),
    };
  };

  const runway = (
    clause: V2Clause<V2Range> | undefined,
    path: string,
  ): MClause<number> | undefined => {
    if (!clause) return undefined;
    const [lo] = clause.value;
    if (lo === null) {
      notes.push({ path, reason: 'open-ended runway range has no minimum; clause dropped' });
      return undefined;
    }
    return {
      value: lo,
      essentiality: clause.essentiality,
      ...(clause.weight === undefined ? {} : { weight: clause.weight }),
    };
  };

  const laneChangeLegal = c.laneChangeLegal
    ? {
        value: {
          side: c.laneChangeLegal.value.side,
          sRange: c.laneChangeLegal.value.sRange
            ? closeRange(c.laneChangeLegal.value.sRange)
            : ([-OPEN_END_M, 0] as MRange),
        },
        essentiality: c.laneChangeLegal.essentiality,
        ...(c.laneChangeLegal.weight === undefined ? {} : { weight: c.laneChangeLegal.weight }),
      }
    : undefined;
  if (c.laneChangeLegal && !c.laneChangeLegal.value.sRange) {
    notes.push({
      path: 'anchor.corridor.laneChangeLegal',
      reason: 'no sRange given; checked over the whole approach',
    });
  }

  return {
    ...(clauseOf(c.throughLanesSameDir, closeRange) === undefined
      ? {}
      : { throughLanesSameDir: clauseOf(c.throughLanesSameDir, closeRange) }),
    ...(clauseOf(c.throughLanesOpposing, closeRange) === undefined
      ? {}
      : { throughLanesOpposing: clauseOf(c.throughLanesOpposing, closeRange) }),
    ...(clauseOf(c.laneWidthM, closeRange) === undefined
      ? {}
      : { laneWidthM: clauseOf(c.laneWidthM, closeRange) }),
    ...(clauseOf(c.speedLimitKph, closeRange) === undefined
      ? {}
      : { speedLimitKph: clauseOf(c.speedLimitKph, closeRange) }),
    ...(clauseOf(c.curvatureDegPer10m, closeRange) === undefined
      ? {}
      : { curvatureDegPer10m: clauseOf(c.curvatureDegPer10m, closeRange) }),
    ...(clauseOf(c.gradePct, closeRange) === undefined
      ? {}
      : { gradePct: clauseOf(c.gradePct, closeRange) }),
    ...(runway(c.runwayUpstreamM, 'anchor.corridor.runwayUpstreamM') === undefined
      ? {}
      : { runwayUpstreamM: runway(c.runwayUpstreamM, 'anchor.corridor.runwayUpstreamM') }),
    ...(runway(c.runwayDownstreamM, 'anchor.corridor.runwayDownstreamM') === undefined
      ? {}
      : { runwayDownstreamM: runway(c.runwayDownstreamM, 'anchor.corridor.runwayDownstreamM') }),
    ...(adjacent(c.requiresAdjacent, 'anchor.corridor.requiresAdjacent') === undefined
      ? {}
      : { requiresAdjacent: adjacent(c.requiresAdjacent, 'anchor.corridor.requiresAdjacent') }),
    ...(adjacent(c.forbidsAdjacent, 'anchor.corridor.forbidsAdjacent') === undefined
      ? {}
      : { forbidsAdjacent: adjacent(c.forbidsAdjacent, 'anchor.corridor.forbidsAdjacent') }),
    ...(laneChangeLegal === undefined ? {} : { laneChangeLegal }),
  };
}

/**
 * The crossing angle a `conflicting_gate` role should be ranked against, when
 * the author expressed it as a range on the anchor feature.
 */
export function templateCrossingAngle(
  template: ScenarioTemplateV2,
  featureId: string,
): number | undefined {
  const feature = template.anchor.features.find((f) => f.id === featureId);
  if (!feature || feature.kind !== 'junction') return undefined;
  const range = feature.conflictingApproach?.value.crossingAngleDeg;
  if (!range) return undefined;
  const [lo, hi] = range;
  if (lo === null && hi === null) return undefined;
  if (lo === null) return hi as number;
  if (hi === null) return lo;
  return (lo + hi) / 2;
}

function adaptFeature(
  feature: V2Feature,
  isOrigin: boolean,
  notes: AdaptNote[],
): MAnchor['features'][number] | null {
  const path = `anchor.features.${feature.id}`;
  const kind = FEATURE_KIND_MAP[feature.kind];
  if (!kind) {
    notes.push({ path, reason: `feature kind "${feature.kind}" is not matchable; feature dropped` });
    return null;
  }

  // `atM` is optional in the authored document and mandatory in the matcher.
  // The origin sits at s = 0 by construction; everything else defaults to
  // "anywhere on the reference path", which is what "unconstrained" means.
  const atM: MClause<MRange> = feature.atM
    ? {
        value: closeRange(feature.atM.value),
        essentiality: feature.atM.essentiality,
        ...(feature.atM.weight === undefined ? {} : { weight: feature.atM.weight }),
      }
    : {
        value: isOrigin ? [0, 0] : [-OPEN_END_M, OPEN_END_M],
        essentiality: isOrigin ? 'required' : 'cosmetic',
      };

  const out: MAnchor['features'][number] = {
    id: feature.id,
    kind,
    atM,
    ...(feature.side
      ? {
          side: {
            value: feature.side.value,
            essentiality: feature.side.essentiality,
            ...(feature.side.weight === undefined ? {} : { weight: feature.side.weight }),
          },
        }
      : {}),
  };

  if (feature.kind === 'junction') {
    const junction: NonNullable<MAnchor['features'][number]['junction']> = {};
    const arms = clauseOf(feature.arms, closeRange);
    if (arms) junction.arms = arms;
    const control = clauseOf(feature.control, (v) => [...v]);
    if (control) junction.control = control;
    if (feature.egoTurn) {
      const turns = feature.egoTurn.value;
      if (turns.length > 1) {
        notes.push({
          path: `${path}.egoTurn`,
          reason: `the matcher evaluates one ego turn; kept "${turns[0]}" and dropped ${turns.slice(1).join(', ')}`,
        });
      }
      junction.egoTurn = {
        value: turns[0] as MTurn,
        essentiality: feature.egoTurn.essentiality,
        ...(feature.egoTurn.weight === undefined ? {} : { weight: feature.egoTurn.weight }),
      };
    }
    if (feature.conflictingApproach) {
      junction.conflictingApproach = {
        value: {
          from: approachRelation(
            feature.conflictingApproach.value.from,
            `${path}.conflictingApproach.from`,
            notes,
          ),
          turn: feature.conflictingApproach.value.turn as MTurn,
        },
        essentiality: feature.conflictingApproach.essentiality,
        ...(feature.conflictingApproach.weight === undefined
          ? {}
          : { weight: feature.conflictingApproach.weight }),
      };
    }
    const sizeM = clauseOf(feature.sizeM, closeRange);
    if (sizeM) junction.sizeM = sizeM;
    const hasCrossingOnLeg = clauseOf(feature.hasCrossingOnLeg, (v) => v);
    if (hasCrossingOnLeg) junction.hasCrossingOnLeg = hasCrossingOnLeg;
    if (Object.keys(junction).length > 0) out.junction = junction;
  } else if (feature.kind === 'crossing') {
    for (const key of ['marked', 'controlled', 'lengthM', 'placement'] as const) {
      if (feature[key] !== undefined) {
        notes.push({
          path: `${path}.${key}`,
          reason: 'the matcher has no crossing predicates; clause not evaluated',
        });
      }
    }
  } else if (feature.kind === 'parking_zone') {
    for (const key of ['orientation', 'capacity', 'occupancy', 'lengthM'] as const) {
      if (feature[key] !== undefined) {
        notes.push({
          path: `${path}.${key}`,
          reason: 'the matcher has no parking-zone predicates; clause not evaluated',
        });
      }
    }
  }

  return out;
}

function adaptRole(
  role: V2Role,
  template: ScenarioTemplateV2,
  scope: ExprScope,
  notes: AdaptNote[],
): MRole | null {
  const path = `roles.${role.id}`;
  const base = { role: role.id, essentiality: role.essentiality } as const;

  switch (role.kind) {
    case 'on_reference':
      return {
        ...base,
        kind: 'on_reference',
        dsM: numberish(role.pose.s, scope, 0),
        tFrac: numberish(role.pose.tFrac, scope, 0),
      };
    case 'lane_offset':
      return {
        ...base,
        kind: 'lane_offset',
        k: role.k,
        onMissing: role.onMissing,
        dsM: numberish(role.pose.s, scope, 0),
        tFrac: numberish(role.pose.tFrac, scope, 0),
      };
    case 'opposing':
      return {
        ...base,
        kind: 'opposing',
        index: role.k,
        dsM: numberish(role.pose.s, scope, 0),
        tFrac: numberish(role.pose.tFrac, scope, 0),
      };
    case 'conflicting_gate': {
      const angle = templateCrossingAngle(template, role.feature);
      return {
        ...base,
        kind: 'conflicting_gate',
        feature: role.feature,
        from: approachRelation(role.from, `${path}.from`, notes),
        turn: role.turn as MTurn,
        ...(angle === undefined ? {} : { templateCrossingAngleDeg: angle }),
        ...(role.arriveAtConflict
          ? {
              arriveAtConflict: {
                relativeTo: role.arriveAtConflict.relativeTo,
                deltaT: numberish(role.arriveAtConflict.deltaT, scope, 0),
              },
            }
          : {}),
      };
    }
    case 'on_crossing':
      return {
        ...base,
        kind: 'on_crossing',
        feature: role.feature,
        startFrac: role.startFrac,
        // The two vocabularies name the same two directions differently; the
        // mapping is positional and the materializer only uses the sign.
        direction: role.direction === 'near_to_far' ? 'left_to_right' : 'right_to_left',
      };
    case 'in_parking_zone': {
      let slotIndex = 0;
      if (typeof role.slot === 'number') slotIndex = role.slot;
      else if (role.slot === 'last') {
        notes.push({
          path: `${path}.slot`,
          reason: 'the matcher binds a parking zone as a point, so "last" resolves to the zone itself',
        });
      }
      const feature = template.anchor.features.find((f) => f.id === role.feature);
      const side = feature?.side?.value === 'left' ? 'left' : 'right';
      return { ...base, kind: 'in_parking_zone', feature: role.feature, side, slotIndex };
    }
    case 'relative_to':
      return {
        ...base,
        kind: 'relative_to',
        ref: role.ref,
        dLane: role.dLane,
        dsM: numberish(role.dsM, scope, 0),
        tFrac: role.tFrac,
      };
    case 'scene_absolute':
      notes.push({
        path,
        reason: 'scene_absolute roles are not portable and cannot be matched; role dropped',
      });
      return null;
  }
}

/** Adapt a parsed v2 template onto the matcher's anchor + role vocabulary. */
export function adaptTemplate(template: ScenarioTemplateV2): AdaptedAnchor {
  const notes: AdaptNote[] = [];
  const scope = templateStaticScope(template);

  // The origin is `features[0]` in both vocabularies (v2 has no
  // `originFeatureId`; the matcher defaults to the first feature).
  const originId = template.anchor.features[0]?.id;
  const features: MAnchor['features'] = [];
  for (const feature of template.anchor.features) {
    const adapted = adaptFeature(feature, feature.id === originId, notes);
    if (adapted) features.push(adapted);
  }

  const policy: Partial<MPolicy> = {
    allowMirror: template.anchor.policy.allowMirror,
    maxSitesPerMap: template.anchor.policy.maxSitesPerMap,
    diversity: DIVERSITY_MAP[template.anchor.policy.diversity] ?? 'junction',
    minScore: template.anchor.policy.minScore,
  };

  let pin: MAnchor['pin'];
  if (template.anchor.pin) {
    if (template.anchor.pin.siteId) {
      pin = { mapId: template.anchor.pin.mapId, siteId: template.anchor.pin.siteId };
    } else {
      notes.push({
        path: 'anchor.pin',
        reason: 'pin carries a map but no siteId (pin_site_unresolved); matching against the clauses instead',
      });
    }
  }

  const corridor = adaptCorridor(template, notes);
  const anchor: MAnchor = {
    id: template.anchor.id ?? 'anchor',
    ...(corridor && Object.keys(corridor).length > 0 ? { corridor } : {}),
    features,
    policy,
    ...(pin ? { pin } : {}),
  };

  const roles: MRole[] = [];
  for (const role of template.roles) {
    const adapted = adaptRole(role, template, scope, notes);
    if (adapted) roles.push(adapted);
  }

  return { anchor, roles, notes };
}
