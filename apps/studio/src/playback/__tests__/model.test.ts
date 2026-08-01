import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  contentHash,
  parseSimScenarioInput,
  type SimScenarioInput,
  type SimTrace,
} from '@uniscenarios/sim-engine';
import {
  PlaybackLoadError,
  parsePlaybackPair,
  readPlaybackFiles,
  samplePlaybackActors,
  samplePlaybackSignals,
  type PlaybackFile,
} from '../model';

function input(): SimScenarioInput {
  return parseSimScenarioInput({
    mapId: 'yale-street',
    clipSeconds: 1,
    warmupSeconds: 0,
    dt: 0.2,
    seed: 'playback-test',
    metricSubject: 'ego',
    actors: [
      {
        id: 'bus',
        kind: 'vehicle',
        dims: { l: 12, w: 2.55, h: 3.2 },
        initial: { pose: { x: 10, z: -20, headingRad: 0.25 }, speedMps: 0 },
        behavior: {
          route: { kind: 'polyline', points: [{ x: 10, z: -20 }, { x: 11, z: -20 }] },
        },
        static: true,
        tags: ['catalog:vehicle.bus'],
      },
      {
        id: 'ego',
        kind: 'vehicle',
        dims: { l: 4.8, w: 1.9, h: 1.5 },
        initial: { pose: { x: 0, z: 0, headingRad: 3.1 }, speedMps: 10 },
        behavior: {
          route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 20, z: 0 }] },
        },
      },
    ],
  });
}

function trace(documentInput = input()): SimTrace {
  const hash = contentHash(documentInput);
  return {
    header: {
      traceVersion: 1,
      engineVersion: '0.1.0',
      inputHash: hash,
      seed: 'playback-test',
      mapId: 'yale-street',
      engineGraphDigest: 'graph-digest',
      topologyDigest: 'graph-digest',
      dt: 0.2,
      clipSeconds: 1,
      warmupSeconds: 0,
      frame: 'xodr-local',
      actorIds: ['bus', 'ego'],
      metricSubject: 'ego',
    },
    ticks: {
      t: [0, 1],
      actors: {
        bus: {
          x: [10, 10],
          y: [20, 20],
          headingRad: [0.25, 0.25],
          speedMps: [0, 0],
          laneRsl: [null, null],
          s: [0, 0],
          present: [1, 1],
        },
        ego: {
          x: [0, 10],
          y: [0, 0],
          headingRad: [3.1, -3.1],
          speedMps: [10, 10],
          laneRsl: [null, null],
          s: [0, 10],
          present: [1, 1],
        },
      },
    },
    events: [],
    metrics: {
      minTTC: null,
      minDistance: [],
      requiredDecelMax: { bus: 0, ego: 0 },
      collisions: [],
      triggerNeverFired: [],
      clippedCriticality: false,
      ticksSimulated: 2,
    },
  };
}

function pair() {
  const documentInput = input();
  return {
    instance: {
      kind: 'scenario-instance',
      version: 1,
      manifest: {
        instanceId: 'golden#1',
        inputHash: contentHash(documentInput),
        replayKey: { mapId: 'yale-street', engineGraphDigest: 'graph-digest' },
        actors: [{ id: 'bus' }, { id: 'ego' }],
      },
      input: documentInput,
    },
    trace: trace(documentInput),
  };
}

class BytesFile implements PlaybackFile {
  constructor(readonly name: string, private readonly bytes: Uint8Array) {}
  async arrayBuffer(): Promise<ArrayBuffer> {
    return Uint8Array.from(this.bytes).buffer;
  }
}

function message(action: () => unknown): string {
  try {
    action();
    throw new Error('expected action to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(PlaybackLoadError);
    return (error as Error).message;
  }
}

describe('UniScenarios concrete playback import', () => {
  it('parses a concrete instance with plain JSON or a gzip trace', async () => {
    const fixture = pair();
    const instanceBytes = new TextEncoder().encode(JSON.stringify(fixture.instance));
    const traceBytes = new TextEncoder().encode(JSON.stringify(fixture.trace));

    const plain = await readPlaybackFiles(
      new BytesFile('golden.instance.json', instanceBytes),
      new BytesFile('golden.trace.json', traceBytes),
    );
    const gzipped = await readPlaybackFiles(
      new BytesFile('golden.instance.json', instanceBytes),
      new BytesFile('golden.trace.json.gz', gzipSync(traceBytes)),
    );

    expect(plain.actors.map((actor) => [actor.id, actor.catalogId, actor.modelBasis])).toEqual([
      ['bus', 'vehicle.bus', 'input-tag'],
      ['ego', 'vehicle.sedan', 'kind-default'],
    ]);
    expect(gzipped.actors).toEqual(plain.actors);
    expect(gzipped.startTime).toBe(0);
    expect(gzipped.endTime).toBe(1);
  });

  it('imports, validates, and samples export-ready physical signal state', () => {
    const documentInput = parseSimScenarioInput({
      ...input(),
      signalPrograms: [
        {
          id: 'signal:1542',
          phases: [
            { phase: 'red', durationS: 1 },
            { phase: 'green', durationS: 1 },
          ],
          stopLines: [],
          mapBinding: {
            junctionId: '134',
            controllerIds: ['1562'],
            headIds: ['1542'],
            timingSource: 'synthetic-default',
          },
        },
      ],
    });
    const baseTrace = trace(documentInput);
    const signalTrace: SimTrace = {
      ...baseTrace,
      ticks: {
        ...baseTrace.ticks,
        signals: { 'signal:1542': { phase: ['red', 'green'] } },
      },
    };
    const bundle = parsePlaybackPair(
      {
        kind: 'scenario-instance',
        version: 1,
        manifest: {
          instanceId: 'signalized#1',
          inputHash: contentHash(documentInput),
          replayKey: { mapId: 'yale-street', engineGraphDigest: 'graph-digest' },
          actors: [{ id: 'bus' }, { id: 'ego' }],
        },
        input: documentInput,
      },
      signalTrace,
      { instanceName: 'signal.instance.json', traceName: 'signal.trace.json' },
    );
    expect(bundle.signals).toEqual([
      {
        id: 'signal:1542',
        headIds: ['1542'],
        timingSource: 'synthetic-default',
      },
    ]);
    expect(samplePlaybackSignals(bundle, 0)).toEqual([
      expect.objectContaining({ id: 'signal:1542', phase: 'red', headIds: ['1542'] }),
    ]);
    expect(samplePlaybackSignals(bundle, 1)[0]?.phase).toBe('green');
  });

  it('rejects input-hash, map, and actor identity mismatches with paths', () => {
    const fixture = pair();
    const broken = structuredClone(fixture.trace) as any;
    broken.header.inputHash = 'wrong-hash';
    broken.header.mapId = 'other-map';
    broken.header.actorIds = ['ego'];
    delete (broken.ticks.actors as Partial<typeof broken.ticks.actors>).bus;

    const error = message(() => parsePlaybackPair(fixture.instance, broken));
    expect(error).toContain('header.inputHash');
    expect(error).toContain('header.mapId');
    expect(error).toContain('actor ids differ');
    expect(error).toContain('ticks.actors.bus is missing');
  });

  it('maps real actor ids and interpolates dynamic pose and wrapped heading', () => {
    const fixture = pair();
    const bundle = parsePlaybackPair(fixture.instance, fixture.trace);
    const sampled = samplePlaybackActors(bundle, 0.5);
    const bus = sampled.find((actor) => actor.id === 'bus')!;
    const ego = sampled.find((actor) => actor.id === 'ego')!;

    expect(bundle.actors).toHaveLength(2);
    expect(bus.static).toBe(true);
    expect(bus).toMatchObject({ x: 10, z: -20, headingRad: 0.25, present: true });
    expect(ego.static).toBe(false);
    expect(ego.x).toBeCloseTo(5, 8);
    expect(ego.z).toBeCloseTo(0, 8);
    expect(Math.abs(ego.headingRad)).toBeGreaterThan(3.1);
  });

  it('keeps a static actor fixed while a dynamic actor moves across samples', () => {
    const fixture = pair();
    const bundle = parsePlaybackPair(fixture.instance, fixture.trace);
    const atStart = samplePlaybackActors(bundle, 0);
    const atEnd = samplePlaybackActors(bundle, 1);
    const startBus = atStart.find((actor) => actor.id === 'bus')!;
    const endBus = atEnd.find((actor) => actor.id === 'bus')!;
    const startEgo = atStart.find((actor) => actor.id === 'ego')!;
    const endEgo = atEnd.find((actor) => actor.id === 'ego')!;

    expect(endBus).toEqual(startBus);
    expect(endEgo.x - startEgo.x).toBe(10);
  });

  it('rejects changing static traces and malformed channel lengths', () => {
    const fixture = pair();
    const broken = structuredClone(fixture.trace) as any;
    broken.ticks.actors.bus.x[1] = 10.1;
    broken.ticks.actors.ego.present.pop();

    const error = message(() => parsePlaybackPair(fixture.instance, broken));
    expect(error).toContain('static actor bus changes in channel x');
    expect(error).toContain('ticks.actors.ego.present length 1 does not match ticks.t length 2');
  });

  it('rejects unknown actor model mappings instead of drawing a cosmetic box', () => {
    const fixture = pair();
    fixture.instance.input.actors[0]!.tags = ['catalog:vehicle.does-not-exist'];
    fixture.instance.manifest.inputHash = contentHash(fixture.instance.input);
    (fixture.trace.header as any).inputHash = fixture.instance.manifest.inputHash;

    expect(message(() => parsePlaybackPair(fixture.instance, fixture.trace))).toContain(
      'unknown Studio catalog model "vehicle.does-not-exist"',
    );
  });
});

const GOLDEN_ROOT = new URL('../../../../../fixtures/evidence/golden-yale-bus-stop/', import.meta.url);
const GOLDEN_INSTANCE = new URL('instance.json', GOLDEN_ROOT);
const GOLDEN_TRACE = new URL('trace.json.gz', GOLDEN_ROOT);

describe.skipIf(!existsSync(GOLDEN_INSTANCE) || !existsSync(GOLDEN_TRACE))('corrected golden Yale pair', () => {
  it('loads three concrete actors and samples real static/dynamic motion', async () => {
    const bundle = await readPlaybackFiles(
      new BytesFile('instance.json', readFileSync(GOLDEN_INSTANCE)),
      new BytesFile('trace.json.gz', readFileSync(GOLDEN_TRACE)),
    );
    expect(bundle.instance.manifest.instanceId).toBe('fa9fa19457cf576f#8');
    expect(bundle.instance.manifest.inputHash).toBe(
      '29309981338d6ada82186b3a7e21d2138775dd8cedd16e587efbca5f4da66531',
    );
    expect(bundle.actors.map((actor) => actor.id)).toEqual(['bus', 'ego', 'ped']);

    const before = samplePlaybackActors(bundle, 0);
    const conflict = samplePlaybackActors(bundle, 6.9);
    const bus0 = before.find((actor) => actor.id === 'bus')!;
    const bus1 = conflict.find((actor) => actor.id === 'bus')!;
    const ego0 = before.find((actor) => actor.id === 'ego')!;
    const ego1 = conflict.find((actor) => actor.id === 'ego')!;
    expect(bus1).toEqual(bus0);
    expect(Math.hypot(ego1.x - ego0.x, ego1.z - ego0.z)).toBeGreaterThan(80);
  });
});
