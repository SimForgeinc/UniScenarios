import { describe, expect, it, vi } from 'vitest';
import { TemplateDocument } from '@uniscenarios/scenario-model';
import { simulationSourceHash } from '../campaign/recovery';
import { groundEditableActors } from './grounding';

function legacyRichmondDraft() {
  const doc = TemplateDocument.create({
    name: 'Legacy Richmond generation',
    sourceMap: { mapId: 'richmond-field-station', mapName: 'Richmond Field Station' },
  });
  doc.addRole({
    id: 'sedan-1', label: 'Sedan 1', kind: 'scene_absolute',
    actor: { class: 'car', catalogId: 'vehicle.sedan', static: false, sensors: [] },
    pose: { position: { x: 197.9079, y: 0, z: -270.4788 }, headingRad: 1.234 },
    initialRoute: { mode: 'lanePath', lanes: ['12:0:-1', '19:0:-1'] },
    laneRef: { roadId: '12', section: 0, laneId: -1, s: 34.5, t: 0, headingOffsetRad: 0 },
    essentiality: 'required',
  });
  return doc.data;
}

describe('generated draft ground reconciliation', () => {
  it('grounds the exact legacy Richmond position without changing 2D execution state', () => {
    const legacy = legacyRichmondDraft();
    const beforeHash = simulationSourceHash(legacy);
    const sampleHeight = vi.fn((x: number, z: number) => {
      expect({ x, z }).toEqual({ x: 197.9079, z: -270.4788 });
      return 7.213935;
    });

    const grounded = groundEditableActors(legacy, sampleHeight);
    const before = legacy.roles[0]!;
    const after = grounded.roles[0]!;
    expect(sampleHeight).toHaveBeenCalledOnce();
    expect(after).toMatchObject({
      id: before.id,
      pose: { position: { x: 197.9079, y: 7.213935, z: -270.4788 }, headingRad: 1.234 },
      laneRef: before.kind === 'scene_absolute' ? before.laneRef : undefined,
      initialRoute: before.kind === 'scene_absolute' ? before.initialRoute : undefined,
    });
    expect(grounded.choreography).toEqual(legacy.choreography);
    expect(simulationSourceHash(grounded)).toBe(beforeHash);
  });

  it('preserves the exact authored height and object identity without a usable sampler', () => {
    const legacy = legacyRichmondDraft();
    expect(groundEditableActors(legacy, null)).toBe(legacy);
    expect(groundEditableActors(legacy, () => null).roles[0]).toEqual(legacy.roles[0]);
  });
});
