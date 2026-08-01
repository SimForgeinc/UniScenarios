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

import { runSimulation, traceDigest } from '@scenario-studio/sim-engine';

import { DEV_ASSETS, REPO_ROOT, loadMap } from '../maps.js';
import { materialize } from '../materialize.js';
import { findSite, matchOnMap } from '../sites.js';
import { readTemplate } from '../template-io.js';
import { cellSeed, paramsVersion, templateId } from '../params.js';

const MAP = 'yale-street';
const LTAP = path.join(REPO_ROOT, 'examples', 'ltap-opposing.template.json');
const DARTOUT = path.join(REPO_ROOT, 'examples', 'cpnco-dartout.template.json');

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
    expect(manifest.replayKey.topologyDigest).toBe(bundle.index.topologyDigest);
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

    // The parked row became real occluder boxes.
    expect(input.occluders.length).toBe(4);
    expect(input.occluders.every((o) => o.obb.lengthM > 4 && o.obb.heightM > 1)).toBe(true);

    const { trace } = runSimulation(input, { graph: bundle.graph, guards: 'collect' });
    expect(trace.metrics.revealToConflict).toBeTruthy();
    expect(trace.metrics.revealToConflict!.value).toBeGreaterThan(0);
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
