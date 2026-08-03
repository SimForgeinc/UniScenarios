import type { MotionPhysicsMode, SimScenarioInput } from '@uniscenarios/sim-engine';

/**
 * Deterministic editable-document migration. Immutable evidence never calls
 * this helper: playback uses its recorded trace directly.
 */
export function withEditablePhysicsDefault(input: SimScenarioInput): SimScenarioInput {
  return input.physics ? input : { ...input, physics: { mode: 'dynamic-v1' } };
}

/** Trace v1 predates explicit provenance and is therefore legacy kinematic. */
export function activePhysicsModeForTrace(
  trace: { readonly header: { readonly physics?: { readonly mode: MotionPhysicsMode } } } | null,
): MotionPhysicsMode {
  return trace ? (trace.header.physics?.mode ?? 'kinematic-v1') : 'dynamic-v1';
}
