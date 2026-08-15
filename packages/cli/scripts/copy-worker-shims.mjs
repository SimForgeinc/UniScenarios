#!/usr/bin/env node
/**
 * Ship the worker-thread shims next to the bundle.
 *
 * tsup bundles TypeScript entry points; it does not carry plain `.mjs` files across, and `--clean`
 * wipes `dist/` on every build. Without this step the built CLI resolves its worker shim to a path
 * that does not exist and `uniscenarios batch` dies before simulating a cell (defect TG-B0).
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const shims = ['batch-worker.mjs', 'catalog-batch-worker.mjs'];

await mkdir(dist, { recursive: true });
for (const shim of shims) {
  await copyFile(path.join(root, 'src', shim), path.join(dist, shim));
  process.stdout.write(`copied ${shim} -> dist/\n`);
}
