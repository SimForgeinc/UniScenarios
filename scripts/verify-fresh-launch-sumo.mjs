#!/usr/bin/env node
import { chromium } from 'playwright-core';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index]?.replace(/^--/, ''), process.argv[index + 1]);
}
const baseUrl = args.get('url') ?? 'http://127.0.0.1:5199/';
const preset = args.get('preset') ?? 'minimal';
const map = args.get('map') ?? 'yale-street';
const headless = args.get('headless') !== 'false';

const browser = await chromium.launch({
  channel: 'chrome',
  headless,
  args: ['--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1360, height: 850 } });
const page = await context.newPage();
const failures = [];
const sumoRequests = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('request', (request) => {
  if (request.url().includes('/dev-assets/sumo-runtime/')) sumoRequests.push(request.url());
});
page.on('requestfailed', (request) => {
  const reason = request.failure()?.errorText ?? '';
  if (!reason.includes('ERR_ABORTED')) failures.push(`${reason}: ${request.url()}`);
});
page.on('response', (response) => {
  if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
});

try {
  const target = new URL(baseUrl);
  target.searchParams.set('map', map);
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId(`graphics-choice-${preset}`).click();
  await page.getByTestId('tool-ambient').waitFor({ timeout: 90_000 });
  await page.getByTestId('tool-ambient').click();
  await page.getByText('SUMO ready').waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => {
    let actors = 0;
    window.__viewer?.scene.traverse((object) => {
      if (object.name === 'actor-batch.catalog:vehicle.sedan#0') actors = object.count ?? 0;
    });
    return actors > 0;
  }, null, { timeout: 30_000 });
  const result = await page.evaluate(() => {
    let actorCount = 0;
    window.__viewer?.scene.traverse((object) => {
      if (object.name === 'actor-batch.catalog:vehicle.sedan#0') actorCount = object.count ?? 0;
    });
    const status = document.querySelector('[data-testid="sumo-traffic-status"]')?.textContent?.trim() ?? '';
    const accelerated = document.querySelector('[data-testid="ambient-traffic-accelerated-signal-cycles"]');
    return { actorCount, status, acceleratedSignalCycles: accelerated instanceof HTMLInputElement && accelerated.checked };
  });
  if (result.acceleratedSignalCycles) failures.push('accelerated signal cycles unexpectedly enabled on a fresh launch');
  if (result.actorCount <= 0) failures.push('SUMO reported ready without rendering initial actors');
  if (!result.status.startsWith('SUMO ready')) failures.push(`unexpected status: ${result.status}`);
  const wasmRequests = sumoRequests.filter((url) => url.endsWith('/sumo.wasm')).length;
  if (wasmRequests !== 1) failures.push(`expected one SUMO runtime initialization, saw ${wasmRequests}`);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log(JSON.stringify({ map, preset, ...result, wasmRequests }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
