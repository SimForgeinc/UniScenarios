/**
 * Layer 3 of the PEGASUS stack: temporary modifications — the placeable prop
 * layer (parked rows, cones, barriers, hedges, double-parked trucks).
 *
 * Props are frame-relative like roles, and they reference the prop catalog by
 * id. Two design points:
 *
 * 1. **Occlusion is a modifier, not a scenario.** A prop that occludes carries
 *    `targetRevealToConflictS` — the derived metric that actually matters
 *    (line-of-sight opening → collision point at current closing speeds;
 *    critical band 0.4–1.5 s). The author tunes that readout, not the prop's
 *    metres. Because the metric is a relation between an observer and a target,
 *    `occludes` (who is hidden from whom) is required whenever the target time
 *    is set — a bare "reveal time" with no pair is meaningless, and the
 *    structural validator says so rather than guessing the pair.
 * 2. **`repeat` exists** because a parked row is twenty props and no author
 *    should place twenty props. It expands at instantiation time, not here.
 */

import { z } from 'zod';

import { ExprSchema, NumberOrExprSchema } from '../../expr/index.js';
import { FeatureRefSchema, PropIdSchema, RoleRefSchema, V2ExtensionsSchema } from './common.js';
import { FramePoseSchema } from './roles.js';

/** Who is prevented from seeing whom. */
export const OcclusionPairSchema = z.strictObject({
  /** The actor whose view is blocked (usually the metric subject). */
  observer: RoleRefSchema,
  /** The actor that is hidden. */
  target: RoleRefSchema,
});

const TFracOrExprSchema = z.union([z.number().min(-1).max(1), ExprSchema]);

/** Repeat a prop along the corridor — parked rows, cone tapers, barrier runs. */
export const PropRepeatSchema = z.strictObject({
  count: z.number().int().min(2).max(200),
  /** Longitudinal spacing between instances, metres. */
  spacingM: NumberOrExprSchema,
  /** Lateral drift per instance, fraction of lane width — makes a taper. May be parameterised. */
  tFracStep: TFracOrExprSchema.default(0),
});

/**
 * Rigidly attach a prop to an actor-local frame. Longitudinal is forward,
 * lateral is left, and height is above the carrier's ground-contact point.
 * The prop inherits the carrier's route pose for the complete episode.
 */
export const PropAttachmentSchema = z.strictObject({
  role: RoleRefSchema,
  longitudinalM: z.number().finite().min(-20).max(20).default(0),
  lateralM: z.number().finite().min(-20).max(20).default(0),
  heightM: z.number().finite().min(0).max(20).default(0),
  headingOffsetRad: z.number().min(-Math.PI).max(Math.PI).default(0),
});

/** One placed prop (or a repeated run of them). */
export const PropPlacementSchema = z.strictObject({
  id: PropIdSchema,
  /** Prop catalog id. Resolved at author time; a miss must fail loudly. */
  catalogId: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  /** Frame-relative placement. */
  pose: FramePoseSchema,
  /** Anchor the pose to a feature instead of the frame origin. */
  feature: FeatureRefSchema.optional(),
  /** Rigid actor-local attachment; `pose` remains the authoring/fallback pose. */
  attachment: PropAttachmentSchema.optional(),
  /** Yaw relative to the lane tangent, radians. */
  headingOffsetRad: z.number().min(-Math.PI).max(Math.PI).default(0),
  /** Uniform scale. Height class is what decides whether a prop occludes. */
  scale: z.number().positive().max(10).default(1),
  /** Declares the prop as a sight-line blocker between two roles. */
  occludes: OcclusionPairSchema.optional(),
  /**
   * The authored criticality of the occlusion, seconds. The solver nudges the
   * prop along the corridor until the simulated reveal-to-conflict time matches.
   */
  targetRevealToConflictS: NumberOrExprSchema.optional(),
  repeat: PropRepeatSchema.optional(),
  /** `cosmetic` props may be dropped by degradation; occluders never should be. */
  essentiality: z.enum(['required', 'preferred', 'cosmetic']).default('preferred'),
  extensions: V2ExtensionsSchema.optional(),
});

/**
 * A lane closure — the drivable surface itself, not scenery.
 *
 * `close_lane` used to mean "place cones". The drivable surface was untouched, every actor's route
 * still ran straight through the devices, and the ego drove into the barriers: 91 of 126 cells with
 * contact on the first honest attempt (`tools/STATE.json` blocker B1), 45 of 60 on the probe here.
 * A closure that does not change where vehicles may drive is a decoration.
 *
 * The author states *what is closed*, never where a cone goes:
 *
 *     { id: 'wz', fromS: 60, toS: 110, closedWidthM: 1.8, side: 'right', device: 'cone' }
 *
 * and the materializer solves the rest from that one description — MUTCD taper length and device
 * spacing, every device pose, the lane-availability override handed to the engine, and the shifted
 * travel path through the works. Devices and detour therefore come from a SINGLE source of truth
 * and cannot drift apart. Authoring them separately is what leaves residual contacts: measured
 * 15/60 with a hand-authored detour against 0/60 when both are solved from the closure.
 */
export const LaneClosureSchema = z.strictObject({
  id: PropIdSchema,
  label: z.string().max(200).optional(),
  /** Signed same-direction lane index; 0 is the reference lane. */
  laneOffset: z.number().int().min(-8).max(8).default(0),
  /** Start of the closed span (the downstream end of the taper), frame metres. */
  fromS: NumberOrExprSchema,
  /** End of the closed span, frame metres. */
  toS: NumberOrExprSchema,
  /** How much of the lane width is taken, measured in from `side`. */
  closedWidthM: NumberOrExprSchema,
  /** Which edge the works are against. */
  side: z.enum(['left', 'right']).default('right'),
  /** Channelizing device. Height and spacing come from the catalog and MUTCD, not the author. */
  device: z.enum(['cone', 'drum', 'barricade', 'barrier']).default('cone'),
  /** Design speed for the MUTCD taper. Defaults to the site's posted limit when omitted. */
  assumedSpeedKph: NumberOrExprSchema.optional(),
  /**
   * Shift traffic around the works rather than leaving routes running through them.
   *
   * `true` is the MUTCD Fig. 6H-9 lane shift and is the whole point of the operation. `false`
   * exists only to author a genuinely impassable closure — a road actually shut — and then the
   * ego is expected to stop, not to thread the devices.
   */
  shiftTraffic: z.boolean().default(true),
  /** Advance warning sign distance upstream of the taper, metres. */
  advanceWarningM: NumberOrExprSchema.optional(),
  essentiality: z.enum(['required', 'preferred', 'cosmetic']).default('required'),
});

/** A lane closure. */
export type LaneClosure = z.infer<typeof LaneClosureSchema>;
/** A lane closure as authored. */
export type LaneClosureInput = z.input<typeof LaneClosureSchema>;

/** A placed prop. */
export type PropPlacement = z.infer<typeof PropPlacementSchema>;
/** A placed prop as authored. */
export type PropPlacementInput = z.input<typeof PropPlacementSchema>;
export type PropAttachment = z.infer<typeof PropAttachmentSchema>;
/** An occlusion pair. */
export type OcclusionPair = z.infer<typeof OcclusionPairSchema>;
