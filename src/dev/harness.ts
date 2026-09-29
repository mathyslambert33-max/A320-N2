/**
 * Dev harness — load only some modules and look at them in isolation (see docs/ARCHITECTURE.md).
 *
 *   /dev.html?module=overhead[&mods=a,b][&cam=px,py,pz,tx,ty,tz][&orbit=1][&power=1][&night=1][&test=1]
 *            [&set=C:X=1,S:Y=2][&scenario=<module>.<name>][&post=0][&wait=frames]
 *   /dev.html?display=PFD1&mods=pfdnd[&scenario=pfdnd.aligned][&power=1][&scale=1]
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createApp } from '../app';
import { MODULES } from '../modules';
import { applyColdAndDark } from '../core/catalog';
import { applyScenario } from '../core/scenario';
import { getDisplayCanvas } from '../displays/framework';
import { FAKE_POWER_VARS } from './fakePower';

const q = new URLSearchParams(location.search);
const display = q.get('display');
const mods = [...(q.get('module') ? [q.get('module')!] : []), ...(q.get('mods')?.split(',').filter(Boolean) ?? [])];
const night = q.get('night') === '1';
const power = q.get('power') === '1';

const scenarioFiles = import.meta.glob('./scenarios/*.ts') as Record<string, () => Promise<{ scenarios: Record<string, (sim: any) => void> }>>;

async function main() {
  const root = document.getElementById('app')!;
  const app = await createApp(root, { harness: true });
  const { sim, scene, camera, renderer } = app;
  applyColdAndDark(sim);
  applyScenario(sim, night ? 'night' : 'day');

  // Neutral studio lighting so panels can be judged (the world module brings the real sky/sun).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = night ? 0.03 : 0.55;
  scene.background = new THREE.Color(night ? 0x05070a : 0x3a4048);
  const sun = new THREE.DirectionalLight(0xfff4e0, night ? 0 : 2.2);
  sun.position.set(-2, 5, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -2; sun.shadow.camera.right = 2; sun.shadow.camera.top = 2; sun.shadow.camera.bottom = -2;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x30302a, night ? 0.02 : 0.6));
  if (q.get('post') === '0') app.post.enabled = false;

  for (const m of mods) {
    const load = MODULES[m] ?? (m === 'kitdemo' ? () => import('./kitdemo') : undefined);
    if (!load) { console.error(`[harness] unknown module ${m}`); continue; }
    try { await (await load()).default(app); } catch (e) { console.error(`[harness] module ${m} failed`, e); }
  }

  const scen = q.get('scenario');
  if (scen) {
    const [file, name] = scen.split('.');
    const loader = scenarioFiles[`./scenarios/${file}.ts`];
    if (!loader) console.error(`[harness] no scenario file ${file}`);
    else {
      const s = (await loader()).scenarios[name];
      if (!s) console.error(`[harness] no scenario ${name} in ${file}`);
      else s(sim);
    }
  }
  const applySet = () => {
    for (const kv of (q.get('set') ?? '').split(',').filter(Boolean)) {
      const [k, v] = kv.split('=');
      sim.set(k, Number(v));
    }
    if (power) for (const [k, v] of Object.entries(FAKE_POWER_VARS)) if (!sim.has(k) || k.startsWith('S:INTLT') || k.startsWith('S:ANN') || !sim.getB(k)) sim.set(k, v);
    if (q.get('test') === '1') sim.set('S:INTLT_ANN_TEST', 1);
    if (night && power) {
      sim.set('S:INTLT_INTEG_OVHD', 0.8); sim.set('S:INTLT_INTEG_MAIN', 0.8); sim.set('S:INTLT_INTEG_GLARE', 0.8);
      sim.set('S:INTLT_FLOOD_MAIN', 0.3); sim.set('S:INTLT_FLOOD_PED', 0.3);
    }
  };
  applySet();
  app.onFrame(applySet, -1000);

  if (display) {
    renderer.domElement.style.display = 'none';
    const c = getDisplayCanvas(display);
    const scale = Number(q.get('scale') ?? 0) || Math.min((innerWidth - 20) / c.width, (innerHeight - 20) / c.height);
    c.style.cssText = `width:${c.width * scale}px;height:${c.height * scale}px;margin:10px;image-rendering:auto;border:1px solid #333`;
    document.body.style.background = '#111';
    document.body.appendChild(c);
  } else {
    // Frame the module's objects from the captain's eye (or the given camera).
    const cam = q.get('cam')?.split(',').map(Number);
    const eye = new THREE.Vector3(-0.53, 1.28, 0);
    let target = new THREE.Vector3(0, 1, -0.8);
    const box = new THREE.Box3().setFromObject(app.cockpit);
    if (!box.isEmpty()) target = box.getCenter(new THREE.Vector3());
    if (cam && cam.length === 6) { eye.set(cam[0], cam[1], cam[2]); target.set(cam[3], cam[4], cam[5]); }
    camera.position.copy(eye);
    camera.lookAt(app.aircraft.localToWorld(target.clone()));
    if (q.get('orbit') === '1') {
      const oc = new OrbitControls(camera, renderer.domElement);
      oc.target.copy(target);
      oc.update();
      app.onFrame(() => oc.update());
    }
  }

  app.start();
  const waitFrames = Number(q.get('wait') ?? 20);
  let n = 0;
  app.onFrame(() => { if (++n === waitFrames) (window as any).__ready = true; }, 1000);
}

main().catch((e) => { console.error(e); (window as any).__ready = true; });
