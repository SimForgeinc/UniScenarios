#!/usr/bin/env node
/**
 * Real-GPU verification for the city renderer.
 *
 * Drives system Chrome (headless SwiftShader lies about performance) against a
 * running `pnpm dev`, screenshots startup / settled / street level, fails on any
 * console error, and runs `window.__bench()`.
 *
 *   node scripts/verify-city-renderer.mjs [--url http://localhost:5199] [--out /tmp/...]
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]?.replace(/^--/, ''), process.argv[i + 1]);
}
const url = args.get('url') ?? 'http://localhost:5199/';
const outDir = args.get('out') ?? '/tmp/uniscenarios-verify';
const settleMs = Number(args.get('settle') ?? 60000);
const benchMs = Number(args.get('bench') ?? 15000);
const minTiles = Number(args.get('min-tiles') ?? 30);
const extraChromeArgs = (args.get('chrome-flags') ?? '')
  .split(',')
  .map((flag) => flag.trim())
  .filter(Boolean);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--window-size=1680,1050',
    ...extraChromeArgs,
  ],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
// A fresh profile otherwise stops at Studio's first-run graphics chooser and
// never mounts the viewer. Match the export harness and select the app's full
// city + vegetation balanced preset before boot.
await context.addInitScript(() => {
  localStorage.setItem('uniscenarios.studio.render-quality.v1', JSON.stringify({ preset: 'balanced' }));
});
const page = await context.newPage();

const consoleErrors = [];
const consoleWarnings = [];
page.on('console', (msg) => {
  const text = `${msg.type()}: ${msg.text()}`;
  if (msg.type() === 'error') consoleErrors.push(text);
  else if (msg.type() === 'warning') consoleWarnings.push(text);
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('requestfailed', (req) => {
  // React StrictMode double-mounts in dev: the first viewer is disposed and its
  // in-flight fetches abort. That is expected, anything else is not.
  const failure = req.failure()?.errorText ?? '';
  if (failure.includes('ERR_ABORTED')) return;
  consoleErrors.push(`requestfailed: ${failure} ${req.url()}`);
});
page.on('response', (res) => {
  if (res.status() >= 400) consoleErrors.push(`http ${res.status()} ${res.url()}`);
});

const shot = async (name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  screenshot -> ${file}`);
  return file;
};

const stats = () => page.evaluate(() => window.__viewer?.getStats() ?? null);

console.log(`> opening ${url}`);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__viewer), null, { timeout: 30000 });
const gl = await page.evaluate(() => {
  const canvas = window.__viewer.renderer.domElement;
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!context) return null;
  const debug = context.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: debug ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL) : context.getParameter(context.VENDOR),
    renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
    version: context.getParameter(context.VERSION),
  };
});
console.log(`> WebGL ${JSON.stringify(gl)}`);

// 1. Startup: the coarse city must be on screen quickly.
const startupBegin = Date.now();
await page.waitForFunction(
  (minimum) => (window.__viewer?.getStats().residentTiles ?? 0) >= minimum,
  minTiles,
  { timeout: 60000 },
);
const startupMs = Date.now() - startupBegin;
console.log(`> coarse city resident after ${startupMs} ms`);
await page.waitForTimeout(500);
await shot('01-startup');
const startupStats = await stats();

// 2. Settle: let the SSE selector pull in the near LODs.
console.log('> settling…');
await page
  .waitForFunction(
    () => {
      const s = window.__viewer?.getStats();
      return s ? s.loading === 0 && s.queued === 0 && s.uploading === 0 : false;
    },
    null,
    { timeout: settleMs },
  )
  .catch(() => console.log('  (still streaming at settle timeout)'));
await page.waitForTimeout(1500);
await shot('02-settled');
const settledStats = await stats();

// 3. Street level.
console.log('> street level');
const street = await page.evaluate(() => {
  const viewer = window.__viewer;
  const Vec = viewer.camera.position.constructor;
  const lane = [...window.__editor.laneIndex.all].sort((a, b) => b.length - a.length)[0];
  const pose = window.__editor.laneIndex.poseAt(lane, lane.length / 2, 0);
  const spot = { x: pose.x, z: pose.z, lane: lane.rsl };
  const y = viewer.sampleGroundHeight(spot.x, spot.z);
  const base = (y ?? 8) + 1.8;
  viewer.controls.setView(
    new Vec(spot.x - 55, base, spot.z + 30),
    new Vec(spot.x + 90, base + 4, spot.z - 45),
  );
  return { groundY: y, lane: spot.lane };
});
console.log(`  sampleGroundHeight -> ${JSON.stringify(street)}`);
// Let the near LOD0/LOD1 tiles land before judging the street-level frame.
await page
  .waitForFunction(
    () => {
      const s = window.__viewer?.getStats();
      return s ? s.loading === 0 && s.uploading === 0 : false;
    },
    null,
    { timeout: 40000 },
  )
  .catch(() => console.log('  (still streaming at street timeout)'));
await page.waitForTimeout(2500);
await shot('03-street');
const streetStats = await stats();

// 4. Interaction: layer toggles, orbit drag, fly-mode WASD.
console.log('> interaction');
const interaction = { layers: {}, orbit: null, fly: null };
for (const layer of ['vegetation', 'city']) {
  const before = await page.evaluate(() => window.__viewer.getStats().drawCalls);
  await page.evaluate((name) => {
    window.__viewer[`${name}Group`].visible = false;
  }, layer);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__viewer.getStats().drawCalls);
  interaction.layers[layer] = { before, after, dropped: before - after };
  await page.evaluate((name) => {
    window.__viewer[`${name}Group`].visible = true;
  }, layer);
  await page.waitForTimeout(300);
}
const poseOf = () => page.evaluate(() => window.__viewer.camera.position.toArray());
const orbitBefore = await poseOf();
await page.mouse.move(800, 500);
await page.mouse.down();
await page.mouse.move(1000, 560, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
interaction.orbit = { before: orbitBefore, after: await poseOf() };

await page.evaluate(() => window.__viewer.setCameraMode('fly'));
const flyBefore = await poseOf();
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
await page.keyboard.up('KeyW');
await page.waitForTimeout(200);
interaction.fly = { before: flyBefore, after: await poseOf() };
await page.evaluate(() => window.__viewer.setCameraMode('orbit'));
const moved = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
console.log(`  layer toggles: ${JSON.stringify(interaction.layers)}`);
console.log(`  orbit drag moved camera ${moved(interaction.orbit.before, interaction.orbit.after).toFixed(1)} m`);
console.log(`  fly W moved camera ${moved(interaction.fly.before, interaction.fly.after).toFixed(1)} m`);
await shot('05-interaction');

// 5. Benchmark.
console.log('> benchmark');
const bench = await page.evaluate((ms) => window.__bench(ms), benchMs);
await shot('04-post-bench');
const finalStats = await stats();

const report = {
  url,
  chromeArgs: extraChromeArgs,
  minTiles,
  gl,
  startupMs,
  startupStats,
  settledStats,
  streetStats,
  interaction,
  finalStats,
  bench,
  consoleErrors,
  consoleWarnings: consoleWarnings.slice(0, 20),
};
await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

console.log('\n--- bench ---');
console.log(JSON.stringify(bench, null, 2));
console.log('--- stats (settled) ---');
console.log(JSON.stringify(settledStats, null, 2));
console.log('--- stats (street) ---');
console.log(JSON.stringify(streetStats, null, 2));
console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const err of consoleErrors.slice(0, 20)) console.log(`  ${err}`);
console.log(`console warnings: ${consoleWarnings.length}`);
for (const warn of consoleWarnings.slice(0, 5)) console.log(`  ${warn}`);

await context.close();
await browser.close();
process.exit(consoleErrors.length === 0 ? 0 : 1);
