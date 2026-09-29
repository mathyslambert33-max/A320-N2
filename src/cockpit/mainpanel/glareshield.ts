/**
 * Glareshield: housing (anti-glare top, painted face, chin over the main panel), warning panels
 * (MASTER WARN / CAUT, CHRONO, SIDE STICK PRIORITY, AUTO LAND), both EFIS control panels and the FCU.
 * Built in the GLARE_MP frame (see common.ts): x right, y up the face, z out of the face.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo, type PanelBuilder } from '../kit';
import { placeAt } from '../layout';
import { Batch, DEG, GLARE_MP, decorateKnob, extrudeX, ringSelector } from './common';

const PANEL_H = 0.08;
const PROUD = 0.006; // glareshield modules stand proud of the housing face

export function buildGlareshield(app: App): THREE.Group {
  const root = new THREE.Group();
  root.name = 'mainpanel:glareshield';
  root.add(buildHousing(app));
  for (const side of [1, 2] as const) {
    const w = buildWarn(app, side);
    w.position.set(side === 1 ? -0.49 : 0.49, 0, PROUD);
    root.add(w);
    const e = buildEfis(app, side);
    e.position.set(side === 1 ? -0.305 : 0.305, 0, PROUD);
    root.add(e);
  }
  const f = buildFcu(app);
  f.position.set(0, 0, PROUD);
  root.add(f);
  placeAt(root, GLARE_MP);
  return root;
}

/* ------------------------------------------------------------------ */
/* Housing                                                              */
/* ------------------------------------------------------------------ */

function buildHousing(app: App): THREE.Group {
  const M = app.kit.mats;
  const b = new Batch();
  const X0 = -0.95, X1 = 0.95;
  // Painted face + chin (joins the main panel face ~2 cm behind the lower edge).
  b.add(extrudeX([
    [-0.045, 0], [0.046, 0], [0.046, -0.05], [-0.035, -0.05], [-0.0495, -0.03], [-0.0485, -0.008], [-0.047, -0.002],
  ], X0, X1), M.paint);
  // Anti-glare top: rounded padded nose overhanging the modules, then sloping down to the windshield base
  // (body y 1.08, z −0.95 = local (0.1055, −0.174)).
  const nose: Array<[number, number]> = [[0.046, 0]];
  const cx = 0.0565, cz = 0.0015, r = 0.0105; // nose arc centre / radius (y, z)
  for (let i = 0; i <= 10; i++) {
    const a = (-100 + i * 19) * DEG; // from below-front, over the top, to the back
    nose.push([cy(cx, r, a), cz + r * Math.cos(a) * 0.95]);
  }
  b.add(extrudeX([
    ...nose,
    [0.1075, -0.18], [0.1085, -0.2], [0.085, -0.2], [0.046, -0.05],
  ], X0, X1), M.antiGlare);
  // End caps trims (dark) and a thin light-plate edge line under the nose.
  b.at(geo.box(0.004, 0.096, 0.03), M.paintDark, X0 + 0.002, 0, -0.013);
  b.at(geo.box(0.004, 0.096, 0.03), M.paintDark, X1 - 0.002, 0, -0.013);
  b.at(geo.box(X1 - X0, 0.0016, 0.0022), M.paintDark, 0, 0.0452, 0.0006);
  const g = b.build('GLARE:housing');
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) app.interaction.addBlocker(o); });
  return g;
}

function cy(c: number, r: number, a: number): number {
  return c + r * Math.sin(a);
}

/* ------------------------------------------------------------------ */
/* Warning panels                                                        */
/* ------------------------------------------------------------------ */

function buildWarn(app: App, side: 1 | 2): THREE.Group {
  const S = side === 1 ? 'CAPT' : 'FO';
  const k = side === 1 ? 1 : -1; // outboard = −x for CAPT, +x for F/O
  const p = app.kit.panel({ name: side === 1 ? 'GLARE_WARN_L' : 'GLARE_WARN_R', width: 0.13, height: PANEL_H, zone: 'glare', thickness: PROUD + 0.004, pxPerM: 7000 });
  // outboard: MASTER WARN over MASTER CAUT
  const xm = -0.036 * k;
  p.pb(`WARN_MASTER_WARN_${S}`, xm, 0.017, { w: 0.028, h: 0.022 });
  p.pb(`WARN_MASTER_CAUT_${S}`, xm, -0.017, { w: 0.028, h: 0.022 });
  // middle: side stick priority (green CAPT/F/O + red arrow) over AUTO LAND
  const xp = 0.006 * k;
  p.ann(`PRIO_${S}`, xp, 0.024, 0.024, 0.0095);
  p.ann(`PRIO_${S}_ARROW`, xp, 0.0115, 0.024, 0.0095);
  p.ann(`AUTOLAND_${S}`, xp, -0.017, 0.024, 0.016);
  p.label('AUTO LAND', xp, -0.0328, { size: 0.0019 });
  // inboard: CHRONO
  const xc = 0.045 * k;
  p.pb(`CHRONO_${S}`, xc, 0.0, { w: 0.019, h: 0.016, capText: 'CHRONO' });
  return p.finish();
}

/* ------------------------------------------------------------------ */
/* EFIS control panel                                                    */
/* ------------------------------------------------------------------ */

function buildEfis(app: App, side: 1 | 2): THREE.Group {
  const e = `EFIS${side}`;
  const p = app.kit.panel({ name: side === 1 ? 'GLARE_EFIS_L' : 'GLARE_EFIS_R', width: 0.2, height: PANEL_H, zone: 'glare', thickness: PROUD + 0.004, pxPerM: 7000 });
  // --- BARO section (left)
  const bx = -0.047;
  p.screen(`${e}_BARO`, bx, 0.024, 0.042, 0.0158, { margin: 0.0015, recess: 0.002 });
  p.label('QNH', bx - 0.013, 0.0365, { size: 0.0019 });
  p.label('BARO', bx + 0.012, 0.0365, { size: 0.0019 });
  const baro = p.enc(`${e}_BARO`, bx, -0.013, { style: 'round', size: 0.0092 });
  decorateKnob(app, baro, [finRing(app, 0.0092, 0.011)]);
  ringSelector(app, p, `${e}_BARO_UNIT`, bx, -0.013, {
    rIn: 0.0098, rOut: 0.0135, angles: [205, 155], labels: ['in Hg', 'hPa'], labelAngles: [240, 120], labelRadius: 0.0215, labelSize: 0.0019,
  });
  p.label('PULL STD', bx, -0.0355, { size: 0.0015 });
  // FD / LS
  p.pb(`${e}_FD`, -0.087, 0.012, { w: 0.015, h: 0.013, capText: 'FD' });
  p.pb(`${e}_LS`, -0.087, -0.016, { w: 0.015, h: 0.013, capText: 'LS' });
  // separator engraving
  p.line([[-0.022, 0.036], [-0.022, -0.036]], 0.0004, 0.6);
  // --- ND section (right): option pbs row
  const opts = ['CSTR', 'WPT', 'VORD', 'NDB', 'ARPT'];
  const capt = ['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT'];
  opts.forEach((o, i) => p.pb(`${e}_${o}`, -0.0045 + i * 0.0215, 0.027, { w: 0.0175, h: 0.0115, capText: capt[i] }));
  // ND mode and range selectors
  const mx = 0.021, rx = 0.07, ky = -0.011;
  p.rot(`${e}_ND_MODE`, mx, ky, { style: 'pointer', size: 0.0072, angles: [-60, -30, 0, 30, 60], labelRadius: 0.017, labelSize: 0.0019 });
  p.rot(`${e}_ND_RANGE`, rx, ky, { style: 'pointer', size: 0.0072, angles: [-75, -45, -15, 15, 45, 75], labelRadius: 0.017, labelSize: 0.0019 });
  // ADF / VOR needle selectors (catalog 'sw' with 3 positions, built as small pointer selectors)
  for (const n of [1, 2] as const) {
    const x = n === 1 ? -0.009 : 0.088;
    p.rot(`${e}_NAV${n}`, x, -0.029, { style: 'pointer', size: 0.0042, angles: [-55, 0, 55], labelRadius: 0.0102, labelSize: 0.0016, ticks: false });
    p.label(String(n), x, -0.0372, { size: 0.0019 });
  }
  return p.finish();
}

/** Thin knurled skirt ring making the EFIS baro knob look like the real one (two-level knob). */
function finRing(app: App, r: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(geo.latheZ(`mpBaroTop${r}`, [[0, h], [r * 0.55, h], [r * 0.6, h + 0.0025], [0, h + 0.0027]], 32), app.kit.mats.knob);
  return m;
}

/* ------------------------------------------------------------------ */
/* FCU                                                                   */
/* ------------------------------------------------------------------ */

function buildFcu(app: App): THREE.Group {
  const M = app.kit.mats;
  const p: PanelBuilder = app.kit.panel({ name: 'GLARE_FCU', width: 0.39, height: PANEL_H, zone: 'glare', thickness: PROUD + 0.004, pxPerM: 7000 });
  const wy = 0.019; // LCD windows row
  const ky = -0.017; // knobs row
  const by = -0.021; // lower pbs row
  // SPD / MACH
  p.pb('FCU_SPD_MACH', -0.178, wy, { w: 0.014, h: 0.011, capText: ['SPD', 'MACH'] });
  p.screen('FCU_SPD', -0.14, wy, 0.042, 0.021, { margin: 0.0015, recess: 0.002 });
  const spd = p.enc('FCU_SPD', -0.14, ky, { size: 0.0118 });
  // HDG / TRK
  p.screen('FCU_HDG', -0.066, wy, 0.06, 0.02, { margin: 0.0015, recess: 0.002 });
  const hdg = p.enc('FCU_HDG', -0.075, ky, { size: 0.0118 });
  p.pb('FCU_LOC', -0.0345, by, { w: 0.02, h: 0.0145, capText: 'LOC' });
  // centre: HDG V/S - TRK FPA, AP1 / AP2, A/THR
  p.label('HDG', -0.0095, 0.0355, { size: 0.0019, align: 'right' });
  p.label('V/S', 0.0095, 0.0355, { size: 0.0019, align: 'left' });
  p.pb('FCU_HDG_TRK', 0, 0.0305, { w: 0.013, h: 0.009 });
  p.label('TRK', -0.0095, 0.0255, { size: 0.0019, align: 'right' });
  p.label('FPA', 0.0095, 0.0255, { size: 0.0019, align: 'left' });
  p.pb('FCU_AP1', -0.0125, 0.0065, { w: 0.02, h: 0.0145, capText: 'AP 1' });
  p.pb('FCU_AP2', 0.0125, 0.0065, { w: 0.02, h: 0.0145, capText: 'AP 2' });
  p.pb('FCU_ATHR', 0, by, { w: 0.02, h: 0.0145, capText: 'A/THR' });
  p.pb('FCU_APPR', 0.0345, by, { w: 0.02, h: 0.0145, capText: 'APPR' });
  // ALT
  p.screen('FCU_ALT', 0.07, wy, 0.068, 0.017, { margin: 0.0015, recess: 0.002 });
  const alt = p.enc('FCU_ALT', 0.078, ky, { size: 0.0122 });
  ringSelector(app, p, 'FCU_ALT_INC', 0.078, ky, {
    rIn: 0.0128, rOut: 0.0162, angles: [-118, 118], labels: ['100', '1000'], labelAngles: [-122, 122], labelRadius: 0.0228, labelSize: 0.0019,
  });
  p.pb('FCU_EXPED', 0.1215, by, { w: 0.02, h: 0.0145, capText: 'EXPED' });
  p.pb('FCU_METRIC_ALT', 0.1175, 0.0275, { w: 0.013, h: 0.009 });
  p.label(['METRIC', 'ALT'], 0.1175, 0.0163, { size: 0.0016 });
  // V/S - FPA
  p.screen('FCU_VS', 0.16, wy, 0.052, 0.0173, { margin: 0.0015, recess: 0.002 });
  const vs = p.enc('FCU_VS', 0.162, ky, { size: 0.0118 });
  p.label('UP', 0.183, -0.0055, { size: 0.0018 });
  p.label('DN', 0.183, -0.0285, { size: 0.0018 });

  // Distinct knob tops (real FCU: SPD plain, HDG with pointer, ALT stepped, V/S with a grip bar).
  const T = 0.014 + 0.0011; // kit 'roundLarge' body height + cap
  decorateKnob(app, spd, [lathe('spdTop', [[0, T], [0.0105, T], [0.0098, T + 0.0012], [0, T + 0.0014]], M.knob)]);
  const ptr = new THREE.Mesh(wedge(), M.knob);
  ptr.position.set(0, 0, T);
  decorateKnob(app, hdg, [ptr]);
  decorateKnob(app, alt, [lathe('altTop', [[0, T], [0.0085, T], [0.0085, T + 0.003], [0.0078, T + 0.0038], [0, T + 0.0038]], M.knobKnurl)]);
  const bar = new THREE.Mesh(geo.roundedBox(0.019, 0.0045, 0.0045, 0.0015), M.knob);
  bar.position.set(0, 0, T + 0.0018);
  decorateKnob(app, vs, [bar]);
  return p.finish();
}

function lathe(key: string, pts: Array<[number, number]>, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geo.latheZ(`mp${key}`, pts, 36), mat);
}

/** Raised heading pointer on the HDG knob top. */
function wedge(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.0032, -0.004);
  s.lineTo(0.0032, -0.004);
  s.lineTo(0.0009, 0.0102);
  s.lineTo(-0.0009, 0.0102);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.0022, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0004, bevelSegments: 2 });
}
