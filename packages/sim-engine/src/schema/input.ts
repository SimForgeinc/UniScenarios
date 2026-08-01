/**
 * `SimScenarioInput` — the engine's stable input contract.
 *
 * This is a **fully resolved concrete scenario**: no logical anchors, no
 * parameter references, no expressions, no map queries. Every actor already has
 * a pose, a route and numeric behaviour rules; every trigger already has
 * numeric thresholds. Producing one of these from a `ScenarioTemplate` v2 (site
 * match + parameter draw + expression evaluation) is the *adapter's* job and
 * lives in another package — this seam is what the adapter targets.
 *
 * The vocabulary mirrors `docs/research/interactions-and-edge-cases.md`
 * exactly: seven verbs over five axes, one uniform `dynamics` shape, and
 * `at | after | when` triggers (plus the pre-solved `arrival` form).
 *
 * Coordinates in this file are **scene frame** (`{x, z}`, y-up) — see
 * `src/frames.ts`.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ basics */

const finite = z.number().finite();
const nonNeg = finite.min(0);
const positive = finite.gt(0);

/** An `id` used to reference actors, interactions, signals and occluders. */
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/, 'id must be a printable reference token');

/** A ground-plane point in the scene frame. */
export const scenePointSchema = z.object({ x: finite, z: finite });
export type ScenePoint = z.infer<typeof scenePointSchema>;

/** A lane reference: `rsl` = `road:section:lane`, `s` = arc length along it. */
export const laneRefSchema = z.object({
  rsl: z.string().min(1),
  s: nonNeg,
  /** Lateral offset as a fraction of local lane width; 0 = centreline. */
  tFrac: finite.min(-2).max(2).default(0),
});
export type LaneRef = z.infer<typeof laneRefSchema>;

export const poseSchema = z.object({ x: finite, z: finite, headingRad: finite });
export type Pose = z.infer<typeof poseSchema>;

export const dimsSchema = z.object({ l: positive, w: positive, h: positive });
export type Dims = z.infer<typeof dimsSchema>;

/* ---------------------------------------------------------------- dynamics */

/**
 * The uniform dynamics descriptor. Mandatory on every shaped verb — never
 * defaulted, per the research doc's LLM-generation rules.
 *
 * - `rate`: m/s² for `speed`/`gap`, m/s lateral velocity for `changeLane`/
 *   `laneOffset` (this is R157's lateral-velocity parameterisation).
 * - `time`: seconds to complete the transition.
 * - `distance`: metres of longitudinal travel over which to complete it.
 */
export const dynamicsSchema = z.object({
  shape: z.enum(['step', 'linear', 'sinusoidal', 'cubic']),
  constraint: z.enum(['rate', 'time', 'distance']),
  value: positive,
});
export type Dynamics = z.infer<typeof dynamicsSchema>;

/* ------------------------------------------------------------------ routes */

export const turnRelationSchema = z.enum([
  'Straight',
  'Left',
  'Right',
  'UTurnLeft',
  'UTurnRight',
]);
export type TurnRelation = z.infer<typeof turnRelationSchema>;

/**
 * How an actor's path through the network is specified.
 *
 * - `lanePath` — an explicit ordered lane chain. Fully deterministic; what
 *   adapters should emit once a site is bound.
 * - `follow` — walk successors from a start lane, taking the listed turns at
 *   junctions (missing entries fall back to `Straight`, then to the
 *   lowest-`rsl` gate). Useful for hand-authored fixtures.
 * - `polyline` — an explicit ground path in scene coordinates. The pedestrian
 *   escape hatch (crossings, jaywalk diagonals); vehicles may use it too but
 *   then have no lane identity in the trace.
 */
export const routeSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('lanePath'),
    lanes: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('follow'),
    startRsl: z.string().min(1),
    turns: z.array(turnRelationSchema).default([]),
    maxLengthM: positive.default(2000),
  }),
  z.object({
    kind: z.literal('polyline'),
    points: z.array(scenePointSchema).min(2),
  }),
]);
export type RouteSpec = z.infer<typeof routeSpecSchema>;

/* ------------------------------------------------------------------- rules */

/**
 * The discrete behaviour switches. `collisionAvoidance: false` is the
 * make-or-break flag from the research doc — it disables the safety governor so
 * a challenger actually commits instead of chickening out.
 */
export const actorRulesSchema = z.object({
  obeySignals: z.boolean().default(true),
  yield: z.boolean().default(true),
  collisionAvoidance: z.boolean().default(true),
  /** 0 = timid, 1 = aggressive. Scales accepted gaps and comfort decel. */
  aggression: finite.min(0).max(1).default(0.5),
  /** Multiplier on the lane speed limit for free-flow cruising. */
  speedFactor: finite.min(0).max(3).default(1),
});
export type ActorRules = z.infer<typeof actorRulesSchema>;

/* ------------------------------------------------------------------ actors */

export const actorKindSchema = z.enum(['vehicle', 'pedestrian']);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const actorSchema = z.object({
  id: idSchema,
  kind: actorKindSchema,
  dims: dimsSchema,
  initial: z.object({
    /**
     * Where on the lane graph the actor starts. Optional: without it the engine
     * projects `pose` onto the route's first lane. With it, `pose` is treated
     * as advisory and the lane placement wins (adapters should emit both and
     * keep them consistent).
     */
    laneRef: laneRefSchema.optional(),
    pose: poseSchema,
    speedMps: nonNeg,
  }),
  behavior: z.object({
    rules: actorRulesSchema.default({
      obeySignals: true,
      yield: true,
      collisionAvoidance: true,
      aggression: 0.5,
      speedFactor: 1,
    }),
    route: routeSpecSchema,
    /**
     * Free-flow cruise speed override, m/s. Without it the actor cruises at
     * `speedFactor × laneSpeedLimit`.
     */
    cruiseSpeedMps: nonNeg.optional(),
  }),
  /** `false` = starts absent, waiting for an `exist(present)` interaction. */
  presentAtStart: z.boolean().default(true),
  /**
   * Static roadside actors (parked cars, stopped queues, barriers modelled as
   * actors) still occupy space and occlude sight lines, but they are excluded
   * from episode pair metrics so they cannot steal `minTTC` from the incident
   * pair they are only meant to reveal or hide.
   */
  static: z.boolean().default(false),
  /** Free-form tags carried through to the trace header (role, class, …). */
  tags: z.array(z.string()).default([]),
});
export type SimActor = z.infer<typeof actorSchema>;

/* ------------------------------------------------------------------- verbs */

/** `speed(target, dyn)` — abs | ±Δ | ×k | match another actor | stop. */
export const speedTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('absolute'), value: nonNeg }),
  z.object({ mode: z.literal('delta'), value: finite }),
  z.object({ mode: z.literal('factor'), value: nonNeg }),
  z.object({ mode: z.literal('match'), actorId: idSchema, offsetMps: finite.default(0) }),
  z.object({ mode: z.literal('stop') }),
]);
export type SpeedTarget = z.infer<typeof speedTargetSchema>;

export const laneChangeTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('left'), count: z.number().int().min(1).max(4).default(1) }),
  z.object({ mode: z.literal('right'), count: z.number().int().min(1).max(4).default(1) }),
  z.object({ mode: z.literal('lane'), rsl: z.string().min(1) }),
  z.object({ mode: z.literal('actorLane'), actorId: idSchema }),
]);
export type LaneChangeTarget = z.infer<typeof laneChangeTargetSchema>;

/** Keys the `set` verb understands. `rules.*` feed the controllers; the rest
 * are recorded state only (they exist so the renderer and the exporter can read
 * them back out of the trace). */
export const setKeySchema = z.string().regex(
  /^(rules\.(obeySignals|yield|collisionAvoidance|aggression|speedFactor)|lights\.[A-Za-z0-9_]+|doors\.[A-Za-z0-9_]+|pose\.[A-Za-z0-9_]+|env\.[A-Za-z0-9_]+|signal:[A-Za-z0-9._:@/-]+\.phase)$/,
  'unknown set() key — see the typed key registry',
);

export const verbSchema = z.discriminatedUnion('verb', [
  z.object({
    verb: z.literal('speed'),
    target: speedTargetSchema,
    dynamics: dynamicsSchema,
  }),
  z.object({
    verb: z.literal('gap'),
    target: z.object({ actorId: idSchema }),
    value: positive,
    mode: z.enum(['time', 'distance']),
    dynamics: dynamicsSchema,
  }),
  z.object({
    verb: z.literal('changeLane'),
    target: laneChangeTargetSchema,
    dynamics: dynamicsSchema,
  }),
  z.object({
    verb: z.literal('laneOffset'),
    target: z.object({ mode: z.enum(['meters', 'fraction']), value: finite }),
    dynamics: dynamicsSchema,
  }),
  z.object({ verb: z.literal('route'), target: routeSpecSchema }),
  z.object({ verb: z.literal('exist'), target: z.object({ state: z.enum(['present', 'absent']) }) }),
  z.object({
    verb: z.literal('set'),
    target: z.object({ key: setKeySchema, value: z.union([z.boolean(), finite, z.string()]) }),
  }),
]);
export type VerbSpec = z.infer<typeof verbSchema>;

/* ---------------------------------------------------------------- triggers */

export const regionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('circle'), center: scenePointSchema, radiusM: positive }),
  z.object({ kind: z.literal('polygon'), points: z.array(scenePointSchema).min(3) }),
  z.object({ kind: z.literal('laneWindow'), rsl: z.string().min(1), sMin: nonNeg, sMax: nonNeg }),
]);
export type Region = z.infer<typeof regionSchema>;

const cmp = z.enum(['lte', 'gte']);

/**
 * Trigger conditions. Every scalar comparison carries an explicit direction so
 * a generated scenario can never be ambiguous about which side fires.
 */
export type Condition =
  | { kind: 'distance'; a: string; b: string; mode: 'alongLane' | 'euclidean'; cmp: 'lte' | 'gte'; value: number }
  | { kind: 'ttc'; a: string; b: string; cmp: 'lte' | 'gte'; value: number }
  | { kind: 'headway'; a: string; b: string; cmp: 'lte' | 'gte'; value: number }
  | { kind: 'reaches'; actorId: string; region: Region }
  | { kind: 'speed'; actorId: string; cmp: 'lte' | 'gte'; value: number }
  | { kind: 'standstill'; actorId: string; durationS: number }
  | { kind: 'signal'; signalId: string; phase: 'green' | 'yellow' | 'red' }
  | { kind: 'collision'; a?: string; b?: string }
  | { kind: 'visible'; a: string; to: string; value: boolean }
  | { kind: 'and'; of: Condition[] }
  | { kind: 'or'; of: Condition[] }
  | { kind: 'not'; of: Condition };

/**
 * `and`/`or`/`not` are **shallow** by contract (research doc): one level of
 * nesting of leaf conditions. The schema enforces that — a boolean node's
 * children must be leaves.
 */
const leafConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('distance'),
    a: idSchema,
    b: idSchema,
    mode: z.enum(['alongLane', 'euclidean']),
    cmp,
    value: nonNeg,
  }),
  z.object({ kind: z.literal('ttc'), a: idSchema, b: idSchema, cmp, value: nonNeg }),
  z.object({ kind: z.literal('headway'), a: idSchema, b: idSchema, cmp, value: nonNeg }),
  z.object({ kind: z.literal('reaches'), actorId: idSchema, region: regionSchema }),
  z.object({ kind: z.literal('speed'), actorId: idSchema, cmp, value: nonNeg }),
  z.object({ kind: z.literal('standstill'), actorId: idSchema, durationS: nonNeg }),
  z.object({
    kind: z.literal('signal'),
    signalId: idSchema,
    phase: z.enum(['green', 'yellow', 'red']),
  }),
  z.object({ kind: z.literal('collision'), a: idSchema.optional(), b: idSchema.optional() }),
  z.object({ kind: z.literal('visible'), a: idSchema, to: idSchema, value: z.boolean() }),
]);

export const conditionSchema: z.ZodType<Condition> = z.union([
  leafConditionSchema,
  z.object({ kind: z.literal('and'), of: z.array(leafConditionSchema).min(1).max(8) }),
  z.object({ kind: z.literal('or'), of: z.array(leafConditionSchema).min(1).max(8) }),
  z.object({ kind: z.literal('not'), of: leafConditionSchema }),
]) as unknown as z.ZodType<Condition>;

/** Where the arrival solver aims the actor. */
export const arrivalPointSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('point'),
    at: scenePointSchema,
    /**
     * Optional proof that this point was authored from a reference-frame
     * cross-section. Each station is the same longitudinal cross-section on a
     * concrete lane. An actor route containing one of those lanes therefore
     * resolves the arrival semantically, even when the authored point is one or
     * more lane widths away from its centreline.
     */
    referenceFrame: z
      .object({
        stations: z.array(z.object({ rsl: z.string().min(1), s: nonNeg })).min(1),
      })
      .optional(),
  }),
  z.object({ kind: z.literal('laneS'), rsl: z.string().min(1), s: nonNeg }),
]);
export type ArrivalPoint = z.infer<typeof arrivalPointSchema>;

/**
 * The arrival spec. Exactly one of `ttc` / `deltaT`:
 *
 * - `ttc: 1.5` — when `of` reaches the conflict point, `syncWith` is 1.5 s away
 *   from it (the Euro-NCAP / Scenic reading of "declared criticality").
 * - `deltaT: -1.5` — `of` reaches the point 1.5 s *before* `syncWith`.
 *
 * They are the same number with opposite sign: `ttc === -deltaT`.
 */
export const arrivalSpecSchema = z
  .object({
    of: idSchema,
    at: arrivalPointSchema,
    syncWith: idSchema,
    ttc: finite.optional(),
    deltaT: finite.optional(),
  })
  .refine((v) => (v.ttc === undefined) !== (v.deltaT === undefined), {
    message: 'arrival requires exactly one of ttc | deltaT',
  });
export type ArrivalSpec = z.infer<typeof arrivalSpecSchema>;

/**
 * `when` carries a mandatory `byLatest` — a condition that never fires is a
 * silent bug, so the author must say what happens instead.
 */
export const triggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('at'), t: finite }),
  z.object({ kind: z.literal('after'), interactionId: idSchema, delayS: nonNeg.default(0) }),
  z.object({
    kind: z.literal('when'),
    condition: conditionSchema,
    byLatest: finite,
    ifNever: z.enum(['skip', 'fire']),
  }),
  z.object({ kind: z.literal('arrival'), arrival: arrivalSpecSchema }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

/* ------------------------------------------------------------ interactions */

export const interactionSchema = z.intersection(
  z.object({
    id: idSchema,
    actorId: idSchema,
    trigger: triggerSchema,
    /** Releases the axis back to default behaviour when satisfied. */
    until: conditionSchema.optional(),
  }),
  verbSchema,
);
export type Interaction = z.infer<typeof interactionSchema>;

/* ----------------------------------------------------- signals & occluders */

export const signalProgramSchema = z.object({
  id: idSchema,
  /**
   * One cycle. Phases play in order from `t = -warmupSeconds + offsetS` and
   * repeat when `loop` (the default).
   */
  phases: z
    .array(z.object({ phase: z.enum(['green', 'yellow', 'red']), durationS: positive }))
    .min(1),
  offsetS: finite.default(0),
  loop: z.boolean().default(true),
  /**
   * Stop lines this program controls. An actor whose route crosses one of these
   * lanes brakes for the line when the phase forbids entry.
   */
  stopLines: z
    .array(z.object({
      rsl: z.string().min(1),
      s: nonNeg,
      /**
       * Optional movement filter. A stop line only applies when the actor's
       * route continues through one of these junction lanes. This keeps a
       * protected left-turn head from stopping adjacent through traffic that
       * happens to share the same approach lane.
       */
      connectingLaneRsls: z.array(z.string().min(1)).default([]),
    }))
    .default([]),
  /** Stable binding back to the map's physical signal furniture/export ids. */
  mapBinding: z.object({
    junctionId: z.string().min(1),
    controllerIds: z.array(z.string().min(1)).default([]),
    headIds: z.array(z.string().min(1)).min(1),
    /** Honest provenance for programs derived without authoritative timing. */
    timingSource: z.enum(['map', 'synthetic-default', 'authored']),
  }).optional(),
});
export type SignalProgram = z.infer<typeof signalProgramSchema>;

/** Static line-of-sight blockers, in the scene frame. */
export const occluderSchema = z.object({
  /** Concrete shape id; repeated author-level props materialize as one shape per member. */
  id: idSchema,
  /** Optional author-level aggregate id shared by repeated concrete shapes. */
  groupId: idSchema.optional(),
  obb: z.object({
    center: scenePointSchema,
    lengthM: positive,
    widthM: positive,
    headingRad: finite,
    heightM: positive.default(2),
  }),
});
export type Occluder = z.infer<typeof occluderSchema>;

/** An authored line-of-sight relation the occluder layer is supposed to affect. */
export const occlusionPairSchema = z.object({
  observer: idSchema,
  target: idSchema,
  /** Concrete occluder id, occluder groupId, or static actor ref (`actor:<id>`). */
  occluderId: idSchema.optional(),
});
export type OcclusionPair = z.infer<typeof occlusionPairSchema>;

/* ------------------------------------------------------------- the document */

export const simScenarioInputSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    /** Informational: which map the `rsl` references belong to. */
    mapId: z.string().min(1).default('unknown'),
    /** Recorded clip length in seconds; the trace covers `t ∈ [0, clipSeconds]`. */
    clipSeconds: positive.default(20),
    /** Unrecorded prologue `t ∈ [-warmupSeconds, 0)`. */
    warmupSeconds: nonNeg.default(5),
    /** Fixed integration step, seconds. */
    dt: positive.max(0.2).default(0.02),
    seed: z.union([z.number().int(), z.string()]).default(0),
    /** Which actor the criticality metrics are reported against. */
    metricSubject: idSchema.optional(),
    actors: z.array(actorSchema).min(1),
    interactions: z.array(interactionSchema).default([]),
    signalPrograms: z.array(signalProgramSchema).default([]),
    occluders: z.array(occluderSchema).default([]),
    occlusionPairs: z.array(occlusionPairSchema).default([]),
  })
  .superRefine((doc, ctx) => {
    const actorIds = new Set<string>();
    for (const a of doc.actors) {
      if (actorIds.has(a.id)) {
        ctx.addIssue({ code: 'custom', path: ['actors'], message: `duplicate actor id ${a.id}` });
      }
      actorIds.add(a.id);
    }
    const interactionIds = new Set<string>();
    for (let i = 0; i < doc.interactions.length; i++) {
      const it = doc.interactions[i]!;
      if (interactionIds.has(it.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['interactions', i, 'id'],
          message: `duplicate interaction id ${it.id}`,
        });
      }
      interactionIds.add(it.id);
      if (!actorIds.has(it.actorId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['interactions', i, 'actorId'],
          message: `unknown actor ${it.actorId}`,
        });
      }
    }
    for (let i = 0; i < doc.interactions.length; i++) {
      const it = doc.interactions[i]!;
      if (it.trigger.kind === 'after' && !interactionIds.has(it.trigger.interactionId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['interactions', i, 'trigger', 'interactionId'],
          message: `after() references unknown interaction ${it.trigger.interactionId}`,
        });
      }
    }
    if (doc.metricSubject !== undefined && !actorIds.has(doc.metricSubject)) {
      ctx.addIssue({ code: 'custom', path: ['metricSubject'], message: 'unknown actor' });
    }
    const occluderIds = new Set<string>();
    const occluderGroupIds = new Set<string>();
    for (let i = 0; i < doc.occluders.length; i++) {
      const o = doc.occluders[i]!;
      if (occluderIds.has(o.id)) {
        ctx.addIssue({ code: 'custom', path: ['occluders', i, 'id'], message: `duplicate occluder id ${o.id}` });
      }
      occluderIds.add(o.id);
      if (o.groupId) occluderGroupIds.add(o.groupId);
    }
    for (let i = 0; i < doc.occluders.length; i++) {
      const groupId = doc.occluders[i]!.groupId;
      if (groupId && occluderIds.has(groupId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['occluders', i, 'groupId'],
          message: `occluder group ${groupId} collides with a concrete occluder id`,
        });
      }
    }
    const staticActorOccluderIds = new Set(doc.actors.filter((a) => a.static).map((a) => `actor:${a.id}`));
    for (let i = 0; i < doc.occlusionPairs.length; i++) {
      const pair = doc.occlusionPairs[i]!;
      if (!actorIds.has(pair.observer)) {
        ctx.addIssue({
          code: 'custom',
          path: ['occlusionPairs', i, 'observer'],
          message: `unknown actor ${pair.observer}`,
        });
      }
      if (!actorIds.has(pair.target)) {
        ctx.addIssue({
          code: 'custom',
          path: ['occlusionPairs', i, 'target'],
          message: `unknown actor ${pair.target}`,
        });
      }
      if (
        pair.occluderId !== undefined &&
        !occluderIds.has(pair.occluderId) &&
        !occluderGroupIds.has(pair.occluderId) &&
        !staticActorOccluderIds.has(pair.occluderId)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['occlusionPairs', i, 'occluderId'],
          message: `unknown occluder or occluder group ${pair.occluderId}`,
        });
      }
    }
    const signalIds = new Set(doc.signalPrograms.map((p) => p.id));
    for (let i = 0; i < doc.signalPrograms.length; i++) {
      const p = doc.signalPrograms[i]!;
      if (doc.signalPrograms.findIndex((q) => q.id === p.id) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: ['signalPrograms', i, 'id'],
          message: `duplicate signal program ${p.id}`,
        });
      }
    }
    void signalIds;
  });

export type SimScenarioInput = z.infer<typeof simScenarioInputSchema>;
/** The pre-parse shape: everything with a default is optional. */
export type SimScenarioInputSpec = z.input<typeof simScenarioInputSchema>;

/**
 * Parse + normalise. Throws a `ZodError`; use `safeParseSimScenarioInput` when
 * you want structured issues for a repair loop.
 */
export function parseSimScenarioInput(value: unknown): SimScenarioInput {
  return simScenarioInputSchema.parse(value);
}

function byId<T extends { id: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Canonical ordering: every keyed collection sorted by id.
 *
 * The engine iterates in sorted order anyway, so normalising does not change
 * behaviour — but it makes `contentHash(input)` (and therefore
 * `trace.header.inputHash`) independent of the order an adapter happened to
 * emit its actors in. `determinism.test.ts` relies on exactly this.
 */
export function normalizeSimScenarioInput(input: SimScenarioInput): SimScenarioInput {
  return {
    ...input,
    actors: byId(input.actors),
    interactions: byId(input.interactions),
    signalPrograms: byId(input.signalPrograms),
    occluders: byId(input.occluders),
    occlusionPairs: [...input.occlusionPairs].sort(
      (a, b) =>
        a.observer.localeCompare(b.observer) ||
        a.target.localeCompare(b.target) ||
        (a.occluderId ?? '').localeCompare(b.occluderId ?? ''),
    ),
  };
}

/** A schema violation flattened for an unattended repair loop. */
export interface SimSchemaIssue {
  readonly code: string;
  /** Dotted path into the document, e.g. `actors.1.behavior.route.lanes`. */
  readonly path: string;
  readonly message: string;
}

export function safeParseSimScenarioInput(
  value: unknown,
): { ok: true; value: SimScenarioInput } | { ok: false; issues: SimSchemaIssue[] } {
  const r = simScenarioInputSchema.safeParse(value);
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.map((i) => ({
    code: String(i.code),
    path: i.path.map((p) => String(p)).join('.'),
    message: i.message,
  }));
  return { ok: false, issues };
}
