#!/usr/bin/env node
/**
 * `scen` — the agent CLI entry point.
 *
 * The monorepo consumes TypeScript sources directly (every package's `main`
 * points at `src/index.ts`), so the bin registers the `tsx` ESM loader and then
 * imports the real entry. There is no build step to forget and no `dist/` that
 * can go stale relative to the packages this thing integrates.
 */
import { register } from 'tsx/esm/api';

register();
await import('../src/main.ts');
