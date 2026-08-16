/**
 * Evidence join under ambient-induced control-binding repair.
 *
 * Defect (found by EmergentLane, rethink 2026-08-16): the engine constructor
 * applies `resolveOverlappingControlLanes` to its input, and when an actor —
 * in practice an *ambient* actor, whose route the materializer only knows
 * after ambient placement — routes over an OpenDRIVE lane coincident with a
 * signal/road-control stop line, the engine appends repaired stop-line
 * bindings BEFORE hashing `trace.header.inputHash`. The materializer stamped
 * `manifest.inputHash` over the unrepaired input, so the two hashes diverged,
 * `verifyEvidenceHashes` failed, and the cell died as
 * `trace_input_hash_mismatch` — a harness defect masquerading as a physics
 * verdict, and a hole in the "instance is a fully resolved document" seam.
 *
 * Contract under test: for a materialized instance, the input document is a
 * fixpoint of the engine's input resolution — the engine finds nothing left
 * to repair, and both sides hash the same bytes.
 *
 * Reproduction pinned from: `batch tools/tg-research/worldgen/templates/
 * world-junction.template.json --map yale-street --max-sites 2 --draws 1
 * --ambient city` → site 02331c12992a78c2 repaired
 * signal:1432 76:0:-1 → 320:0:-1 (an ambient actor's route lane).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { runSimulation } from '@uniscenarios/sim-engine';
import { ScenarioTemplateV2Schema } from '@uniscenarios/scenario-model';

import { DEV_ASSETS } from '../maps.js';
import { materialize } from '../materialize.js';
import { findSite } from '../sites.js';

const MAP = 'yale-street';
const SITE_ID = '02331c12992a78c2';
const haveArtifacts = existsSync(path.join(DEV_ASSETS, MAP, 'derived', 'topology-derived.json.gz'));

/** Minimal signalized-junction world probe (worldgen shape): ego only, ambient supplies the traffic. */
const TEMPLATE = ScenarioTemplateV2Schema.parse({
  scenarioVersion: 2,
  meta: {
    name: 'Evidence join: ambient route over coincident control lane',
    description:
      'Ego crosses a signalized junction; the city ambient population routes over a lane coincident with the signal stop line, forcing a control-binding repair.',
    createdAt: '2026-08-16T00:00:00.000Z',
    modifiedAt: '2026-08-16T00:00:00.000Z',
    appVersion: 'uniscenarios/0.0.1',
    archetype: 'worldgen.junction-cross',
    tags: ['test', 'evidence-join'],
    author: 'test/engine-lane',
    negativeControl: false,
  },
  params: { declarations: [], constraints: [] },
  environment: { weather: 'clear', timeOfDay: 'noon' },
  anchor: {
    id: 'worldgen-junction',
    corridor: {
      throughLanesSameDir: { value: [1, 5], essentiality: 'required' },
      runwayUpstreamM: { value: [40, null], essentiality: 'required' },
      runwayDownstreamM: { value: [40, null], essentiality: 'required' },
    },
    features: [
      {
        id: 'world-junction',
        kind: 'junction',
        essentiality: 'required',
        atM: { value: [0, 0], essentiality: 'required' },
        arms: { value: [3, 4], essentiality: 'required' },
        control: {
          value: ['signalized', 'all_way_stop', 'minor_stop', 'yield', 'uncontrolled'],
          essentiality: 'preferred',
          weight: 1,
        },
        egoTurn: { value: ['straight'], essentiality: 'required' },
      },
    ],
    policy: { allowMirror: false, maxSitesPerMap: 12, diversity: 'moderate', minScore: 0.4 },
  },
  roles: [
    {
      id: 'ego',
      kind: 'on_reference',
      label: 'probe vehicle crossing the junction',
      actor: { class: 'car', catalogId: 'vehicle.sedan' },
      pose: { laneOffset: 0, s: -35, tFrac: 0, headingOffsetRad: 0 },
      initialSpeedKph: 'clamp(0.7 * lane.speedLimitKph, 25, 50)',
    },
  ],
  props: [],
  choreography: { clipSeconds: 30, warmupSeconds: 2, interactions: [] },
  invariants: [],
  variants: [],
  metricSubject: 'ego',
});

describe.skipIf(!haveArtifacts)('evidence join survives ambient-induced control-binding repair', () => {
  it('materializer and engine hash the same input when ambient routes force a stop-line repair', async () => {
    const { bundle, site } = await findSite(TEMPLATE, MAP, SITE_ID);
    const { input, manifest } = materialize(TEMPLATE, bundle, site, {
      drawIndex: 0,
      ambient: { version: 1, preset: 'city' },
    });

    // The scenario must actually exercise the defect: the materializer records
    // the control-binding repair it baked into the instance. If map assets or
    // the matcher drift so no repair occurs here, this test is vacuous and must
    // say so rather than pass silently.
    const repairs = manifest.issues.filter((issue) => issue.code === 'traffic_control_binding_repaired');
    expect(repairs.length, 'site no longer exercises a control-binding repair; pick a new pinned site').toBeGreaterThan(0);

    const run = runSimulation(input, { graph: bundle.graph, guards: 'collect' });

    // The instance was fully resolved: the engine has nothing left to repair...
    expect(run.issues.filter((issue) => issue.code === 'traffic_control_binding_repaired')).toEqual([]);
    // ...and both sides of the evidence join hash the same document.
    expect(run.trace.header.inputHash).toBe(manifest.inputHash);
  }, 180_000);
});
