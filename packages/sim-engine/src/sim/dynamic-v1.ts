import { angleDelta, clamp, normalizeAngle } from '../core/math.js';
import type { VehiclePhysicsProfile } from '../schema/input.js';
import type {
  MotionActorInitialization,
  MotionBackend,
  MotionIntent,
  MotionStepResult,
  PhysicsTelemetrySample,
  VehicleControl,
  VehicleMotionState,
} from './motion-backend.js';
import {
  solvePlanarCollisions,
  type CollisionImpulse,
  type PlanarCollisionBody,
  type PlanarStaticCollider,
} from './collision-response.js';

const G = 9.80665;
export const DYNAMIC_V1_DEFAULT_SUBSTEP_S = 0.005;

export interface ResolvedVehiclePhysicsProfile {
  readonly massKg: number;
  readonly yawInertiaKgM2: number;
  readonly wheelbaseM: number;
  readonly cgToFrontM: number;
  readonly cgHeightM: number;
  readonly wheelRadiusM: number;
  readonly corneringStiffnessFrontNPerRad: number;
  readonly corneringStiffnessRearNPerRad: number;
  readonly dragCoefficientNPerMps2: number;
  readonly rollingResistanceCoefficient: number;
  readonly maxDriveForceN: number;
  readonly maxBrakeForceN: number;
  readonly maxSteerRad: number;
  readonly steerRateRadPerS: number;
  readonly steerTimeConstantS: number;
  readonly tireMu: number;
}

/** Calibrated generic 1.5-tonne passenger car; not a make/model claim. */
export const GENERIC_PASSENGER_CAR_PROFILE: ResolvedVehiclePhysicsProfile = {
  massKg: 1_500,
  yawInertiaKgM2: 2_500,
  wheelbaseM: 2.7,
  cgToFrontM: 1.2,
  cgHeightM: 0.55,
  wheelRadiusM: 0.31,
  corneringStiffnessFrontNPerRad: 82_000,
  corneringStiffnessRearNPerRad: 88_000,
  dragCoefficientNPerMps2: 0.42,
  rollingResistanceCoefficient: 0.012,
  maxDriveForceN: 5_500,
  maxBrakeForceN: 13_500,
  maxSteerRad: 0.58,
  steerRateRadPerS: 4.5,
  steerTimeConstantS: 0.12,
  tireMu: 1,
};

export function resolveVehiclePhysicsProfile(
  override: VehiclePhysicsProfile | undefined,
): ResolvedVehiclePhysicsProfile {
  const profile = { ...GENERIC_PASSENGER_CAR_PROFILE, ...override };
  // The schema validates authored input. These relational checks also protect
  // direct library callers and keep axle geometry physically meaningful.
  if (profile.cgToFrontM >= profile.wheelbaseM) {
    throw new Error('dynamic-v1 cgToFrontM must be less than wheelbaseM');
  }
  return profile;
}

interface MutableVehicleState {
  x: number;
  y: number;
  yawRad: number;
  longitudinalVelocityMps: number;
  lateralVelocityMps: number;
  yawRateRadps: number;
  steerRad: number;
  wheelAngularSpeedRadps: number;
  longitudinalAccelerationMps2: number;
}

interface VehicleEntry {
  readonly profile: ResolvedVehiclePhysicsProfile;
  readonly state: MutableVehicleState;
  previous: Pick<MutableVehicleState, 'x' | 'y' | 'yawRad'>;
  telemetry: PhysicsTelemetrySample;
}

const ZERO_CONTROL: VehicleControl = { throttle: 0, brake: 0, steer: 0 };

function zeroTelemetry(substepS: number): PhysicsTelemetrySample {
  return {
    control: ZERO_CONTROL,
    longitudinalForceN: 0,
    frontLateralForceN: 0,
    rearLateralForceN: 0,
    frontNormalForceN: 0,
    rearNormalForceN: 0,
    tireUtilization: 0,
    substeps: 0,
    substepS,
    collisionImpulseNs: 0,
    collisionCount: 0,
  };
}

function controlFor(
  state: MutableVehicleState,
  profile: ResolvedVehiclePhysicsProfile,
  intent: MotionIntent,
): VehicleControl {
  const speedError = intent.targetSpeedMps - state.longitudinalVelocityMps;
  const desiredAccel = intent.targetAccelerationMps2 + 1.25 * speedError;
  const resistance =
    profile.dragCoefficientNPerMps2 * state.longitudinalVelocityMps ** 2 +
    profile.rollingResistanceCoefficient * profile.massKg * G;
  const requestedForce = profile.massKg * desiredAccel + resistance;
  const throttle = clamp(requestedForce / profile.maxDriveForceN, 0, 1);
  const brake = clamp(-requestedForce / profile.maxBrakeForceN, 0, 1);

  const dx = intent.previewPoint.x - state.x;
  const dy = intent.previewPoint.y - state.y;
  const previewDistance = Math.max(Math.hypot(dx, dy), 1);
  const bearing = Math.atan2(dy, dx);
  const alpha = angleDelta(state.yawRad, bearing);
  const purePursuit = Math.atan2(2 * profile.wheelbaseM * Math.sin(alpha), previewDistance);
  const headingCorrection = 0.35 * angleDelta(state.yawRad, intent.previewHeadingRad);
  const steerRad = clamp(purePursuit + headingCorrection, -profile.maxSteerRad, profile.maxSteerRad);
  return { throttle, brake, steer: steerRad / profile.maxSteerRad };
}

function frictionEllipseLateral(
  desiredFy: number,
  fx: number,
  normalN: number,
  mu: number,
): { force: number; utilization: number } {
  const capacity = Math.max(mu * normalN, 1);
  const remaining = Math.sqrt(Math.max(0, capacity * capacity - fx * fx));
  const force = clamp(desiredFy, -remaining, remaining);
  return { force, utilization: Math.hypot(fx, force) / capacity };
}

/** Deterministic planar bicycle solver with a WASM-friendly numeric boundary. */
export class DynamicV1Backend implements MotionBackend {
  readonly id = 'dynamic-v1';
  readonly version = 1;
  readonly substepS: number;
  private readonly vehicles = new Map<string, VehicleEntry>();

  constructor(substepS = DYNAMIC_V1_DEFAULT_SUBSTEP_S) {
    if (!(substepS > 0)) throw new Error('dynamic-v1 substepS must be positive');
    this.substepS = substepS;
  }

  register(input: MotionActorInitialization): void {
    const u = input.state.longitudinalVelocityMps;
    const profile = resolveVehiclePhysicsProfile(input.profile);
    this.vehicles.set(input.actorId, {
      profile,
      state: {
        x: input.state.x,
        y: input.state.y,
        yawRad: input.state.yawRad,
        longitudinalVelocityMps: u,
        lateralVelocityMps: input.state.lateralVelocityMps ?? 0,
        yawRateRadps: input.state.yawRateRadps ?? 0,
        steerRad: input.state.steerRad ?? 0,
        wheelAngularSpeedRadps: input.state.wheelAngularSpeedRadps ?? u / profile.wheelRadiusM,
        longitudinalAccelerationMps2: input.state.longitudinalAccelerationMps2 ?? 0,
      },
      previous: { x: input.state.x, y: input.state.y, yawRad: input.state.yawRad },
      telemetry: zeroTelemetry(this.substepS),
    });
  }

  state(actorId: string): VehicleMotionState | undefined {
    const value = this.vehicles.get(actorId)?.state;
    return value ? { ...value } : undefined;
  }

  telemetry(actorId: string): PhysicsTelemetrySample | undefined {
    const value = this.vehicles.get(actorId)?.telemetry;
    return value ? { ...value, control: { ...value.control } } : undefined;
  }

  step(actorId: string, intent: MotionIntent, dtS: number, frictionScale: number): MotionStepResult {
    const entry = this.vehicles.get(actorId);
    if (!entry) throw new Error(`dynamic-v1 actor is not registered: ${actorId}`);
    if (!(dtS > 0)) throw new Error('dynamic-v1 step dtS must be positive');
    const count = Math.max(1, Math.ceil(dtS / this.substepS - 1e-12));
    const h = dtS / count;
    entry.previous = { x: entry.state.x, y: entry.state.y, yawRad: entry.state.yawRad };
    let telemetry = zeroTelemetry(h);
    for (let i = 0; i < count; i++) telemetry = this.integrate(entry, intent, h, frictionScale);
    entry.telemetry = { ...telemetry, substeps: count, substepS: h };
    return { state: { ...entry.state }, telemetry: entry.telemetry };
  }

  /**
   * Resolve actor/actor and actor/static contacts after every synchronized
   * engine tick. This deliberately remains a plain-data seam so a future
   * pinned WASM implementation can replace it without changing choreography.
   */
  resolveCollisions(
    activeActorIds: ReadonlySet<string>,
    staticColliders: readonly PlanarStaticCollider[],
    dtS: number,
  ): CollisionImpulse[] {
    const bodies: PlanarCollisionBody[] = [];
    for (const actorId of [...activeActorIds].sort()) {
      const entry = this.vehicles.get(actorId);
      if (!entry) continue;
      const p = entry.profile;
      const s = entry.state;
      const cos = Math.cos(s.yawRad);
      const sin = Math.sin(s.yawRad);
      // Actor dimensions are supplied by the engine as static colliders for
      // fallbacks, but dynamic footprint dimensions are registered below.
      const dimensions = this.dimensions.get(actorId);
      if (!dimensions) continue;
      bodies.push({
        id: actorId,
        lengthM: dimensions.lengthM,
        widthM: dimensions.widthM,
        inverseMass: 1 / p.massKg,
        inverseInertia: 1 / p.yawInertiaKgM2,
        previous: entry.previous,
        x: s.x,
        y: s.y,
        yawRad: s.yawRad,
        vx: s.longitudinalVelocityMps * cos - s.lateralVelocityMps * sin,
        vy: s.longitudinalVelocityMps * sin + s.lateralVelocityMps * cos,
        angularVelocity: s.yawRateRadps,
      });
    }
    const impulses = solvePlanarCollisions(bodies, staticColliders, dtS);
    const impulseByActor = new Map<string, { total: number; count: number }>();
    for (const impulse of impulses) {
      for (const id of [impulse.a, impulse.b]) {
        if (!this.vehicles.has(id)) continue;
        const value = impulseByActor.get(id) ?? { total: 0, count: 0 };
        value.total += impulse.normalImpulseNs;
        value.count += 1;
        impulseByActor.set(id, value);
      }
    }
    for (const body of bodies) {
      const entry = this.vehicles.get(body.id)!;
      const s = entry.state;
      s.x = body.x;
      s.y = body.y;
      s.yawRad = normalizeAngle(body.yawRad);
      const cos = Math.cos(s.yawRad);
      const sin = Math.sin(s.yawRad);
      s.longitudinalVelocityMps = body.vx * cos + body.vy * sin;
      s.lateralVelocityMps = -body.vx * sin + body.vy * cos;
      s.yawRateRadps = body.angularVelocity;
      const contact = impulseByActor.get(body.id);
      entry.telemetry = {
        ...entry.telemetry,
        collisionImpulseNs: contact?.total ?? 0,
        collisionCount: contact?.count ?? 0,
      };
    }
    return impulses;
  }

  private readonly dimensions = new Map<string, { lengthM: number; widthM: number }>();

  registerDimensions(actorId: string, lengthM: number, widthM: number): void {
    this.dimensions.set(actorId, { lengthM, widthM });
  }

  private integrate(
    entry: VehicleEntry,
    intent: MotionIntent,
    h: number,
    frictionScale: number,
  ): PhysicsTelemetrySample {
    const s = entry.state;
    const p = entry.profile;
    const control = controlFor(s, p, intent);
    const steerTarget = control.steer * p.maxSteerRad;
    const steerDerivative = clamp(
      (steerTarget - s.steerRad) / p.steerTimeConstantS,
      -p.steerRateRadPerS,
      p.steerRateRadPerS,
    );
    s.steerRad = clamp(s.steerRad + steerDerivative * h, -p.maxSteerRad, p.maxSteerRad);

    const driveN = control.throttle * p.maxDriveForceN;
    const brakeN = control.brake * p.maxBrakeForceN;
    const direction = Math.abs(s.longitudinalVelocityMps) > 0.05
      ? Math.sign(s.longitudinalVelocityMps)
      : 1;
    const dragN = p.dragCoefficientNPerMps2 * s.longitudinalVelocityMps * Math.abs(s.longitudinalVelocityMps);
    const rollingN = p.rollingResistanceCoefficient * p.massKg * G *
      Math.tanh(s.longitudinalVelocityMps / 0.1);
    const requestedFx = driveN - direction * brakeN - dragN - rollingN;
    const requestedAx = requestedFx / p.massKg;

    const lf = p.cgToFrontM;
    const lr = p.wheelbaseM - lf;
    const frontNormal = clamp(
      (p.massKg * G * lr - p.massKg * requestedAx * p.cgHeightM) / p.wheelbaseM,
      0.1 * p.massKg * G,
      0.9 * p.massKg * G,
    );
    const rearNormal = p.massKg * G - frontNormal;
    const mu = Math.max(0.05, p.tireMu * frictionScale);

    // Rear-wheel drive and a 60/40 front/rear brake balance. The longitudinal
    // allocations share the same friction circles as lateral tyre forces.
    const frontFxRequest = control.brake > 0 ? -direction * brakeN * 0.6 : 0;
    const rearFxRequest = requestedFx - frontFxRequest;
    const frontFx = clamp(frontFxRequest, -mu * frontNormal, mu * frontNormal);
    const rearFx = clamp(rearFxRequest, -mu * rearNormal, mu * rearNormal);

    const speedForSlip = Math.max(Math.abs(s.longitudinalVelocityMps), 0.75);
    const frontSlip = Math.atan2(
      s.lateralVelocityMps + lf * s.yawRateRadps,
      speedForSlip,
    ) - s.steerRad;
    const rearSlip = Math.atan2(
      s.lateralVelocityMps - lr * s.yawRateRadps,
      speedForSlip,
    );
    const front = frictionEllipseLateral(
      -p.corneringStiffnessFrontNPerRad * frontSlip,
      frontFx,
      frontNormal,
      mu,
    );
    const rear = frictionEllipseLateral(
      -p.corneringStiffnessRearNPerRad * rearSlip,
      rearFx,
      rearNormal,
      mu,
    );

    const cosSteer = Math.cos(s.steerRad);
    const sinSteer = Math.sin(s.steerRad);
    const totalFx = rearFx + frontFx * cosSteer - front.force * sinSteer;
    const uDot = totalFx / p.massKg + s.lateralVelocityMps * s.yawRateRadps;
    const vDot = (rear.force + front.force * cosSteer + frontFx * sinSteer) / p.massKg -
      s.longitudinalVelocityMps * s.yawRateRadps;
    const yawDot = (lf * (front.force * cosSteer + frontFx * sinSteer) - lr * rear.force) /
      p.yawInertiaKgM2;

    const oldU = s.longitudinalVelocityMps;
    const oldV = s.lateralVelocityMps;
    const oldYawRate = s.yawRateRadps;
    const oldYaw = s.yawRad;
    s.longitudinalVelocityMps += uDot * h;
    if (intent.targetSpeedMps >= 0 && s.longitudinalVelocityMps < 0) s.longitudinalVelocityMps = 0;
    s.lateralVelocityMps += vDot * h;
    s.yawRateRadps += yawDot * h;
    s.yawRad = normalizeAngle(oldYaw + 0.5 * (oldYawRate + s.yawRateRadps) * h);
    const oldWorldX = oldU * Math.cos(oldYaw) - oldV * Math.sin(oldYaw);
    const oldWorldY = oldU * Math.sin(oldYaw) + oldV * Math.cos(oldYaw);
    const newWorldX = s.longitudinalVelocityMps * Math.cos(s.yawRad) - s.lateralVelocityMps * Math.sin(s.yawRad);
    const newWorldY = s.longitudinalVelocityMps * Math.sin(s.yawRad) + s.lateralVelocityMps * Math.cos(s.yawRad);
    s.x += 0.5 * (oldWorldX + newWorldX) * h;
    s.y += 0.5 * (oldWorldY + newWorldY) * h;
    s.longitudinalAccelerationMps2 = uDot;

    // Wheel state is an aggregate driven-wheel speed. A short tyre relaxation
    // time captures launch/braking lag without introducing a stiff slip solver.
    const rollingOmega = s.longitudinalVelocityMps / p.wheelRadiusM;
    const wheelTauS = control.brake > 0 ? 0.035 : 0.08;
    s.wheelAngularSpeedRadps += (rollingOmega - s.wheelAngularSpeedRadps) * (h / wheelTauS);
    if (s.longitudinalVelocityMps === 0 && control.brake > 0) s.wheelAngularSpeedRadps = 0;

    return {
      control,
      longitudinalForceN: totalFx,
      frontLateralForceN: front.force,
      rearLateralForceN: rear.force,
      frontNormalForceN: frontNormal,
      rearNormalForceN: rearNormal,
      tireUtilization: Math.max(front.utilization, rear.utilization),
      substeps: 1,
      substepS: h,
      collisionImpulseNs: 0,
      collisionCount: 0,
    };
  }
}
