/**
 * Interior flight-deck lighting driven by sys-misc (docs/vars/sys-misc.md):
 *  - S:INTLT_DOME (0 / 0.35 DIM / 1 BRT)     → two dome lights in the ceiling linings beside the aft overhead (area lights)
 *  - S:INTLT_FLOOD_MAIN (0..1)               → main-panel flood strip under the glareshield lip (area light)
 *  - S:INTLT_FLOOD_PED (0..1)                → pedestal flood light under the aft overhead (spot)
 *  - S:INTLT_CONSOLE_CAPT/FO (0 / 0.4 / 1)   → console & floor lights under the side-window sills (spots)
 *  - S:INTLT_READING_CAPT/FO (0..1)          → reading lights in the ceiling above each pilot (spots)
 * Warm-white colours, no shadow casters. Cost control: the 8 lights are only in the scene graph (visible) while at
 * least one interior light is on, so the daytime / cold-and-dark shaders carry no interior lights at all; the
 * "lights on" shader variants are pre-compiled once at start so switching the first light on does not stall.
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { App } from '../../app';
import { geo } from '../kit';
import { planAt, Y_WALL_TOP, DEG } from './geom';
import { ceilMap } from './structure';
import { MergeBag } from './surf';
import { shellMats } from './mats';

interface Channel {
  v: string;
  lights: Array<{ l: THREE.Light; max: number }>;
  lens: THREE.MeshStandardMaterial;
  lensMax: number;
  last: number;
}

export interface LightParts {
  root: THREE.Group;
  update(): void;
}

/** Point + basis on the right ceiling lining at station z, fraction w (0 wall top → 1 overhead edge). */
function ceilingFrame(z: number, w: number): { p: THREE.Vector3; du: THREE.Vector3; dw: THREE.Vector3; n: THREE.Vector3 } {
  const u = z - planAt(Y_WALL_TOP).zt;
  const p = ceilMap(u, w, new THREE.Vector3());
  const du = ceilMap(u + 0.01, w, new THREE.Vector3()).sub(p).normalize();
  const dw = ceilMap(u, w + 0.01, new THREE.Vector3()).sub(p).normalize();
  const n = new THREE.Vector3().crossVectors(du, dw).normalize(); // into the cockpit
  return { p, du, dw, n };
}

const mirror = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);

export function buildLights(app: App): LightParts {
  RectAreaLightUniformsLib.init();
  const M = shellMats();
  const K = app.kit.mats;
  const root = new THREE.Group();
  root.name = 'shell:lights';
  const fixtures = new MergeBag();
  const channels: Channel[] = [];
  const lensMat = (name: string) => { const m = M.lampLens.clone(); m.name = name; return m; };
  const WARM = new THREE.Color(1.0, 0.86, 0.68);
  const DOME = new THREE.Color(1.0, 0.93, 0.82);

  // ---- dome lights (ceiling linings beside the aft overhead console)
  {
    const lens = lensMat('lens:dome');
    const ch: Channel = { v: 'S:INTLT_DOME', lights: [], lens, lensMax: 2.5, last: -1 };
    const f = ceilingFrame(0.36, 0.72);
    for (const s of [1, -1]) {
      const p = s > 0 ? f.p : mirror(f.p);
      const n = s > 0 ? f.n : mirror(f.n);
      const du = s > 0 ? f.du : mirror(f.du);
      const dw = s > 0 ? f.dw : mirror(f.dw);
      const basis = new THREE.Matrix4().makeBasis(du, dw, n).setPosition(p);
      fixtures.add(geo.roundedBox(0.3, 0.12, 0.012, 0.01), K.bezel, basis);
      fixtures.add(geo.roundedBox(0.27, 0.09, 0.014, 0.008), lens, basis.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.001)));
      const L = new THREE.RectAreaLight(DOME, 0, 0.27, 0.09);
      L.position.copy(p).addScaledVector(n, 0.012);
      L.lookAt(p.clone().addScaledVector(n, 1));
      root.add(L);
      ch.lights.push({ l: L, max: 28 });
    }
    channels.push(ch);
  }

  // ---- main-panel flood strip under the glareshield lip
  {
    const lens = lensMat('lens:flood_main');
    const ch: Channel = { v: 'S:INTLT_FLOOD_MAIN', lights: [], lens, lensMax: 2.0, last: -1 };
    const p = new THREE.Vector3(0, 1.064, -0.729);
    fixtures.at(geo.box(1.6, 0.006, 0.016), K.bezel, p.x, p.y + 0.004, p.z);
    fixtures.at(geo.box(1.56, 0.003, 0.009), lens, p.x, p.y + 0.0005, p.z);
    const L = new THREE.RectAreaLight(WARM, 0, 1.56, 0.012);
    L.position.copy(p);
    L.lookAt(new THREE.Vector3(0, 0.74, -0.62));
    root.add(L);
    ch.lights.push({ l: L, max: 60 });
    channels.push(ch);
  }

  // ---- pedestal flood light under the aft overhead
  {
    const lens = lensMat('lens:flood_ped');
    const ch: Channel = { v: 'S:INTLT_FLOOD_PED', lights: [], lens, lensMax: 2.5, last: -1 };
    const p = new THREE.Vector3(0, 2.045, 0.5);
    fixtures.at(geo.cylZ(0.03, 0.034, 0.03, 24), K.bezel, p.x, p.y + 0.012, p.z, Math.PI / 2 + 0.5, 0, 0);
    fixtures.at(geo.cylZ(0.024, 0.024, 0.004, 24), lens, p.x, p.y - 0.004, p.z - 0.004, Math.PI / 2 + 0.5, 0, 0);
    const L = new THREE.SpotLight(WARM, 0, 3.0, 36 * DEG, 0.7, 2);
    L.position.copy(p);
    L.target.position.set(0, 0.58, -0.08);
    root.add(L, L.target);
    ch.lights.push({ l: L, max: 9 });
    channels.push(ch);
  }

  // ---- reading lights (ceiling above each pilot, aimed at the lap / sidestick area)
  for (const side of ['CAPT', 'FO'] as const) {
    const s = side === 'CAPT' ? -1 : 1;
    const lens = lensMat(`lens:reading_${side}`);
    const ch: Channel = { v: `S:INTLT_READING_${side}`, lights: [], lens, lensMax: 3, last: -1 };
    const f = ceilingFrame(0.02, 0.42);
    const p = s > 0 ? f.p : mirror(f.p);
    const n = s > 0 ? f.n : mirror(f.n);
    const target = new THREE.Vector3(s * 0.6, 0.66, -0.3);
    const dir = target.clone().sub(p).normalize();
    const basis = new THREE.Matrix4().lookAt(new THREE.Vector3(), n.clone().negate(), new THREE.Vector3(0, 0, 1)).setPosition(p);
    fixtures.add(geo.cylZ(0.034, 0.038, 0.008, 28), K.bezel, basis);
    const eye = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), new THREE.Vector3(0, 1, 0)).setPosition(p.clone().addScaledVector(n, 0.012));
    fixtures.add(new THREE.SphereGeometry(0.022, 20, 12), K.knobGrey, eye);
    fixtures.add(geo.cylZ(0.013, 0.013, 0.022, 20), lens, eye);
    // individual air outlet (gasper) next to the reading light
    const g2 = ceilingFrame(-0.12, 0.44);
    const gp = s > 0 ? g2.p : mirror(g2.p), gn = s > 0 ? g2.n : mirror(g2.n);
    const gm = new THREE.Matrix4().lookAt(new THREE.Vector3(), gn.clone().negate(), new THREE.Vector3(0, 0, 1)).setPosition(gp);
    fixtures.add(geo.cylZ(0.03, 0.033, 0.007, 28), K.bezel, gm);
    fixtures.add(new THREE.SphereGeometry(0.02, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), K.knobGrey, gm);
    fixtures.add(geo.cylZ(0.007, 0.007, 0.022, 12), K.black, gm);
    const L = new THREE.SpotLight(WARM, 0, 2.2, 20 * DEG, 0.55, 2);
    L.position.copy(p).addScaledVector(n, 0.02);
    L.target.position.copy(target);
    root.add(L, L.target);
    ch.lights.push({ l: L, max: 5 });
    channels.push(ch);
  }

  // ---- console / floor lights (under the side-window sills, lighting the console tops and the floor)
  for (const side of ['CAPT', 'FO'] as const) {
    const s = side === 'CAPT' ? -1 : 1;
    const lens = lensMat(`lens:console_${side}`);
    const ch: Channel = { v: `S:INTLT_CONSOLE_${side}`, lights: [], lens, lensMax: 2, last: -1 };
    const p = new THREE.Vector3(s * 1.045, 0.995, -0.28);
    fixtures.at(geo.roundedBox(0.03, 0.02, 0.16, 0.006), K.bezel, p.x, p.y, p.z);
    fixtures.at(geo.box(0.004, 0.008, 0.13), lens, p.x - s * 0.016, p.y - 0.004, p.z);
    const L = new THREE.SpotLight(WARM, 0, 2.0, 58 * DEG, 0.85, 2);
    L.position.set(p.x - s * 0.03, p.y - 0.02, p.z);
    L.target.position.set(s * 0.8, 0.1, -0.05);
    root.add(L, L.target);
    ch.lights.push({ l: L, max: 3.5 });
    channels.push(ch);
  }

  const fx = fixtures.build('shell:light_fixtures', { castShadow: false });
  root.add(fx);
  const all = channels.flatMap((c) => c.lights.map((x) => x.l));
  for (const l of all) { l.castShadow = false; l.visible = false; }

  // pre-compile the "interior lights on" shader variants once everything is loaded (a few frames in)
  let frames = 0, warmed = false, anyOn = false;
  const sim = app.sim;
  return {
    root,
    update() {
      if (!warmed && ++frames === 30) {
        warmed = true;
        if (!anyOn && !app.isHarness) {
          try {
            for (const l of all) l.visible = true;
            app.renderer.compile(app.scene, app.camera);
          } catch (e) { console.warn('[shell] light pre-compile failed', e); }
          for (const l of all) l.visible = false;
        }
      }
      let on = false;
      for (const c of channels) {
        const v = Math.max(0, Math.min(1, sim.get(c.v)));
        if (v > 0) on = true;
        if (v === c.last) continue;
        c.last = v;
        for (const { l, max } of c.lights) l.intensity = v * max;
        c.lens.emissiveIntensity = v * c.lensMax;
      }
      if (on !== anyOn) {
        anyOn = on;
        for (const l of all) l.visible = on;
      }
    },
  };
}
