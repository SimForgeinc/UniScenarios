#!/usr/bin/env node
/**
 * `scen` — the agent CLI entry point.
 *
 * Published packages execute the same compiled entry point consumers import.
 */
await import('../dist/main.js');
