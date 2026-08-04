import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { renderBirdEye } from './birdsEyeRenderer.js';

const RICHMOND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../dev-assets/richmond-field-station/topology-index.json.gz');

function doc(): ScenarioTemplateV2 {
  return {
    schemaVersion: 2,
    meta: { id: 'visual-test', name: 'Visual test', description: 'test', tags: [] },
    map: { mapId: 'richmond-field-station', mode: 'anchored' },
    parameters: [],
    roles: [{ id: 'ego', kind: 'scene_absolute', label: 'Sedan 1', actor: { class: 'car', catalogId: 'vehicle.sedan' }, essentiality: 'required', pose: { x: 20, y: 0, z: -360, headingRad: 1.2 }, initialSpeedKph: 25 }],
    props: [], trafficControls: [], mapSignalPlans: [],
    choreography: { clip: { start: 0, end: 20 }, interactions: [] },
    invariants: [], variants: [], validation: { rules: [] },
  } as ScenarioTemplateV2;
}

describe.skipIf(!existsSync(RICHMOND))('deterministic bird-eye renderer', () => {
  it('creates a bounded deterministic PNG with accessible provenance', () => {
    const first = renderBirdEye({ mapId: 'richmond-field-station', scenarioDoc: doc(), iteration: 1, width: 320, height: 320 });
    const second = renderBirdEye({ mapId: 'richmond-field-station', scenarioDoc: doc(), iteration: 1, width: 320, height: 320 });
    expect(first.png.subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(first.sha256).toBe(second.sha256);
    expect(first.width).toBe(320);
    expect(first.height).toBe(320);
    expect(first.bytes).toBeLessThan(1_000_000);
    expect(first.altText).toContain('Sedan 1');
    expect(first.legend).toContain('Blue arrows: lane travel direction');
    expect(first.provenance.renderer).toBe('uniscenarios-deterministic-birds-eye-v1');
  });

  it('rejects path traversal map ids', () => {
    expect(() => renderBirdEye({ mapId: '../secret', scenarioDoc: doc(), iteration: 1 })).toThrow('unsafe map id');
  });
});
