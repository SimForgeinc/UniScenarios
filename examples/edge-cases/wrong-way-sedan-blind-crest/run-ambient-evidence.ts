import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import {
  evaluateAmbientRobustness,
  evaluateIntentRubric,
  intentRubricSchema,
  traceDigest,
  type AmbientRobustnessCase,
  type SimScenarioInput,
  type SimTrace,
} from '@uniscenarios/sim-engine';

import { loadMap } from '../../../packages/cli/src/maps.js';

const DIR = new URL('./', import.meta.url);

type Point = { x: number; y: number };
type Rect = { center: Point; lengthM: number; widthM: number; headingRad: number };

function vertices(rect: Rect): Point[] {
  const c = Math.cos(rect.headingRad); const s = Math.sin(rect.headingRad);
  const hl = rect.lengthM / 2; const hw = rect.widthM / 2;
  return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([u, v]) => ({
    x: rect.center.x + u! * c - v! * s,
    y: rect.center.y + u! * s + v! * c,
  }));
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x; const dy = b.y - a.y; const den = dx * dx + dy * dy;
  const u = den === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

function projectionsOverlap(a: Point[], b: Point[], axis: Point): boolean {
  const pa = a.map((p) => p.x * axis.x + p.y * axis.y); const pb = b.map((p) => p.x * axis.x + p.y * axis.y);
  return Math.max(...pa) >= Math.min(...pb) && Math.max(...pb) >= Math.min(...pa);
}

function rectDistance(a: Rect, b: Rect): number {
  const av = vertices(a); const bv = vertices(b);
  const axes = [av, bv].flatMap((polygon) => polygon.map((p, i) => { const q = polygon[(i + 1) % 4]!; const dx = q.x - p.x; const dy = q.y - p.y; const n = Math.hypot(dx, dy); return { x: -dy / n, y: dx / n }; }));
  if (axes.every((axis) => projectionsOverlap(av, bv, axis))) return 0;
  let min = Infinity;
  for (const [one, other] of [[av, bv], [bv, av]] as const) for (const p of one) for (let i = 0; i < other.length; i += 1) min = Math.min(min, pointSegmentDistance(p, other[i]!, other[(i + 1) % other.length]!));
  return min;
}

function eventTimes(trace: SimTrace): Record<string, number> {
  return Object.fromEntries(trace.events.filter((e) => e.kind === 'trigger_fired').map((e) => [e.interactionId, e.t]));
}

function metricGap(trace: SimTrace, a: string, b: string): { minDistanceM: number; t: number } | null {
  return trace.metrics.minDistance.find((item) => item.pair.includes(a) && item.pair.includes(b)) ?? null;
}

function actorSpeedAt(trace: SimTrace, actorId: string, t: number): number | null {
  const index = trace.ticks.t.findIndex((sample) => sample >= t - 1e-9);
  return index < 0 ? null : trace.ticks.actors[actorId]?.speedMps[index] ?? null;
}

function centreDistanceAt(trace: SimTrace, a: string, b: string, index: number): number {
  const aa = trace.ticks.actors[a]!; const bb = trace.ticks.actors[b]!;
  return Math.hypot(aa.x[index]! - bb.x[index]!, aa.y[index]! - bb.y[index]!);
}

function review04(trace: SimTrace, input: SimScenarioInput): Record<string, unknown> {
  const times = eventTimes(trace);
  const order = ['wrong-way-visible', 'ego-brakes', 'wrong-way-brakes', 'motorcycle-brakes', 'ego-edges-right', 'wrong-way-offsets', 'hold-position'];
  const wrongGap = metricGap(trace, 'ego', 'wrong-way-sedan');
  const motorcycleGap = metricGap(trace, 'ego', 'following-motorcycle');
  const egoSpeedAtWrongGapMps = wrongGap ? actorSpeedAt(trace, 'ego', wrongGap.t) : null;
  const ego = trace.ticks.actors.ego!; const bus = trace.ticks.actors['opposing-bus']!;
  const conflictIndices = trace.ticks.t.flatMap((t, i) => t >= 8 && t <= 12 && ego.present[i] === 1 && bus.present[i] === 1 ? [i] : []);
  const busMinCentreM = Math.min(...conflictIndices.map((i) => centreDistanceAt(trace, 'ego', 'opposing-bus', i)));
  const busMinSpeedMps = Math.min(...conflictIndices.map((i) => bus.speedMps[i]!));
  const egoLane = input.actors.find((actor) => actor.id === 'ego')!.initial.laneRef!.rsl;
  const busLane = input.actors.find((actor) => actor.id === 'opposing-bus')!.initial.laneRef!.rsl;
  const laneDirection = (rsl: string | null): string | null => rsl?.split(':').at(-1) ?? null;
  const egoDirection = laneDirection(egoLane); const busDirection = laneDirection(busLane);
  const egoStayedInLane = trace.ticks.t.every((t, i) => t < 8 || t > 12 || laneDirection(ego.laneRsl[i] ?? null) === egoDirection);
  const lanesRemainDistinct = conflictIndices.every((i) => ego.laneRsl[i] !== bus.laneRsl[i]);
  const actorDims = trace.header.actorMetadata.ego!.dims;
  const props = Object.values(trace.header.propMetadata ?? {}).filter((prop) => prop.id.startsWith('right-parapet-'));
  let parapetClearanceM = Infinity; let parapetClearanceT = 0; let parapetId = '';
  trace.ticks.t.forEach((t, i) => {
    const actorRect: Rect = { center: { x: ego.x[i]!, y: ego.y[i]! }, lengthM: actorDims.l, widthM: actorDims.w, headingRad: ego.headingRad[i]! };
    for (const prop of props) {
      const clearance = rectDistance(actorRect, { center: { x: prop.pose.x, y: -prop.pose.z }, lengthM: prop.dims.l * prop.scale, widthM: prop.dims.w * prop.scale, headingRad: -prop.pose.headingRad });
      if (clearance < parapetClearanceM) { parapetClearanceM = clearance; parapetClearanceT = t; parapetId = prop.id; }
    }
  });
  const occlusion = trace.metrics.declaredOcclusion.find((item) => item.observer === 'ego' && item.target === 'wrong-way-sedan');
  const pass = trace.metrics.collisions.length === 0
    && trace.metrics.triggerNeverFired.length === 0
    && order.every((id, index) => times[id] !== undefined && (index === 0 || times[id]! > times[order[index - 1]!]!))
    && wrongGap !== null && wrongGap.minDistanceM > 0 && wrongGap.minDistanceM < 8
    && egoSpeedAtWrongGapMps !== null && egoSpeedAtWrongGapMps < 5 / 3.6
    && motorcycleGap !== null && motorcycleGap.minDistanceM > 0
    && parapetClearanceM >= 0.4
    && busMinCentreM <= 8 && busMinSpeedMps > 0.1 && busDirection !== egoDirection && lanesRemainDistinct && egoStayedInLane
    && occlusion?.status === 'blocked_at_conflict';
  return { pass, observed: { durationS: trace.ticks.t.at(-1), eventTimes: times, collisions: trace.metrics.collisions, triggerNeverFired: trace.metrics.triggerNeverFired, wrongWayShapeClearanceM: wrongGap?.minDistanceM ?? null, wrongWayClearanceAtS: wrongGap?.t ?? null, egoSpeedAtMinimumWrongWayClearanceKph: egoSpeedAtWrongGapMps === null ? null : egoSpeedAtWrongGapMps * 3.6, motorcycleShapeGapM: motorcycleGap?.minDistanceM ?? null, parapetClearanceM, parapetClearanceAtS: parapetClearanceT, nearestParapetId: parapetId, busMinCentreDistance8To12M: busMinCentreM, busMinSpeed8To12Kph: busMinSpeedMps * 3.6, egoInitialLane: egoLane, busInitialLane: busLane, egoDirection, busDirection, lanesRemainDistinct8To12: lanesRemainDistinct, egoStayedInAuthoredDirection8To12: egoStayedInLane, occlusionStatus: occlusion?.status ?? null } };
}

async function main(): Promise<void> {
  const instance = JSON.parse(await readFile(new URL('scenario.instance.json', DIR), 'utf8')) as { input: SimScenarioInput };
  const rubric = intentRubricSchema.parse(JSON.parse(await readFile(new URL('intent-rubric.json', DIR), 'utf8')));
  const bundle = await loadMap(instance.input.mapId);
  const cases: readonly AmbientRobustnessCase[] = [
    { label: 'off', profile: { version: 1, preset: 'off', seed: 'edge-case-04-ambient-off-pinned', maxActors: 0 } },
    { label: 'light', profile: { version: 1, preset: 'light', seed: 'edge-case-04-ambient-light-pinned', maxActors: 24 } },
    { label: 'moderate', profile: { version: 1, preset: 'moderate', seed: 'edge-case-04-ambient-moderate-pinned', maxActors: 40 } },
  ];
  const robustness = evaluateAmbientRobustness(instance.input, bundle.graph, cases);
  const baselineReview = review04(robustness.baselineTrace, instance.input);
  const baselineIntentEvaluation = evaluateIntentRubric(robustness.baselineTrace, rubric);
  const modes = [];
  for (const result of robustness.cases) {
    const review = review04(result.trace, instance.input);
    const intentEvaluation = evaluateIntentRubric(result.trace, rubric);
    const accepted = result.accepted && review.pass === true && intentEvaluation.verdict === 'accept';
    await writeFile(new URL(`ambient-${result.label}.trace.json.gz`, DIR), gzipSync(`${JSON.stringify(result.trace)}\n`));
    modes.push({ mode: result.label, profile: result.profile, pinnedSeed: result.profile.seed, inputHash: result.trace.header.inputHash, traceDigest: traceDigest(result.trace), provenance: result.provenance, deterministic: result.deterministic, authoredEventOrderPreserved: result.authoredEventOrderPreserved, authoredTriggerCompletionPreserved: result.authoredNeverFiredPreserved, ambientCollisions: result.ambientCollisions, robustnessEvaluation: result.evaluation, robustnessAccepted: result.accepted, robustnessFailures: result.failures, intentEvaluation, review, accepted, failures: [...result.failures, ...(review.pass === true ? [] : ['scenario-specific rubric rejected']), ...(intentEvaluation.verdict === 'accept' ? [] : [`intent rubric verdict: ${intentEvaluation.verdict}`])] });
  }
  const report = { version: 2, evaluationPolicy: 'Combined gate: evaluateAmbientRobustness AND evaluateIntentRubric AND the original scenario-specific rubric; no thresholds relaxed.', unsupportedCriteriaPolicy: 'Unsupported typed criteria are not treated as measured passes. The scenario-specific gate enforces the compound stop/separation condition, actor-to-prop parapet clearance, and moving native-lane bus blockage from trace evidence.', baseline: { inputHash: robustness.baselineTrace.header.inputHash, traceDigest: traceDigest(robustness.baselineTrace), robustnessEvaluation: robustness.baselineEvaluation, intentEvaluation: baselineIntentEvaluation, review: baselineReview, accepted: baselineReview.pass === true && baselineIntentEvaluation.verdict === 'accept' }, robustnessAccepted: robustness.accepted, accepted: robustness.accepted && baselineReview.pass === true && baselineIntentEvaluation.verdict === 'accept' && modes.every((entry) => entry.accepted === true), modes };
  await writeFile(new URL('ambient-sweep.json', DIR), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(new URL('ambient-evidence.json', DIR), `${JSON.stringify({ version: 1, scenarioOrdinal: 4, evaluationPolicy: 'Combined acceptance requires evaluateAmbientRobustness, evaluateIntentRubric, and scenario 04 review for baseline and every pinned mode.', accepted: report.accepted, baseline: report.baseline, modes: modes.map(({ mode, pinnedSeed, inputHash, traceDigest: digest, accepted, failures, review, intentEvaluation }) => ({ mode, pinnedSeed, inputHash, traceDigest: digest, accepted, failures, review, intentEvaluation })) }, null, 2)}\n`);
  console.log(JSON.stringify({ accepted: report.accepted, baseline: report.baseline.accepted, modes: modes.map(({ mode, accepted, failures }) => ({ mode, accepted, failures })) }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
