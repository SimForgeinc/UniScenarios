import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { analyzeRoadTiling, geometryIdentity, makeGeometryOnlyGlb, readGlb, representativeImageColor, semanticFallbackColor, subsetSceneRoots, writeGlb } from '../map-derivatives-lib.mjs';
import { inspectPinnedToolchain } from '../map-derivative-toolchain.mjs';

function fixture({ crossing = false } = {}) {
  const positions = Buffer.alloc(36);
  const image = Buffer.from('pretend-image-payload');
  const bin = Buffer.concat([positions, image]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'road-patch', mesh: 0, translation: crossing ? [9, 0, 0] : [1, 0, 1] }],
    meshes: [{ name: 'road', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 0, 2] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: image.length }],
    buffers: [{ byteLength: bin.length }], images: [{ bufferView: 1, mimeType: 'image/png' }], textures: [{ source: 0 }],
    materials: [{ name: 'Asphalt', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  };
  return writeGlb(json, bin);
}

test('geometry-only GLB strips image bytes and preserves geometry identity', async () => {
  const source = fixture();
  const before = geometryIdentity(readGlb(source).json);
  const { output, report } = await makeGeometryOnlyGlb(source);
  const parsed = readGlb(output);
  assert.equal(parsed.json.images, undefined);
  assert.equal(parsed.json.textures, undefined);
  assert.equal(parsed.json.bufferViews.length, 1);
  assert.equal(geometryIdentity(parsed.json), before);
  assert.ok(parsed.bin.length < readGlb(source).bin.length);
  assert.equal(report.geometryIdentity, before);
});

test('geometry-only GLB preserves legal zero-length buffer views', async () => {
  const parsed = readGlb(fixture());
  parsed.json.bufferViews.push({ buffer: 0, byteOffset: parsed.bin.length, byteLength: 0 });
  const source = writeGlb(parsed.json, parsed.bin);
  const { output } = await makeGeometryOnlyGlb(source);
  const result = readGlb(output);
  assert.equal(result.json.bufferViews.some((view) => view.byteLength === 0), true);
  assert.equal(geometryIdentity(result.json), geometryIdentity(parsed.json));
});

test('representative texture colors are averaged in linear space and alpha-weighted', async () => {
  const png = await sharp(Buffer.from([
    255, 0, 0, 255,
    0, 0, 255, 255,
    0, 255, 0, 0,
  ]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
  const [red, green, blue, alpha] = await representativeImageColor(png, new Map(), { alphaMode: 'BLEND' });
  assert.ok(Math.abs(red - 0.5) < 0.01);
  assert.ok(green < 0.01);
  assert.ok(Math.abs(blue - 0.5) < 0.01);
  assert.ok(Math.abs(alpha - (2 / 3)) < 0.01);
});

test('semantic flat-color fallbacks distinguish roads, grass, buildings, and vegetation', () => {
  assert.notDeepEqual(semanticFallbackColor('Asphalt1_Road'), semanticFallbackColor('Grass1_Ground'));
  assert.notDeepEqual(semanticFallbackColor('Real_home_red'), semanticFallbackColor('mi_oak_leaf_v1'));
  assert.deepEqual(semanticFallbackColor('Concrete1_Sidewalk'), semanticFallbackColor('Curb_Curb'));
});

test('geometry-only conversion bakes texture color times factor and removes texture declarations', async () => {
  const png = await sharp(Buffer.from([255, 0, 0, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
  const parsed = readGlb(fixture());
  parsed.json.bufferViews[1].byteLength = png.length;
  parsed.json.buffers[0].byteLength = 36 + png.length;
  parsed.json.materials[0].alphaMode = 'MASK';
  parsed.json.materials[0].alphaCutoff = 0.4;
  parsed.json.materials[0].doubleSided = true;
  parsed.json.materials[0].pbrMetallicRoughness.baseColorFactor = [0.5, 0.75, 1, 1];
  parsed.json.extensionsUsed = ['KHR_texture_transform'];
  const source = writeGlb(parsed.json, Buffer.concat([parsed.bin.subarray(0, 36), png]));
  const result = readGlb((await makeGeometryOnlyGlb(source)).output).json;
  assert.deepEqual(result.materials[0].pbrMetallicRoughness.baseColorFactor, [0.5, 0, 0, 1]);
  assert.equal(result.materials[0].alphaMode, 'MASK');
  assert.equal(result.materials[0].alphaCutoff, 0.4);
  assert.equal(result.materials[0].doubleSided, true);
  assert.equal(result.extensionsUsed, undefined);
  assert.equal(JSON.stringify(result).includes('Texture'), false);
});

test('road tiling fails closed for a node crossing a cell boundary', () => {
  assert.equal(analyzeRoadTiling(fixture({ crossing: true }), { origin: [0, 0, 0], cellSize: [10, 10] }).safe, false);
});

test('safe node subsets preserve the selected scene root without rewriting buffers', () => {
  const source = fixture();
  const subset = readGlb(subsetSceneRoots(source, [0]));
  assert.deepEqual(subset.json.scenes[0].nodes, [0]);
  assert.equal(subset.bin.length, readGlb(source).bin.length);
});

test('pinned toolchain rejects a missing or modified executable', () => {
  const repository = '/repository';
  const fixtureConfig = {
    ktxSoftware: {
      version: '4.4.2',
      platforms: {
        'test-arch': {
          installDirectory: 'ktx/test',
          executables: { ktx: '0'.repeat(64), toktx: '0'.repeat(64), ktxinfo: '0'.repeat(64) },
        },
      },
    },
  };
  assert.throws(() => inspectPinnedToolchain(repository, fixtureConfig, 'test-arch'), /Pinned ktx executable is missing/);
});
