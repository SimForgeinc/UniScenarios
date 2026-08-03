import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  console.error('usage: node prepare-map.mjs <map.xodr> <output-directory>');
  process.exit(2);
}
const input = resolve(inputArgument);
const output = resolve(outputArgument);
await mkdir(output, { recursive: true });
const networkPath = join(output, `${basename(input, '.xodr')}.net.xml`);

execFileSync('netconvert', [
  '--opendrive-files', input,
  '--output-file', networkPath,
  '--opendrive.import-all-lanes', 'false',
  '--geometry.remove', 'false',
  '--junctions.join', 'false',
  '--no-warnings', 'true',
], { stdio: 'inherit' });

const network = await readFile(networkPath);
const xml = network.toString('utf8');
const location = xml.match(/<location\s+([^>]+)\/>/)?.[1] ?? '';
const netOffset = attribute(location, 'netOffset')?.split(',').map(Number) ?? [0, 0];
const compressed = gzipSync(network, { level: 9 });
const compressedPath = `${networkPath}.gz`;
await writeFile(compressedPath, compressed);

const manifest = {
  schema: 'uniscenarios.sumo-network.v1',
  sourceOpenDrive: basename(input),
  networkFile: basename(compressedPath),
  networkBytes: network.byteLength,
  compressedBytes: compressed.byteLength,
  sha256: createHash('sha256').update(network).digest('hex'),
  sumoLocation: {
    netOffset: attribute(location, 'netOffset') ?? '0,0',
    convBoundary: attribute(location, 'convBoundary') ?? '',
    origBoundary: attribute(location, 'origBoundary') ?? '',
    projParameter: attribute(location, 'projParameter') ?? '',
  },
  // For local OpenDRIVE coordinates SUMO applies netOffset while importing.
  // A map-specific registration process may replace rotation/scale.
  worldFromNetwork: {
    translationX: -(netOffset[0] || 0),
    translationY: -(netOffset[1] || 0),
    rotationDegrees: 0,
    scale: 1,
  },
};
await writeFile(join(output, 'sumo-network-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));

function attribute(source, name) {
  return source.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}
