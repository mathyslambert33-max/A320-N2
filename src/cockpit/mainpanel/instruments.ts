/**
 * Centre-panel instruments: ISIS unit (screen owned by pfdnd) and the BRAKES / ACCU PRESS triple
 * indicator with three mechanical needles.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { DEG, addScrew } from './common';

let _face: THREE.MeshStandardMaterial | null = null;
/** Black instrument face (clock, ISIS, triple indicator). */
export function instrumentFace(): THREE.MeshStandardMaterial {
  return (_face ??= new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.62, metalness: 0.05 }));
}

/* ------------------------------------------------------------------ */
/* ISIS                                                                  */
/* ------------------------------------------------------------------ */

export function buildIsis(app: App): THREE.Group {
  const M = app.kit.mats;
  const p = app.kit.panel({ name: 'MAIN_ISIS', width: 0.092, height: 0.098, zone: 'main', material: instrumentFace(), screws: false, thickness: 0.01, radius: 0.005, pxPerM: 9000 });
  for (const [sx, sy] of [[-0.0415, 0.0445], [0.0415, 0.0445], [-0.0415, -0.0445], [0.0415, -0.0445]] as const) addScrew(p, M, sx, sy, 0);
  const sy = 0.003;
  p.addStatic(geo.rectRing(0.072, 0.072, 0.0665, 0.0665, 0.0022, 0.004), M.bezel, 0, sy, 0);
  p.screen('ISIS', 0, sy, 0.064, 0.064, { margin: 0.0012, recess: 0.002 });
  p.pb('ISIS_BUGS', -0.026, 0.0425, { w: 0.014, h: 0.0072, capText: 'BUGS' });
  p.pb('ISIS_LS', 0.026, 0.0425, { w: 0.014, h: 0.0072, capText: 'LS' });
  p.pb('ISIS_PLUS', -0.035, -0.0395, { w: 0.0085, h: 0.0072, capText: '+' });
  p.pb('ISIS_MINUS', -0.0215, -0.0395, { w: 0.0085, h: 0.0072, capText: '−' });
  p.pb('ISIS_RST', 0.0, -0.0395, { w: 0.0115, h: 0.0072, capText: 'RST' });
  p.enc('ISIS_BARO', 0.0335, -0.0395, { style: 'round', size: 0.0062 });
  p.label('BARO', 0.0335, -0.0296, { size: 0.0014 });
  return p.finish();
}

/* ------------------------------------------------------------------ */
/* Triple indicator (ACCU PRESS / BRAKES L, R)                          */
/* ------------------------------------------------------------------ */

const ACCU_C: [number, number] = [0, -0.001];
const L_C: [number, number] = [-0.025, -0.017];
const R_C: [number, number] = [0.025, -0.017];

/** Needle angle (deg, clockwise from 12 o'clock) for a pressure in psi. */
export const accuAngle = (psi: number) => -60 + 120 * clamp01(psi / 4000);
export const brakeAngleL = (psi: number) => 150 - 120 * clamp01(psi / 4000);
export const brakeAngleR = (psi: number) => -150 + 120 * clamp01(psi / 4000);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function buildTripleIndicator(app: App): THREE.Group {
  const M = app.kit.mats;
  const p = app.kit.panel({ name: 'MAIN_BRK_IND', width: 0.075, height: 0.075, zone: 'main', material: instrumentFace(), screws: false, thickness: 0.009, radius: 0.004, pxPerM: 10000 });
  // raised frame + glass
  p.addStatic(geo.rectRing(0.075, 0.075, 0.0655, 0.0655, 0.0075, 0.004), M.bezel, 0, 0, 0);
  for (const [sx, sy] of [[-0.0339, 0.0339], [0.0339, 0.0339], [-0.0339, -0.0339], [0.0339, -0.0339]] as const) addScrew(p, M, sx, sy, 0.0075);
  // --- ACCU PRESS scale
  p.label('ACCU PRESS', 0, 0.0305, { size: 0.0021 });
  p.arc(ACCU_C[0], ACCU_C[1], 0.021, -60, 60, 0.0005);
  for (let k = 0; k <= 8; k++) {
    const a = (-60 + 15 * k) * DEG, major = k % 2 === 0;
    const r0 = 0.021, r1 = major ? 0.0245 : 0.023;
    p.line([[ACCU_C[0] + Math.sin(a) * r0, ACCU_C[1] + Math.cos(a) * r0], [ACCU_C[0] + Math.sin(a) * r1, ACCU_C[1] + Math.cos(a) * r1]], major ? 0.0006 : 0.0004);
    if (major) p.label(String(k / 2), ACCU_C[0] + Math.sin(a) * 0.0165, ACCU_C[1] + Math.cos(a) * 0.0165, { size: 0.0019 });
  }
  // --- BRAKES scales (L needle pivots bottom-left, R bottom-right; 0 at the bottom, pressure → up)
  for (const [c, f] of [[L_C, brakeAngleL], [R_C, brakeAngleR]] as const) {
    const a0 = f(0), a1 = f(4000);
    p.arc(c[0], c[1], 0.015, Math.min(a0, a1), Math.max(a0, a1), 0.0005);
    for (let k = 0; k <= 8; k++) {
      const a = f(k * 500) * DEG, major = k % 2 === 0;
      const r0 = 0.015, r1 = major ? 0.0185 : 0.017;
      p.line([[c[0] + Math.sin(a) * r0, c[1] + Math.cos(a) * r0], [c[0] + Math.sin(a) * r1, c[1] + Math.cos(a) * r1]], major ? 0.0006 : 0.0004);
      if (major) p.label(String(k / 2), c[0] + Math.sin(a) * 0.0107, c[1] + Math.cos(a) * 0.0105, { size: 0.0017 });
    }
  }
  p.label('L', -0.0305, -0.0045, { size: 0.0019 });
  p.label('R', 0.0305, -0.0045, { size: 0.0019 });
  p.label('BRAKES', 0, -0.0315, { size: 0.0021 });
  p.label('PSI x 1000', 0, -0.0105, { size: 0.0016 });

  // --- needles (mechanical, smoothed)
  const needleGeo = needle();
  const hubGeo = geo.cylZ(0.0021, 0.0023, 0.0016, 20);
  const mk = (c: [number, number], len: number) => {
    const g = new THREE.Group();
    g.position.set(c[0], c[1], 0.0022);
    const n = new THREE.Mesh(needleGeo, M.white);
    n.scale.set(1, len / 0.02, 1);
    const hub = new THREE.Mesh(hubGeo, M.black);
    hub.position.z = 0.0008;
    n.castShadow = true;
    g.add(n, hub);
    p.add(g, c[0], c[1], 0.0022);
    return g;
  };
  const accu = mk(ACCU_C, 0.0225);
  const nl = mk(L_C, 0.0165);
  const nr = mk(R_C, 0.0165);
  const st = { a: 0, l: 0, r: 0 };
  app.kit.addInstance({
    id: 'MAIN_BRK_IND',
    sync: (sim, dt) => {
      const k = Math.min(1, dt * 6);
      st.a += (sim.get('S:BRK_ACCU_PRESS') - st.a) * k;
      st.l += (sim.get('S:BRK_PRESS_L') - st.l) * k;
      st.r += (sim.get('S:BRK_PRESS_R') - st.r) * k;
      accu.rotation.z = -accuAngle(st.a) * DEG;
      nl.rotation.z = -brakeAngleL(st.l) * DEG;
      nr.rotation.z = -brakeAngleR(st.r) * DEG;
    },
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.066), M.screenGlass);
  glass.renderOrder = 2;
  p.add(glass, 0, 0, 0.0068);
  app.interaction.addBlocker(glass);
  return p.finish();
}

/** Needle pointing +Y from the pivot (length 0.02 m, short counterweight tail). */
function needle(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.0009, -0.0045);
  s.lineTo(0.0009, -0.0045);
  s.lineTo(0.0007, 0);
  s.lineTo(0.00022, 0.02);
  s.lineTo(-0.00022, 0.02);
  s.lineTo(-0.0007, 0);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.0004, bevelEnabled: false });
}
