import { describe, expect, it } from 'vitest';
import {
  compileDigest,
  jobProducesArtifacts,
  jobProducesCompleteTrace,
  mapAssetDigest,
  RevisionGate,
  runtimeDigest,
  type MapRuntimeIdentity,
} from '../mapRuntime';

const map = {
  id: 'test-map',
  manifest: '/map/manifest.1.json',
  topology: '/map/topology.1.json',
  derivedTopology: '/map/derived.1.json',
  locations: '/map/locations.1.json',
  xodr: '/map/map.1.xodr',
  signals: '/map/signals.1.json',
};

const runtime: MapRuntimeIdentity = {
  mapId: map.id,
  assetDigest: mapAssetDigest(map),
  graphDigest: 'graph-1',
  controlDigest: 'controls-1',
  colliderDigest: 'colliders-1',
};

describe('worker-side MapRuntime identity', () => {
  it('is deterministic for warm reuse and invalidates on every map artifact class', () => {
    expect(mapAssetDigest({ ...map })).toBe(mapAssetDigest(map));
    for (const field of ['manifest', 'topology', 'derivedTopology', 'locations', 'xodr', 'signals'] as const) {
      expect(mapAssetDigest({ ...map, [field]: `${map[field]}?rev=2` })).not.toBe(mapAssetDigest(map));
    }
  });

  it('invalidates the runtime for graph, control and collider revisions', () => {
    const baseline = runtimeDigest(runtime);
    expect(runtimeDigest({ ...runtime, graphDigest: 'graph-2' })).not.toBe(baseline);
    expect(runtimeDigest({ ...runtime, controlDigest: 'controls-2' })).not.toBe(baseline);
    expect(runtimeDigest({ ...runtime, colliderDigest: 'colliders-2' })).not.toBe(baseline);
  });

  it('compiles the same document revision deterministically and separates revisions', () => {
    const compile = { revision: '17', documentDigest: 'document-a', ambientDigest: 'traffic-a' };
    expect(compileDigest(runtime, { ...compile })).toBe(compileDigest(runtime, compile));
    expect(compileDigest(runtime, { ...compile, revision: '18' })).not.toBe(compileDigest(runtime, compile));
    expect(compileDigest(runtime, { ...compile, documentDigest: 'document-b' })).not.toBe(compileDigest(runtime, compile));
  });
});

describe('runtime job separation', () => {
  it('keeps edit compilation and Play free of complete traces and export artifacts', () => {
    expect(jobProducesCompleteTrace('compile')).toBe(false);
    expect(jobProducesCompleteTrace('play')).toBe(false);
    expect(jobProducesArtifacts('compile')).toBe(false);
    expect(jobProducesArtifacts('play')).toBe(false);
    expect(jobProducesArtifacts('validate')).toBe(false);
    expect(jobProducesCompleteTrace('validate')).toBe(true);
    expect(jobProducesCompleteTrace('export')).toBe(true);
    expect(jobProducesArtifacts('export')).toBe(true);
  });

  it('rejects stale worker completions after a newer editor revision begins', () => {
    const gate = new RevisionGate();
    gate.begin('revision-1');
    expect(gate.accepts('revision-1')).toBe(true);
    gate.begin('revision-2');
    expect(gate.accepts('revision-1')).toBe(false);
    expect(gate.accepts('revision-2')).toBe(true);
    gate.invalidate();
    expect(gate.accepts('revision-2')).toBe(false);
  });
});
