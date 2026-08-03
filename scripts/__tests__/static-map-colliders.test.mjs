import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { buildStaticColliderArtifact, extractGlbColliders, serializeStaticColliderArtifact } from '../static-map-colliders-lib.mjs';
import { sha256, writeGlb } from '../map-derivatives-lib.mjs';

const fixture = () => readFileSync(resolve(import.meta.dirname, '../../fixtures/yale-tile_0_0.lod3.glb'));

test('static collider artifact is byte-for-byte deterministic and schema-stable', () => {
  const bytes = fixture();
  const input = {
    mapId: 'yale-street',
    sourceManifestSha256: 'a'.repeat(64),
    manifest: { tiles: [{ id: 'yale-0-0', lods: [{ level: 3, file: 'tile.glb' }] }] },
    topology: { lanes: {} },
    readSource: () => bytes,
  };
  const first = buildStaticColliderArtifact(input);
  const second = buildStaticColliderArtifact(input);
  assert.equal(serializeStaticColliderArtifact(first), serializeStaticColliderArtifact(second));
  assert.equal(first.schema, 'uniscenarios.static-map-colliders/v1');
  assert.match(first.digest, /^sha256-[a-f0-9]{64}$/);
  assert.deepEqual(first.colliders, extractGlbColliders(bytes, 'yale-0-0').colliders.sort((a, b) => a.id.localeCompare(b.id)));
});

test('real Yale tile provides broad static-structure coverage quickly', () => {
  const start = performance.now();
  const result = extractGlbColliders(fixture(), 'yale-0-0');
  const elapsed = performance.now() - start;
  assert.ok(result.colliders.filter((item) => item.class === 'building').length >= 5);
  assert.ok(result.colliders.filter((item) => item.class === 'wall').length >= 2);
  assert.ok(result.colliders.every((item) => item.id.startsWith('yale-0-0/')));
  assert.ok(elapsed < 50, `metadata extraction took ${elapsed.toFixed(1)} ms`);
});

test('only explicitly named curbs become road-boundary colliders', () => {
  const glb = writeGlb({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'Road_Curb_1', mesh: 0 }, { name: 'sidewalk_concrete', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [-1, 0, -0.1], max: [1, 0.2, 0.1] }],
    buffers: [{ byteLength: 0 }],
  }, Buffer.alloc(0));
  const artifact = buildStaticColliderArtifact({
    mapId: 'curb-test', sourceManifestSha256: 'a'.repeat(64),
    manifest: { tiles: [{ id: 'tile', lods: [{ level: 3, file: 'tile.glb' }] }] },
    topology: { lanes: { lane: { laneType: 'driving', representativeWidthM: 3.5, polyline: [[0, 0], [2, 0]] } } },
    readSource: () => glb,
  });
  assert.deepEqual(artifact.colliders.map(({ id, class: kind }) => ({ id, kind })), [{ id: 'tile/0', kind: 'road-boundary' }]);
});

const fullYale = resolve(import.meta.dirname, '../../dev-assets/yale-street');
test('full Yale artifact covers buildings, fences, and barriers compactly', { skip: !existsSync(fullYale) }, () => {
  const manifestBytes = readFileSync(resolve(fullYale, '3d/manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const topology = JSON.parse(gunzipSync(readFileSync(resolve(fullYale, 'topology-index.json.gz'))));
  const readHeader = (relative) => {
    const descriptor = openSync(resolve(fullYale, '3d', relative), 'r');
    try {
      const header = Buffer.alloc(20);
      readSync(descriptor, header, 0, 20, 0);
      const jsonLength = header.readUInt32LE(12);
      const bytes = Buffer.alloc(20 + jsonLength);
      header.copy(bytes);
      readSync(descriptor, bytes, 20, jsonLength, 20);
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  };
  const start = performance.now();
  const artifact = buildStaticColliderArtifact({
    mapId: 'yale-street', sourceManifestSha256: sha256(manifestBytes), manifest, topology, readSource: readHeader,
  });
  assert.ok(artifact.statistics.classes.building >= 70);
  assert.ok(artifact.statistics.classes.wall >= 8);
  assert.ok(artifact.statistics.classes.barrier >= 2);
  assert.ok(Buffer.byteLength(serializeStaticColliderArtifact(artifact)) < 100_000);
  assert.ok(performance.now() - start < 1_000);
});
