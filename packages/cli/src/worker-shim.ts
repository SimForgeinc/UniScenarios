/**
 * Locate a worker-thread shim, whichever layout the CLI is running from.
 *
 * The CLI executes from two different module layouts and the shim sits in a different place in
 * each:
 *
 *   source  `tsx src/main.ts`      -> caller is `src/commands/*.ts`, shim is `src/<name>`   (`../`)
 *   bundled `node dist/main.js`    -> caller is `dist/main.js`,      shim is `dist/<name>`  (`./`)
 *
 * Hard-coding `../<name>` was correct only for the source layout; under the bundle it resolved to
 * `packages/cli/<name>`, which does not exist, and every `batch` run died with
 * `Cannot find module .../packages/cli/batch-worker.mjs` before simulating a single cell
 * (defect TG-B0, `src/__tests__/batch-worker-resolution.test.ts`).
 *
 * Probing for the file rather than branching on a build flag keeps this correct for any future
 * layout, and fails loudly with both candidates named instead of a bare module-not-found.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CliError } from './errors.js';

export function workerShimUrl(name: string, from: string): URL {
  const candidates = [new URL(`../${name}`, from), new URL(`./${name}`, from)];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  throw new CliError('internal_error', `worker shim ${name} is missing from this build`, {
    detail: { searched: candidates.map((c) => fileURLToPath(c)) },
  });
}
