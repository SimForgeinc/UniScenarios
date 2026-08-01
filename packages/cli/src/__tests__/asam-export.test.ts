import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildLaneGraph, parseSimScenarioInput, type TopologyIndex } from '@uniscenarios/sim-engine';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AsamExportError,
  exportOpenScenarioDsl22,
  exportOpenScenarioXml14,
} from '../asam/index.js';

const graph = buildLaneGraph({
  schemaVersion: 1,
  mapName: 'export-fixture',
  source: { xodrSha256: 'fixture' },
  lanes: {},
  gates: [],
  junctions: {},
} satisfies TopologyIndex);

function fixture() {
  return parseSimScenarioInput({
    mapId: 'fixture-map',
    clipSeconds: 12,
    warmupSeconds: 0,
    metricSubject: 'ego',
    actors: [
      {
        id: 'ego',
        kind: 'vehicle',
        dims: { l: 4.6, w: 1.9, h: 1.5 },
        initial: { pose: { x: 10, z: -5, headingRad: 0.25 }, speedMps: 2 },
        behavior: {
          route: { kind: 'polyline', points: [{ x: 10, z: -5 }, { x: 80, z: -5 }] },
        },
      },
    ],
    interactions: [
      {
        id: 'accelerate',
        actorId: 'ego',
        trigger: { kind: 'at', t: 1 },
        verb: 'speed',
        target: { mode: 'absolute', value: 6 },
        dynamics: { shape: 'linear', constraint: 'time', value: 2 },
      },
      {
        id: 'stop',
        actorId: 'ego',
        trigger: { kind: 'after', interactionId: 'accelerate', delayS: 1 },
        verb: 'speed',
        target: { mode: 'stop' },
        dynamics: { shape: 'step', constraint: 'time', value: 0.1 },
      },
    ],
    occluders: [
      {
        id: 'parked-van',
        obb: { center: { x: 25, z: -2 }, lengthM: 5, widthM: 2, heightM: 2.2, headingRad: 0 },
      },
    ],
  });
}

function extendedXmlFixture() {
  const base = fixture();
  return parseSimScenarioInput({
    ...base,
    interactions: [
      {
        id: 'change-lane',
        actorId: 'ego',
        trigger: { kind: 'at', t: 0.5 },
        verb: 'changeLane',
        target: { mode: 'left', count: 1 },
        dynamics: { shape: 'sinusoidal', constraint: 'time', value: 1.5 },
      },
      {
        id: 'replace-route',
        actorId: 'ego',
        trigger: { kind: 'after', interactionId: 'change-lane', delayS: 0 },
        verb: 'route',
        target: { kind: 'polyline', points: [{ x: 30, z: -5 }, { x: 60, z: -10 }] },
      },
      {
        id: 'conditional-stop',
        actorId: 'ego',
        trigger: {
          kind: 'when',
          condition: { kind: 'speed', actorId: 'ego', cmp: 'gte', value: 4 },
          byLatest: 4,
          ifNever: 'fire',
        },
        verb: 'speed',
        target: { mode: 'stop' },
        dynamics: { shape: 'step', constraint: 'time', value: 0.1 },
      },
      {
        id: 'set-red',
        actorId: 'ego',
        trigger: { kind: 'at', t: 2 },
        verb: 'set',
        target: { key: 'signal:main-signal.phase', value: 'red' },
      },
      {
        id: 'remove-ego',
        actorId: 'ego',
        trigger: { kind: 'at', t: 10 },
        verb: 'exist',
        target: { state: 'absent' },
      },
    ],
    signalPrograms: [{
      id: 'main-signal',
      phases: [
        { phase: 'green', durationS: 6 },
        { phase: 'yellow', durationS: 2 },
        { phase: 'red', durationS: 6 },
      ],
      offsetS: 1,
      loop: true,
    }],
  });
}

describe('ASAM OpenSCENARIO XML 1.4.0 export', () => {
  it('emits deterministic concrete entities, routes, dependency triggers, and stop time', () => {
    const result = exportOpenScenarioXml14(fixture(), { graph, roadFile: 'fixture.xodr' });
    expect(result.standard).toBe('ASAM OpenSCENARIO XML 1.4.0');
    expect(result.content).toContain('<FileHeader revMajor="1" revMinor="4"');
    expect(result.content).toContain('<LogicFile filepath="fixture.xodr"/>');
    expect(result.content).toContain('<ScenarioObject name="actor_ego">');
    expect(result.content).toContain('<MiscObject mass="1" name="uniscenarios_occluder"');
    expect(result.content).toContain('<Route name="route_ego" closed="false">');
    expect(result.content).toContain('storyboardElementRef="event_accelerate"');
    expect(result.content).toContain('storyboardElementType="event" state="completeState"');
    expect(result.content).toContain('<SimulationTimeCondition value="12" rule="greaterOrEqual"/>');
    expect(result.warnings.map((warning) => warning.code)).toContain('evaluation_metadata_omitted');
    expect(exportOpenScenarioXml14(fixture(), { graph, roadFile: 'fixture.xodr' }).content).toBe(result.content);
  });

  it('emits schema-shaped routes, lifecycle actions, conditions, and 1.4 signal semantics', () => {
    const content = exportOpenScenarioXml14(extendedXmlFixture(), { graph }).content;
    expect(content).toContain('<LaneChangeAction>');
    expect(content).toContain('<AssignRouteAction>');
    expect(content).toContain('<DeleteEntityAction/>');
    expect(content).toContain('<TrafficSignalController name="main-signal"');
    expect(content).toContain('<Phase name="green" duration="6" semantics="go">');
    expect(content).toContain('<SpeedCondition rule="greaterOrEqual" value="4"/>');
  });
});

describe('ASAM OpenSCENARIO DSL 2.2.0 export', () => {
  it('emits the official import, concrete geometry, absolute schedules, and typed units', () => {
    const result = exportOpenScenarioDsl22(fixture(), { graph, roadFile: 'fixture.xodr' });
    expect(result.standard).toBe('ASAM OpenSCENARIO DSL 2.2.0');
    expect(result.content).toContain('import osc.standard');
    expect(result.content).toContain('scenario uniscenarios_instance:');
    expect(result.content).toContain('actor_ego: vehicle with:');
    expect(result.content).toContain('route_ego: path = path(');
    expect(result.content).toContain('actor_ego.change_speed(target: 6mps, rate_profile: constant, rate_peak: 2mpss)');
    expect(result.content).toContain('wait elapsed(4s)');
    expect(result.content).toContain('actor_ego.assign_speed(speed: 0mps)');
    expect(result.content).toContain('occluder_parked_van.location(pose: occluder_pose_parked_van)');
  });
});

describe('honest unsupported-feature failures', () => {
  it('reports exact paths instead of silently degrading controller semantics', () => {
    const input = fixture();
    const changed = parseSimScenarioInput({
      ...input,
      actors: input.actors.map((actor) => ({
        ...actor,
        behavior: { ...actor.behavior, rules: { ...actor.behavior.rules, obeySignals: false } },
      })),
    });
    expect(() => exportOpenScenarioXml14(changed, { graph })).toThrowError(AsamExportError);
    try {
      exportOpenScenarioXml14(changed, { graph });
    } catch (error) {
      expect((error as AsamExportError).issues).toEqual([
        expect.objectContaining({ code: 'unsupported_controller_rules', path: 'actors.0.behavior.rules' }),
      ]);
    }
  });

  it('rejects DSL traffic-signal programs without concrete map group bindings', () => {
    const input = parseSimScenarioInput({
      ...fixture(),
      signalPrograms: [{
        id: 'main-signal',
        phases: [{ phase: 'green', durationS: 10 }, { phase: 'red', durationS: 10 }],
      }],
    });
    try {
      exportOpenScenarioDsl22(input, { graph });
      throw new Error('expected export to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AsamExportError);
      expect((error as AsamExportError).issues).toEqual([
        expect.objectContaining({ code: 'unsupported_signal_program', path: 'signalPrograms' }),
      ]);
    }
  });
});

const officialXsd = process.env['ASAM_OPENSCENARIO_14_XSD'];
describe.skipIf(!officialXsd || !existsSync(officialXsd))('official ASAM XML 1.4.0 schema', () => {
  let dir = '';
  beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'uniscenarios-asam-')); });
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('validates the generated .xosc with the official XSD deliverable', async () => {
    for (const [name, input] of [['fixture', fixture()], ['extended', extendedXmlFixture()]] as const) {
      const file = path.join(dir, `${name}.xosc`);
      await writeFile(file, exportOpenScenarioXml14(input, { graph }).content, 'utf8');
      const result = await execa('xmllint', ['--noout', '--schema', officialXsd!, file], { reject: false });
      expect(result.exitCode, result.stderr).toBe(0);
    }
  });
});
