import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import type { MatchedSite } from '@uniscenarios/anchor-matcher';
import { ScenarioTemplateV2Schema } from '@uniscenarios/scenario-model';
import { runSimulation } from '@uniscenarios/sim-engine';

import { buildSiteSignalPlan, defaultPhasesForHead, parseMapSignalCatalog } from '../map-signals.js';
import { DEV_ASSETS, REPO_ROOT, loadMap } from '../maps.js';
import { matchOnMap } from '../sites.js';
import { readTemplate } from '../template-io.js';
import { materialize } from '../materialize.js';

const YALE = 'yale-street';
const BELMONT = 'belmont-research-center';
const LTAP = path.join(REPO_ROOT, 'examples', 'ltap-opposing.template.json');
const haveMaps = [YALE, BELMONT].every((map) => existsSync(path.join(DEV_ASSETS, map, 'map.xodr')));

describe('map signal controller parsing', () => {
  it('preserves head, controller sequence, and junction bindings', () => {
    const catalog = parseMapSignalCatalog(
      `
        <controller id="c1" sequence="0"><control signalId="h1"/></controller>
        <controller id="c2" sequence="1"><control signalId="h2"/></controller>
        <junction id="j1"><controller id="c1"/><controller id="c2"/></junction>
      `,
      {
        features: [
          { properties: { id: 'h1', road_id: '10', s: 2, signal_category: 'traffic_light', dynamic: 'yes' } },
          { properties: { id: 'static', road_id: '10', signal_category: 'traffic_light', dynamic: 'no' } },
        ],
      },
    );
    expect(catalog.heads.map((head) => head.id)).toEqual(['h1']);
    expect(catalog.controllers.map((controller) => [controller.id, controller.sequence])).toEqual([
      ['c1', 0],
      ['c2', 1],
    ]);
    expect(catalog.junctions).toEqual([{ junctionId: 'j1', controllerIds: ['c1', 'c2'] }]);
    expect(defaultPhasesForHead('h1', catalog.controllers)).toEqual([
      { phase: 'green', durationS: 12 },
      { phase: 'yellow', durationS: 3 },
      { phase: 'red', durationS: 15 },
    ]);
  });
});

describe.skipIf(!haveMaps)('real map signal materialization', () => {
  it('binds Yale physical heads and controller sequences to movement-filtered programs', async () => {
    const template = await readTemplate(LTAP);
    const match = await matchOnMap(template, YALE);
    const bundle = await loadMap(YALE);
    const site = match.report.sites.find((candidate) => {
      return buildSiteSignalPlan(bundle, candidate).programs.length > 0;
    })!;
    expect(site).toBeDefined();
    const plan = buildSiteSignalPlan(bundle, site);
    expect(plan.timingSource).toBe('synthetic-default');
    expect(plan.junctionId).toBe(site.frame.origin.mapFeatureId.slice('junction:'.length));
    expect(plan.programs.length).toBeGreaterThan(0);
    expect(plan.programs.every((program) => program.mapBinding?.timingSource === 'synthetic-default')).toBe(true);
    expect(plan.programs.some((program) => program.stopLines.length > 0)).toBe(true);
    expect(
      plan.programs.flatMap((program) => program.stopLines).every((line) => line.connectingLaneRsls.length > 0),
    ).toBe(true);

    const concrete = materialize(template, bundle, site, { drawIndex: 0 });
    expect(concrete.input.signalPrograms).toEqual(plan.programs);
    expect(concrete.manifest.notes.some((note) => note.reason.includes('synthetic-default'))).toBe(true);

    const withSignalTrigger = structuredClone(template) as any;
    withSignalTrigger.choreography.interactions.push({
      id: 'ego-goes-on-green',
      actor: 'ego',
      verb: 'set',
      trigger: {
        kind: 'when',
        condition: { kind: 'signal', signal: { feature: 'jx', approach: 'ego' }, phase: 'green' },
        byLatest: 10,
        ifNever: 'skip',
      },
      target: { key: 'rules.obeySignals', value: true },
    });
    const triggered = materialize(ScenarioTemplateV2Schema.parse(withSignalTrigger), bundle, site, { drawIndex: 0 });
    const interaction = triggered.input.interactions.find((entry) => entry.id === 'ego-goes-on-green');
    expect(interaction?.trigger).toEqual(expect.objectContaining({
      kind: 'when',
      condition: expect.objectContaining({ kind: 'signal', phase: 'green' }),
    }));
    expect(triggered.manifest.notes.some((note) => note.path.includes('ego-goes-on-green') && note.reason.includes('dropped'))).toBe(false);
    const { trace } = runSimulation(triggered.input, { graph: bundle.graph, guards: 'collect' });
    expect(Object.keys(trace.ticks.signals ?? {})).toEqual(
      triggered.input.signalPrograms.map((program) => program.id).sort(),
    );
    expect(
      Object.values(trace.ticks.signals ?? {}).every((track) => track.phase.length === trace.ticks.t.length),
    ).toBe(true);
    expect(trace.events.some((event) => event.kind === 'trigger_fired' && event.interactionId === 'ego-goes-on-green')).toBe(true);
  });

  it('keeps an unsignalized Belmont site explicitly empty', async () => {
    const bundle = await loadMap(BELMONT);
    expect(bundle.signalCatalog.heads).toEqual([]);
    expect(bundle.signalCatalog.controllers).toEqual([]);
    const junctionId = Object.keys(bundle.topology.junctions).sort()[0]!;
    const site = {
      frame: { origin: { mapFeatureId: `junction:${junctionId}` } },
    } as unknown as MatchedSite;
    const plan = buildSiteSignalPlan(bundle, site);
    expect(plan).toEqual(expect.objectContaining({ junctionId, programs: [], timingSource: 'none' }));
  });
});
