import { chromium } from 'playwright-core';

// args: url out waitMs eyeX eyeY eyeZ tgtX tgtY tgtZ
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
