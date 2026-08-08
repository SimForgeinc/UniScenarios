import { contentHash } from '../core/hash.js';
import { toSceneXZ } from '../frames.js';
import type { LaneGraph } from '../map/lane-graph.js';
import { buildRoute } from '../map/route.js';
import { normalizeSimScenarioInput, type SimActor, type SimScenarioInput } from '../schema/input.js';
import { runSimulation } from '../sim/engine.js';

/**
 * AMBIENT WARM-UP (settle).
 *
 * ## Why this exists
 *
 * Generated background traffic is spawned already at cruise speed. The corpus
 * templates carry `choreography.warmupSeconds = 0.6`, so at `t = 0` no
 * generated car has had time to reach a stop line, close on a leader, or build
 * a queue: the road is populated but visibly "just started". Measured on a
 * nine-cell `--ambient city` run, **0 of 32** ambient actors were below
 * 0.5 m/s at `t = 0` (minimum 5.02 m/s), while **14 of 32** were below
 * 0.5 m/s by the end of the same 13 s clip. The queuing behaviour is correct;
 * what is missing is a settle window before the recording starts.
 *
 * ## Why not simply raise `warmupSeconds`
 *
 * `Simulation` integrates the WHOLE scene from `t = -warmupSeconds`. Raising it
 * advances the ego and the authored challenger along their routes too, and
 * arrival triggers sync to the ego, so the authored conflict timing is
 * destroyed. The warm-up has to advance the generated population and **nothing
 * else**.
 *
 * ## The mechanism
 *
 * Run a separate, throw-away simulation whose actor list contains ONLY the
 * generated population, then write its final state back as those actors'
 * *initial* state in the real input. Authored actors never enter the settle
 * sim, so their input bytes cannot change; with no ambient actors this function
 * returns the input object it was given, unmodified.
 *
 * Three facts make the write-back exact:
 *
 * 1. `Simulation` derives route progress by PROJECTING `initial.pose` onto the
 *    actor's route (`engine.ts`, "the authored scene transform is the t=0
 *    source of truth"). `initial.laneRef` is advisory. So a settled actor is
 *    expressed by rewriting `initial.pose`, `initial.speedMps` and
 *    `initial.laneRef` while keeping the same `behavior.route`.
 * 2. `SignalBook.stateAt` reads `elapsed = t + warmupSeconds + offsetS`. The
 *    real run's prologue starts at `elapsed = offsetS`; a settle run with
 *    `warmupSeconds = 0` ends at `elapsed = settleSeconds + offsetS'`. Setting
 *    `offsetS' = offsetS - settleSeconds` therefore hands the real run exactly
 *    the phase the settle finished on, so a queue that formed on red is still
 *    stopped on red when the clip begins.
 * 3. Trace tracks are xodr-local (`frames.ts`), so `pose.z = -track.y`.
 *
 * The pass is deterministic: same seed, same profile, same population, same
 * settle, same digest.
 */

/** Generated actors are the ones the ambient generator tagged. */
function isAmbient(actor: SimActor): boolean {
  return actor.tags.includes('ambient');
}

export interface AmbientSettleOptions {
  /** Seconds of ambient-only integration before `t = 0`. `0` disables the pass. */
  readonly settleSeconds: number;
  /** Explicit population; defaults to every actor tagged `ambient`. */
  readonly ambientActorIds?: readonly string[];
  /** Integration step; defaults to the scenario `dt`. */
  readonly dt?: number;
}

export interface AmbientSettleProvenance {
  readonly version: 1;
  readonly settleSeconds: number;
  readonly dt: number;
  /** Actors that entered the settle sim. */
  readonly settledActorIds: readonly string[];
  /** Settled actors that had left the world by the end of the settle. */
  readonly droppedActorIds: readonly string[];
  /** Settled actors whose final state could not be read back. */
  readonly unresolvedActorIds: readonly string[];
  readonly signalProgramsShifted: number;
  /** Speeds at the end of the settle, i.e. at real-run `t = -warmupSeconds`. */
  readonly finalSpeedMps: {
    readonly min: number;
    readonly median: number;
    readonly max: number;
    readonly belowHalfMps: number;
  } | null;
  readonly inputHashBefore: string;
  readonly inputHashAfter: string;
  readonly warnings: readonly string[];
}

export interface AmbientSettleResult {
  readonly input: SimScenarioInput;
  readonly provenance: AmbientSettleProvenance | null;
}

/**
 * Advance ONLY the generated population by `settleSeconds` and fold the result
 * back into their initial state. Authored actors are untouched by construction.
 */
export function settleAmbientTraffic(
  base: SimScenarioInput,
  graph: LaneGraph,
  options: AmbientSettleOptions,
): AmbientSettleResult {
  const settleSeconds = options.settleSeconds;
  const explicit = options.ambientActorIds === undefined ? null : new Set(options.ambientActorIds);
  const population = base.actors.filter((actor) =>
    explicit === null ? isAmbient(actor) : explicit.has(actor.id));
  // No settle requested, or nothing to settle: return the caller's own object so
  // an authored-only input is byte-identical and every historical digest holds.
  if (!(settleSeconds > 0) || population.length === 0) return { input: base, provenance: null };

  const dt = options.dt ?? base.dt;
  const warnings: string[] = [];
  const settleInput = normalizeSimScenarioInput({
    ...base,
    clipSeconds: settleSeconds,
    warmupSeconds: 0,
    dt,
    actors: population,
    // Authored choreography cannot be carried: every interaction names an
    // authored actor, and the near-miss criteria and metric subject do too.
    interactions: [],
    nearMissCriteria: undefined,
    metricSubject: population[0]!.id,
    // Hand the settle the phase that ends where the real prologue begins.
    signalPrograms: base.signalPrograms.map((program) => ({
      ...program,
      offsetS: program.offsetS - settleSeconds,
    })),
  });

  const result = runSimulation(settleInput, { graph, guards: 'skip', resolveArrival: false });
  const ticks = result.trace.ticks;
  const last = ticks.t.length - 1;
  if (last < 0) {
    warnings.push('settle produced no ticks; the population is unchanged');
    return { input: base, provenance: null };
  }

  const dropped: string[] = [];
  const unresolved: string[] = [];
  const settledById = new Map<string, SimActor>();
  const finalSpeeds: number[] = [];
  for (const actor of population) {
    const track = ticks.actors[actor.id];
    if (!track) { unresolved.push(actor.id); continue; }
    // The last tick the actor was actually in the world. An actor that ran off
    // the end of its route despawns; it is dropped rather than teleported.
    let i = last;
    while (i >= 0 && track.present[i] !== 1) i--;
    if (i < 0) { dropped.push(actor.id); continue; }
    if (i !== last) { dropped.push(actor.id); continue; }

    const x = track.x[i];
    const y = track.y[i];
    const headingRad = track.headingRad[i];
    const speedMps = track.speedMps[i];
    if (x === undefined || y === undefined || headingRad === undefined || speedMps === undefined) {
      unresolved.push(actor.id);
      continue;
    }
    const pose = toSceneXZ({ x, y });
    const settled: SimActor = {
      ...actor,
      initial: {
        ...actor.initial,
        pose: { ...actor.initial.pose, x: pose.x, z: pose.z, headingRad },
        speedMps: Math.max(0, speedMps),
        laneRef: settledLaneRef(base, graph, actor, track.laneRsl[i] ?? null, track.s[i], track.lateralOffsetM[i]),
      },
    };
    settledById.set(actor.id, settled);
    finalSpeeds.push(Math.max(0, speedMps));
  }

  if (settledById.size === 0) {
    warnings.push('no ambient actor survived the settle; the population is unchanged');
    return { input: base, provenance: null };
  }

  // Order is preserved, and an actor that despawned during the settle is
  // removed rather than restarted: it has physically left the scene.
  const droppedSet = new Set(dropped);
  const actors = base.actors
    .filter((actor) => !droppedSet.has(actor.id))
    .map((actor) => settledById.get(actor.id) ?? actor);
  const input = normalizeSimScenarioInput({ ...base, actors });

  const sorted = [...finalSpeeds].sort((a, b) => a - b);
  const median = sorted.length === 0
    ? null
    : sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  if (dropped.length > 0) {
    warnings.push(`${dropped.length} ambient actor(s) left the world during the ${settleSeconds}s settle and were removed.`);
  }
  if (unresolved.length > 0) {
    warnings.push(`${unresolved.length} ambient actor(s) had no readable settle state and kept their spawn state.`);
  }

  return {
    input,
    provenance: {
      version: 1,
      settleSeconds,
      dt,
      settledActorIds: [...settledById.keys()].sort(),
      droppedActorIds: [...dropped].sort(),
      unresolvedActorIds: [...unresolved].sort(),
      signalProgramsShifted: base.signalPrograms.length,
      finalSpeedMps: median === null ? null : {
        min: sorted[0]!,
        median,
        max: sorted[sorted.length - 1]!,
        belowHalfMps: sorted.filter((v) => v < 0.5).length,
      },
      inputHashBefore: contentHash(base),
      inputHashAfter: contentHash(input),
      warnings,
    },
  };
}

/**
 * Re-express the settled position as a lane reference.
 *
 * `laneRef` is advisory for placement (the pose wins), but the engine compares
 * the two and warns when they disagree by more than 0.25 m, and downstream
 * consumers read it. `Route.sOfLaneStorage` maps lane storage to route arc
 * length affinely inside a leg, so the inverse is one linear solve; `tFrac`
 * comes from the settled lateral offset so the declared point reproduces the
 * settled pose rather than the lane centreline.
 */
function settledLaneRef(
  base: SimScenarioInput,
  graph: LaneGraph,
  actor: SimActor,
  laneRsl: string | null,
  routeS: number | undefined,
  lateralOffsetM: number | undefined,
): SimActor['initial']['laneRef'] {
  if (laneRsl === null || routeS === undefined) return undefined;
  const built = buildRoute(graph, actor.behavior.route);
  if (!built.ok) return undefined;
  const route = built.route;
  const laneLengthM = graph.lengthOf(laneRsl);
  if (!(laneLengthM > 0)) return undefined;
  const sAtZero = route.sOfLaneStorage(laneRsl, 0);
  const sAtEnd = route.sOfLaneStorage(laneRsl, laneLengthM);
  if (sAtZero === null || sAtEnd === null || sAtEnd === sAtZero) return undefined;
  const storageS = ((routeS - sAtZero) / (sAtEnd - sAtZero)) * laneLengthM;
  if (!Number.isFinite(storageS)) return undefined;
  const clamped = Math.min(laneLengthM, Math.max(0, storageS));
  const widthM = route.widthAt(routeS);
  const tFrac = widthM > 0 && lateralOffsetM !== undefined ? lateralOffsetM / widthM : 0;
  return { rsl: laneRsl, s: clamped, tFrac: Math.min(1, Math.max(-1, tFrac)) };
}
