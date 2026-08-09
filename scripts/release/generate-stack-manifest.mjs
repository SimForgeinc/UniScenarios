import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStackManifest, serializeStackManifest } from './stack-manifest-lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const outputArg = option('--out');
if (!outputArg) throw new Error('Usage: generate-stack-manifest.mjs --out <file> [--source-revision <sha>]');

const output = path.resolve(repoRoot, outputArg);
const manifest = await buildStackManifest({
  repoRoot,
  sourceRevision: option('--source-revision'),
});

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, serializeStackManifest(manifest), 'utf8');
process.stdout.write(`${path.relative(repoRoot, output)}\n`);
