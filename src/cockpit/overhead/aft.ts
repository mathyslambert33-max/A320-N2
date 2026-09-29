/**
 * Aft part of the overhead: the strip aft of the forward rack (still in the OVHD plane: AUDIO SWITCHING
 * and circuit-breaker panels) and the aft overhead proper (anchor OVHD_AFT: MAINT panel 50VU,
 * circuit-breaker panels, blank plates). Circuit breakers are instanced (one draw call per anchor).
 * Millimetres unless stated.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { Plate, MM, ovhdMats } from './lib';
import { SIDE_W, CTR_W, COL_X, Y_AFT } from './fwd';

/** First aft plate edge (mm, OVHD frame): 6 mm step lip after the forward rack. */
export const Y_AFT_SECTION = Y_AFT + 6;
/** Aft edge of usable area in the OVHD anchor (the anchor ends at +475). */
export const Y_OVHD_END = 470;

/* ------------------------------------------------------------------ */
/* Circuit breakers                                                     */
/* ------------------------------------------------------------------ */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CB_SYS = ['ELEC', 'HYD', 'FUEL', 'ENG 1', 'ENG 2', 'APU', 'FIRE DET', 'AIR COND', 'BLEED', 'PRESS', 'ANTI ICE', 'LIGHTING',
  'NAV', 'COM', 'ADIRS', 'FMGC', 'FCU', 'FWC', 'SDAC', 'DMC', 'EFIS', 'L/G', 'BRAKES', 'F/CTL', 'ELAC', 'SEC', 'FAC', 'CVR',
  'OXY', 'WIPERS', 'CARGO', 'VENT', 'ECAM', 'WXR', 'ATC', 'GPWS', 'CIDS', 'SFCC', 'FQI', 'BMC', 'LGCIU', 'CFDIU'];
const CB_AMPS = ['3', '5', '5', '3', '2', '7.5', '10', '5', '3', '15', '1', '5'];

export class CbField {
  private readonly pos: number[] = [];
  add(x: number, y: number): void { this.pos.push(x, y); }
  build(name: string): THREE.InstancedMesh | null {
    const n = this.pos.length / 2;
    if (!n) return null;
    const collar = geo.normalise(geo.cylZ(0.0056, 0.0058, 0.0011, 20));
    const body = geo.normalise(geo.cylZ(0.0041, 0.0044, 0.0058, 20)).translate(0, 0, 0.0011);
    const top = geo.normalise(geo.latheZ('cbTop', [[0, 0], [0.0041, 0], [0.0036, 0.0008], [0, 0.001]], 20)).translate(0, 0, 0.0069);
    const g = geo.mergeGeometries([collar, body, top])!;
    const mesh = new THREE.InstancedMesh(g, ovhdMats().cb, n);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, mtx.makeTranslation(this.pos[2 * i], this.pos[2 * i + 1], 0));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    return mesh;
  }
}

/** A circuit-breaker panel at (cx, cy) (mm, anchor frame). */
function cbPanel(app: App, name: string, w: number, h: number, cx: number, cy: number, field: CbField, seed: number, rowLetter0 = 0): THREE.Group {
  const p = new Plate(app, name, w, h);
  const r = rng(seed);
  const px = 15.5, py = 19.5;
  const cols = Math.floor((w - 16) / px);
  const rows = Math.floor((h - 14) / py);
  const x0 = -((cols - 1) * px) / 2 + 2.5;
  const y0 = ((rows - 1) * py) / 2 - 4;
  for (let c = 0; c < cols; c++) p.label(String(c + 1), x0 + c * px, h / 2 - 4.2, 1.5);
  for (let row = 0; row < rows; row++) {
    const y = y0 - row * py;
    p.label(String.fromCharCode(65 + rowLetter0 + row), -w / 2 + 4.5, y, 1.6);
    let c = 0;
    while (c < cols) {
      const len = Math.min(cols - c, 2 + Math.floor(r() * 5));
      const gx0 = x0 + c * px - 5.5, gx1 = x0 + (c + len - 1) * px + 5.5;
      const title = CB_SYS[Math.floor(r() * CB_SYS.length)];
      p.p.bracket(title, gx0 * MM, gx1 * MM, (y + 9.6) * MM, { size: 1.45 * MM, drop: 1.4 * MM });
      for (let k = 0; k < len; k++) {
        const x = x0 + (c + k) * px;
        if (r() < 0.08) continue; // spare position
        p.label(CB_AMPS[Math.floor(r() * CB_AMPS.length)], x, y + 6.1, 1.3);
        field.add((cx + x) * MM, (cy + y) * MM);
      }
      c += len + (r() < 0.25 ? 1 : 0);
    }
  }
  const g = p.finish();
  g.position.set(cx * MM, cy * MM, 0);
  return g;
}

function blankAt(app: App, name: string, w: number, h: number, cx: number, cy: number, text?: string): THREE.Group {
  const p = new Plate(app, name, w, h);
  if (text) p.label(text, 0, 0, 3.0);
  const g = p.finish();
  g.position.set(cx * MM, cy * MM, 0);
  return g;
}

/* ------------------------------------------------------------------ */
/* Aft strip of the OVHD anchor                                          */
/* ------------------------------------------------------------------ */

export function buildAftSection(app: App, root: THREE.Group): void {
  const field = new CbField();
  const y0 = Y_AFT_SECTION;
  const hAll = Y_OVHD_END - y0;
  // left: AUDIO SWITCHING (forward) + C/B panel
  const hA = 58;
  const pa = new Plate(app, 'OVHD_AUDIO_SW', SIDE_W, hA);
  pa.label('AUDIO SWITCHING', 0, 21.5, 2.4);
  pa.rot('AUDIO_SWITCHING', 0, -7, { size: 8.5, labelRadius: 17.5 });
  const ga = pa.finish();
  ga.position.set(COL_X.L * MM, (y0 + hA / 2) * MM, 0);
  root.add(ga);
  const hL = hAll - hA - 1.5;
  root.add(cbPanel(app, 'OVHD_CB_L1', SIDE_W, hL, COL_X.L, y0 + hA + 1.5 + hL / 2, field, 11));
  root.add(cbPanel(app, 'OVHD_CB_C1', CTR_W, hAll, COL_X.C, y0 + hAll / 2, field, 23));
  root.add(cbPanel(app, 'OVHD_CB_R1', SIDE_W, hAll, COL_X.R, y0 + hAll / 2, field, 37));
  const cb = field.build('OVHD:cb');
  if (cb) root.add(cb);
}

/* ------------------------------------------------------------------ */
/* Aft overhead (OVHD_AFT anchor): MAINT panel + C/B panels              */
/* ------------------------------------------------------------------ */

function maint(app: App, h: number): THREE.Group {
  const p = new Plate(app, 'OVHD_MAINT', SIDE_W, h);
  const M = materials();
  p.line([[-23.5, -92], [-23.5, 96]], 0.6);
  p.line([[23.5, -92], [23.5, 96]], 0.6);
  // ENG FADEC GND PWR / APU AUTO EXTING
  p.label('ENG', -47, 92, 2.6);
  p.label('FADEC GND PWR', -47, 86, 1.6);
  p.pb('MAINT_FADEC_GND_PWR1', -47, 64, { label: '1' });
  p.pb('MAINT_FADEC_GND_PWR2', -47, 33, { label: '2' });
  p.label('APU', -47, 12.5, 2.6);
  p.label('AUTO EXTING', -47, 7, 1.6);
  p.pb('MAINT_APU_AUTOEXT_TEST', -47, -14, { label: 'TEST' });
  // RESET (decorative round pushbutton)
  p.addStatic(geo.latheZ('maintRst', [[0.0062, 0], [0.0078, 0], [0.0078, 0.0026], [0.0062, 0.0032], [0.0062, 0]], 32), M.bezel, -47, -46);
  p.addStatic(geo.cylZ(0.0058, 0.0058, 0.0042, 28), M.cap, -47, -46);
  p.label('RESET', -47, -34.5, 1.8);
  // HYD
  p.label('HYD', 0, 92, 2.6);
  p.pb('MAINT_BLUE_PUMP_OVRD', 0, 64);
  p.label(['BLUE PUMP', 'OVRD'], 0, 83, 1.7);
  p.label(['LEAK MEASUREMENT', 'VALVES'], 0, 44.5, 1.5);
  const leak: Array<[string, string, number]> = [['MAINT_HYD_LEAK_B', 'B', 20], ['MAINT_HYD_LEAK_G', 'G', -14], ['MAINT_HYD_LEAK_Y', 'Y', -48]];
  for (const [id, l, y] of leak) { p.pb(id, 0, y); p.label(l, 0, y + 16.8, 1.9); }
  // OXYGEN / SVCE INT / AVIONICS COMPT LT / CVR HEADSET
  p.label('OXYGEN', 47, 92, 2.6);
  p.pb('MAINT_OXY_TMR_RESET', 47, 64, { label: 'TMR RESET' });
  p.pb('MAINT_SVCE_INT_OVRD', 47, 29, { label: ['SVCE INT', 'OVRD'] });
  p.pb('MAINT_AVIONICS_COMPT_LT', 47, -9, { label: ['AVIONICS', 'COMPT LT'] });
  p.addStatic(geo.latheZ('jack', [[0.0028, 0], [0.0052, 0], [0.0052, 0.0022], [0.0043, 0.003], [0.0028, 0.003], [0.0028, 0]], 32), M.alu, 47, -50);
  p.addStatic(geo.cylZ(0.0028, 0.0028, 0.0003, 20), M.black, 47, -50);
  p.label(['CVR', 'HEADSET'], 47, -39, 1.7);
  return p.finish();
}

export function buildAftOverhead(app: App, root: THREE.Group): void {
  const field = new CbField();
  const yF = -246.5, yEnd = 244.5;
  const hCb = 300, hRest = yEnd - (yF + hCb + 1.5);
  root.add(cbPanel(app, 'OVHD_CB_L2', SIDE_W, hCb, COL_X.L, yF + hCb / 2, field, 51));
  root.add(blankAt(app, 'OVHD_AFT_L_BLANK', SIDE_W, hRest, COL_X.L, yEnd - hRest / 2));
  root.add(cbPanel(app, 'OVHD_CB_C2', CTR_W, hCb, COL_X.C, yF + hCb / 2, field, 67, 9));
  root.add(blankAt(app, 'OVHD_AFT_C_BLANK', CTR_W, hRest, COL_X.C, yEnd - hRest / 2));
  const hM = 200;
  const gm = maint(app, hM);
  gm.position.set(COL_X.R * MM, (yF + hM / 2) * MM, 0);
  root.add(gm);
  const hR = yEnd - (yF + hM + 1.5);
  root.add(cbPanel(app, 'OVHD_CB_R2', SIDE_W, hR, COL_X.R, yEnd - hR / 2, field, 79));
  const cb = field.build('OVHD_AFT:cb');
  if (cb) root.add(cb);
}
