// Load a page headless and report render cost + console errors (integration check).
// Usage: node tools/probe.mjs ["/index.html" | "/dev.html?..."] [waitMs]
// Prints: draw calls / triangles of one frame (with and without post-processing), meshes, materials, lights,
// textures/geometries in GPU memory, and every console error/warning. SwiftShader FPS is meaningless: only the
// counts are. Uses the same browser selection as tools/shot.mjs.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const [, , target = '/index.html', wait = '4000'] = process.argv;
const url = target.startsWith('http') ? target : `http://127.0.0.1:${process.env.PORT || 5173}${target.startsWith('/') ? '' : '/'}${target}`;
const exe = process.env.CHROME_PATH || (process.platform !== 'darwin' && fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');
const browser = await chromium.launch(exe
  ? { executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] }
  : { channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try { await page.waitForFunction('window.__ready === true', null, { timeout: 240000 }); } catch { logs.push('[probe] window.__ready never became true'); }
const tReady = Date.now() - t0;
await page.waitForTimeout(+wait);
const stats = await page.evaluate(() => {
  const app = window.__app;
  if (!app) return { error: 'no window.__app' };
  const r = app.renderer;
  const count = { meshes: 0, instanced: 0, batched: 0, points: 0, lines: 0, lights: 0, shadowLights: 0, visibleMeshes: 0 };
  const mats = new Set();
  app.scene.traverse((o) => {
    if (o.isInstancedMesh) count.instanced++;
    else if (o.isBatchedMesh) count.batched++;
    else if (o.isMesh) count.meshes++;
    if (o.isPoints) count.points++;
    if (o.isLine) count.lines++;
    if (o.isLight) { count.lights++; if (o.castShadow) count.shadowLights++; }
    if ((o.isMesh || o.isInstancedMesh || o.isBatchedMesh) && o.visible) {
      count.visibleMeshes++;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
    }
  });
  const frame = (post) => {
    const was = app.post.enabled;
    app.post.enabled = post;
    r.info.autoReset = false;
    r.info.reset();
    app.renderOnce();
    const info = { calls: r.info.render.calls, triangles: r.info.render.triangles };
    r.info.autoReset = true;
    app.post.enabled = was;
    return info;
  };
  const noPost = frame(false);
  const withPost = frame(true);
  return {
    ...count, materials: mats.size, noPost, withPost,
    geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length,
    pixelRatio: r.getPixelRatio(), quality: app.quality, modules: Object.keys(app.services),
  };
});
await browser.close();
console.log(JSON.stringify({ url, readyMs: tReady, ...stats }, null, 1));
if (logs.length) console.log(logs.slice(0, 60).join('\n'));
