/**
 * Landing gear lever (pull out of the detent, then move), LDG GEAR indicator (UNLK / green down-lock
 * triangles), AUTO/BRK panel (LO / MED / MAX with DECEL + ON legends, BRK FAN).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo, type Handle } from '../kit';
import { atlas, cellPlane } from '../kit/atlas';
import { knurlNormalMap } from '../kit/materials';
import { DEG } from './common';

/** LDG GEAR indicator panel (3 × UNLK over ▼). */
export function buildGearIndicator(app: App): THREE.Group {
  const p = app.kit.panel({ name: 'MAIN_GEAR_IND', width: 0.1, height: 0.056, zone: 'main', pxPerM: 7000 });
  p.label('LDG GEAR', 0, 0.0195, { size: 0.0026 });
  const cols: Array<[string, number]> = [['L', -0.028], ['NOSE', 0], ['R', 0.028]];
  for (const [c, x] of cols) {
    p.ann(`GEAR_${c}_UNLK`, x, 0.0035, 0.021, 0.0105);
    p.ann(`GEAR_${c}_DOWN`, x, -0.0135, 0.021, 0.0135);
  }
  return p.finish();
}

/** AUTO/BRK panel with BRK FAN. */
export function buildAutobrake(app: App): THREE.Group {
  const p = app.kit.panel({ name: 'MAIN_AUTOBRK', width: 0.16, height: 0.056, zone: 'main', pxPerM: 7000 });
  p.pb('BRK_FAN', -0.055, -0.007, { label: 'BRK FAN' });
  p.line([[-0.036, 0.022], [-0.036, -0.022]], 0.0004, 0.5);
  const xs: Array<[string, number]> = [['LO', -0.013], ['MED', 0.017], ['MAX', 0.047]];
  for (const [n, x] of xs) p.pb(`AUTOBRK_${n}`, x, -0.007, { label: n });
  p.bracket('AUTO/BRK', -0.024, 0.058, 0.0205, { size: 0.0024 });
  return p.finish();
}

/**
 * Landing gear lever panel. The lever must be pulled out of its detent before it can travel
 * (visual pull → move → push-in sequence); drag up/down, wheel, or click to operate.
 */
export function buildGearLever(app: App): THREE.Group {
  const kit = app.kit;
  const M = kit.mats;
  const p = kit.panel({ name: 'MAIN_GEAR', width: 0.08, height: 0.18, zone: 'main', pxPerM: 7000 });
  p.label('LDG GEAR', 0, 0.079, { size: 0.003 });
  p.label('UP', -0.0305, 0.046, { size: 0.0028 });
  p.label('DOWN', -0.0305, -0.046, { size: 0.0026 });
  p.line([[-0.03, 0.039], [-0.03, 0.028]], 0.0005);
  p.line([[-0.03, -0.039], [-0.03, -0.028]], 0.0005);
  // slot with brush seal
  p.addStatic(geo.roundedBox(0.016, 0.075, 0.002, 0.0015), M.black, 0, 0, -0.0005);
  p.addStatic(geo.box(0.0055, 0.072, 0.0008), M.rubber, -0.0037, 0, 0.0002);
  p.addStatic(geo.box(0.0055, 0.072, 0.0008), M.rubber, 0.0037, 0, 0.0002);
  // guide plates at both detents
  p.addStatic(geo.roundedBox(0.03, 0.006, 0.002, 0.001), M.darkMetal, 0, 0.041, 0.001);
  p.addStatic(geo.roundedBox(0.03, 0.006, 0.002, 0.001), M.darkMetal, 0, -0.041, 0.001);

  // --- mechanism
  const PIVOT_Z = -0.055, ARM = 0.108, SWING = 24;
  const pivot = new THREE.Group();
  p.add(pivot, 0, 0, PIVOT_Z);
  const slider = new THREE.Group(); // translates along the arm when pulled out of the detent
  pivot.add(slider);
  const arm = new THREE.Mesh(geo.cylZ(0.0042, 0.005, ARM - 0.008, 20), M.alu);
  slider.add(arm);
  // handle: "wheel" with tread, light-grey hub face and the red down-arrow lens
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2b2d2f, roughness: 0.55, metalness: 0.05, normalMap: knurlNormalMap(), normalScale: new THREE.Vector2(1.4, 1.4) });
  const handle = new THREE.Group();
  handle.position.z = ARM - 0.012;
  slider.add(handle);
  const tread = new THREE.Mesh(geo.cylZ(0.0245, 0.0245, 0.019, 48), wheelMat);
  const face = new THREE.Mesh(geo.latheZ('mpGearFace', [[0, 0.019], [0.0232, 0.019], [0.0215, 0.0205], [0.013, 0.0212], [0, 0.0212]], 48), M.knobGrey);
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x3a0505, roughness: 0.2, clearcoat: 0.6, transparent: true, opacity: 0.85 });
  const lens = new THREE.Mesh(geo.cylZ(0.0115, 0.0118, 0.0006, 32), lensMat);
  lens.position.z = 0.0212;
  const legMat = kit.legendMaterial('R');
  legMat.transparent = true;
  legMat.blending = THREE.AdditiveBlending;
  legMat.depthWrite = false;
  const arrow = new THREE.Mesh(cellPlane(0.018, 0.018, atlas().cell(['▼'], 1, 'legend')), legMat);
  arrow.position.z = 0.0219;
  kit.addLegend('GEAR_LEVER_RED', legMat);
  handle.add(tread, face, lens, arrow);
  for (const m of [arm, tread, face]) { m.castShadow = true; m.receiveShadow = true; }

  const def = kit.def('GEAR_LEVER');
  const angleOf = (v: number) => (v > 0.5 ? SWING : -SWING); // DOWN = +24° (handle low), UP = −24°
  let ang = angleOf(kit.sim.get('C:GEAR_LEVER'));
  let pull = 0;
  let held = false;
  pivot.rotation.x = ang * DEG;
  kit.addInstance({
    id: 'GEAR_LEVER',
    sync: (sim, dt) => {
      const target = angleOf(sim.get('C:GEAR_LEVER'));
      const moving = Math.abs(target - ang) > 0.3;
      const pullTarget = moving || held ? 1 : 0;
      pull += Math.sign(pullTarget - pull) * Math.min(Math.abs(pullTarget - pull), dt * 7);
      if (pull > 0.95 || !moving) {
        const step = dt * 190;
        ang += Math.sign(target - ang) * Math.min(Math.abs(target - ang), step);
      }
      pivot.rotation.x = ang * DEG;
      slider.position.z = pull * 0.013;
    },
  });
  let acc = 0, dragged = false;
  const set = (v: number) => {
    if (Math.round(kit.sim.get('C:GEAR_LEVER')) === v) return;
    kit.setControl('GEAR_LEVER', v, handle, 'detent');
  };
  const h: Handle = {
    id: 'GEAR_LEVER',
    ref: pivot,
    cursor: 'drag',
    onDown: () => { held = true; acc = 0; dragged = false; kit.sfx('pull', 'GEAR_LEVER', handle); },
    onDrag: (_dx, dy) => {
      acc += dy;
      if (Math.abs(acc) > 3) dragged = true;
      if (acc < -28) { set(0); acc = 0; }
      else if (acc > 28) { set(1); acc = 0; }
    },
    onUp: () => {
      held = false;
      if (!dragged) set(Math.round(kit.sim.get('C:GEAR_LEVER')) ? 0 : 1);
      kit.sfx('push', 'GEAR_LEVER', handle);
    },
    onWheel: (s) => set(s > 0 ? 0 : 1),
    describe: () => ({ ...kit.describe(def), state: `${kit.stateText(def)} · tirer + glisser / clic` }),
  };
  kit.interactive(slider, h);
  return p.finish();
}
