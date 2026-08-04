import { describe, expect, it, vi } from 'vitest';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { contentHash } from '@uniscenarios/sim-engine';
import type { MapEntry } from '../maps';
import { copyScenarioDiagnosticText, createScenarioDiagnostic, SCENARIO_DIAGNOSTIC_HEADER } from './scenarioDiagnostic';

const map: MapEntry = {
  id: 'yale-street', label: 'Yale Street', locality: 'Palo Alto',
  manifest: '/dev-assets/yale-street/3d/manifest.json', xodr: '/dev-assets/yale-street/map.xodr',
  lanePolygons: '/dev-assets/yale-street/lane-polygons.geojson.gz', signals: '/dev-assets/yale-street/signals.geojson.gz',
  topology: '/dev-assets/yale-street/topology-index.json.gz', derivedTopology: '/dev-assets/yale-street/derived/topology-derived.json.gz',
  locations: '/dev-assets/yale-street/derived/locations.json.gz', sumoManifest: '/dev-assets/yale-street/derived/sumo/manifest.json',
};

const scenario = {
  scenarioVersion: 2,
  meta: { name: 'Diagnostic case', description: '', createdAt: '2026-08-03T00:00:00.000Z', modifiedAt: '2026-08-03T00:00:01.000Z', appVersion: '0.1.0-editor', tags: [], negativeControl: false },
  sourceMap: { mapId: 'yale-street', mapName: 'Yale Street', xodrSha256: 'a'.repeat(64) },
  params: {}, environment: {}, anchor: { features: [], pin: { mapId: 'yale-street' } },
  roles: [{ id: 'ego', kind: 'scene_absolute', actor: { class: 'car', static: false, catalogId: 'vehicle.sedan' }, pose: { x: 1, z: 2, headingRad: 0 } }],
  props: [{ id: 'cone', model: { kind: 'catalog', catalogId: 'street.traffic_cone' }, pose: { x: 3, z: 4, headingRad: 0 } }],
  trafficControls: [], mapSignalPlans: [],
  choreography: { clipSeconds: 20, interactions: [{ id: 'go', actor: 'ego', trigger: { kind: 'at', t: 1.735 }, verb: 'speed', target: { mode: 'absolute', valueKph: 20 }, dynamics: { shape: 'linear', constraint: 'time', value: 1 } }] },
  invariants: [], variants: [],
  extensions: {
    'studio.ambientTraffic.provider.v1': 'native',
    'studio.presentation.ambientTraffic.v1': { version: 1, preset: 'heavy', densityVehiclesPerKm: 42, seed: 'diagnostic' },
    'studio.ambientTraffic.acceleratedSignalCycles.v1': true,
    apiKey: 'must-not-leak',
    localAsset: '/Users/person/private/model.fbx',
  },
} as unknown as ScenarioTemplateV2;

const controls = {
  version: 3 as const,
  reverseHorizontalLook: false, reverseVerticalLook: false,
  reverseHorizontalPan: false, reverseVerticalPan: false,
  horizontalLookSensitivity: 100, verticalLookSensitivity: 100,
  middlePanSensitivity: 100, rightPanSensitivity: 100, wheelZoomSensitivity: 100,
  keyboardMoveSensitivity: 100, keyboardTurnSensitivity: 100,
};

function build() {
  return createScenarioDiagnostic({
    scenario, revision: 17, map, currentXodrSha256: 'b'.repeat(64),
    validation: { ok: false, mapChecked: true, issues: [{ severity: 'warning', code: 'schema_invalid', path: 'roles.0', message: 'Review binding.' }] },
    graphicsPreset: 'roads-only', cameraControls: controls, buildCommit: 'ABCDEF1234567',
  });
}

function payload(text: string): Record<string, any> {
  const match = text.match(/^UNISCENARIOS_SCENARIO_DIAGNOSTIC_V1\n```json\n([\s\S]+)\n```$/);
  if (!match) throw new Error('invalid diagnostic envelope');
  return JSON.parse(match[1]!);
}

describe('scenario diagnostic bundle', () => {
  it('is deterministic, versioned, self-contained, and tied to the committed revision', () => {
    const first = build();
    const second = build();
    expect(first).toEqual(second);
    expect(first.text.startsWith(SCENARIO_DIAGNOSTIC_HEADER)).toBe(true);
    expect(first.bytes).toBe(new TextEncoder().encode(first.text).byteLength);
    const body = payload(first.text);
    expect(body).toMatchObject({
      kind: 'uniscenarios-scenario-diagnostic', schemaVersion: 1, diagnosticOnly: true, importSupported: false,
      revision: 17, durationSeconds: 20, scenarioDigest: contentHash(scenario),
      app: { appVersion: '0.1.0-editor', buildCommit: 'abcdef1234567' },
      map: { id: 'yale-street', name: 'Yale Street', contentHashes: { currentXodrSha256: 'b'.repeat(64), authoredXodrSha256: 'a'.repeat(64) } },
      reproduction: { graphicsPreset: 'roads-only', traffic: { engine: 'native', densityVehiclesPerKm: 42, acceleratedSignalCycles: true } },
      validation: { ok: false, mapChecked: true },
    });
    expect(body.scenario.choreography.interactions[0].trigger.t).toBe(1.735);
    expect(body.diagnosticContentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('redacts secrets and local paths and excludes heavy or stale artifacts', () => {
    const text = build().text;
    expect(text).not.toContain('must-not-leak');
    expect(text).not.toContain('/Users/person');
    expect(text).toContain('[redacted]');
    for (const excluded of ['canonicalTrace', 'traceGzip', 'variationsCandidates', 'localStorage', 'videoBytes', 'mapBinary']) {
      expect(text).not.toContain(excluded);
    }
  });

  it('does not mutate the scenario or its digest', () => {
    const before = JSON.stringify(scenario);
    const digest = contentHash(scenario);
    build();
    expect(JSON.stringify(scenario)).toBe(before);
    expect(contentHash(scenario)).toBe(digest);
  });
});

describe('scenario diagnostic clipboard', () => {
  it('uses the async clipboard when available', async () => {
    const writeText = vi.fn(async () => undefined);
    await expect(copyScenarioDiagnosticText('payload', { clipboard: { writeText }, document: null })).resolves.toBe('clipboard');
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('payload');
  });

  it('falls back to a temporary selectable textarea', async () => {
    const textarea = {
      value: '', style: {} as CSSStyleDeclaration, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const execCommand = vi.fn(() => true);
    const document = { body: { appendChild }, createElement: vi.fn(() => textarea), execCommand } as unknown as Document;
    const clipboard = { writeText: vi.fn(async () => { throw new Error('denied'); }) };
    await expect(copyScenarioDiagnosticText('fallback payload', { clipboard, document })).resolves.toBe('fallback');
    expect(textarea.value).toBe('fallback payload');
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalledOnce();
  });

  it('reports failure when neither clipboard path is available', async () => {
    await expect(copyScenarioDiagnosticText('payload', { clipboard: null, document: null }))
      .rejects.toThrow('Clipboard access is unavailable');
  });
});
