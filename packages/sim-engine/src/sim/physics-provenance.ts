import type { ActorKind, MotionPhysicsMode, ResolvedPhysicsConfig } from '../schema/input.js';
import type { ActorPhysicsBackendProvenance } from '../trace/trace.js';

/**
 * Report the backend an actor will actually execute. This is deliberately a
 * pure classifier shared by simulation, diagnostics, and exporters so those
 * surfaces cannot make broader fidelity claims than the engine.
 */
export function actorPhysicsBackend(
  actor: { readonly kind: ActorKind; readonly static: boolean; readonly tags: readonly string[] },
  physics: Pick<ResolvedPhysicsConfig, 'mode'>,
): ActorPhysicsBackendProvenance {
  if (physics.mode === 'kinematic-v1') return { mode: 'kinematic-v1', reason: 'selected' };
  if (actor.static) return { mode: 'kinematic-v1', reason: 'static-actor' };
  if (actor.tags.includes('motion:reverse')) return { mode: 'kinematic-v1', reason: 'reverse-motion' };
  if (actor.kind !== 'vehicle' && actor.kind !== 'car') {
    return { mode: 'kinematic-v1', reason: 'unsupported-actor-kind' };
  }
  return { mode: 'dynamic-v1', reason: 'selected' };
}

export function actorPhysicsBackends(
  actors: readonly { readonly id: string; readonly kind: ActorKind; readonly static: boolean; readonly tags: readonly string[] }[],
  physics: Pick<ResolvedPhysicsConfig, 'mode'>,
): Record<string, ActorPhysicsBackendProvenance> {
  return Object.fromEntries(actors.map((actor) => [actor.id, actorPhysicsBackend(actor, physics)]));
}

export function physicsBackendCounts(
  backends: Readonly<Record<string, { readonly mode: MotionPhysicsMode }>>,
): { readonly dynamic: number; readonly kinematic: number } {
  let dynamic = 0;
  let kinematic = 0;
  for (const backend of Object.values(backends)) {
    if (backend.mode === 'dynamic-v1') dynamic += 1;
    else kinematic += 1;
  }
  return { dynamic, kinematic };
}
