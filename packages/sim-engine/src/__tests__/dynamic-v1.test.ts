import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_V1_DEFAULT_SUBSTEP_S,
  DynamicV1Backend,
  GENERIC_PASSENGER_CAR_PROFILE,
} from '../sim/dynamic-v1.js';
import type { MotionIntent, MotionStepResult } from '../sim/motion-backend.js';
import { runSimulation } from '../sim/engine.js';
import type { SimScenarioInput } from '../schema/input.js';
import { LANE_LEFT, LANE_RIGHT, poseOnLane, scenario, syntheticGraph, vehicle } from './fixtures/scenarios.js';

const STRAIGHT: MotionIntent = {
  targetSpeedMps: 20,
  targetAccelerationMps2: 2.5,
  previewPoint: { x: 1_000, y: 0 },
  previewHeadingRad: 0,
};

function backend(substepS = DYNAMIC_V1_DEFAULT_SUBSTEP_S, tireMu = 1): DynamicV1Backend {
  const value = new DynamicV1Backend(substepS);
  value.register({
    actorId: 'car',
    state: { x: 0, y: 0, yawRad: 0, longitudinalVelocityMps: 0 },
    profile: { tireMu },
  });
  return value;
}

function advance(
  value: DynamicV1Backend,
  seconds: number,
  intent: MotionIntent | ((result: MotionStepResult | null) => MotionIntent),
  frictionScale = 1,
): MotionStepResult {
  let result: MotionStepResult | null = null;
  const dt = 0.05;
  for (let t = 0; t < seconds - 1e-12; t += dt) {
    result = value.step('car', typeof intent === 'function' ? intent(result) : intent, dt, frictionScale);
  }
  return result!;
}

describe('dynamic-v1 passenger car', () => {
  it('defaults omitted physics to dynamic-v1 while an explicit legacy pin remains kinematic', () => {
    const graph = syntheticGraph();
    const pinnedFixture = scenario(graph, {
      actors: [vehicle(graph, { id: 'car', rsl: LANE_LEFT, s: 20, speedMps: 8, cruiseSpeedMps: 12 })],
    });
    const { physics: _legacyPin, ...legacy } = pinnedFixture;
    const explicitDynamic: SimScenarioInput = { ...legacy, physics: { mode: 'dynamic-v1' } };
    const explicitKinematic: SimScenarioInput = { ...legacy, physics: { mode: 'kinematic-v1' } };
    const implicitTrace = runSimulation(legacy, { graph, guards: 'collect' }).trace;
    const dynamicTrace = runSimulation(explicitDynamic, { graph, guards: 'collect' }).trace;
    const kinematicTrace = runSimulation(explicitKinematic, { graph, guards: 'collect' }).trace;
    expect(JSON.stringify(implicitTrace.ticks)).toBe(JSON.stringify(dynamicTrace.ticks));
    expect(implicitTrace.ticks.actors.car!.physics).toBeDefined();
    expect(implicitTrace.header.physics.mode).toBe('dynamic-v1');
    expect(implicitTrace.header.physics.substepS).toBe(0.005);
    expect(kinematicTrace.ticks.actors.car!.physics).toBeUndefined();
    expect(kinematicTrace.header.physics.actorBackends?.car).toEqual({ mode: 'kinematic-v1', reason: 'selected' });
  });

  it('records explicit kinematic fallbacks for unsupported dynamic actors', () => {
    const graph = syntheticGraph();
    const car = vehicle(graph, { id: 'car', rsl: LANE_LEFT, s: 20, speedMps: 8 });
    const bus = {
      ...vehicle(graph, { id: 'bus', rsl: LANE_LEFT, s: 80, speedMps: 6 }),
      kind: 'bus' as const,
      tags: ['ambient'],
    };
    const input = scenario(graph, { actors: [car, bus], physics: { mode: 'dynamic-v1' } });
    const trace = runSimulation(input, { graph, guards: 'collect' }).trace;
    expect(trace.header.physics.actorBackends).toEqual({
      bus: { mode: 'kinematic-v1', reason: 'unsupported-actor-kind' },
      car: { mode: 'dynamic-v1', reason: 'selected' },
    });
    expect(trace.ticks.actors.bus!.physics).toBeUndefined();
    expect(trace.ticks.actors.car!.physics).toBeDefined();
  });

  it('runs ambient-only supported vehicles through dynamic-v1', () => {
    const graph = syntheticGraph();
    const ambient = {
      ...vehicle(graph, { id: 'ambient-car', rsl: LANE_LEFT, s: 100, speedMps: 8 }),
      tags: ['ambient'],
    };
    const input = scenario(graph, { actors: [ambient], physics: { mode: 'dynamic-v1' } });
    const trace = runSimulation(input, { graph, guards: 'collect' }).trace;
    expect(trace.header.physics.mode).toBe('dynamic-v1');
    expect(trace.header.physics.actorBackends).toEqual({
      'ambient-car': { mode: 'dynamic-v1', reason: 'selected' },
    });
    expect(trace.ticks.actors['ambient-car']!.physics).toBeDefined();
  });

  it('gives authored and ambient supported vehicles identical dynamic treatment', () => {
    const graph = syntheticGraph();
    const authored = vehicle(graph, { id: 'authored', rsl: LANE_LEFT, s: 20, speedMps: 8 });
    const ambient = {
      ...vehicle(graph, { id: 'ambient-car', rsl: LANE_LEFT, s: 100, speedMps: 8 }),
      tags: ['ambient'],
    };
    const input = scenario(graph, { actors: [authored, ambient], physics: { mode: 'dynamic-v1' } });
    const trace = runSimulation(input, { graph, guards: 'collect' }).trace;
    expect(trace.header.physics.actorBackends).toEqual({
      'ambient-car': { mode: 'dynamic-v1', reason: 'selected' },
      authored: { mode: 'dynamic-v1', reason: 'selected' },
    });
    expect(trace.ticks.actors['ambient-car']!.physics).toBeDefined();
    expect(trace.ticks.actors.authored!.physics).toBeDefined();
  });

  it('does not let ambient provenance change a supported vehicle trace', () => {
    const graph = syntheticGraph();
    const actor = vehicle(graph, { id: 'car', rsl: LANE_LEFT, s: 20, speedMps: 8, cruiseSpeedMps: 12 });
    const authored = scenario(graph, { actors: [actor], physics: { mode: 'dynamic-v1' } });
    const ambient = scenario(graph, {
      actors: [{ ...actor, tags: ['ambient'] }],
      physics: { mode: 'dynamic-v1' },
    });
    const authoredTrace = runSimulation(authored, { graph, guards: 'collect' }).trace;
    const ambientTrace = runSimulation(ambient, { graph, guards: 'collect' }).trace;
    expect(ambientTrace.ticks).toEqual(authoredTrace.ticks);
    expect(ambientTrace.header.physics.actorBackends).toEqual(authoredTrace.header.physics.actorBackends);
  });

  it('runs only when selected and records solver telemetry/provenance', () => {
    const graph = syntheticGraph();
    const input: SimScenarioInput = {
      ...scenario(graph, {
        actors: [vehicle(graph, { id: 'car', rsl: LANE_LEFT, s: 20, speedMps: 8, cruiseSpeedMps: 12 })],
      }),
      physics: { mode: 'dynamic-v1', substepS: 0.005, vehicleProfiles: { car: { massKg: 1_550 } } },
    };
    const trace = runSimulation(input, { graph, guards: 'collect' }).trace;
    expect(trace.header.physics).toMatchObject({
      mode: 'dynamic-v1',
      solver: 'uniscenarios-sim-engine',
      substepS: 0.005,
    });
    expect(trace.header.physics.vehicleProfileDigest).toMatch(/^[0-9a-f]{64}$/);
    const telemetry = trace.ticks.actors.car!.physics!;
    expect(telemetry.vxBodyMps).toHaveLength(trace.ticks.t.length);
    expect(telemetry.frontNormalForceN.some((value) => value > 0)).toBe(true);
    expect(Math.max(...telemetry.tireUtilization)).toBeLessThanOrEqual(1.000_001);
  });

  it('applies deterministic response while preserving collision event timing', () => {
    const graph = syntheticGraph();
    const input: SimScenarioInput = {
      ...scenario(graph, {
        warmupSeconds: 0,
        clipSeconds: 6,
        actors: [
          vehicle(graph, {
            id: 'car', rsl: LANE_LEFT, s: 20, speedMps: 14, cruiseSpeedMps: 14,
            rules: { collisionAvoidance: false },
          }),
          vehicle(graph, {
            id: 'obstacle', rsl: LANE_LEFT, s: 65, speedMps: 0, cruiseSpeedMps: 0,
            rules: { collisionAvoidance: false },
          }),
        ],
      }),
      physics: { mode: 'dynamic-v1' },
    };
    const trace = runSimulation(input, { graph, guards: 'collect' }).trace;
    expect(trace.events.some((event) => event.kind === 'collision')).toBe(true);
    expect(Math.max(...trace.ticks.actors.car!.physics!.collisionImpulseNs)).toBeGreaterThan(0);
  });

  it('cannot tunnel through a static map wall and records contact telemetry', () => {
    const graph = syntheticGraph();
    const wallPose = poseOnLane(graph, LANE_LEFT, 50);
    const input: SimScenarioInput = {
      ...scenario(graph, {
        warmupSeconds: 0,
        clipSeconds: 3,
        dt: 0.05,
        actors: [vehicle(graph, {
          id: 'car', rsl: LANE_LEFT, s: 20, speedMps: 20, cruiseSpeedMps: 20,
          rules: { collisionAvoidance: false },
        })],
      }),
      physics: { mode: 'dynamic-v1' },
    };
    const trace = runSimulation(input, {
      graph,
      guards: 'collect',
      staticColliders: [{
        id: 'test-wall',
        class: 'wall',
        obb: {
          center: { x: wallPose.x, z: wallPose.z },
          lengthM: 0.2,
          widthM: 20,
          headingRad: wallPose.headingRad,
        },
      }],
    }).trace;
    const car = trace.ticks.actors.car!;
    expect(Math.max(...car.x)).toBeLessThan(wallPose.x - 2.2);
    expect(Math.max(...car.physics!.collisionImpulseNs)).toBeGreaterThan(10_000);
    expect(trace.events.some((event) => event.kind === 'collision' &&
      (event.a === 'map:test-wall' || event.b === 'map:test-wall'))).toBe(true);
  });

  it('accelerates, coasts under resistance, and brakes deterministically', () => {
    const value = backend();
    const launched = advance(value, 5, STRAIGHT);
    expect(launched.state.longitudinalVelocityMps).toBeGreaterThan(11);
    expect(launched.telemetry.frontNormalForceN).toBeLessThan(
      GENERIC_PASSENGER_CAR_PROFILE.massKg * 9.80665 * 0.6,
    );

    const coastSpeed = launched.state.longitudinalVelocityMps;
    const resistanceAccel = -(
      GENERIC_PASSENGER_CAR_PROFILE.dragCoefficientNPerMps2 * coastSpeed ** 2 +
      GENERIC_PASSENGER_CAR_PROFILE.rollingResistanceCoefficient *
        GENERIC_PASSENGER_CAR_PROFILE.massKg * 9.80665
    ) / GENERIC_PASSENGER_CAR_PROFILE.massKg;
    const coasted = advance(value, 2, {
      ...STRAIGHT,
      targetSpeedMps: coastSpeed,
      targetAccelerationMps2: resistanceAccel,
    });
    expect(coasted.state.longitudinalVelocityMps).toBeLessThan(coastSpeed);

    const stopped = advance(value, 3, {
      ...STRAIGHT,
      targetSpeedMps: 0,
      targetAccelerationMps2: -8,
    });
    expect(stopped.state.longitudinalVelocityMps).toBeLessThan(0.1);
    expect(stopped.state.wheelAngularSpeedRadps).toBeLessThan(0.2);
    expect(stopped.telemetry.frontNormalForceN).toBeGreaterThan(stopped.telemetry.rearNormalForceN);
  });

  it('tracks a constant-radius path and develops yaw rate after a steering step', () => {
    const radiusM = 30;
    const runTurn = () => {
      const value = new DynamicV1Backend();
      value.register({
        actorId: 'car',
        state: { x: radiusM, y: 0, yawRad: Math.PI / 2, longitudinalVelocityMps: 10 },
      });
      let maxYawRate = 0;
      let maxSteerStep = 0;
      let maxHeadingStep = 0;
      let maxLateralAccel = 0;
      let prior = value.state('car')!;
      const result = advance(value, 8, (previous) => {
        const state = previous?.state ?? prior;
        maxYawRate = Math.max(maxYawRate, Math.abs(state.yawRateRadps));
        maxSteerStep = Math.max(maxSteerStep, Math.abs(state.steerRad - prior.steerRad));
        const headingDelta = Math.atan2(Math.sin(state.yawRad - prior.yawRad), Math.cos(state.yawRad - prior.yawRad));
        maxHeadingStep = Math.max(maxHeadingStep, Math.abs(headingDelta));
        maxLateralAccel = Math.max(maxLateralAccel, Math.abs(state.longitudinalVelocityMps * state.yawRateRadps));
        prior = state;
        const theta = Math.atan2(state.y, state.x);
        const previewTheta = theta + 0.22;
        return {
          targetSpeedMps: 10,
          targetAccelerationMps2: 0,
          previewPoint: {
            x: radiusM * Math.cos(previewTheta),
            y: radiusM * Math.sin(previewTheta),
          },
          previewHeadingRad: previewTheta + Math.PI / 2,
        };
      });
      return { result, maxYawRate, maxSteerStep, maxHeadingStep, maxLateralAccel };
    };
    const first = runTurn();
    const second = runTurn();
    expect(second).toEqual(first);
    expect(first.maxYawRate).toBeGreaterThan(0.15);
    expect(Math.abs(Math.hypot(first.result.state.x, first.result.state.y) - radiusM)).toBeLessThan(4);
    expect(Math.abs(first.result.state.steerRad)).toBeGreaterThan(0.03);
    expect(first.maxSteerStep).toBeLessThanOrEqual(GENERIC_PASSENGER_CAR_PROFILE.steerRateRadPerS * 0.05 + 1e-9);
    expect(first.maxHeadingStep).toBeLessThan(0.1);
    expect(first.maxLateralAccel).toBeLessThan(9.81);
  });

  it('saturates combined tyre force and responds to surface friction', () => {
    const run = (frictionScale: number) => {
      const value = new DynamicV1Backend();
      value.register({
        actorId: 'car',
        state: { x: 18, y: 0, yawRad: Math.PI / 2, longitudinalVelocityMps: 16 },
      });
      let peakUtilization = 0;
      const result = advance(value, 4, (previous) => {
        const state = previous?.state ?? value.state('car')!;
        const theta = Math.atan2(state.y, state.x);
        const p = theta + 0.28;
        return {
          targetSpeedMps: 16,
          targetAccelerationMps2: 0,
          previewPoint: { x: 18 * Math.cos(p), y: 18 * Math.sin(p) },
          previewHeadingRad: p + Math.PI / 2,
        };
      }, frictionScale);
      peakUtilization = Math.max(peakUtilization, result.telemetry.tireUtilization);
      return { result, peakUtilization };
    };
    const dry = run(1);
    const slick = run(0.35);
    expect(dry.peakUtilization).toBeLessThanOrEqual(1.000_001);
    expect(slick.peakUtilization).toBeLessThanOrEqual(1.000_001);
    expect(Math.abs(slick.result.state.yawRateRadps)).toBeLessThan(Math.abs(dry.result.state.yawRateRadps));
  });

  it('converges between 5 ms and 2.5 ms substeps', () => {
    const run = (substepS: number) => advance(backend(substepS), 8, STRAIGHT);
    const coarse = run(0.005);
    const fine = run(0.0025);
    expect(Math.abs(coarse.state.x - fine.state.x)).toBeLessThan(0.02);
    expect(Math.abs(coarse.state.longitudinalVelocityMps - fine.state.longitudinalVelocityMps)).toBeLessThan(0.03);
  });

  it('records a bounded reference performance measurement', () => {
    const value = new DynamicV1Backend();
    for (let actor = 0; actor < 10; actor++) {
      value.register({
        actorId: `car-${actor}`,
        state: { x: 0, y: actor * 4, yawRad: 0, longitudinalVelocityMps: 0 },
      });
    }
    const started = performance.now();
    for (let tick = 0; tick < 400; tick++) {
      for (let actor = 0; actor < 10; actor++) {
        value.step(`car-${actor}`, {
          ...STRAIGHT,
          previewPoint: { x: 1_000, y: actor * 4 },
        }, 0.05, 1);
      }
    }
    const elapsedMs = performance.now() - started;
    // Contract workload: 10 actors × 20 simulated seconds = 40k integrations.
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('keeps a deterministic City-sized ambient population inside the interactive budget', () => {
    const graph = syntheticGraph();
    const actors = Array.from({ length: 32 }, (_, index) => ({
      ...vehicle(graph, {
        id: `ambient-${String(index).padStart(2, '0')}`,
        rsl: index % 2 === 0 ? LANE_LEFT : LANE_RIGHT,
        s: 20 + Math.floor(index / 2) * 18,
        speedMps: 8,
        cruiseSpeedMps: 10,
      }),
      tags: ['ambient', 'ambient:v1'],
    }));
    const input = scenario(graph, {
      actors,
      clipSeconds: 20,
      warmupSeconds: 0,
      dt: 0.05,
      physics: { mode: 'dynamic-v1' },
    });
    runSimulation(input, { graph, guards: 'collect' });
    const started = performance.now();
    const first = runSimulation(input, { graph, guards: 'collect' }).trace;
    const elapsedMs = performance.now() - started;
    const second = runSimulation(input, { graph, guards: 'collect' }).trace;
    expect(second.ticks).toEqual(first.ticks);
    expect(Object.values(first.header.physics.actorBackends ?? {})).toHaveLength(32);
    expect(Object.values(first.header.physics.actorBackends ?? {}).every(
      (backend) => backend.mode === 'dynamic-v1' && backend.reason === 'selected',
    )).toBe(true);
    expect(Object.values(first.ticks.actors).every((track) => track.physics !== undefined)).toBe(true);
    expect(elapsedMs).toBeLessThan(7_500);
  }, 30_000);
});
