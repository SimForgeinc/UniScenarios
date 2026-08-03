#!/usr/bin/env node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  analyzeRoadTiling, atomicWrite, classifyRoadsOnlySceneRoots, collectManifestGlbs, geometryIdentity, makeGeometryOnlyGlb, readGlb, sha256, subsetSceneNodes, subsetSceneRoots,
} from './map-derivatives-lib.mjs';
import { inspectPinnedToolchain, pinnedToolEnvironment } from './map-derivative-toolchain.mjs';
import { buildStaticColliderArtifact, serializeStaticColliderArtifact } from './static-map-colliders-lib.mjs';

function readGlbJsonChunk(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) throw new Error(`Truncated GLB header: ${file}`);
    const jsonLength = header.readUInt32LE(12);
    const bytes = Buffer.alloc(20 + jsonLength);
    header.copy(bytes);
    if (fs.readSync(descriptor, bytes, 20, jsonLength, 20) !== jsonLength) throw new Error(`Truncated GLB JSON chunk: ${file}`);
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const mapId = arg('map');
const mode = arg('mode', 'dry-run');
const variant = arg('variant', 'all');
if (!mapId || !/^[a-z0-9-]+$/.test(mapId)) throw new Error('Pass a safe map id with --map <id>');
if (!['dry-run', 'build'].includes(mode)) throw new Error('--mode must be dry-run or build');
if (!['all', 'geometry-only', 'roads-only', 'ktx2', 'static-colliders'].includes(variant)) throw new Error('--variant must be all, geometry-only, roads-only, ktx2, or static-colliders');

const repository = path.resolve(import.meta.dirname, '..');
const mapRoot = path.join(repository, 'dev-assets', mapId, '3d');
const manifestFile = path.join(mapRoot, 'manifest.json');
if (!fs.existsSync(manifestFile)) throw new Error(`Map does not exist: ${mapId}`);
const manifestBytes = fs.readFileSync(manifestFile);
const manifest = JSON.parse(manifestBytes);
const toolchain = JSON.parse(fs.readFileSync(path.join(repository, 'config', 'map-derivative-toolchain.json')));
const sourceFiles = collectManifestGlbs(manifest);
const sourceBytes = sourceFiles.reduce((sum, file) => sum + fs.statSync(path.join(mapRoot, file)).size, 0);
const outputRoot = path.join(mapRoot, 'variants');
if (!outputRoot.startsWith(`${mapRoot}${path.sep}`)) throw new Error('Derivative output escaped the selected map');

const localGltfTransform = process.env.UNISCENARIOS_GLTF_TRANSFORM
  || path.join(repository, '.tools', 'map-derivatives', 'node_modules', '.bin', 'gltf-transform');
const gltfTransformCommand = localGltfTransform;
const tool = childProcess.spawnSync(gltfTransformCommand, ['--version'], { encoding: 'utf8' });
const gltfVersion = tool.status === 0 ? tool.stdout.trim() : '';
let pinnedKtx = null;
let pinnedKtxError = null;
try { pinnedKtx = inspectPinnedToolchain(repository, toolchain); } catch (error) { pinnedKtxError = error instanceof Error ? error.message : String(error); }
const toolEnvironment = pinnedKtx ? pinnedToolEnvironment(pinnedKtx) : undefined;
const ktx2Ready = tool.status === 0 && gltfVersion === toolchain.gltfTransform && Boolean(pinnedKtx);
const road = manifest.staticLayers?.find((entry) => entry.id === 'road');
const roadPlan = road ? analyzeRoadTiling(fs.readFileSync(path.join(mapRoot, road.file)), {
  origin: manifest.scene.origin,
  cellSize: [manifest.scene.cellSize?.[0] ?? 100, manifest.scene.cellSize?.[2] ?? manifest.scene.cellSize?.[1] ?? 100],
}) : null;
const plan = {
  schemaVersion: 1, mapId, mode, requestedVariant: variant, sourceFiles: sourceFiles.length,
  sourceBytes, estimatedWorstCaseOutputBytes: Math.ceil(sourceBytes * 1.15),
  availableDiskBytes: fs.statfsSync(mapRoot).bavail * fs.statfsSync(mapRoot).bsize,
  tools: {
    expected: toolchain,
    gltfTransform: tool.status === 0 ? gltfVersion : null,
    ktx: pinnedKtx?.ktxVersion ?? null,
    toktx: pinnedKtx?.toktxVersion ?? null,
    pinnedPlatform: pinnedKtx?.platform ?? `${process.platform}-${process.arch}`,
    pinnedError: pinnedKtxError,
    pinnedKtx2Ready: ktx2Ready,
  },
  roadTiling: roadPlan ? { safe: roadPlan.safe, cellCount: roadPlan.cellCount, blockers: roadPlan.unsafe.slice(0, 20), blockerCount: roadPlan.unsafe.length } : null,
};
if (plan.availableDiskBytes < plan.estimatedWorstCaseOutputBytes * 1.2) throw new Error('Insufficient disk headroom for deterministic derivative build');
if (mode === 'dry-run') { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
if ((variant === 'ktx2' || variant === 'all') && !ktx2Ready) throw new Error('KTX2 build requires pinned gltf-transform and toktx executables; geometry-only can run independently');

const generatedAt = new Date().toISOString();
const variantManifestFile = path.join(outputRoot, 'manifest.json');
let variants = {};
if (fs.existsSync(variantManifestFile)) {
  const existing = JSON.parse(fs.readFileSync(variantManifestFile));
  if (existing.sourceManifestSha256 !== sha256(manifestBytes)) {
    throw new Error('Existing derivative manifest targets a different source manifest; refusing to merge variants');
  }
  variants = existing.variants ?? {};
}
if (variant === 'geometry-only' || variant === 'all') {
  const files = {};
  const representativeColorCache = new Map();
  // Publish into a versioned directory. The existing manifest continues to
  // reference the complete previous generation until the final atomic rename.
  const geometryDirectory = `geometry-only-v2-${generatedAt.replace(/[^0-9]/g, '')}`;
  for (const sourceFile of sourceFiles) {
    const source = fs.readFileSync(path.join(mapRoot, sourceFile));
    const { output } = await makeGeometryOnlyGlb(source, { representativeColorCache });
    const relative = path.posix.join('variants', geometryDirectory, sourceFile);
    atomicWrite(path.join(mapRoot, relative), output);
    files[sourceFile] = { file: relative, sourceSha256: sha256(source), outputSha256: sha256(output), bytes: output.length };
  }
  const geometryVariant = { id: 'geometry-only', generatedAt, generator: { name: 'uniscenarios-map-derivatives', version: '2.0.0', command: process.argv.join(' ') }, files };
  if (road && roadPlan?.safe && tool.status === 0) {
    const geometryRoad = fs.readFileSync(path.join(mapRoot, files[road.file].file));
    const tiledFiles = [];
    const tiledBounds = [];
    for (const [cell, nodeIndices] of Object.entries(roadPlan.assignments)) {
      const relative = path.posix.join('variants', geometryDirectory, 'road-tiles', `road_${cell}.glb`);
      const outputPath = path.join(mapRoot, relative);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const intermediate = `${outputPath}.unpruned-${process.pid}.glb`;
      const temporary = `${outputPath}.tmp-${process.pid}.glb`;
      fs.writeFileSync(intermediate, subsetSceneRoots(geometryRoad, nodeIndices));
      const result = childProcess.spawnSync(gltfTransformCommand, ['prune', intermediate, temporary], { stdio: 'inherit', env: toolEnvironment ?? process.env });
      fs.rmSync(intermediate);
      if (result.status !== 0) throw new Error(`Road tile prune failed for ${cell}`);
      fs.renameSync(temporary, outputPath);
      tiledFiles.push(relative);
      const [gx, gz] = cell.split('_').map(Number);
      const sx = manifest.scene.cellSize?.[0] ?? 100;
      const sz = manifest.scene.cellSize?.[2] ?? manifest.scene.cellSize?.[1] ?? 100;
      const ox = manifest.scene.origin?.[0] ?? 0;
      const oz = manifest.scene.origin?.[2] ?? 0;
      tiledBounds.push({ min: [ox + gx * sx, manifest.scene.bounds.min[1], oz + gz * sz], max: [ox + (gx + 1) * sx, manifest.scene.bounds.max[1], oz + (gz + 1) * sz] });
    }
    geometryVariant.staticLayers = [{ id: 'road', files: tiledFiles, bounds: tiledBounds }];
  }
  variants['geometry-only'] = geometryVariant;
}
if (variant === 'roads-only' || variant === 'all') {
  if (!road) throw new Error('Roads Only requires a road static layer');
  if (tool.status !== 0) throw new Error('Roads Only build requires the pinned gltf-transform prune executable');
  const source = fs.readFileSync(path.join(mapRoot, road.file));
  const { output: geometryRoad } = await makeGeometryOnlyGlb(source);
  const selection = classifyRoadsOnlySceneRoots(geometryRoad);
  if (selection.selectedNodeIndices.length === 0) throw new Error(`Roads Only selected no road or signal roots for ${mapId}`);
  const directory = `roads-only-v1-${generatedAt.replace(/[^0-9]/g, '')}`;
  const relative = path.posix.join('variants', directory, road.file);
  const outputPath = path.join(mapRoot, relative);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const intermediate = `${outputPath}.unpruned-${process.pid}.glb`;
  const temporary = `${outputPath}.tmp-${process.pid}.glb`;
  fs.writeFileSync(intermediate, subsetSceneNodes(geometryRoad, selection.selectedNodeIndices));
  const result = childProcess.spawnSync(gltfTransformCommand, ['prune', intermediate, temporary], { stdio: 'inherit', env: toolEnvironment ?? process.env });
  fs.rmSync(intermediate);
  if (result.status !== 0) throw new Error('Roads Only road prune failed');
  fs.renameSync(temporary, outputPath);
  const output = fs.readFileSync(outputPath);
  variants['roads-only'] = {
    id: 'roads-only', generatedAt,
    generator: { name: 'uniscenarios-map-derivatives', version: '1.0.0', command: process.argv.join(' ') },
    files: { [road.file]: { file: relative, sourceSha256: sha256(source), outputSha256: sha256(output), bytes: output.length } },
    audit: { keptRoots: selection.kept, droppedRootCount: selection.dropped.length },
  };
}
if (variant === 'static-colliders' || variant === 'all') {
  const topologyFile = ['topology-index.json.gz', 'topology-index.json']
    .map((name) => path.join(repository, 'dev-assets', mapId, name))
    .find((file) => fs.existsSync(file));
  if (!topologyFile) throw new Error(`Map has no topology index: ${mapId}`);
  const topologyBytes = fs.readFileSync(topologyFile);
  const topology = JSON.parse((topologyFile.endsWith('.gz') ? zlib.gunzipSync(topologyBytes) : topologyBytes).toString('utf8'));
  const artifact = buildStaticColliderArtifact({
    mapId,
    sourceManifestSha256: sha256(manifestBytes),
    manifest,
    topology,
    readSource: (file) => readGlbJsonChunk(path.join(mapRoot, file)),
  });
  const relative = 'static-colliders-v1.json';
  const serialized = serializeStaticColliderArtifact(artifact);
  atomicWrite(path.join(outputRoot, relative), serialized);
  variants['static-colliders'] = {
    id: 'static-colliders',
    schemaVersion: 1,
    generator: { name: 'uniscenarios-static-map-colliders', version: '1.0.0' },
    file: relative,
    digest: artifact.digest,
    outputSha256: sha256(Buffer.from(serialized)),
    bytes: Buffer.byteLength(serialized),
    sourceTiles: artifact.statistics.sourceTiles,
    accepted: artifact.statistics.accepted,
  };
}
if (variant === 'ktx2' || variant === 'all') {
  const files = {};
  for (const sourceFile of sourceFiles) {
    const sourcePath = path.join(mapRoot, sourceFile);
    const relative = path.posix.join('variants/ktx2', sourceFile);
    const outputPath = path.join(mapRoot, relative);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.tmp-${process.pid}.glb`;
    const result = childProcess.spawnSync(gltfTransformCommand, ['uastc', sourcePath, temporary, '--level', '2', '--rdo', '--rdo-lambda', '2'], { stdio: 'inherit', env: toolEnvironment });
    if (result.status !== 0) throw new Error(`KTX2 conversion failed for ${sourceFile}`);
    const source = fs.readFileSync(sourcePath);
    const output = fs.readFileSync(temporary);
    if (geometryIdentity(readGlb(source).json) !== geometryIdentity(readGlb(output).json)) {
      fs.rmSync(temporary);
      throw new Error(`KTX2 conversion changed scene, transform, or accessor identity for ${sourceFile}`);
    }
    fs.renameSync(temporary, outputPath);
    files[sourceFile] = { file: relative, sourceSha256: sha256(source), outputSha256: sha256(output), bytes: output.length };
  }
  const basisSource = path.join(repository, 'packages', 'city-renderer', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  const runtimeAssets = [];
  for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    const source = fs.readFileSync(path.join(basisSource, name));
    const relative = path.posix.join('variants/basis', name);
    atomicWrite(path.join(mapRoot, relative), source);
    runtimeAssets.push({ file: relative, sha256: sha256(source) });
  }
  variants.ktx2 = {
    id: 'ktx2', generatedAt,
    generator: { name: 'gltf-transform/uastc', version: gltfVersion, command: 'gltf-transform uastc --level 2 --rdo --rdo-lambda 2' },
    files,
    runtime: { ktx2TranscoderPath: 'variants/basis/', assets: runtimeAssets },
  };
}
const variantManifest = { schemaVersion: 1, sourceManifestSha256: sha256(manifestBytes), variants };
atomicWrite(variantManifestFile, `${JSON.stringify(variantManifest, null, 2)}\n`);
atomicWrite(path.join(outputRoot, 'build-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({ ...plan, outputRoot, variants: Object.keys(variants) }, null, 2));
