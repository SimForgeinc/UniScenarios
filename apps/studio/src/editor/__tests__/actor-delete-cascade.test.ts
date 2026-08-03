import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MemoryStorage,
  TemplateDocument,
  WebTemplateFileStore,
  defaultDashCamera,
  type ScenarioTemplateV2,
} from '@uniscenarios/scenario-model';
import { MAPS } from '../../maps';
import { EditorDocument, autosaveName } from '../document';

const ambulanceTemplate = (): ScenarioTemplateV2 => JSON.parse(readFileSync(
  new URL('../../../../../examples/edge-cases/05-ambulance-gridlocked-intersection/template.json', import.meta.url),
  'utf8',
)) as ScenarioTemplateV2;

describe('actor deletion graph transaction', () => {
  it('removes owned commands, dependent triggers and rules atomically, then Undo restores the exact graph', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 1 });
    const source = ambulanceTemplate();
    source.props.push({
      id: 'ambulance-load', catalogId: 'hazard.cardboard_box',
      pose: { laneOffset: 0, s: 0, tFrac: 0, headingOffsetRad: 0 },
      attachment: { role: 'ambulance', longitudinalM: -1, lateralM: 0, heightM: 0.5, headingOffsetRad: 0 },
      headingOffsetRad: 0, scale: 1, essentiality: 'preferred',
    });
    source.variants.push({
      id: 'ambulance-speed-variant', when: [{ left: 1, op: '<=', right: 2 }],
      overrides: [{ path: 'roles#ambulance.initialSpeedKph', op: 'set', value: 25 }],
    });
    source.metricSubject = 'ambulance';
    document.importTemplate(source);
    const ambulance = document.data.roles.find((role) => role.id === 'ambulance')!;
    document.addActorSensor('ambulance', defaultDashCamera(ambulance.actor, 'ambulance-dash'));
    const beforeDelete = structuredClone(document.data);

    document.remove(['ambulance']);

    expect(document.data.roles.map((role) => role.id)).not.toContain('ambulance');
    expect(document.data.choreography.interactions.some((interaction) => interaction.actor === 'ambulance')).toBe(false);
    expect(document.data.choreography.interactions.map((interaction) => interaction.id)).not.toContain('ambulance-exempt');
    expect(document.data.invariants.map((invariant) => invariant.id)).not.toContain('protected-yield-order');
    expect(document.data.props.map((prop) => prop.id)).not.toContain('ambulance-load');
    expect(document.data.variants.map((variant) => variant.id)).not.toContain('ambulance-speed-variant');
    expect(document.data.metricSubject).toBeUndefined();
    expect(document.validation.issues.filter((issue) => issue.code === 'interaction_ref_unknown' || issue.code === 'role_ref_unknown')).toEqual([]);

    expect(document.undo()).toBe(true);
    expect(document.data).toEqual(beforeDelete);
    expect(document.data.roles.find((role) => role.id === 'ambulance')?.actor.sensors.map((sensor) => sensor.id)).toEqual(['ambulance-dash']);
    document.dispose();
  });

  it('persists the complete cascade and does not resurrect it on reload', async () => {
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 1 });
    document.importTemplate(ambulanceTemplate());
    document.remove(['cross-traffic']);
    expect(document.data.choreography.interactions.map((interaction) => interaction.id)).not.toEqual(expect.arrayContaining(['cross-traffic-clears', 'cross-red']));
    expect(document.data.invariants.map((invariant) => invariant.id)).not.toContain('protected-yield-order');
    await document.flush();
    document.dispose();

    const reopened = await EditorDocument.open(MAPS[0]!, { store, autosaveMs: 1 });
    expect(reopened.data.roles.map((role) => role.id)).not.toContain('cross-traffic');
    expect(reopened.data.choreography.interactions.map((interaction) => interaction.id)).not.toEqual(expect.arrayContaining(['cross-traffic-clears', 'cross-red']));
    expect(reopened.validation.issues.filter((issue) => issue.code === 'interaction_ref_unknown' || issue.code === 'role_ref_unknown')).toEqual([]);
    reopened.dispose();
  });

  it('migrates stale autosaves by pruning dangling commands and rules without deleting remaining actors', async () => {
    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const stale = ambulanceTemplate();
    const removed = new Set(['cross-traffic-clears', 'ambulance-siren', 'ambulance-horn-1-on']);
    stale.choreography.interactions = stale.choreography.interactions.filter((interaction) => !removed.has(interaction.id));
    const originalRoles = stale.roles.map((role) => role.id);
    await store.write(autosaveName(map.id), TemplateDocument.fromJSON(stale));

    const repaired = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(repaired.data.roles.map((role) => role.id)).toEqual(originalRoles);
    expect(repaired.data.choreography.interactions.map((interaction) => interaction.id)).not.toEqual(expect.arrayContaining(['cross-red', 'ambulance-exempt']));
    expect(repaired.data.invariants.map((invariant) => invariant.id)).not.toContain('protected-yield-order');
    expect(repaired.validation.issues.filter((issue) => issue.code === 'interaction_ref_unknown' || issue.code === 'role_ref_unknown')).toEqual([]);
    expect(repaired.canUndo).toBe(false);
    await repaired.flush();
    repaired.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(reopened.data.roles.map((role) => role.id)).toEqual(originalRoles);
    expect(reopened.data.choreography.interactions.map((interaction) => interaction.id)).not.toEqual(expect.arrayContaining(['cross-red', 'ambulance-exempt']));
    reopened.dispose();
  });
});
