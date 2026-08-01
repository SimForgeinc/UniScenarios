#!/usr/bin/env node
/**
 * Park the viewer at an exact pose in real Chrome and screenshot it.
 *
 * Used for look/QA passes that need a repeatable camera — e.g. comparing the
 * lit render against `?debugShadow=1` (which renders the baked shadow term
 * instead of shading) to confirm the lightmap projection lands on the geometry:
 *
 *   node scripts/inspect-city-view.mjs 'http://localhost:5199/?debugShadow=1' \
 *     /tmp/shadow.png 14000  410 250 -1859.9  410 10 -1860
 *
 * args: url out waitMs eyeX eyeY eyeZ tgtX tgtY tgtZ
 */
import { chromium } from 'playwright-core';
const [, , url, out, waitMs, ex, ey, ez, tx, ty, tz] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(url ?? 'http://localhost:5199/');
await page.waitForFunction(() => Boolean(window.__viewer), null, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.evaluate((v) => {
  const viewer = window.__viewer;
  const V = viewer.camera.position.constructor;
  viewer.controls.setView(new V(v[0], v[1], v[2]), new V(v[3], v[4], v[5]));
}, [ex, ey, ez, tx, ty, tz].map(Number));
await page.waitForTimeout(Number(waitMs ?? 12000));
await page.screenshot({ path: out });
console.log('stats', JSON.stringify(await page.evaluate(() => window.__viewer.getStats())));
console.log('errors', errors.length, errors.slice(0, 8));
await browser.close();
