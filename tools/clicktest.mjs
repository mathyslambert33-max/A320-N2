// Click cockpit controls by id in the free-cursor mode and report hover + C: value change (integration check).
// Usage: node tools/clicktest.mjs "<url>" ID1 ID2 ...   (the control's root object is named after its catalog id)
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const url = process.argv[2].startsWith('http') ? process.argv[2] : `http://127.0.0.1:${process.env.PORT || 5173}${process.argv[2]}`;
const ids = process.argv.slice(3);
const exe = process.env.CHROME_PATH || (process.platform !== 'darwin' && fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');
const browser = await chromium.launch(exe ? { executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(url);
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
for (const id of ids) {
  const pos = await page.evaluate((id) => {
    const app = window.__app;
    let obj = null;
    app.cockpit.traverse((o) => { if (!obj && o.name === id) obj = o; });
    if (!obj) return null;
    const THREE = obj.position.constructor; // Vector3 class
    const v = new THREE();
    obj.getWorldPosition(v);
    v.project(app.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, before: window.__sim.get('C:' + id) };
  }, id);
  if (!pos) { console.log(id, 'not found'); continue; }
  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(300);
  const hover = await page.evaluate(() => window.__app.interaction.hoverInfo()?.id ?? null);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate((id) => window.__sim.get('C:' + id), id);
  console.log(`${id}: hover=${hover} C: ${pos.before} -> ${after}`);
}
console.log(logs.length ? logs.join('\n') : 'no page errors');
await browser.close();
