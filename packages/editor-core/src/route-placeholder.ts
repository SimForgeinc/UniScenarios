import type { Interaction } from '@uniscenarios/scenario-model';

/**
 * Radius within which a custom route's points count as one spot rather than a
 * path. Shared with the editors' "has the author drawn this yet?" checks.
 */
export const ROUTE_PLACEHOLDER_EPSILON_M = 0.05;

/** Ground-plane position, in scene metres, a placeholder route is seeded on. */
export interface RouteAnchor {
  readonly x: number;
  readonly z: number;
}

/**
 * True when a custom route still holds catalog geometry rather than a path.
 *
 * The two route kinds need different tests, because repeated points mean
 * different things in each:
 *
 * - `customRoute` has no time axis, so stacking points on one spot expresses
 *   nothing an author would want. A route with no extent is undrawn wherever it
 *   sits, and the schema's two-point minimum is the only reason it has a second
 *   point at all.
 * - `customTimedRoute` interpolates between keyframes, so two coincident points
 *   at different times is a real instruction — hold here. Only the catalog's
 *   signature counts as undrawn there: every point still on the scene origin.
 *
 * A drawn path covers ground either way, so neither test can mistake one.
 */
export function isRoutePlaceholder(interaction: Interaction): boolean {
  if (interaction.verb !== 'route') return false;
  const { target } = interaction;
  if (target.mode !== 'customRoute' && target.mode !== 'customTimedRoute') return false;
  const points: readonly { x: number; z: number }[] = target.points;
  const first = points[0];
  if (!first) return false;
  const withoutExtent = points.every(
    (point) => Math.hypot(point.x - first.x, point.z - first.z) <= ROUTE_PLACEHOLDER_EPSILON_M,
  );
  if (!withoutExtent) return false;
  if (target.mode === 'customRoute') return true;
  return Math.hypot(first.x, first.z) <= ROUTE_PLACEHOLDER_EPSILON_M;
}

/**
 * Move an unconfigured custom route onto the actor that will drive it.
 *
 * A catalog placeholder committed unchanged is not a placeholder at all but a
 * world path to the middle of the map: a timed route pins the actor there at
 * t=0, an untimed one drives it the whole way. Anything already authored, and
 * any interaction whose actor has no resolved pose, is returned untouched.
 *
 * Point count and per-point timing are preserved, so a timed placeholder keeps
 * its keyframes and only its position changes.
 */
export function routePlaceholderOnActor(
  interaction: Interaction,
  anchor: RouteAnchor | undefined,
): Interaction {
  if (!anchor || !isRoutePlaceholder(interaction)) return interaction;
  const target = interaction.target as { mode: string; points: readonly { x: number; z: number }[] };
  const x = Number(anchor.x.toFixed(3));
  const z = Number(anchor.z.toFixed(3));
  return {
    ...interaction,
    target: { ...target, points: target.points.map((point) => ({ ...point, x, z })) },
  } as Interaction;
}
