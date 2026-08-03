#!/usr/bin/env node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { inspectPinnedToolchain, pinnedToolEnvironment } from './map-derivative-toolchain.mjs';
import { readGlb, sha256 } from './map-derivatives-lib.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const toolchain = JSON.parse(fs.readFileSync(path.join(repository, 'config', 'map-derivative-toolchain.json')));
const inspected = inspectPinnedToolchain(repository, toolchain);
const environment = pinnedToolEnvironment(inspected);
const outputRoot = path.join(repository, '.tools', 'map-derivatives', 'smoke');
fs.mkdirSync(outputRoot, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}
function png(width, height, pixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4); row[0] = 0;
    for (let x = 0; x < width; x++) Buffer.from(pixel(x, y)).copy(row, 1 + x * 4);
    rows.push(row);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

export const texturePolicies = Object.freeze({
  baseColor: { transfer: 'SRGB', format: 'R8G8B8A8_SRGB', rdo: true },
  emissive: { transfer: 'SRGB', format: 'R8G8B8A8_SRGB', rdo: true },
  normal: { transfer: 'LINEAR', format: 'R8G8B8A8_UNORM', rdo: false },
  orm: { transfer: 'LINEAR', format: 'R8G8B8A8_UNORM', rdo: true },
});

const pixels = {
  baseColor: (x, y) => [80 + x * 12, 42 + y * 9, 20 + ((x + y) % 4) * 10, 255],
  emissive: (x, y) => [20 + x * 24, 5 + y * 8, 2, 255],
  normal: (x, y) => [125 + x, 125 + y, 253, 255],
  orm: (x, y) => [180 + x, 65 + y * 8, 8 + x * 20, 255],
};
const reports = [];
for (const [slot, policy] of Object.entries(texturePolicies)) {
  const source = path.join(outputRoot, `${slot}.png`);
  const output = path.join(outputRoot, `${slot}.ktx2`);
  fs.writeFileSync(source, png(8, 8, pixels[slot]));
  const args = [
    'create', '--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18', '--generate-mipmap',
    '--assign-oetf', policy.transfer.toLowerCase(), '--assign-primaries', policy.transfer === 'SRGB' ? 'bt709' : 'none',
    '--format', policy.format,
  ];
  if (policy.rdo) args.push('--uastc-rdo', '--uastc-rdo-l', '2');
  args.push(source, output);
  const create = childProcess.spawnSync(inspected.commands.ktx, args, { encoding: 'utf8', env: environment });
  if (create.status !== 0) throw new Error(`KTX smoke conversion failed for ${slot}: ${create.stderr || create.stdout}`);
  const validate = childProcess.spawnSync(inspected.commands.ktx, ['validate', output], { encoding: 'utf8', env: environment });
  if (validate.status !== 0) throw new Error(`Official KTX validation failed for ${slot}: ${validate.stderr || validate.stdout}`);
  const info = childProcess.spawnSync(inspected.commands.ktxinfo, [output], { encoding: 'utf8', env: environment });
  if (info.status !== 0) throw new Error(`ktxinfo failed for ${slot}: ${info.stderr || info.stdout}`);
  const transfer = info.stdout.match(/colorModel[^\n]*\n|transferFunction[^\n]*/gi)?.join(' ') ?? info.stdout;
  if (!new RegExp(`KHR_DF_TRANSFER_${policy.transfer}`, 'i').test(transfer)) {
    throw new Error(`${slot} transfer function mismatch; expected ${policy.transfer}`);
  }
  reports.push({ slot, transfer: policy.transfer, rdo: policy.rdo, bytes: fs.statSync(output).size, sha256: sha256(fs.readFileSync(output)) });
}

// Exercise the exact map-build integration on a small real asset containing
// base-color, normal, occlusion, roughness, and metallic texture slots.
const realSource = path.join(repository, 'dev-assets', 'belmont-research-center', '3d', 'tiles', 'tile_4_7.lod3.glb');
if (!fs.existsSync(realSource)) throw new Error(`Representative map asset is unavailable: ${realSource}`);
const realOutput = path.join(outputRoot, 'real-belmont-sign.ktx2.glb');
const gltfTransform = path.join(repository, '.tools', 'map-derivatives', 'node_modules', '.bin', 'gltf-transform');
const realConversion = childProcess.spawnSync(gltfTransform, [
  'uastc', realSource, realOutput, '--level', '2', '--rdo', '--rdo-lambda', '2',
], { encoding: 'utf8', env: environment });
if (realConversion.status !== 0) throw new Error(`Real GLB KTX2 conversion failed: ${realConversion.stderr || realConversion.stdout}`);
const { json: realJson, bin: realBin } = readGlb(fs.readFileSync(realOutput));
if (!(realJson.extensionsRequired ?? []).includes('KHR_texture_basisu')) throw new Error('Real GLB does not require KHR_texture_basisu');
const slots = new Map();
for (const material of realJson.materials ?? []) {
  const pbr = material.pbrMetallicRoughness ?? {};
  for (const [slot, textureInfo] of [
    ['baseColor', pbr.baseColorTexture], ['normal', material.normalTexture],
    ['orm', pbr.metallicRoughnessTexture], ['orm', material.occlusionTexture],
  ]) if (textureInfo) slots.set(textureInfo.index, slot);
}
const realTextures = [];
for (const [textureIndex, slot] of slots) {
  const sourceIndex = realJson.textures?.[textureIndex]?.extensions?.KHR_texture_basisu?.source;
  const image = realJson.images?.[sourceIndex];
  const view = realJson.bufferViews?.[image?.bufferView];
  if (image?.mimeType !== 'image/ktx2' || !view) throw new Error(`Real ${slot} texture was not encoded as embedded KTX2`);
  const bytes = realBin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const extracted = path.join(outputRoot, `real-${slot}.ktx2`);
  fs.writeFileSync(extracted, bytes);
  const validate = childProcess.spawnSync(inspected.commands.ktx, ['validate', extracted], { encoding: 'utf8', env: environment });
  if (validate.status !== 0) throw new Error(`Official KTX validation failed for real ${slot}: ${validate.stderr || validate.stdout}`);
  const info = childProcess.spawnSync(inspected.commands.ktxinfo, [extracted], { encoding: 'utf8', env: environment });
  const expectedTransfer = slot === 'baseColor' ? 'SRGB' : 'LINEAR';
  if (info.status !== 0 || !new RegExp(`KHR_DF_TRANSFER_${expectedTransfer}`, 'i').test(info.stdout)) {
    throw new Error(`Real ${slot} transfer function mismatch; expected ${expectedTransfer}`);
  }
  realTextures.push({ slot, transfer: expectedTransfer, bytes: bytes.length, sha256: sha256(bytes) });
}
for (const required of ['baseColor', 'normal', 'orm']) {
  if (!realTextures.some((entry) => entry.slot === required)) throw new Error(`Real smoke asset did not exercise ${required}`);
}

const report = {
  schemaVersion: 1,
  platform: inspected.platform,
  ktxVersion: inspected.ktxVersion,
  toktxVersion: inspected.toktxVersion,
  outputRoot,
  textures: reports,
  realAsset: {
    source: path.relative(repository, realSource),
    sourceSha256: sha256(fs.readFileSync(realSource)),
    output: path.relative(repository, realOutput),
    outputSha256: sha256(fs.readFileSync(realOutput)),
    textures: realTextures,
  },
};
fs.writeFileSync(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
