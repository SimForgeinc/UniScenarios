/** Portable, authored traffic-control furniture and its deterministic program. */
import { z } from 'zod';

import { NumberOrExprSchema } from '../../expr/index.js';
import { FeatureRefSchema } from './common.js';
import { FramePoseSchema } from './roles.js';

export const CONTROL_INDICATIONS = [
  'green', 'yellow', 'red', 'flashing_yellow', 'flashing_red', 'off',
  'green_arrow', 'yellow_arrow', 'red_x', 'proceed', 'stop',
] as const;

export const ControlIndicationSchema = z.enum(CONTROL_INDICATIONS);

export const TrafficControlPhaseSchema = z.strictObject({
  indication: ControlIndicationSchema,
  durationS: NumberOrExprSchema,
});

/** A portable stop line expressed in the scenario reference frame. */
export const PortableStopLineSchema = z.strictObject({
  pose: FramePoseSchema,
  feature: FeatureRefSchema.optional(),
});

/**
 * A temporary or scenario-owned control. Multiple controls may share a program
 * simply by authoring identical, offset phase lists (for example the two ends
 * of a one-lane work zone). `pose` is render placement; `stopLines` are the
 * executable right-of-way boundary and remain frame-relative across maps.
 */
export const TrafficControlSchema = z.strictObject({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  kind: z.enum(['temporary_signal', 'lane_control', 'normal_signal', 'human_director']),
  pose: FramePoseSchema,
  feature: FeatureRefSchema.optional(),
  stopLines: z.array(PortableStopLineSchema).min(1).max(8),
  phases: z.array(TrafficControlPhaseSchema).min(1).max(32),
  offsetS: NumberOrExprSchema.default(0),
  loop: z.boolean().default(false),
  label: z.string().max(200).optional(),
}).superRefine((control, ctx) => {
  const allowed: Record<typeof control.kind, readonly string[]> = {
    temporary_signal: ['green', 'yellow', 'red', 'flashing_yellow', 'flashing_red', 'off'],
    normal_signal: ['green', 'yellow', 'red', 'flashing_yellow', 'flashing_red', 'off'],
    lane_control: ['green_arrow', 'yellow_arrow', 'red_x', 'off'],
    human_director: ['proceed', 'stop'],
  };
  control.phases.forEach((phase, index) => {
    if (!allowed[control.kind].includes(phase.indication)) {
      ctx.addIssue({
        code: 'custom', path: ['phases', index, 'indication'],
        message: `${phase.indication} is not valid for ${control.kind}`,
      });
    }
  });
});

export type TrafficControl = z.infer<typeof TrafficControlSchema>;
export type TrafficControlInput = z.input<typeof TrafficControlSchema>;
