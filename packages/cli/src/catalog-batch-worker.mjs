/**
 * One isolated catalog attempt, valid in BOTH module layouts. The parent owns scheduling.
 *
 * A plain `.mjs` shim rather than the TypeScript module itself: a worker thread gets its own module
 * registry, so under `tsx` it needs its own registration before it can resolve `./batch-cell.js`
 * onto `batch-cell.ts`.
 *
 * When a built `catalog-batch-worker-impl.js` sits beside this file (the bundled `dist/` layout) it is
 * imported directly -- registering `tsx` there would be wrong, because the `.ts` sources are not
 * shipped. Otherwise we are running from `src/` and register `tsx` exactly as before.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const built = new URL('./catalog-batch-worker-impl.js', import.meta.url);

if (existsSync(fileURLToPath(built))) {
  await import(built.href);
} else {
  const { register } = await import('tsx/esm/api');
  register();
  await import('./catalog-batch-worker-impl.ts');
}
