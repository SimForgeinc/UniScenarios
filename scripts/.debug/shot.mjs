import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = process.argv[3] ?? '/tmp/scenario-studio-verify/debug.png';
const wait = Number(process.argv[4] ?? 12000);
const evalStr = process.argv[5] ?? '';

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForFunction(() => Boolean(window.__viewer), null, { timeout: 30000 });
if (evalStr) {
  await page.waitForTimeout(4000);
  console.log('eval ->', JSON.stringify(await page.evaluate(evalStr)));
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
console.log('stats', JSON.stringify(await page.evaluate(() => window.__viewer.getStats())));
console.log('errors', errors.length, errors.slice(0, 10));
await browser.close();
