/**
 * Sloped forward section of the pedestal: MCDU 1 / MCDU 2 (146 × 229 mm, full keyboard, annunciators, screen bound
 * to the MCDU displays), SWITCHING panel and ECAM control panel between them (214 mm centre column).
 * Layout from the FCOM pedestal figure and the FlyByWire A32NX panel references (dimensions in mm).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { Plate, leg, m } from './lib';

/** Screen of the MCDU: 96 × 80 mm (768 × 640 canvas), centre 49.5 mm above the unit centre. */
export const MCDU_SCREEN = { x: 0, y: 49.5, w: 96, h: 80 };
/** MCDU canvas rows (see avionics/mcdu/draw.ts): 14 rows of 43.71 px after a 14 px margin, 640 px high. */
const mcduRowY = (row: number) => MCDU_SCREEN.y + MCDU_SCREEN.h / 2 - ((14 + (row + 0.5) * ((640 - 28) / 14)) / 640) * MCDU_SCREEN.h;

export function buildMcdu(app: App, n: 1 | 2): THREE.Group {
  const M = materials();
  const P = `MCDU${n}_KEY`;
  const pl = new Plate(app, `PED_MCDU${n}`, 146, 229, {
    screws: [[-67.5, 108.5], [67.5, 108.5], [-67.5, -108.5], [67.5, -108.5], [-67.5, 0], [67.5, 0]],
    thickness: 0.006,
  });
  // screen surround (black lining) + screen
  pl.addStatic(geo.rectRing(m(108), m(92), m(99), m(83), 0.0028, 0.003), M.bezel, MCDU_SCREEN.x, MCDU_SCREEN.y, 0);
  pl.screen(`MCDU${n}`, MCDU_SCREEN.x, MCDU_SCREEN.y, MCDU_SCREEN.w, MCDU_SCREEN.h, { margin: 1.6, recess: 4 });
  // line select keys, aligned with the data lines (rows 2, 4, … 12) of the screen
  for (let i = 1; i <= 6; i++) {
    const y = mcduRowY(2 * i);
    pl.key(`${P}_L${i}`, -63.8, y, 9, 5.6, { text: '—', depth: 4 });
    pl.key(`${P}_R${i}`, 63.8, y, 9, 5.6, { text: '—', depth: 4 });
    pl.line([[-58, y], [-51.5, y + 0.8]], 0.5);
    pl.line([[58, y], [51.5, y + 0.8]], 0.5);
  }
  // function keys
  const fx = [-47.3, -31.3, -15.3, 0.7, 16.7, 32.7];
  const F1 = ['DIR', 'PROG', 'PERF', 'INIT', 'DATA'];
  const F2 = ['FPLN', 'RADNAV', 'FUEL', 'SECFPLN', 'ATC', 'MENU'];
  F1.forEach((k, i) => pl.key(`${P}_${k}`, fx[i], -5.5, 14.2, 8, { depth: 4.5 }));
  F2.forEach((k, i) => pl.key(`${P}_${k}`, fx[i], -16.8, 14.2, 8, { depth: 4.5 }));
  pl.key(`${P}_AIRPORT`, fx[0], -28.1, 14.2, 8, { depth: 4.5 });
  // blank key positions (no function)
  for (const [x, y] of [[fx[5], -5.5], [fx[1], -28.1]] as const) {
    pl.addStatic(geo.roundedBox(m(14.2), m(8), 0.0045, 0.001), M.keyCap, x, y, 2.25);
  }
  pl.key(`${P}_PREV`, fx[0], -39.6, 14.2, 8, { depth: 4.5 });
  pl.key(`${P}_UP`, fx[1], -39.6, 14.2, 8, { depth: 4.5 });
  pl.key(`${P}_NEXT`, fx[0], -51, 14.2, 8, { depth: 4.5 });
  pl.key(`${P}_DOWN`, fx[1], -51, 14.2, 8, { depth: 4.5 });
  pl.key(`${P}_BRT`, 52.5, -5.5, 9.5, 8, { depth: 4.5 });
  pl.key(`${P}_DIM`, 52.5, -16.8, 9.5, 8, { depth: 4.5 });
  // alphabetic keys 5 × 6
  const lx = [-6.3, 7.8, 21.9, 36, 50.1];
  const ly = [-34.4, -48.3, -62.2, -76.1, -90, -103.9];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
  for (let i = 0; i < 25; i++) pl.key(`${P}_${letters[i]}`, lx[i % 5], ly[Math.floor(i / 5)], 10.6, 9.6, { depth: 4.5 });
  ['Z', 'SLASH', 'SP', 'OVFY', 'CLR'].forEach((k, i) => pl.key(`${P}_${k}`, lx[i], ly[5], 10.6, 9.6, { depth: 4.5, small: k === 'OVFY' }));
  // numeric keys (round)
  const nx = [-48.8, -34.6, -20.4];
  const ny = [-66.4, -79, -91.6, -104];
  const nums = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DOT', '0', 'PLUSMINUS'];
  nums.forEach((k, i) => {
    const r = pl.key(`${P}_${k}`, nx[i % 3], ny[Math.floor(i / 3)], 10, 10, { depth: 4.5 });
    roundKey(r, 10);
  });
  // annunciators: top row FM1 / IND / RDY / (blank) / FM2, sides FAIL + FMGC (left), MCDU MENU + FM (right)
  const L = `MCDU${n}`;
  pl.lamp(-36, 107, [leg('FM1', 'A', `${L}_FM1`)], { w: 12, h: 5 });
  pl.lamp(-20, 107, [leg('IND', 'A', `${L}_IND`)], { w: 12, h: 5 });
  pl.lamp(-4, 107, [leg('RDY', 'G', `${L}_RDY`)], { w: 12, h: 5 });
  pl.lamp(15, 107, [], { w: 20, h: 5 });
  pl.lamp(36, 107, [leg('FM2', 'A', `${L}_FM2`)], { w: 12, h: 5 });
  pl.lamp(-64.2, -36.5, [leg('FAIL', 'A', `${L}_FAIL`)], { w: 9, h: 10 });
  pl.lamp(-64.2, -50.5, [leg('FMGC', 'W', `${L}_FMGC`)], { w: 9, h: 10 });
  pl.lamp(64.2, -36.5, [leg(['MCDU', 'MENU'], 'W', `${L}_MENU`)], { w: 9, h: 10 });
  pl.lamp(64.2, -50.5, [leg('FM', 'W', `${L}_FM`)], { w: 9, h: 10 });
  // ambient light sensors (top corners)
  for (const x of [-55, 55]) {
    pl.addStatic(geo.cylZ(m(3.2), m(3.4), 0.0012, 24), M.bezel, x, 108.3, 0);
    pl.addStatic(geo.cylZ(m(2.4), m(2.4), 0.0014, 24), M.white, x, 108.3, 0);
  }
  // keyboard well (slightly recessed darker field)
  pl.addStatic(geo.rectRing(m(128), m(116), m(126.6), m(114.6), 0.0006, 0.002), M.bezel, 0, -54.5, 0);
  return pl.finish();
}

/** Turn a kit key into a round key (numeric keypad). */
function roundKey(root: THREE.Group, d: number): void {
  const capG = root.children[0] as THREE.Group;
  const body = capG.children[0] as THREE.Mesh;
  body.geometry = geo.latheZ(`pedRoundKey${d}`, [[0, -0.00225], [m(d / 2), -0.00225], [m(d / 2), 0.0016], [m(d / 2 - 0.8), 0.00225], [0, 0.00225]], 32);
}

export function buildSwitching(app: App): THREE.Group {
  const pl = new Plate(app, 'PED_SWITCHING', 214, 66.7, { screws: [[-101, 27.8], [101, 27.8], [-101, -27.8], [101, -27.8]] });
  pl.label('SWITCHING', 0, 24.5, 3.0);
  const knobs: Array<[string, string, string, string]> = [
    ['SW_ATT_HDG', 'ATT HDG', 'CAPT', 'F/O'],
    ['SW_AIR_DATA', 'AIR DATA', 'CAPT', 'F/O'],
    ['SW_EIS_DMC', 'EIS DMC', 'CAPT', 'F/O'],
    ['SW_ECAM_ND_XFR', 'ECAM/ND XFR', 'CAPT', 'F/O'],
  ];
  const xs = [-69.6, -24.7, 19.6, 64.9];
  knobs.forEach(([id, name, l, r], i) => {
    const x = xs[i], y = -12;
    const xfr = id === 'SW_ECAM_ND_XFR';
    pl.rot(id, x, y, { white: true, size: 9.5, angles: [-55, 0, 55], ticks: false, pos: [
      [name, 0, 17.5], ['NORM', 0, 13], [l, -16, 6.2, 'right'], [r, 16, 6.2, 'left'],
      ...(xfr ? [] : [['3', -16.5, 1.5, 'right'], ['3', 16.5, 1.5, 'left']] as Array<[string, number, number, CanvasTextAlign]>),
    ] });
    // detent tick marks
    for (const a of [-55, 0, 55]) {
      const s = Math.sin(a * Math.PI / 180), c = Math.cos(a * Math.PI / 180);
      pl.line([[x + s * 11.2, y + c * 11.2], [x + s * 13.2, y + c * 13.2]], 0.55);
    }
  });
  return pl.finish();
}

export function buildEcp(app: App): THREE.Group {
  const M = materials();
  const pl = new Plate(app, 'PED_ECAM', 214, 76.2, { screws: [[-101, 32.6], [101, 32.6], [-101, -32.6], [101, -32.6]] });
  pl.label('ECAM', -87.5, 33, 3.0);
  // brightness knobs
  pl.pot('ECP_UPPER_BRT', -84.8, 11.8, { style: 'round', size: 6.2, from: -140, to: 140 });
  pl.label(['UPPER DISPLAY'], -84.8, 26.2, 1.9);
  pl.pot('ECP_LOWER_BRT', -84.8, -23.5, { style: 'round', size: 6.2, from: -140, to: 140 });
  pl.label(['LOWER DISPLAY'], -84.8, -9.1, 1.9);
  for (const y of [11.8, -23.5]) {
    pl.arc(-84.8, y, 10.2, -130, 130, 0.5);
    pl.label('OFF', -94.8, y - 10.6, 1.8);
    pl.label('BRT', -74.8, y - 10.6, 1.8);
    pl.arrowHead(-84.8 + Math.sin(130 * Math.PI / 180) * 10.2, y + Math.cos(130 * Math.PI / 180) * 10.2, 220, 1.8);
  }
  pl.pb('ECP_TO_CONFIG', -26.9, 24, { w: 14.5, h: 11, capText: ['T.O', 'CONFIG'] });
  pl.pb('ECP_EMER_CANC', 35.5, 24, { w: 17, h: 11, capText: ['EMER', 'CANC'] });
  // protective fence around EMER CANC
  pl.addStatic(geo.rectRing(m(26), m(19), m(23), m(16), 0.0075, 0.0015), M.bezel, 35.5, 24, 0);
  const col = [-48.4, -27, -5.6, 15.8, 37.2, 58.6];
  const row1: Array<[string, string]> = [['ECP_ENG', 'ENG'], ['ECP_BLEED', 'BLEED'], ['ECP_PRESS', 'PRESS'], ['ECP_ELEC', 'ELEC'], ['ECP_HYD', 'HYD'], ['ECP_FUEL', 'FUEL']];
  const row2: Array<[string, string]> = [['ECP_APU', 'APU'], ['ECP_COND', 'COND'], ['ECP_DOOR', 'DOOR'], ['ECP_WHEEL', 'WHEEL'], ['ECP_FCTL', 'F/CTL'], ['ECP_ALL', 'ALL']];
  row1.forEach(([id, t], i) => pl.pb(id, col[i], 5, { w: 14.2, h: 9.6, capText: t }));
  row2.forEach(([id, t], i) => pl.pb(id, col[i], -9.6, { w: 14.2, h: 9.6, capText: t }));
  pl.pb('ECP_CLR_L', col[0], -26.3, { w: 16.5, h: 11, capText: 'CLR' });
  pl.pb('ECP_STS', col[2], -26.3, { w: 14.2, h: 9.6, capText: 'STS' });
  pl.pb('ECP_RCL', col[3], -26.3, { w: 14.2, h: 9.6, capText: 'RCL' });
  pl.pb('ECP_CLR_R', col[5], -26.3, { w: 16.5, h: 11, capText: 'CLR' });
  return pl.finish();
}

/** Plain blank plate. */
export function blank(app: App, name: string, w: number, h: number, screws?: Array<[number, number]>): THREE.Group {
  const pl = new Plate(app, name, w, h, screws ? { screws } : {});
  return pl.finish();
}
