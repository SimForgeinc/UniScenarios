import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Defect TG-B0: the built CLI cannot run `batch` or `catalog batch`.
 *
 * `packages/cli/bin/uniscenarios.js` imports `../dist/main.js`. `commands/batch.ts` spawns its
 * worker with `new URL('../batch-worker.mjs', import.meta.url)`. That specifier is correct for the
 * SOURCE layout (`src/commands/` -> `src/batch-worker.mjs`) but wrong for the BUNDLED layout, where
 * tsup collapses every module into `dist/main.js`, so `../batch-worker.mjs` resolves to
 * `packages/cli/batch-worker.mjs` -- a path that does not exist. Result:
 *
 *   {"code":"internal_error","reason":"Error: Cannot find module '.../packages/cli/batch-worker.mjs'"}
 *
 * and every `uniscenarios batch` run dies before a single cell is simulated.
 *
 * This is the same class as defect F4 in ALGORITHM.md: a stale/misresolved copy means the built
 * pipeline does not do what a manual source run does.
 *
 * The test asserts the invariant that actually matters and is layout-independent: for each worker
 * shim, SOME resolvable file exists next to the module that will spawn it, in whichever layout the
 * CLI is executing from.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(HERE, '..', '..');

const WORKERS = ['batch-worker.mjs', 'catalog-batch-worker.mjs'] as const;

describe('worker shims resolve in the built layout', () => {
  it('ships a worker shim next to the bundled entry point', () => {
    const dist = path.join(CLI_ROOT, 'dist');
    if (!existsSync(path.join(dist, 'main.js'))) {
      // Source-only checkout: nothing to assert about the bundle.
      return;
    }
    for (const worker of WORKERS) {
      // dist/main.js does `new URL('../<worker>', import.meta.url)` -> packages/cli/<worker>,
      // and a copy in dist/ covers a future './<worker>' specifier. One of them must exist.
      const beside = path.join(CLI_ROOT, worker);
      const inside = path.join(dist, worker);
      expect(
        existsSync(beside) || existsSync(inside),
        `neither ${beside} nor ${inside} exists; built CLI cannot spawn ${worker}`,
      ).toBe(true);
    }
  });

  it('keeps the source-layout shims in place', () => {
    for (const worker of WORKERS) {
      expect(existsSync(path.join(CLI_ROOT, 'src', worker))).toBe(true);
    }
  });
});
