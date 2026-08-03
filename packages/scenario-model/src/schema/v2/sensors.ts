/** Sensors rigidly mounted to an actor. */

import { z } from 'zod';

import { EntityIdSchema, Vec3Schema } from '../v1.js';

/** Actor classes that currently have a supported physical dash-camera mount. */
export const DASH_CAMERA_ACTOR_CLASSES = [
  'car',
  'truck',
  'bus',
  'van',
  'motorcycle',
] as const;

export type DashCameraActorClass = (typeof DASH_CAMERA_ACTOR_CLASSES)[number];

/** Euler orientation in the actor-local frame, in radians. */
export const SensorRotationSchema = z.strictObject({
  yawRad: z.number().min(-Math.PI).max(Math.PI).default(0),
  pitchRad: z.number().min(-Math.PI / 2).max(Math.PI / 2).default(0),
  rollRad: z.number().min(-Math.PI).max(Math.PI).default(0),
});

/**
 * Rigid mount in actor-local metres: +X forward, +Y up and +Z left.
 * Rotation is applied yaw (+Y), pitch (+Z), then roll (+X).
 */
export const SensorMountSchema = z.strictObject({
  position: Vec3Schema,
  rotation: SensorRotationSchema.prefault({}),
});

export const DashCameraIntrinsicsSchema = z.strictObject({
  horizontalFovDeg: z.number().min(10).max(170).default(90),
  nearM: z.number().positive().max(10).default(0.05),
  farM: z.number().positive().max(100_000).default(1_000),
  aspectRatio: z.number().positive().max(10).default(1.777778),
}).check((ctx) => {
  if (ctx.value.farM <= ctx.value.nearM) {
    ctx.issues.push({
      code: 'custom',
      message: 'farM must be greater than nearM',
      path: ['farM'],
      input: ctx.value.farM,
    });
  }
});

/** First actor-attached sensor type. The discriminator leaves room for lidar etc. */
export const DashCameraSensorSchema = z.strictObject({
  id: EntityIdSchema,
  type: z.literal('dash_camera'),
  label: z.string().min(1).max(200).optional(),
  enabled: z.boolean().default(true),
  mount: SensorMountSchema,
  camera: DashCameraIntrinsicsSchema.prefault({}),
});

export const ActorSensorSchema = z.discriminatedUnion('type', [DashCameraSensorSchema]);

export type SensorRotation = z.infer<typeof SensorRotationSchema>;
export type SensorMount = z.infer<typeof SensorMountSchema>;
export type DashCameraIntrinsics = z.infer<typeof DashCameraIntrinsicsSchema>;
export type DashCameraSensor = z.infer<typeof DashCameraSensorSchema>;
export type ActorSensor = z.infer<typeof ActorSensorSchema>;

export function isDashCamera(sensor: ActorSensor): sensor is DashCameraSensor {
  return sensor.type === 'dash_camera';
}

/** Deterministic discovery: authoring order, optionally including disabled sensors. */
export function dashCameras(
  actor: { sensors: readonly ActorSensor[] },
  options: { includeDisabled?: boolean } = {},
): DashCameraSensor[] {
  return actor.sensors.filter(
    (sensor): sensor is DashCameraSensor =>
      isDashCamera(sensor) && (options.includeDisabled === true || sensor.enabled),
  );
}

export function firstEnabledDashCamera(
  actor: { sensors: readonly ActorSensor[] },
): DashCameraSensor | undefined {
  return dashCameras(actor)[0];
}

export interface ActorForDashCamera {
  class: string;
  dims?: { length: number; width: number; height: number };
}

export function supportsDashCamera(actor: Pick<ActorForDashCamera, 'class'>): boolean {
  return (DASH_CAMERA_ACTOR_CLASSES as readonly string[]).includes(actor.class);
}

/** Stable, schema-legal sensor id. It is generated once when the sensor is added. */
export function newSensorId(): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `dash-camera-${time}-${random}`.slice(0, 64);
}

/** A forward-facing windscreen/dash mount scaled to the actor's authored box. */
export function defaultDashCamera(actor: ActorForDashCamera, id: string = newSensorId()): DashCameraSensor {
  if (!supportsDashCamera(actor)) {
    throw new Error(`dash cameras are not supported on actor class "${actor.class}"`);
  }
  const length = actor.dims?.length ?? 4.8;
  const height = actor.dims?.height ?? 1.5;
  return {
    id,
    type: 'dash_camera',
    enabled: true,
    mount: {
      position: {
        x: Math.max(0, length / 2 - 0.35),
        y: Math.max(0.5, height * 0.72),
        z: 0,
      },
      rotation: { yawRad: 0, pitchRad: 0, rollRad: 0 },
    },
    camera: {
      horizontalFovDeg: 90,
      nearM: 0.05,
      farM: 1_000,
      aspectRatio: 1.777778,
    },
  };
}
