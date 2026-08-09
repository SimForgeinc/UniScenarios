import { z } from 'zod';

/** Stable authored driver policies. Physical vehicle parameters stay separate. */
export const DRIVER_PROFILE_IDS = ['lawful', 'cautious', 'assertive', 'violator'] as const;

export const DriverProfileSchema = z.enum(DRIVER_PROFILE_IDS);
export type DriverProfile = z.infer<typeof DriverProfileSchema>;

export interface DriverProfileDefinition {
  readonly id: DriverProfile;
  readonly label: string;
  readonly description: string;
  readonly rules: {
    readonly obeySignals: boolean;
    readonly yield: boolean;
    readonly yieldToVehicles: boolean;
    readonly yieldToPedestrians: boolean;
    readonly collisionAvoidance: boolean;
    readonly aggression: number;
    readonly speedFactor: number;
  };
}

export const DRIVER_PROFILES: Readonly<Record<DriverProfile, DriverProfileDefinition>> = {
  lawful: {
    id: 'lawful', label: 'Lawful',
    description: 'Obeys stop controls and signals with ordinary spacing and speed.',
    rules: { obeySignals: true, yield: true, yieldToVehicles: true, yieldToPedestrians: true, collisionAvoidance: true, aggression: 0.5, speedFactor: 1 },
  },
  cautious: {
    id: 'cautious', label: 'Cautious',
    description: 'Obeys controls, leaves larger gaps, and drives below the free-flow limit.',
    rules: { obeySignals: true, yield: true, yieldToVehicles: true, yieldToPedestrians: true, collisionAvoidance: true, aggression: 0.2, speedFactor: 0.9 },
  },
  assertive: {
    id: 'assertive', label: 'Assertive',
    description: 'Accepts tighter gaps but still obeys stop controls and signals.',
    rules: { obeySignals: true, yield: true, yieldToVehicles: true, yieldToPedestrians: true, collisionAvoidance: true, aggression: 0.8, speedFactor: 1.05 },
  },
  violator: {
    id: 'violator', label: 'Traffic-law violator',
    description: 'May run stop controls and signals while retaining collision avoidance.',
    rules: { obeySignals: false, yield: false, yieldToVehicles: false, yieldToPedestrians: false, collisionAvoidance: true, aggression: 0.85, speedFactor: 1.1 },
  },
};

export function driverProfileDefinition(profile: DriverProfile | undefined): DriverProfileDefinition {
  return DRIVER_PROFILES[profile ?? 'lawful'];
}
