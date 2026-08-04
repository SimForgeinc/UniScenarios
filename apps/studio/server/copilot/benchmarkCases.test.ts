import { TemplateDocument } from '@uniscenarios/scenario-model';
import { describe, expect, it } from 'vitest';
import { COPILOT_EDGE_CASES, evaluateCopilotSemantics } from './benchmarkCases.js';

function fixture() {
  return TemplateDocument.fromJSON({
    scenarioVersion: 2,
    meta: { name: 'fixture', description: '', createdAt: '2026-08-03T00:00:00.000Z', modifiedAt: '2026-08-03T00:00:00.000Z', appVersion: 'test' },
    sourceMap: { mapId: 'test', mapName: 'test' },
    anchor: { id: 'test', features: [], pin: { mapId: 'test' } },
    roles: [
      { id: 'ego', kind: 'scene_absolute', actor: { class: 'car', catalogId: 'vehicle.sedan', static: false, sensors: [] }, pose: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 }, initialSpeedKph: 30, essentiality: 'required' },
      { id: 'lead', kind: 'scene_absolute', actor: { class: 'van', catalogId: 'vehicle.van', static: false, sensors: [] }, pose: { position: { x: 20, y: 0, z: 0 }, headingRad: 0 }, initialSpeedKph: 20, essentiality: 'required' },
    ],
    props: [], trafficControls: [], mapSignalPlans: [], params: { declarations: [], constraints: [] }, environment: {},
    choreography: { clipSeconds: 20, warmupSeconds: 1, interactions: [{ id: 'brake', actor: 'lead', verb: 'speed', trigger: { kind: 'at', t: 6 }, target: { mode: 'absolute', valueKph: 0 }, dynamics: { shape: 'linear', constraint: 'time', value: 1 } }] },
    invariants: [], variants: [], metricSubject: 'ego', extensions: {},
  }).data;
}

describe('Scenario Copilot benchmark semantic assertions', () => {
  it('credits executable hard-braking behavior', () => {
    expect(evaluateCopilotSemantics('lead-hard-brake', fixture()).every((item) => item.pass)).toBe(true);
  });

  it('does not credit prose-only semantics', () => {
    const doc = fixture();
    expect(evaluateCopilotSemantics('pedestrian-near-miss', doc).every((item) => item.pass)).toBe(false);
    expect(evaluateCopilotSemantics('unsupported-impossible', doc)[0]?.pass).toBe(false);
  });

  it('keeps the frozen twenty-case corpus executable and includes both negative controls', () => {
    expect(COPILOT_EDGE_CASES).toHaveLength(20);
    expect(COPILOT_EDGE_CASES.filter((item) => item.expectedRejection).map((item) => item.id)).toEqual(['unsupported-impossible', 'contradictory-constraints']);
    for (const item of COPILOT_EDGE_CASES) expect(() => evaluateCopilotSemantics(item.id, fixture())).not.toThrow();
  });
});
