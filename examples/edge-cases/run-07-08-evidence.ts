import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import { parseTemplate, type ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { materializeMapBound } from '@uniscenarios/scenario-materializer';
import {
  buildFollowRoute,
  contentHash,
  evaluateAmbientRobustness,
  evaluateIntentRubric,
  intentRubricSchema,
  parseSimScenarioInput,
  runSimulation,
  traceDigest,
  type AmbientRobustnessCase,
  type IntentRubric,
  type LaneGraph,
  type Route,
  type SimScenarioInput,
  type SimTrace,
} from '@uniscenarios/sim-engine';

import { loadMap } from '../../packages/cli/src/maps.js';

type Bundle = Awaited<ReturnType<typeof loadMap>>;

const ROOT = new URL('./', import.meta.url);

function routeFrom(graph: LaneGraph, rsl: string): Route {
  const built = buildFollowRoute(graph, rsl, [], 1_000);
  if (!built.ok) throw new Error(`${rsl}: ${built.error.reason}`);
  return built.route;
}

function primaryLane(bundle: Bundle, needsAdjacent: boolean): { rsl: string; route: Route } {
  const choices = bundle.graph.laneRsls().flatMap((rsl) => {
    const g = bundle.graph.geometry(rsl);
    if (!g || g.lane.laneType !== 'driving' || g.lane.isJunction) return [];
    const adjacent = [g.lane.adjacentLanes?.left, g.lane.adjacentLanes?.right]
      .some((item) => item?.sameDirection && item.laneRsl && bundle.graph.geometry(item.laneRsl));
    if (needsAdjacent && !adjacent) return [];
    const built = buildFollowRoute(bundle.graph, rsl, [], 1_000);
    if (!built.ok || built.route.lengthM < 220) return [];
    return [{ rsl, route: built.route, speed: g.speedLimitMps }];
  });
  choices.sort((a, b) => b.route.lengthM - a.route.lengthM || b.speed - a.speed || a.rsl.localeCompare(b.rsl));
  const chosen = choices[0];
  if (!chosen) throw new Error(`no long driving lane on ${bundle.mapId}`);
  return chosen;
}

function adjacentLane(bundle: Bundle, rsl: string): string {
  const g = bundle.graph.requireGeometry(rsl);
  for (const adjacent of [g.lane.adjacentLanes?.left, g.lane.adjacentLanes?.right]) {
    if (adjacent?.sameDirection && adjacent.laneRsl && bundle.graph.geometry(adjacent.laneRsl)) return adjacent.laneRsl;
  }
  throw new Error(`no same-direction adjacent lane to ${rsl}`);
}

function opposingLane(bundle: Bundle, primary: Route, station: number): string {
  const origin = primary.poseAt(station);
  const choices = bundle.graph.laneRsls().flatMap((rsl) => {
    const g = bundle.graph.geometry(rsl);
    if (!g || g.lane.laneType !== 'driving' || g.lane.isJunction) return [];
    const route = routeFrom(bundle.graph, rsl);
    const projected = route.projectPoint(origin.point);
    const pose = route.poseAt(projected.s);
    const headingError = Math.abs(Math.atan2(Math.sin(pose.headingRad - origin.headingRad), Math.cos(pose.headingRad - origin.headingRad)));
    return headingError > 2.6 && projected.d < 25 ? [{ rsl, route, d: projected.d, s: projected.s }] : [];
  });
  choices.sort((a, b) => a.d - b.d || a.rsl.localeCompare(b.rsl));
  if (!choices[0]) throw new Error(`no opposing lane near ${primary.poseAt(station).rsl}`);
  return choices[0].rsl;
}

function absoluteRole(
  bundle: Bundle,
  source: ScenarioTemplateV2['roles'][number],
  rsl: string,
  station: number,
  tFrac = 0,
): Record<string, unknown> {
  const route = routeFrom(bundle.graph, rsl);
  const pose = route.poseAt(station);
  const g = bundle.graph.requireGeometry(pose.rsl ?? rsl);
  const width = bundle.graph.widthAt(pose.rsl ?? rsl, pose.storageS);
  const lateral = tFrac * width;
  return {
    id: source.id,
    kind: 'scene_absolute',
    ...(source.label ? { label: source.label } : {}),
    actor: source.actor,
    ...(source.initialSpeedKph === undefined ? {} : { initialSpeedKph: source.initialSpeedKph }),
    pose: {
      position: {
        x: pose.point.x - Math.sin(pose.headingRad) * lateral,
        y: 0,
        z: -(pose.point.y + Math.cos(pose.headingRad) * lateral),
      },
      headingRad: pose.headingRad,
    },
    laneRef: {
      roadId: String(g.lane.roadId), section: g.lane.section, laneId: g.lane.laneId,
      s: pose.storageS, t: lateral, headingOffsetRad: 0,
    },
    essentiality: source.essentiality,
    ...(source.extensions ? { extensions: source.extensions } : {}),
  };
}

function eventTimes(trace: SimTrace): Record<string, number> {
  return Object.fromEntries(trace.events
    .filter((event): event is Extract<SimTrace['events'][number], { kind: 'trigger_fired' }> => event.kind === 'trigger_fired')
    .map((event) => [event.interactionId, event.t]));
}

function pairDistance(trace: SimTrace, a: string, b: string, index: number): number {
  const aa = trace.ticks.actors[a]!;
  const bb = trace.ticks.actors[b]!;
  return Math.hypot(aa.x[index]! - bb.x[index]!, aa.y[index]! - bb.y[index]!);
}

function peakDecel(trace: SimTrace, actor: string): number {
  const speed = trace.ticks.actors[actor]!.speedMps;
  let peak = 0;
  for (let i = 1; i < speed.length; i += 1) {
    peak = Math.max(peak, (speed[i - 1]! - speed[i]!) / (trace.ticks.t[i]! - trace.ticks.t[i - 1]!));
  }
  return peak;
}

/**
 * The engine treats a laneRef as authoritative and derives its runtime pose
 * from route geometry. Persist that same pose for static actors so strict
 * playback can prove the instance and trace are an exact pair.
 */
function alignStaticInitialPoses(input: SimScenarioInput, graph: LaneGraph): SimScenarioInput {
  const parsed = parseSimScenarioInput(input);
  const preliminary = runSimulation(parsed, { graph, guards: 'throw' }).trace;
  return parseSimScenarioInput({
    ...parsed,
    actors: parsed.actors.map((actor) => {
      if (!actor.static) return actor;
      const track = preliminary.ticks.actors[actor.id];
      if (!track) throw new Error(`static actor ${actor.id} has no preliminary trace track`);
      return {
        ...actor,
        initial: {
          ...actor.initial,
          pose: {
            x: track.x[0],
            z: -track.y[0],
            headingRad: track.headingRad[0],
          },
        },
      };
    }),
  });
}

async function ambientSweep(
  dir: URL,
  bundle: Bundle,
  base: SimScenarioInput,
  prefix: string,
  review: (trace: SimTrace) => Record<string, unknown>,
): Promise<void> {
  const cases: readonly AmbientRobustnessCase[] = [
    { label: 'off', profile: { version: 1, preset: 'off', seed: `${prefix}-ambient-off-pinned`, maxActors: 0 } },
    { label: 'light', profile: { version: 1, preset: 'light', seed: `${prefix}-ambient-light-pinned`, maxActors: 24 } },
    { label: 'moderate', profile: { version: 1, preset: 'moderate', seed: `${prefix}-ambient-moderate-pinned`, maxActors: 40 } },
  ];
  const rubric = intentRubricSchema.parse(JSON.parse(await readFile(new URL('intent-rubric.json', dir), 'utf8')));
  const robustness = evaluateAmbientRobustness(base, bundle.graph, cases);
  const summaries: Record<string, unknown>[] = [];
  for (const result of robustness.cases) {
    const scenarioReview = review(result.trace);
    const intentEvaluation = evaluateIntentRubric(result.trace, rubric);
    const accepted = result.accepted && scenarioReview.pass === true && intentEvaluation.verdict === 'accept';
    await writeFile(new URL(`ambient-${result.label}.trace.json.gz`, dir), gzipSync(`${JSON.stringify(result.trace)}\n`));
    summaries.push({
      mode: result.label,
      profile: result.profile,
      pinnedSeed: result.profile.seed,
      inputHash: result.trace.header.inputHash,
      traceDigest: traceDigest(result.trace),
      provenance: result.provenance,
      deterministic: result.deterministic,
      authoredEventOrderPreserved: result.authoredEventOrderPreserved,
      authoredTriggerCompletionPreserved: result.authoredNeverFiredPreserved,
      ambientCollisions: result.ambientCollisions,
      robustnessEvaluation: result.evaluation,
      robustnessAccepted: result.accepted,
      robustnessFailures: result.failures,
      intentEvaluation,
      review: scenarioReview,
      accepted,
      failures: [
        ...result.failures,
        ...(scenarioReview.pass === true ? [] : ['scenario-specific rubric rejected']),
        ...(intentEvaluation.verdict === 'accept' ? [] : [`intent rubric verdict: ${intentEvaluation.verdict}`]),
      ],
    });
  }
  const baselineReview = review(robustness.baselineTrace);
  const baselineIntentEvaluation = evaluateIntentRubric(robustness.baselineTrace, rubric);
  const report = {
    version: 2,
    evaluationPolicy: 'Combined gate: evaluateAmbientRobustness AND evaluateIntentRubric AND the original scenario-specific rubric; no thresholds relaxed.',
    baseline: {
      inputHash: robustness.baselineTrace.header.inputHash,
      traceDigest: traceDigest(robustness.baselineTrace),
      robustnessEvaluation: robustness.baselineEvaluation,
      intentEvaluation: baselineIntentEvaluation,
      review: baselineReview,
      accepted: baselineReview.pass === true && baselineIntentEvaluation.verdict === 'accept',
    },
    robustnessAccepted: robustness.accepted,
    accepted: robustness.accepted
      && baselineReview.pass === true
      && baselineIntentEvaluation.verdict === 'accept'
      && summaries.every((entry) => entry.accepted === true),
    modes: summaries,
  };
  await writeFile(new URL('ambient-sweep.json', dir), `${JSON.stringify(report, null, 2)}\n`);
}

async function readIntentRubric(dir: URL): Promise<IntentRubric> {
  return intentRubricSchema.parse(JSON.parse(await readFile(new URL('intent-rubric.json', dir), 'utf8')));
}

function review07(trace: SimTrace): Record<string, unknown> {
  const times = eventTimes(trace);
  const pre = trace.ticks.t.flatMap((t, i) => t <= 5 ? [pairDistance(trace, 'ego', 'lead-cyclist', i) / Math.max(0.1, trace.ticks.actors.ego!.speedMps[i]!)] : []);
  const doorStates = trace.events.filter((e) => e.kind === 'state_set' && e.actorId === 'parked-car' && e.key === 'doors.left').map((e) => e.value);
  const final = trace.ticks.t.length - 1;
  const minPair = trace.metrics.minDistance.find((item) => item.pair.includes('ego') && item.pair.includes('lead-cyclist'))?.minDistanceM ?? null;
  const order = ['door-opens', 'cyclist-swerves', 'cyclist-brakes', 'ego-brakes', 'trailing-cyclist-stops'];
  const preEventHeadwayMinS = Math.min(...pre);
  const finalEgoLeadDistanceM = pairDistance(trace, 'ego', 'lead-cyclist', final);
  const peakEgoDecelMps2 = peakDecel(trace, 'ego');
  const egoLaneChanges = trace.events.filter((e) => e.kind === 'lane_change' && e.actorId === 'ego').length;
  return {
    pass: trace.metrics.collisions.length === 0
      && order.every((id, i) => times[id] !== undefined && (i === 0 || times[id]! > times[order[i - 1]!]!))
      && preEventHeadwayMinS >= 2 && (minPair ?? 0) >= 1 && finalEgoLeadDistanceM >= 2
      && peakEgoDecelMps2 <= 7 && egoLaneChanges === 0
      && doorStates.includes('opening') && doorStates.includes('open'),
    observed: {
      durationS: trace.ticks.t[final], eventTimes: times, collisions: trace.metrics.collisions,
      preEventHeadwayMinS, egoLeadMinDistanceM: minPair,
      finalEgoLeadDistanceM, peakEgoDecelMps2, doorStates, egoLaneChanges,
    },
    limitations: ['selected map has no surveyed embedded-tram-rail evidence; the adjacent rail-bound tram role is a labeled behavioral surrogate'],
  };
}

function review08(trace: SimTrace): Record<string, unknown> {
  const times = eventTimes(trace);
  const final = trace.ticks.t.length - 1;
  const rollback = trace.ticks.t.flatMap((t, i) => t >= 15 && t <= 18 ? [trace.ticks.actors.ego!.speedMps[i]!] : []);
  const cart = trace.ticks.actors.cart!;
  const before = trace.ticks.t.findIndex((t) => t >= 14.9);
  const after = trace.ticks.t.findIndex((t) => t >= 17.4);
  const cartRollbackDisplacementM = Math.hypot(cart.x[after]! - cart.x[before]!, cart.y[after]! - cart.y[before]!);
  const pedestrianMinDistanceM = trace.ticks.t.reduce((min, _t, i) => Math.min(min, pairDistance(trace, 'ego', 'umbrella-pedestrian', i)), Infinity);
  const closestBeforeMedian = trace.ticks.t.reduce((best, t, i) => {
    if (t > 12) return best;
    const distance = pairDistance(trace, 'ego', 'cart', i);
    return distance < best.distance ? { distance, speedKph: trace.ticks.actors.ego!.speedMps[i]! * 3.6 } : best;
  }, { distance: Infinity, speedKph: Infinity });
  const finalEgoCartDistanceM = pairDistance(trace, 'ego', 'cart', final);
  const egoLaneChanges = trace.events.filter((e) => e.kind === 'lane_change' && e.actorId === 'ego').length;
  const operational = trace.header.operationalConditions;
  return {
    pass: trace.metrics.collisions.every((c) => c.a === 'cart' || c.b === 'cart')
      && times['cart-rolls'] !== undefined && times['cart-hits-median']! > times['cart-rolls']!
      && times['cart-rolls-back']! > times['cart-hits-median']!
      && Math.max(...rollback) <= 0.2 && cartRollbackDisplacementM >= 0.3
      && finalEgoCartDistanceM >= 3 && pedestrianMinDistanceM >= 1.5 && egoLaneChanges === 0
      && operational?.weather === 'rain'
      && (operational.effects?.frictionScale ?? Number.POSITIVE_INFINITY) <= 0.58
      && operational.visibility === 'directional-glare'
      && closestBeforeMedian.speedKph <= 20,
    observed: {
      durationS: trace.ticks.t[final], eventTimes: times, collisions: trace.metrics.collisions,
      operationalConditions: operational,
      peakEgoDecelMps2: peakDecel(trace, 'ego'), maxEgoSpeedDuringRollbackMps: Math.max(...rollback),
      finalEgoCartDistanceM, cartRollbackDisplacementM, pedestrianMinDistanceM,
      egoSpeedAtClosestPreMedianKph: closestBeforeMedian.speedKph, egoLaneChanges,
    },
    limitations: ['selected map has no indexed supermarket-lot grade or median-curb provenance; the crossing/rollback geometry is a labeled behavioral surrogate'],
  };
}

async function run07(): Promise<void> {
  const dir = new URL('./07-dooring-chain-tram/', ROOT);
  const canonical = parseTemplate(JSON.parse(await readFile(new URL('template.json', dir), 'utf8')));
  const bundle = await loadMap('yale-street');
  const primary = primaryLane(bundle, true);
  const adjacent = adjacentLane(bundle, primary.rsl);
  const byId = Object.fromEntries(canonical.roles.map((role) => [role.id, role]));
  const runtime = parseTemplate({
    ...canonical,
    sourceMap: { mapId: bundle.mapId, mapName: bundle.mapId },
    anchor: { id: canonical.anchor.id, features: [], pin: { mapId: bundle.mapId } },
    roles: [
      absoluteRole(bundle, byId.ego!, primary.rsl, 40, 0),
      absoluteRole(bundle, byId['lead-cyclist']!, primary.rsl, 58, 0.72),
      absoluteRole(bundle, byId['parked-car']!, primary.rsl, 104, 0.96),
      absoluteRole(bundle, byId.tram!, adjacent, 5, 0),
      absoluteRole(bundle, byId['trailing-cyclist']!, primary.rsl, 22, 0.65),
    ],
    extensions: { ...canonical.extensions, evidenceRendition: 'behavioral-surrogate', exactMatchCount: 0 },
  });
  const product = materializeMapBound(runtime, bundle, { seed: 'edge-case-07-baseline' });
  const input = alignStaticInitialPoses(product.input, bundle.graph);
  const manifest = { ...product.manifest, inputHash: contentHash(input) };
  const result = runSimulation(input, { graph: bundle.graph, guards: 'collect' });
  const intentEvaluation = evaluateIntentRubric(result.trace, await readIntentRubric(dir));
  const scenarioReview = review07(result.trace);
  await writeFile(new URL('runtime-template.json', dir), `${JSON.stringify(runtime, null, 2)}\n`);
  await writeFile(new URL('instance.json', dir), `${JSON.stringify({ kind: 'scenario-instance', version: 1, manifest, input }, null, 2)}\n`);
  await writeFile(new URL('trace.json.gz', dir), gzipSync(`${JSON.stringify(result.trace)}\n`));
  await writeFile(new URL('result.json', dir), `${JSON.stringify({ traceDigest: traceDigest(result.trace), inputHash: result.trace.header.inputHash, issues: result.issues, review: scenarioReview, intentEvaluation, accepted: scenarioReview.pass === true && intentEvaluation.verdict === 'accept' }, null, 2)}\n`);
  await ambientSweep(dir, bundle, input, 'edge-case-07', review07);
}

async function run08(): Promise<void> {
  const dir = new URL('./08-runaway-shopping-cart/', ROOT);
  const canonical = parseTemplate(JSON.parse(await readFile(new URL('template.json', dir), 'utf8')));
  const bundle = await loadMap('el-camino-road');
  const primary = primaryLane(bundle, false);
  const opposing = opposingLane(bundle, primary.route, 90);
  const byId = Object.fromEntries(canonical.roles.map((role) => [role.id, role]));
  const shiftRoute = (interaction: ScenarioTemplateV2['choreography']['interactions'][number]) => {
    if (interaction.verb !== 'route' || interaction.target.mode !== 'polyline') return interaction;
    const base = interaction.actor === 'shopper' ? 85 : 90;
    return { ...interaction, target: { ...interaction.target, points: interaction.target.points.map((point) => ({ ...point, s: base + Number(point.s) })) } };
  };
  const runtime = parseTemplate({
    ...canonical,
    sourceMap: { mapId: bundle.mapId, mapName: bundle.mapId },
    anchor: { id: canonical.anchor.id, features: [], pin: { mapId: bundle.mapId } },
    roles: [
      absoluteRole(bundle, byId.ego!, primary.rsl, 30, 0),
      absoluteRole(bundle, byId.cart!, primary.rsl, 90, -0.96),
      absoluteRole(bundle, byId.shopper!, primary.rsl, 85, -0.98),
      absoluteRole(bundle, byId['oncoming-glare']!, opposing, 45, 0),
      absoluteRole(bundle, byId['umbrella-pedestrian']!, primary.rsl, 104, -0.95),
    ],
    choreography: { ...canonical.choreography, interactions: canonical.choreography.interactions.map(shiftRoute) },
    extensions: { ...canonical.extensions, evidenceRendition: 'behavioral-surrogate', exactMatchCount: 0 },
  });
  const product = materializeMapBound(runtime, bundle, { seed: 'edge-case-08-baseline' });
  const result = runSimulation(product.input, { graph: bundle.graph, guards: 'collect' });
  const intentEvaluation = evaluateIntentRubric(result.trace, await readIntentRubric(dir));
  const scenarioReview = review08(result.trace);
  await writeFile(new URL('runtime-template.json', dir), `${JSON.stringify(runtime, null, 2)}\n`);
  await writeFile(new URL('instance.json', dir), `${JSON.stringify({ kind: 'scenario-instance', version: 1, manifest: product.manifest, input: product.input }, null, 2)}\n`);
  await writeFile(new URL('trace.json.gz', dir), gzipSync(`${JSON.stringify(result.trace)}\n`));
  await writeFile(new URL('result.json', dir), `${JSON.stringify({ traceDigest: traceDigest(result.trace), inputHash: result.trace.header.inputHash, issues: result.issues, review: scenarioReview, intentEvaluation, accepted: scenarioReview.pass === true && intentEvaluation.verdict === 'accept' }, null, 2)}\n`);
  await ambientSweep(dir, bundle, product.input, 'edge-case-08', review08);
}

async function main(): Promise<void> {
  await run07();
  await run08();
  console.log('edge cases 07/08 materialized and simulated');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
