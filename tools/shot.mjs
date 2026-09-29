// Headless screenshot helper (uses the system Google Chrome through playwright-core).
// Usage: node tools/shot.mjs "<url path or full url>" out.png [width] [height] [waitMs]
// Example: node tools/shot.mjs "/dev.html?module=overhead" shots/overhead.png 1600 1000 4000
import { chromium } from 'playwright-core';

const [, , target = '/', out = 'shot.png', w = '1600', h = '1000', wait = '3000'] = process.argv;
const url = target.startsWith('http') ? target : `http://127.0.0.1:${process.env.PORT || 5173}${target.startsWith('/') ? '' : '/'}${target}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
try { await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }); } catch { logs.push('[shot] window.__ready never became true'); }
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
console.log(`saved ${out}`);
