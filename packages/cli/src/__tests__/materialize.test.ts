/**
 * The materializer, against the real Yale-street artifacts.
 *
 * `dev-assets/` is gitignored, so these skip on a clean checkout rather than
 * failing — but when the artifacts are there they are the only tests that prove
 * the four packages actually compose.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ScenarioTemplateV2Schema } from '@uniscenarios/scenario-model';
import { runSimulation, traceDigest } from '@uniscenarios/sim-engine';

import { DEV_ASSETS, REPO_ROOT, loadMap } from '../maps.js';
import { materialize } from '../materialize.js';
import { findSite, matchOnMap } from '../sites.js';
import { readTemplate } from '../template-io.js';
import { cellSeed, paramsVersion, templateId } from '../params.js';

const MAP = 'yale-street';
const LTAP = path.join(REPO_ROOT, 'examples', 'ltap-opposing.template.json');
const DARTOUT = path.join(REPO_ROOT, 'examples', 'cpnco-dartout.template.json');
const BUS_STOP = path.join(REPO_ROOT, 'examples', 'bus-stop-emergence.template.json');

const haveArtifacts =
  existsSync(path.join(DEV_ASSETS, MAP, 'derived', 'topology-derived.json.gz')) &&
  existsSync(path.join(DEV_ASSETS, MAP, 'derived', 'locations.json.gz')) &&
  existsSync(LTAP);

describe.skipIf(!haveArtifacts)('materialize — LTAP on yale-street', () => {
  it('matches sites deterministically and binds both roles', async () => {
    const template = await readTemplate(LTAP);
    const first = await matchOnMap(template, MAP);
    expect(first.report.sites.length).toBeGreaterThan(0);
    for (const site of first.report.sites) {
      expect(site.bindings.map((b) => b.role).sort()).toEqual(['ego', 'oncoming']);
      expect(site.bindings.every((b) => b.status === 'bound')).toBe(true);
      // The whole point of `conflicting_gate`: geometry, not a coordinate.
      const conflict = site.bindings.find((b) => b.role === 'oncoming')?.conflict;
      expect(conflict).toBeDefined();
      expect(conflict?.relation).toBe('opposing');
      expect(conflict?.crossingAngleDeg).toBeGreaterThan(60);
    }
  });

  it('turns every bound role into a concrete actor on a real lane', async () => {
    const template = await readTemplate(LTAP);
    const { bundle, site } = await findSite(template, MAP, (await matchOnMap(template, MAP)).report.sites[0]!.siteId);
    const { input, manifest } = materialize(template, bundle, site, { drawIndex: 0 });

    expect(input.actors.map((a) => a.id).sort()).toEqual(['ego', 'oncoming']);
    for (const actor of input.actors) {
      expect(actor.initial.laneRef?.rsl).toBeTruthy();
      expect(bundle.index.lanes[actor.initial.laneRef!.rsl]).toBeDefined();
      expect(actor.behavior.route.kind).toBe('lanePath');
      expect(actor.initial.speedMps).toBeGreaterThan(0);
    }
    // Ego drives the reference path; the frame's lanes are the ones it is on.
    const egoLanes = new Set(
      input.actors.find((a) => a.id === 'ego')!.behavior.route.kind === 'lanePath'
        ? (input.actors.find((a) => a.id === 'ego')!.behavior.route as { lanes: string[] }).lanes
        : [],
    );
    expect(site.frame.referencePath.some((span) => egoLanes.has(span.laneRsl))).toBe(true);
    expect(manifest.metricSubject).toBe('ego');
  });

  it('materializes sampled role tFrac into a different concrete actor pose', async () => {
    const base = await readTemplate(LTAP);
    const template = JSON.parse(JSON.stringify(base));
    template.params.declarations.push({
      id: 'lateralBias',
      type: 'continuous',
      range: [-0.75, 0.75],
      default: 0,
      distribution: 'uniform',
    });
    template.roles.find((role: { id: string }) => role.id === 'ego').pose.tFrac = 'param.lateralBias';

    const parsed = ScenarioTemplateV2Schema.parse(template);
    const match = await matchOnMap(parsed, MAP);
    const { bundle, site } = await findSite(parsed, MAP, match.report.sites[0]!.siteId);
    const a = materialize(parsed, bundle, site, { drawIndex: 0 });
    const b = materialize(parsed, bundle, site, { drawIndex: 1 });
    const egoA = a.input.actors.find((actor) => actor.id === 'ego')!;
    const egoB = b.input.actors.find((actor) => actor.id === 'ego')!;

    expect(a.manifest.params.values['lateralBias']).not.toBe(b.manifest.params.values['lateralBias']);
    expect(egoA.initial.laneRef?.tFrac).not.toBe(egoB.initial.laneRef?.tFrac);
    expect(Math.hypot(
      egoA.initial.pose.x - egoB.initial.pose.x,
      egoA.initial.pose.z - egoB.initial.pose.z,
    )).toBeGreaterThan(0.1);
  });

  it('spawns ego upstream of the junction even though the spawn is a site-dependent expression', async () => {
    const template = await readTemplate(LTAP);
    const { bundle, site } = await findSite(template, MAP, (await matchOnMap(template, MAP)).report.sites[0]!.siteId);
    const { input } = materialize(template, bundle, site, { drawIndex: 0 });
    const ego = input.actors.find((a) => a.id === 'ego')!;
    const lanes = (ego.behavior.route as { lanes: string[] }).lanes;
    // The entry lane is where the junction starts; ego must be before it.
    const entryIndex = lanes.indexOf(site.frame.entryLaneRsl);
    const spawnIndex = lanes.indexOf(ego.initial.laneRef!.rsl);
    expect(entryIndex).toBeGreaterThanOrEqual(0);
    expect(spawnIndex).toBeGreaterThanOrEqual(0);
    expect(spawnIndex).toBeLessThan(entryIndex);
  });

  it('solves the arrival relation to the parameter the cell drew', async () => {
    const template = await readTemplate(LTAP);
    const { bundle, site } = await findSite(template, MAP, (await matchOnMap(template, MAP)).report.sites[0]!.siteId);
    const { manifest } = materialize(template, bundle, site, { drawIndex: 0 });
    const solution = manifest.arrival.find((s) => s.actorId === 'oncoming');
    expect(solution).toBeDefined();
    expect(solution!.referenceActorId).toBe('ego');
    expect(solution!.converged).toBe(true);
    expect(solution!.targetDeltaT).toBeCloseTo(manifest.params.values['arrivalTtc'] as number, 6);
    expect(solution!.achievedDeltaT).toBeCloseTo(solution!.targetDeltaT, 2);
  });

  it('reproduces a cell byte for byte from its replay key alone', async () => {
    const template = await readTemplate(LTAP);
    const siteId = (await matchOnMap(template, MAP)).report.sites[0]!.siteId;
    const { bundle, site } = await findSite(template, MAP, siteId);

    const a = materialize(template, bundle, site, { drawIndex: 2 });
    const b = materialize(template, bundle, site, { drawIndex: 2 });
    expect(b.manifest.inputHash).toBe(a.manifest.inputHash);
    expect(b.manifest.replayKey).toEqual(a.manifest.replayKey);
    expect(JSON.stringify(b.input)).toBe(JSON.stringify(a.input));

    // And the trace it produces is identical too — the end of the chain.
    expect(traceDigest(runSimulation(b.input, { graph: bundle.graph, guards: 'collect' }).trace)).toBe(
      traceDigest(runSimulation(a.input, { graph: bundle.graph, guards: 'collect' }).trace),
    );
  });

  it('stamps the replay key the batch resumes on', async () => {
    const template = await readTemplate(LTAP);
    const siteId = (await matchOnMap(template, MAP)).report.sites[0]!.siteId;
    const { bundle, site } = await findSite(template, MAP, siteId);
    const { manifest } = materialize(template, bundle, site, { drawIndex: 4 });
    expect(manifest.replayKey.paramSeed).toBe(
      cellSeed(templateId(template), paramsVersion(template), siteId, 4),
    );
    expect(manifest.replayKey.mapId).toBe(MAP);
    expect(manifest.replayKey.siteId).toBe(siteId);
    expect(manifest.replayKey.matcherIndexDigest).toBe(bundle.index.topologyDigest);
    expect(manifest.replayKey.engineGraphDigest).toBe(bundle.graph.topologyDigest);
    expect(manifest.replayKey.matcherVersion).toBeTruthy();
    expect(manifest.replayKey.solverVersion).toBeTruthy();
    expect(manifest.replayKey.templateDigest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives different draws different parameters and the same site', async () => {
    const template = await readTemplate(LTAP);
    const siteId = (await matchOnMap(template, MAP)).report.sites[0]!.siteId;
    const { bundle, site } = await findSite(template, MAP, siteId);
    const a = materialize(template, bundle, site, { drawIndex: 0 });
    const b = materialize(template, bundle, site, { drawIndex: 1 });
    expect(b.manifest.site.siteId).toBe(a.manifest.site.siteId);
    expect(b.manifest.params.values['arrivalTtc']).not.toBe(a.manifest.params.values['arrivalTtc']);
    expect(b.manifest.inputHash).not.toBe(a.manifest.inputHash);
  });

  it('produces a critical episode, not an incidental one', async () => {
    const template = await readTemplate(LTAP);
    const siteId = (await matchOnMap(template, MAP)).report.sites[0]!.siteId;
    const { bundle, site } = await findSite(template, MAP, siteId);
    const { input } = materialize(template, bundle, site, { drawIndex: 0 });
    const { trace } = runSimulation(input, { graph: bundle.graph, guards: 'collect' });
    expect(trace.metrics.minTTC).not.toBeNull();
    expect(trace.metrics.minTTC!.value).toBeLessThan(3);
    expect(trace.metrics.minTTC!.pair.sort()).toEqual(['ego', 'oncoming']);
  });
});

describe.skipIf(!haveArtifacts || !existsSync(DARTOUT))('materialize — CPNCO dart-out on yale-street', () => {
  it('folds the crossing polyline into the pedestrian spawn route and occludes it', async () => {
    const template = await readTemplate(DARTOUT);
    const match = await matchOnMap(template, MAP);
    expect(match.report.sites.length).toBeGreaterThan(0);
    const { bundle, site } = await findSite(template, MAP, match.report.sites[0]!.siteId);
    const { input, manifest } = materialize(template, bundle, site, { drawIndex: 0 });

    const ped = input.actors.find((a) => a.id === 'ped')!;
    expect(ped.kind).toBe('pedestrian');
    expect(ped.behavior.route.kind).toBe('polyline');
    expect(manifest.notes.some((n) => n.reason.includes('folded into'))).toBe(true);

    // The repeated parked row became concrete boxes with one author-level group.
    expect(input.occluders.length).toBe(4);
    expect(input.occluders.every((o) => o.obb.lengthM > 4 && o.obb.heightM > 1)).toBe(true);
    expect(input.occluders.map((o) => o.groupId)).toEqual(['parked-row', 'parked-row', 'parked-row', 'parked-row']);
    expect(input.occlusionPairs).toEqual([{ observer: 'ego', target: 'ped', occluderId: 'parked-row' }]);

    const { trace } = runSimulation(input, { graph: bundle.graph, guards: 'collect' });
    expect(trace.metrics.occluderIneffective).toEqual([]);
    expect(trace.metrics.minTTC?.pair).toEqual(['ego', 'ped']);
    expect(trace.metrics.revealToConflict).toEqual(
      expect.objectContaining({
        pair: ['ego', 'ped'],
        occluderId: 'parked-row',
        relevantOccluderIds: ['parked-row-0', 'parked-row-1', 'parked-row-2', 'parked-row-3'],
      }),
    );
    expect(trace.metrics.revealToConflict!.firstBlockedT).toBeLessThan(trace.metrics.revealToConflict!.losOpenT);
    expect(trace.metrics.revealToConflict!.losOpenT).toBeLessThanOrEqual(trace.metrics.revealToConflict!.conflictT);
    expect(trace.metrics.revealToConflict!.value).toBeGreaterThan(0);
  });

  it('materializes after() references to folded startup interactions as absolute triggers', async () => {
    const base = await readTemplate(DARTOUT);
    const template = JSON.parse(JSON.stringify(base));
    template.choreography.interactions.push({
      id: 'ped-after-folded-route',
      actor: 'ped',
      verb: 'speed',
      trigger: { kind: 'after', of: 'ped-walks-out', delayS: 0.5 },
      target: { mode: 'absolute', valueKph: 6 },
      dynamics: { shape: 'linear', constraint: 'time', value: 0.2 },
    });

    const match = await matchOnMap(template, MAP);
    const { bundle, site } = await findSite(template, MAP, match.report.sites[0]!.siteId);
    const { input, manifest } = materialize(template, bundle, site, { drawIndex: 0 });
    const after = input.interactions.find((it) => it.id === 'ped-after-folded-route');

    expect(after?.trigger).toEqual({ kind: 'at', t: 0.5 });
    expect(manifest.notes.some((n) => n.reason.includes('references an interaction folded into initial state'))).toBe(true);
  });

  it('evaluates parameterized prop tFrac into different occluder positions', async () => {
    const base = await readTemplate(DARTOUT);
    const template = JSON.parse(JSON.stringify(base));
    template.params.declarations.push({
      id: 'lateralBias',
      type: 'continuous',
      range: [-0.95, -0.55],
      default: -0.85,
      distribution: 'uniform',
    });
    template.props[0].pose.tFrac = 'param.lateralBias';

    const parsed = ScenarioTemplateV2Schema.parse(template);
    const match = await matchOnMap(parsed, MAP);
    const { bundle, site } = await findSite(parsed, MAP, match.report.sites[0]!.siteId);
    const a = materialize(parsed, bundle, site, { drawIndex: 0 });
    const b = materialize(parsed, bundle, site, { drawIndex: 1 });

    expect(a.manifest.params.values['lateralBias']).not.toBe(b.manifest.params.values['lateralBias']);
    expect(a.input.occluders[0]!.obb.center).not.toEqual(b.input.occluders[0]!.obb.center);
  });
});

describe.skipIf(!haveArtifacts || !existsSync(BUS_STOP))('materialize — real Yale bus-stop emergence', () => {
  it('selects the checked-in Yale stop proof on the requested curb side', async () => {
    const template = await readTemplate(BUS_STOP);
    const match = await matchOnMap(template, MAP);
    const site = match.report.sites[0]!;
    const stop = site.featureMatches.stop!;
    const side = site.clauses.find((clause) => clause.path === 'features.stop.side')!;

    expect(site.siteId).toBe('fa9fa19457cf576f');
    expect(stop.mapFeatureId).toBe('loc_92ea6eb02738f97c3061a3cd');
    expect(side).toMatchObject({ supported: true, actual: 'right', score: 1 });
    expect(site.matchedReasons).toContain('bus_stop loc_92ea6eb02738f97c3061a3cd is on the right side of travel');
  });

  it('keeps a curbside bus static while the pedestrian clears its nose without crossing its footprint', async () => {
    const template = await readTemplate(BUS_STOP);
    const match = await matchOnMap(template, MAP);
    const { bundle, site } = await findSite(template, MAP, match.report.sites[0]!.siteId);
    const { input, manifest } = materialize(template, bundle, site, { drawIndex: 8 });
    const bus = input.actors.find((actor) => actor.id === 'bus')!;
    const ego = input.actors.find((actor) => actor.id === 'ego')!;
    const ped = input.actors.find((actor) => actor.id === 'ped')!;
    const stop = bundle.index.pointFeatures.find((feature) => feature.id === 'loc_92ea6eb02738f97c3061a3cd')!;

    expect(bus.static).toBe(true);
    expect(bus.initial.speedMps).toBe(0);
    expect(bus.initial.laneRef?.rsl).toBe('87:0:-4');
    expect(ego.behavior.route.kind).toBe('lanePath');
    expect(ego.behavior.route.kind === 'lanePath' && ego.behavior.route.lanes).toContain('87:0:-3');
    expect(stop.point).toBeDefined();
    expect(Math.hypot(bus.initial.pose.x - stop.point!.x, -bus.initial.pose.z - stop.point!.y)).toBeLessThan(7);
    expect(ped.behavior.route.kind).toBe('polyline');

    const points = ped.behavior.route.kind === 'polyline' ? ped.behavior.route.points : [];
    const c = Math.cos(bus.initial.pose.headingRad);
    const s = Math.sin(bus.initial.pose.headingRad);
    const halfLength = bus.dims.l / 2 + ped.dims.l / 2;
    const halfWidth = bus.dims.w / 2 + ped.dims.w / 2;
    for (let i = 1; i < points.length; i += 1) {
      for (let sample = 0; sample <= 20; sample += 1) {
        const t = sample / 20;
        const x = points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t;
        const y = -(points[i - 1]!.z + (points[i]!.z - points[i - 1]!.z) * t);
        const dx = x - bus.initial.pose.x;
        const dy = y - -bus.initial.pose.z;
        const longitudinal = dx * c + dy * s;
        const lateral = -dx * s + dy * c;
        expect(Math.abs(longitudinal) <= halfLength && Math.abs(lateral) <= halfWidth).toBe(false);
      }
    }

    const simulation = runSimulation(input, { graph: bundle.graph, guards: 'collect' });
    const busTrack = simulation.trace.ticks.actors.bus!;
    expect(new Set(busTrack.x).size).toBe(1);
    expect(new Set(busTrack.y).size).toBe(1);
    expect(simulation.trace.metrics.occluderIneffective).toEqual([]);
    expect(simulation.trace.metrics.revealToConflict?.occluderId).toBe('actor:bus');
    expect(simulation.trace.header.inputHash).toBe(manifest.inputHash);
    expect(manifest.arrival.find((solution) => solution.actorId === 'ped')?.converged).toBe(true);
  });
});

describe.skipIf(!haveArtifacts)('map bundles', () => {
  it('adopts map-intel as the index source and carries the derived capabilities', async () => {
    const bundle = await loadMap(MAP);
    expect(bundle.index.provenance.source).toBe('map-intel');
    expect(bundle.index.capabilities.junctionControl).toBe(true);
    expect(bundle.index.topologyDigest).toBe(bundle.derived.topologyDigest);
  });

  it('memoises the bundle, because a batch builds the lane graph once', async () => {
    expect(await loadMap(MAP)).toBe(await loadMap(MAP));
  });
});
