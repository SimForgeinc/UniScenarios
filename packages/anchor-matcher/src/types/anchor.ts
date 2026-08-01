/**
 * `LogicalAnchor` — the LLM-emittable predicate over road structure.
 *
 * Shape follows `docs/research/retargeting.md` § LogicalAnchor exactly: flat,
 * enum-heavy, ranges as `[min, max]`, and **every clause is
 * `{value, essentiality, weight?}`** so the matcher can treat scoring
 * uniformly and explain every decision.
 *
 * This is a *local* declaration on purpose. `@uniscenarios/scenario-model`
 * v2 owns the authored document; the matcher only needs the data shape, and
 * duplicating ~150 lines of schema is much cheaper than a build-order cycle
 * between two in-flight packages. Reconciliation happens in the integration
 * lane — the seam is this file plus {@link parseLogicalAnchor}.
 *
 * No coordinates and no road ids are expressible anywhere below. That is the
 * point: a model cannot hallucinate a `roadId` it has no field for.
 */

import { z } from 'zod';

/** Inclusive `[min, max]` interval. Degenerate `[x, x]` is legal. */
export const RangeSchema = z
  .tuple([z.number(), z.number()])
  .refine(([lo, hi]) => lo <= hi, { message: 'range must be [min, max] with min <= max' });
export type Range = [number, number];

/**
 * How badly the author wants a clause.
 *
 * - `required` — pass/fail. A failure makes the site `infeasible`; no repair
 *   may relax it (that would be relaxing *intent*).
 * - `preferred` — weighted into the score; may be relaxed by a repair.
 * - `cosmetic` — weighted in at a low default weight; freely relaxable.
 */
export const EssentialitySchema = z.enum(['required', 'preferred', 'cosmetic']);
export type Essentiality = z.infer<typeof EssentialitySchema>;

/** Default weights when a clause omits `weight`. */
export const DEFAULT_WEIGHTS: Record<Essentiality, number> = {
  required: 1,
  preferred: 1,
  cosmetic: 0.25,
};

/** `{value, essentiality, weight?}` — the universal clause envelope. */
export function clause<T extends z.ZodType>(value: T) {
  return z.strictObject({
    value,
    essentiality: EssentialitySchema,
    weight: z.number().min(0).optional(),
    /** Per-clause override of the scoring tolerance band (clause-kind units). */
    tolerance: z.number().min(0).optional(),
  });
}

export interface Clause<T> {
  value: T;
  essentiality: Essentiality;
  weight?: number;
  tolerance?: number;
}

/** Lane kinds that may be required/forbidden beside the corridor. */
export const AdjacentKindSchema = z.enum([
  'parking',
  'biking',
  'sidewalk',
  'shoulder',
  'median',
  'opposing',
]);
export type AdjacentKind = z.infer<typeof AdjacentKindSchema>;

export const SideSchema = z.enum(['left', 'right', 'either', 'both']);
export type Side = z.infer<typeof SideSchema>;

/** Junction control classes. The near-miss table in `scoring.ts` is over these. */
export const JunctionControlSchema = z.enum([
  'signalized',
  'all_way_stop',
  'minor_stop',
  'yield',
  'uncontrolled',
  'roundabout',
]);
export type JunctionControl = z.infer<typeof JunctionControlSchema>;

export const TurnSchema = z.enum(['left', 'right', 'straight', 'uturn']);
export type Turn = z.infer<typeof TurnSchema>;

/** Where a conflicting movement comes from, relative to the ego approach. */
export const ApproachRelationSchema = z.enum(['opposing', 'from_left', 'from_right', 'merge']);
export type ApproachRelation = z.infer<typeof ApproachRelationSchema>;

/** Corridor clauses — the "what kind of road" half of the predicate. */
export const CorridorSchema = z.strictObject({
  throughLanesSameDir: clause(RangeSchema).optional(),
  throughLanesOpposing: clause(RangeSchema).optional(),
  laneWidthM: clause(RangeSchema).optional(),
  speedLimitKph: clause(RangeSchema).optional(),
  /** Minimum drivable metres upstream of the origin feature. */
  runwayUpstreamM: clause(z.number().min(0)).optional(),
  /** Minimum drivable metres downstream of the origin feature. */
  runwayDownstreamM: clause(z.number().min(0)).optional(),
  curvatureDegPer10m: clause(RangeSchema).optional(),
  gradePct: clause(RangeSchema).optional(),
  requiresAdjacent: clause(z.array(AdjacentKindSchema)).optional(),
  forbidsAdjacent: clause(z.array(AdjacentKindSchema)).optional(),
  laneChangeLegal: clause(
    z.strictObject({ side: SideSchema, sRange: RangeSchema }),
  ).optional(),
});
export type Corridor = {
  throughLanesSameDir?: Clause<Range>;
  throughLanesOpposing?: Clause<Range>;
  laneWidthM?: Clause<Range>;
  speedLimitKph?: Clause<Range>;
  runwayUpstreamM?: Clause<number>;
  runwayDownstreamM?: Clause<number>;
  curvatureDegPer10m?: Clause<Range>;
  gradePct?: Clause<Range>;
  requiresAdjacent?: Clause<AdjacentKind[]>;
  forbidsAdjacent?: Clause<AdjacentKind[]>;
  laneChangeLegal?: Clause<{ side: Side; sRange: Range }>;
};

/** Kinds of structural feature an anchor can name along the corridor. */
export const FeatureKindSchema = z.enum([
  'junction',
  'crossing',
  'merge',
  'lane_drop',
  'parking_zone',
  'bus_stop',
  'driveway',
]);
export type FeatureKind = z.infer<typeof FeatureKindSchema>;

/** Junction-specific predicates on a `kind: 'junction'` feature. */
export const JunctionPredicateSchema = z.strictObject({
  arms: clause(RangeSchema).optional(),
  control: clause(z.array(JunctionControlSchema).min(1)).optional(),
  egoTurn: clause(TurnSchema).optional(),
  conflictingApproach: clause(
    z.strictObject({ from: ApproachRelationSchema, turn: TurnSchema }),
  ).optional(),
  sizeM: clause(RangeSchema).optional(),
  hasCrossingOnLeg: clause(z.boolean()).optional(),
});
export type JunctionPredicate = {
  arms?: Clause<Range>;
  control?: Clause<JunctionControl[]>;
  egoTurn?: Clause<Turn>;
  conflictingApproach?: Clause<{ from: ApproachRelation; turn: Turn }>;
  sizeM?: Clause<Range>;
  hasCrossingOnLeg?: Clause<boolean>;
};

export const AnchorFeatureSchema = z.strictObject({
  id: z.string().min(1),
  kind: FeatureKindSchema,
  /** Signed distance range along the reference path from the frame origin. */
  atM: clause(RangeSchema),
  side: clause(SideSchema).optional(),
  junction: JunctionPredicateSchema.optional(),
});
export interface AnchorFeature {
  id: string;
  kind: FeatureKind;
  atM: Clause<Range>;
  side?: Clause<Side>;
  junction?: JunctionPredicate;
}

export const MatchPolicySchema = z.strictObject({
  allowMirror: z.boolean().default(false),
  maxSitesPerMap: z.number().int().min(1).default(10),
  /** Dedup granularity — "which lane" is a parameter, not three sites. */
  diversity: z.enum(['junction', 'road_direction', 'none']).default('junction'),
  minScore: z.number().min(0).max(1).default(0.5),
});
export interface MatchPolicy {
  allowMirror: boolean;
  maxSitesPerMap: number;
  diversity: 'junction' | 'road_direction' | 'none';
  minScore: number;
}

export const DEFAULT_POLICY: MatchPolicy = {
  allowMirror: false,
  maxSitesPerMap: 10,
  diversity: 'junction',
  minScore: 0.5,
};

/** Author-supplied overrides of the scoring tolerance bands. */
export const ToleranceOverridesSchema = z.strictObject({
  distanceM: z.number().min(0).optional(),
  speedKph: z.number().min(0).optional(),
  widthM: z.number().min(0).optional(),
  curvatureDegPer10m: z.number().min(0).optional(),
  countLanes: z.number().min(0).optional(),
  gradePct: z.number().min(0).optional(),
});
export type ToleranceOverrides = z.infer<typeof ToleranceOverridesSchema>;

export const LogicalAnchorSchema = z.strictObject({
  id: z.string().min(1),
  corridor: CorridorSchema.optional(),
  features: z.array(AnchorFeatureSchema).default([]),
  /** Which feature establishes `s = 0`. Defaults to `features[0]`. */
  originFeatureId: z.string().min(1).optional(),
  policy: MatchPolicySchema.optional(),
  /** RoadRunner-style manual pinning: the escape hatch, never the mechanism. */
  pin: z.strictObject({ mapId: z.string(), siteId: z.string() }).optional(),
  toleranceOverrides: ToleranceOverridesSchema.optional(),
});

export interface LogicalAnchor {
  id: string;
  corridor?: Corridor;
  features: AnchorFeature[];
  originFeatureId?: string;
  policy?: Partial<MatchPolicy>;
  pin?: { mapId: string; siteId: string };
  toleranceOverrides?: ToleranceOverrides;
}

/** Parse + default-fill an untrusted anchor (LLM output, JSON file, HTTP body). */
export function parseLogicalAnchor(input: unknown): LogicalAnchor {
  return LogicalAnchorSchema.parse(input) as LogicalAnchor;
}

/** Resolve the effective policy (anchor overrides on top of the defaults). */
export function resolvePolicy(anchor: LogicalAnchor): MatchPolicy {
  return { ...DEFAULT_POLICY, ...(anchor.policy ?? {}) };
}

/** The feature that establishes the frame origin, or `undefined` for a pure corridor anchor. */
export function originFeature(anchor: LogicalAnchor): AnchorFeature | undefined {
  if (anchor.features.length === 0) return undefined;
  if (anchor.originFeatureId) {
    return anchor.features.find((f) => f.id === anchor.originFeatureId) ?? anchor.features[0];
  }
  return anchor.features[0];
}

/** Effective weight of a clause. */
export function clauseWeight(c: Clause<unknown>): number {
  return c.weight ?? DEFAULT_WEIGHTS[c.essentiality];
}
