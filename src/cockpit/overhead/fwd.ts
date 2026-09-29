/**
 * Forward overhead panel (anchor OVHD), laid out after the user's reference photo (docs/ref).
 * Real module sizes: lateral columns 146 mm (5.75" Dzus modules), centre column 328 mm; plate heights
 * from 1:1 replica panels (FIRE 76, HYD/FUEL 136, ELEC 100, AIR COND 114, lower 150, left lower 350 mm…).
 * All numbers in this file are millimetres (plate frame: +x right, +y aft = drawing up).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { getControl, type Legend } from '../../core/catalog';
import { Plate, MM, addPaddle, fireFrame, fireGuardLook } from './lib';

/* ------------------------------------------------------------------ */
/* Rack geometry (mm, OVHD anchor frame)                               */
/* ------------------------------------------------------------------ */

export const SIDE_W = 146;
export const CTR_W = 328;
export const COL_X = { L: -(CTR_W / 2 + 5 + SIDE_W / 2), C: 0, R: CTR_W / 2 + 5 + SIDE_W / 2 };
/** Gap between stacked plates. */
export const GAP = 1.5;
/** Forward edge of the centre column (the anchor's forward edge is at −475: 100 mm console nose). */
export const Y_FWD = -375;
const CTR_H = [68, 76, 136, 100, 114, 150];
/** Aft edge of the forward rack. */
export const Y_AFT = Y_FWD + CTR_H.reduce((a, b) => a + b, 0) + GAP * (CTR_H.length - 1);
/** Depth of the lateral columns at their inboard edge (their forward end is chamfered by CHAMFER). */
export const SIDE_D = 632;
export const CHAMFER = 75;

type Build = (app: App, h: number) => THREE.Group;

/** Stack plates from the aft edge forward in one column. */
function stack(app: App, root: THREE.Group, x: number, yTop: number, list: Array<[number, Build]>): void {
  let y = yTop;
  for (const [h, build] of list) {
    const g = build(app, h);
    g.position.set(x * MM, (y - h / 2) * MM, 0);
    root.add(g);
    y -= h + GAP;
  }
}

const blank = (name: string, w: number): Build => (app, h) => new Plate(app, name, w, h).finish();

const leg = (id: string, i: number): Legend => getControl(id)!.leg![i];

/** Arc with end ticks around a selector (engraved). */
function scaleArc(p: Plate, x: number, y: number, r: number, a0: number, a1: number, ticks: number[] = []): void {
  p.arc(x, y, r, a0, a1, 0.45);
  for (const a of [a0, a1, ...ticks]) {
    const s = Math.sin(a * Math.PI / 180), c = Math.cos(a * Math.PI / 180);
    p.line([[x + s * r, y + c * r], [x + s * (r + 2), y + c * (r + 2)]], 0.45);
  }
}

/* ================================================================== */
/* LEFT COLUMN                                                          */
/* ================================================================== */

const paVideo: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_PA_VIDEO', SIDE_W, h);
  p.pb('OVHD_PA', -15.5, -6.5, { label: 'PA' });
  p.pb('COCKPIT_DOOR_VIDEO', 42, -6.5);
  p.label(['COCKPIT', 'DOOR VIDEO'], 42, 11, 2.0);
  p.line([[27, -17], [27, 17]], 0.6);
  return p.finish();
};

const adirs: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_ADIRS', SIDE_W, h);
  p.label('ADIRS', 0, 57, 3.2);
  p.ann('ADIRS_ON_BAT', 0, 46.5, 22, 9.5);
  const n = ['1', '3', '2'];
  [-43, 0, 43].forEach((x, i) => {
    p.pb(`ADIRS_IR${n[i]}`, x, 24, { label: `IR ${n[i]}` });
    p.rot(`ADIRS_IR${n[i]}_MODE`, x, -12, { white: true, size: 10, pos: [['OFF', -16, 14.5], ['NAV', 0, 21], ['ATT', 16, 14.5]] });
    scaleArc(p, x, -12, 12.8, -45, 45);
    p.pb(`ADIRS_ADR${n[i]}`, x, -44, { label: `ADR ${n[i]}` });
  });
  return p.finish();
};

const fltCtlL: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_FLTCTL_L', SIDE_W, h);
  p.label('FLT CTL', 15, 17.5, 2.8);
  p.pb('FLTCTL_ELAC1', -13, -7, { label: 'ELAC 1' });
  p.pb('FLTCTL_SEC1', 15, -7, { label: 'SEC 1' });
  p.pb('FLTCTL_FAC1', 43, -7, { label: 'FAC 1' });
  return p.finish();
};

/** EVAC / EMER ELEC PWR / GPWS / RCDR / OXYGEN / CALLS / RAIN RPLNT + WIPER (one plate, chamfered forward end). */
const leftLower: Build = (app, h) => {
  const H = h / 2;
  const p = new Plate(app, 'OVHD_LEFT_LOWER', SIDE_W, h, {
    outline: [[-73, H], [73, H], [73, -H], [-73, -H + CHAMFER]],
    screws: [[-67.5, H - 5.5], [67.5, H - 5.5], [-67.5, 60], [67.5, 60], [-67.5, -60], [67.5, -60], [67.5, -H + 5.5], [-67.5, -H + CHAMFER + 7]],
  });
  // EVAC
  p.label('EVAC', 0, H - 6.2, 3.0);
  p.pb('EVAC_COMMAND', -21.75, 147);
  p.label('COMMAND', -21.75, 164.5, 2.0);
  p.rpb('EVAC_HORN_SHUTOFF', 15.75, 148, 15, { label: 'HORN SHUT OFF' });
  p.sw('EVAC_CAPT_PURS', 48, 148, { pos: [['CAPT & PURS', 0, 13.5], ['CAPT', 0, -13.5]] });
  // EMER ELEC PWR
  p.section('EMER ELEC PWR', 127);
  p.pb('EMER_ELEC_GEN_TEST', -48, 100);
  p.label('EMER GEN TEST', -48, 117.5, 1.9);
  p.line([[-32, 88], [-32, 116]], 0.6);
  p.pb('EMER_ELEC_GEN1_LINE', -17.5, 98, { label: 'GEN 1 LINE' });
  p.lamp(11.5, 98, [leg('EMER_ELEC_RAT_MAN_ON', 0)], { upper: true });
  p.label(['RAT &', 'EMER GEN'], 11.5, 113.5, 1.9);
  p.pb('EMER_ELEC_RAT_MAN_ON', 38, 100, { legends: [] });
  p.label('MAN ON', 38, 117.5, 1.9);
  p.vtext('AUTO', 53, 100, 1.7);
  // GPWS
  p.section('GPWS', 80);
  p.pb('GPWS_TERR', -52, 52, { label: 'TERR' });
  p.line([[-38.25, 41], [-38.25, 70]], 0.6);
  p.pb('GPWS_SYS', -24.5, 52, { label: 'SYS' });
  p.pb('GPWS_GS_MODE', 0.5, 52, { label: ['G/S', 'MODE'] });
  p.pb('GPWS_FLAP_MODE', 25.5, 52, { label: ['FLAP', 'MODE'] });
  p.pb('GPWS_LDG_FLAP3', 50.5, 52, { label: ['LDG', 'FLAP 3'] });
  // RCDR
  p.section('RCDR', 37);
  p.pb('RCDR_GND_CTL', -18.5, 13, { label: 'GND CTL' });
  p.vtext('AUTO', -4.5, 13, 1.7);
  p.rpb('RCDR_CVR_ERASE', 15, 14, 14, { label: 'CVR ERASE' });
  p.rpb('RCDR_CVR_TEST', 47, 14, 14, { label: 'CVR TEST' });
  // OXYGEN
  p.section('OXYGEN', -2);
  p.pb('OXY_HIGH_ALT_LDG', -52, -28, { label: ['HIGH ALT', 'LDG'] });
  p.pb('OXY_MASK_MAN_ON', -19, -28);
  p.label('MASK MAN ON', -19, -10.5, 1.9);
  p.ann('OXY_PAX_SYS_ON', 14.5, -28, 19, 19);
  p.label('PASSENGER', 14.5, -14, 1.9);
  p.line([[30, -40], [30, -15]], 0.6);
  p.pb('OXY_CREW_SUPPLY', 49, -28, { label: ['CREW', 'SUPPLY'] });
  // CALLS
  p.section('CALLS', -46);
  ([['CALLS_MECH', 'MECH', -53], ['CALLS_ALL', 'ALL', -28], ['CALLS_FWD', 'FWD', -3], ['CALLS_AFT', 'AFT', 22]] as Array<[string, string, number]>)
    .forEach(([id, l, x]) => p.rpb(id, x, -70, 15, { label: l }));
  p.pb('CALLS_EMER', 49, -70);
  p.label('EMER', 49, -52.5, 1.9);
  // RAIN RPLNT + WIPER
  p.section('', -87);
  p.label('RAIN RPLNT', -17.5, -94, 2.5);
  p.rpb('RAIN_RPLNT_CAPT', -17.5, -108, 15);
  p.label('WIPER', 37, -91.5, 2.2);
  p.rot('WIPER_CAPT', 37, -117, { white: true, size: 9, angles: [-10, 42, 90], pos: [['OFF', -3, 19.5], ['SLOW', 15.5, 13.5, 'left'], ['FAST', 20.5, -0.5, 'left']] });
  scaleArc(p, 37, -117, 13, -10, 90, [42]);
  return p.finish();
};

/* ================================================================== */
/* CENTRE COLUMN                                                        */
/* ================================================================== */

const fire: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_FIRE', CTR_W, h);
  p.edge('FIRE', -1);
  p.edge('FIRE', 1);
  for (const s of [-1, 1] as const) {
    const e = s < 0 ? 1 : 2;
    const xo = s * 139, xf = s * 95, xi = s * 50;
    p.pb(`FIRE_ENG${e}_AGENT${s < 0 ? 1 : 2}`, xo, 9, { label: `AGENT ${s < 0 ? 1 : 2}` });
    p.pb(`FIRE_ENG${e}_AGENT${s < 0 ? 2 : 1}`, xi, 9, { label: `AGENT ${s < 0 ? 2 : 1}` });
    p.rpb(`FIRE_ENG${e}_TEST`, xo, -22, 11, { label: 'TEST', labelDy: 10 });
    fireFrame(p, xf, -3, 44, 28);
    fireGuardLook(p.pb(`FIRE_ENG${e}_PB`, xf, -3, { w: 44, h: 28, outWhenOn: true }));
    p.label(`ENG ${e}`, xf, 24.5, 4.0, { weight: 700 });
    p.line([[s * 36, -31], [s * 36, 34]], 0.6);
    p.line([[s * 36, -34.5], [s * 150, -34.5]], 0.6);
  }
  // APU
  fireFrame(p, 0, 8, 44, 28);
  fireGuardLook(p.pb('FIRE_APU_PB', 0, 8, { w: 44, h: 28, outWhenOn: true }));
  p.label('APU', 0, 31.5, 3.6, { weight: 700 });
  p.pb('FIRE_APU_AGENT', -22, -25);
  p.label('AGENT', -8.5, -26, 1.9, { align: 'left' });
  p.rpb('FIRE_APU_TEST', 21, -26, 10, { label: 'TEST', labelDy: 10.5 });
  return p.finish();
};

const hydFuel: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_HYD_FUEL', CTR_W, h);
  p.edge('HYD', -1, 34, 26);
  p.edge('HYD', 1, 34, 26);
  p.edge('FUEL', -1, -34, 26);
  p.edge('FUEL', 1, -34, 26);
  p.line([[-150, -1.5], [150, -1.5]], 0.6);
  p.line([[-150, -64.5], [150, -64.5]], 0.6);

  /* ---------------- HYD ---------------- */
  p.box('GREEN', -96, 60, 20);
  p.box('BLUE', 0, 60, 16);
  p.box('YELLOW', 96, 60, 21);
  p.pb('HYD_ENG1_PUMP', -96, 12);
  p.gbracket(-108, -84, 31);
  p.label('ENG 1 PUMP', -96, 27.2, 1.9);
  p.gline([[-96, 31], [-96, 55]]);
  p.garrow(-96, 57.2, 'u');

  p.pb('HYD_RAT_MAN_ON', -49, 12);
  p.label('RAT MAN ON', -52, 43, 1.9);
  p.gline([[-40, 45.5], [-37, 45.5], [-37, 40.5], [-40, 40.5]]);
  p.gline([[-37, 43], [-1, 43]]);
  p.garrow(-18, 43, 'r');

  p.pb('HYD_BLUE_ELEC_PUMP', 0, 12);
  p.gbracket(-12, 12, 31);
  p.label('ELEC PUMP', 0, 27.2, 1.9);
  p.vtext('AUTO', 14.5, 12, 1.7);
  p.gline([[0, 31], [0, 55]]);
  p.garrow(0, 57.2, 'u');

  p.pb('HYD_PTU', 49, 30);
  p.vtext('AUTO', 63.5, 30, 1.7);
  p.box('PTU', 49, 51, 11, 5.2, 1.9);
  p.gline([[49, 48.4], [49, 42.2]]);

  p.pb('HYD_ENG2_PUMP', 96, 12);
  p.gbracket(84, 108, 31);
  p.label('ENG 2 PUMP', 96, 27.2, 1.9);
  p.gline([[96, 31], [96, 55]]);
  p.garrow(96, 57.2, 'u');

  p.pb('HYD_YELLOW_ELEC_PUMP', 131, 12);
  p.gbracket(120, 142, 31);
  p.label('ELEC PUMP', 131, 27.2, 1.9);
  p.gline([[131, 31], [131, 41], [99, 41]]);
  p.garrow(96.4, 41, 'l');

  // GREEN ← PTU → YELLOW transfer line (behind the BLUE feed)
  p.gline([[-96, 51], [43.5, 51]]);
  p.gline([[54.5, 51], [96, 51]]);
  p.garrow(-68, 51, 'l');
  p.garrow(24, 51, 'l');
  p.garrow(76, 51, 'r');

  /* ---------------- FUEL ---------------- */
  p.box('ENG 1', -95, -9.5, 15);
  p.box('APU', -28, -9.5, 12);
  p.box('ENG 2', 95, -9.5, 15);
  p.pb('FUEL_XFEED', 0, -19, { label: 'X FEED' });
  p.gline([[-95, -20.5], [-12.5, -20.5]]);
  p.gline([[12.5, -20.5], [95, -20.5]]);
  for (const x of [-95, -28, 95]) { p.gline([[x, -20.5], [x, -14.6]]); p.garrow(x, -12.3, 'u'); }

  p.pb('FUEL_L_PUMP1', -109, -48.5);
  p.pb('FUEL_L_PUMP2', -83, -48.5);
  p.gbracket(-121, -71, -29, 2.2, 'L TK PUMPS');
  p.gline([[-95, -20.5], [-95, -27.7]]);
  p.label('1', -109, -33.2, 1.8);
  p.label('2', -83, -33.2, 1.8);

  p.pb('FUEL_CTR_PUMP1', -28, -48.5);
  p.gbracket(-40, -16, -29);
  p.gline([[-28, -20.5], [-28, -29]]);
  p.label('PUMP 1', -28, -33, 1.8);
  p.label('CTR TK', -19.5, -25.2, 1.7);

  p.pb('FUEL_MODE_SEL', 0, -48.5, { label: 'MODE SEL' });

  p.pb('FUEL_CTR_PUMP2', 28, -48.5);
  p.gbracket(16, 40, -29);
  p.gline([[28, -20.5], [28, -29]]);
  p.label('PUMP 2', 28, -33, 1.8);
  p.label('CTR TK', 19.5, -25.2, 1.7);

  p.pb('FUEL_R_PUMP1', 83, -48.5);
  p.pb('FUEL_R_PUMP2', 109, -48.5);
  p.gbracket(71, 121, -29, 2.2, 'R TK PUMPS');
  p.gline([[95, -20.5], [95, -27.7]]);
  p.label('1', 83, -33.2, 1.8);
  p.label('2', 109, -33.2, 1.8);
  return p.finish();
};

const elec: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_ELEC', CTR_W, h);
  p.edge('ELEC', -1, 0, 30);
  p.edge('ELEC', 1, 0, 30);
  p.line([[-150, -47.5], [150, -47.5]], 0.6);

  p.pb('ELEC_COMMERCIAL', -127, 32, { label: 'COMMERCIAL' });
  p.pb('ELEC_GALY_CAB', -127, 3);
  p.label('GALY & CAB', -127, 17.2, 1.9);
  p.vtext('AUTO', -112.5, 3, 1.7);
  p.pb('ELEC_IDG1', -127, -30);
  p.label('IDG 1', -127, -12.8, 1.9);
  p.pb('ELEC_IDG2', 127, -30);
  p.label('IDG 2', 127, -12.8, 1.9);

  // batteries
  p.screen('ELEC_BAT1_V', -52, 28, 24, 9.5);
  p.label('BAT 1', -52, 40, 1.9);
  p.screen('ELEC_BAT2_V', 36, 28, 24, 9.5);
  p.label('BAT 2', 36, 40, 1.9);
  p.pb('ELEC_BAT1', -20, 27);
  p.pb('ELEC_BAT2', 3.6, 27);
  p.label('1', -20, 41, 1.9);
  p.label('BAT', -8.2, 41, 1.9);
  p.label('2', 3.6, 41, 1.9);
  p.pb('ELEC_AC_ESS_FEED', 68, 18, { label: 'AC ESS FEED' });

  // bus boxes
  p.box('DC BUS 1', -97, 38, 18);
  p.box('AC BUS 1', -97, 10, 18);
  p.box('AC ESS BUS', 0, 10, 22);
  p.box('DC BUS 2', 97, 38, 18);
  p.box('AC BUS 2', 97, 10, 18);

  p.pb('ELEC_BUS_TIE', 0, -17, { label: 'BUS TIE' });
  p.vtext('AUTO', 14.5, -17, 1.7);
  p.pb('ELEC_GEN1', -97, -32);
  p.gbracket(-109, -85, -13.5, 2);
  p.label('GEN 1', -97, -17.1, 1.9);
  p.pb('ELEC_APU_GEN', -42, -32, { label: 'APU GEN' });
  p.pb('ELEC_EXT_PWR', 42, -32, { label: 'EXT PWR' });
  p.pb('ELEC_GEN2', 97, -32);
  p.gbracket(85, 109, -13.5, 2);
  p.label('GEN 2', 97, -17.1, 1.9);

  // synoptic
  for (const s of [-1, 1]) {
    const x = s * 97;
    // TR: AC BUS → DC BUS
    p.gline([[x, 12.8], [x, 33]]);
    p.garrow(x, 35.2, 'u');
    p.gline([[x - 3, 23.6], [x + 3, 23.6]], 0.6);
    p.gline([[x - 3, 22.2], [x + 3, 22.2]], 0.6);
    // AC BUS → AC ESS BUS
    p.gline([[s * 88, 10], [s * 13.5, 10]]);
    p.garrow(s * 11.1, 10, s < 0 ? 'r' : 'l');
    // AC BUS ↔ GEN
    p.gline([[x, 7.2], [x, -13.5]]);
    // bus tie line
    p.gline([[x, -6], [s * 12.2, -6]]);
    // IDG → GEN
    p.gline([[s * 115.3, -33], [s * 108.8, -33]]);
    // APU GEN / EXT PWR → BUS TIE
    p.gline([[s * 30.2, -36], [s * 5, -36], [s * 5, -29]]);
  }
  return p.finish();
};

const airCond: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_AIRCOND', CTR_W, h);
  p.edge('AIR COND', -1, 0, 34, 2.8);
  p.edge('AIR COND', 1, 0, 34, 2.8);
  p.line([[-150, -53.5], [150, -53.5]], 0.6);

  p.label('PACK FLOW', -123, 51, 2.1);
  p.rot('AIR_PACK_FLOW', -123, 25, { white: true, size: 9, pos: [['LO', -16, 10.5], ['NORM', 0, 19.5], ['HI', 16, 10.5]] });
  scaleArc(p, -123, 25, 12, -45, 45, [0]);
  p.pb('AIR_PACK1', -131, -6, { label: 'PACK 1' });
  p.pb('AIR_HOT_AIR', 121, 25, { label: 'HOT AIR' });
  p.pb('AIR_PACK2', 131, -6, { label: 'PACK 2' });

  const zones: Array<[string, string, number, number]> = [['AIR_TEMP_CKPT', 'COCKPIT', -49, 20], ['AIR_TEMP_FWD', 'FWD CABIN', 0, 22], ['AIR_TEMP_AFT', 'AFT CABIN', 49, 22]];
  for (const [id, name, x, bw] of zones) {
    p.pot(id, x, 22, { white: true, size: 9.5, from: -125, to: 125, scale: ['COLD', 'HOT'], labelRadius: 18.5 });
    for (let a = -100; a <= 100; a += 25) {
      const s = Math.sin(a * Math.PI / 180), c = Math.cos(a * Math.PI / 180);
      p.line([[x + s * 13.8, 22 + c * 13.8], [x + s * 15.3, 22 + c * 15.3]], 0.4);
    }
    p.box(name, x, 49, bw);
    p.gline([[x, 7.5], [x, 12]]);
    p.gline([[x, 40.5], [x, 44.2]]);
    p.garrow(x, 46.2, 'u', 2.0);
  }

  p.box('PACK 1', -93, -1, 16);
  p.box('PACK 2', 99, -1, 16);
  // mixer / pack outlet duct
  p.gline([[-93, 7.5], [99, 7.5]]);
  p.gline([[-93, 1.8], [-93, 7.5]]);
  p.gline([[99, 1.8], [99, 7.5]]);
  // bleed duct with the RAM AIR crossing hump and the X BLEED valve
  p.gline([[-93, -9], [-47.6, -9]]);
  p.garc(-45, -9, 2.6, -90, 90);
  p.gline([[-42.4, -9], [44.8, -9]]);
  p.gcircle(49, -9, 4.2);
  p.gline([[53.2, -9], [99, -9]]);
  for (const x of [-93, 99]) {
    p.gline([[x, -17.5], [x, -3.8]]);
    p.garrow(x, -3.8, 'u', 2.0);
  }
  p.pb('AIR_ENG1_BLEED', -93, -35);
  p.gbracket(-105, -81, -17.5);
  p.label('ENG 1 BLEED', -93, -21, 1.9);
  p.pb('AIR_ENG2_BLEED', 99, -35);
  p.gbracket(87, 111, -17.5);
  p.label('ENG 2 BLEED', 99, -21, 1.9);
  // START taps
  for (const x of [-68, 72]) {
    p.gline([[x, -9], [x, -12]]);
    p.garrow(x, -14.2, 'd', 2.0);
    p.label('START', x, -17.3, 1.8);
  }
  // RAM AIR
  p.pb('AIR_RAM_AIR', -45, -35);
  p.gbracket(-54, -36, -13, 1.4);
  p.label('RAM AIR', -45, -15.6, 1.8);
  p.gline([[-45, -13], [-45, 5.5]]);
  p.garrow(-45, 7.5, 'u', 2.0);
  // GND HP
  p.gbracket(-26, -14, -13, 1.4);
  p.label('GND HP', -20, -15.6, 1.8);
  p.gline([[-20, -13], [-20, -11.4]]);
  p.garrow(-20, -9.4, 'u', 2.0);
  // APU BLEED
  p.pb('AIR_APU_BLEED', 0, -35);
  p.gbracket(-12, 12, -17.5);
  p.label('APU BLEED', 0, -21, 1.9);
  p.gline([[0, -17.5], [0, -11.6]]);
  p.garrow(0, -9.6, 'u', 2.0);
  // X BLEED
  p.label('X BLEED', 49, 1.6, 1.9);
  p.rot('AIR_XBLEED', 49, -36, { white: true, size: 8.5, pos: [['SHUT', -16, 11], ['AUTO', 0, 18.5], ['OPEN', 16, 11]] });
  scaleArc(p, 49, -36, 11.8, -45, 45, [0]);
  return p.finish();
};

/** ANTI ICE, PROBE/WINDOW HEAT, CABIN PRESS / EXT LT, APU, INT LT, SIGNS (chamfered forward corners). */
const lower: Build = (app, h) => {
  const H = h / 2;
  const p = new Plate(app, 'OVHD_LOWER', CTR_W, h, {
    outline: [[-164, H], [164, H], [164, -H + 15], [149, -H], [-149, -H], [-164, -H + 15]],
    screws: [[-158.5, H - 5.5], [158.5, H - 5.5], [-158.5, -H + 20], [158.5, -H + 20], [-100, -H + 5.5], [100, -H + 5.5]],
  });
  /* --- top row: ANTI ICE, PROBE/WINDOW HEAT, CABIN PRESS --- */
  p.label('ANTI ICE', -90, 68, 2.8);
  p.pb('AI_WING', -137, 44, { label: 'WING' });
  p.line([[-122, 31], [-122, 62]], 0.6);
  p.pb('AI_ENG1', -72, 44, { label: 'ENG 1' });
  p.pb('AI_ENG2', -43, 44, { label: 'ENG 2' });
  p.line([[-27.5, 31], [-27.5, 66]], 0.6);
  p.label(['PROBE/WINDOW', 'HEAT'], 0, 62.5, 2.4);
  p.pb('AI_PROBE_WINDOW', 0, 44);
  p.vtext('AUTO', 14.5, 44, 1.7);
  p.line([[24, 31], [24, 66]], 0.6);
  p.label('CABIN PRESS', 70, 68, 2.8);
  p.sw('PRESS_MAN_VS', 40, 44, { label: 'MAN V/S CTL', labelDy: 15, pos: [['UP', 13.5, 8, 'left'], ['DN', 13.5, -8, 'left']] });
  p.pb('PRESS_MODE_SEL', 70, 44, { label: 'MODE SEL' });
  // LDG ELEV: AUTO at 12 o'clock, −2 … 14 (×1000 ft) clockwise
  const ldgAngles = [0, ...Array.from({ length: 17 }, (_, i) => 30 + i * 18.75)];
  p.rot('PRESS_LDG_ELEV', 104, 44, { white: true, size: 8, angles: ldgAngles, pos: [['AUTO', 0, 16.2]] });
  p.label('LDG ELEV', 104, 66.5, 2.1);
  ldgAngles.forEach((a, i) => {
    const s = Math.sin(a * Math.PI / 180), c = Math.cos(a * Math.PI / 180);
    p.line([[104 + s * 10.2, 44 + c * 10.2], [104 + s * (i % 2 === 1 ? 12.6 : 11.6), 44 + c * (i % 2 === 1 ? 12.6 : 11.6)]], 0.4);
    const v = i - 3; // i=1 → −2
    if (i >= 1 && v % 2 === 0) p.label(String(v), 104 + s * 15.2, 44 + c * 15.2, 1.45);
  });
  p.pb('PRESS_DITCHING', 137, 44);
  p.label('DITCHING', 137, 61.5, 1.9);
  p.line([[-158, 24], [158, 24]], 0.6);

  /* --- EXT LT --- */
  p.label('EXT LT', -92, 17.5, 2.8);
  p.sw('EXTLT_STROBE', -139, -1, { label: 'STROBE', labelDy: 17.5, pos: [['ON', 0, 12.5], ['OFF', 0, -12.5]] });
  p.vtext('AUTO', -128.2, -1, 1.6);
  p.sw('EXTLT_BEACON', -108, -1, { label: 'BEACON', labelDy: 17.5, pos: [['ON', 0, 12.5], ['OFF', 0, -12.5]] });
  p.sw('EXTLT_WING', -76, -1, { label: 'WING', labelDy: 17.5, pos: [['ON', 0, 12.5], ['OFF', 0, -12.5]] });
  const nav = getControl('EXTLT_NAV_LOGO')!.pos!;
  p.sw('EXTLT_NAV_LOGO', -40, -1, { label: 'NAV & LOGO', labelDy: 17.5, pos: [[nav[0], 0, 12.5], [nav[1], 10.5, 0, 'left'], [nav[2], 0, -12.5]] });
  p.sw('EXTLT_RWY_TURNOFF', -137, -40, { label: 'RWY TURN OFF', labelDy: 17, pos: [['ON', 0, 12.5], ['OFF', 0, -12.5]] });
  for (const [id, x, s] of [['EXTLT_LAND_L', -104, 'L'], ['EXTLT_LAND_R', -72, 'R']] as Array<[string, number, string]>) {
    const r = p.sw(id, x, -40, { pos: [[s, 0, 13]] });
    addPaddle(r);
  }
  p.p.bracket('LAND', -104 * MM, -72 * MM, -22.5 * MM, { size: 2.0 * MM, drop: 2.2 * MM });
  p.label('ON', -88, -29.5, 1.8);
  p.label('OFF', -88, -40, 1.8);
  p.label('RETRACT', -88, -51.5, 1.7);
  // retractable landing light symbols
  for (const x of [-104, -72]) {
    p.arc(x, -58.5, 2.6, -90, 90, 0.4);
    p.line([[x - 2.6, -58.5], [x + 2.6, -58.5]], 0.4);
    p.line([[x, -58.2], [x, -55.2]], 0.4);
  }
  p.sw('EXTLT_NOSE', -40, -40, { label: 'NOSE', labelDy: 16.5, pos: [['T.O', 10.5, 9, 'left'], ['TAXI', 10.5, 0, 'left'], ['OFF', 10.5, -9, 'left']] });
  p.line([[-19, -66], [-19, 21]], 0.6);

  /* --- APU --- */
  p.label('APU', 0, 17.5, 2.8);
  p.pb('APU_MASTER', 0, -4, { label: 'MASTER SW' });
  p.pb('APU_START', 0, -40, { label: 'START' });
  p.line([[19, -66], [19, 21]], 0.6);

  /* --- INT LT --- */
  p.label('INT LT', 88, 18.5, 2.8);
  p.pot('INTLT_OVHD_INTEG', 36, -1, { white: true, size: 8, from: -130, to: 130, scale: ['OFF', 'BRT'], labelRadius: 15.5, label: 'OVHD INTEG LT', labelDy: 14 });
  p.sw('INTLT_ICE_IND', 68, -1, { label: ['ICE IND &', 'STBY COMPASS'], labelDy: 14.5, pos: [] });
  p.sw('INTLT_DOME', 97, -1, { label: 'DOME', labelDy: 12, pos: [['BRT', 10, 9, 'left'], ['DIM', 10, 0, 'left'], ['OFF', 10, -9, 'left']] });
  p.sw('INTLT_ANN_LT', 130, -1, { label: 'ANN LT', labelDy: 12, pos: [['TEST', 10, 9, 'left'], ['BRT', 10, 0, 'left'], ['DIM', 10, -9, 'left']] });

  /* --- SIGNS --- */
  p.section('SIGNS', -19, { x0: 22, x1: 160, cx: 50, size: 2.6 });
  p.sw('SIGNS_SEAT_BELTS', 36, -42, { label: 'SEAT BELTS', labelDy: 17.5, pos: [['ON', 0, 12.5], ['OFF', 0, -12.5]] });
  p.sw('SIGNS_NO_SMOKING', 65, -42, { label: 'NO SMOKING', labelDy: 17.5, pos: [['ON', 0, 12.5], ['OFF', 0, -12.5]] });
  p.vtext('AUTO', 75.5, -42, 1.6);
  p.line([[84, -26], [84, -62]], 0.6);
  // EMER EXIT LT: amber OFF light beside the selector
  p.ann('SIGNS_EMER_EXIT_LT_OFF', 97, -42, 12.2, 12.2);
  p.label('EMER EXIT LT', 112, -24.5, 1.9);
  p.sw('SIGNS_EMER_EXIT_LT', 124, -42, { pos: [['ON', 10, 9, 'left'], ['ARM', 10, 0, 'left'], ['OFF', 10, -9, 'left']] });
  return p.finish();
};

/* ================================================================== */
/* RIGHT COLUMN                                                         */
/* ================================================================== */

const acp3: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_ACP3', SIDE_W, h);
  const tx = ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2', 'INT', 'CAB'];
  const names = ['VHF 1', 'VHF 2', 'VHF 3', 'HF 1', 'HF 2', 'INT', 'CAB'];
  tx.forEach((k, i) => {
    const x = -52.5 + i * 17.5;
    p.pb(`ACP3_TX_${k}`, x, 33, { w: 12.5, h: 10 });
    p.label(names[i], x, 23, 1.7);
    p.pot(`ACP3_RX_${k}`, x, 13.5, { style: 'round', size: 5 });
  });
  p.sw('ACP3_INT_RAD', -50, -5, { collar: false, length: 11, pos: [['INT', 0, 10], ['RAD', 8.5, -8.5, 'left']] });
  p.pb('ACP3_VOICE', -24, -6, { w: 12.5, h: 9, capText: 'VOICE' });
  p.pb('ACP3_RESET', -5, -6, { w: 12.5, h: 9, capText: 'RESET' });
  p.pot('ACP3_RX_PA', 22, -4, { style: 'round', size: 5 });
  p.label('PA', 22, -13, 1.7);
  p.pb('ACP3_TX_PA', 47, -6, { w: 14, h: 10 });
  const rx = ['VOR1', 'VOR2', 'MKR', 'ILS', 'ADF1', 'ADF2'];
  const rn = ['VOR 1', 'VOR 2', 'MKR', 'ILS', 'ADF 1', 'ADF 2'];
  rx.forEach((k, i) => {
    const x = -50 + i * 20;
    p.pot(`ACP3_RX_${k}`, x, -28, { style: 'round', size: 5 });
    p.label(rn[i], x, -18.5, 1.7);
  });
  return p.finish();
};

const fltCtlR: Build = (app, h) => {
  const p = new Plate(app, 'OVHD_FLTCTL_R', SIDE_W, h);
  p.label('FLT CTL', 0, 17.5, 2.8);
  p.pb('FLTCTL_ELAC2', -43, -7, { label: 'ELAC 2' });
  p.pb('FLTCTL_SEC2', -14.5, -7, { label: 'SEC 2' });
  p.pb('FLTCTL_SEC3', 14.5, -7, { label: 'SEC 3' });
  p.pb('FLTCTL_FAC2', 43, -7, { label: 'FAC 2' });
  return p.finish();
};

/** CARGO VENT / CARGO SMOKE / VENTILATION / ENG MAN START + N1 MODE / WIPER + RAIN RPLNT. */
const rightLower: Build = (app, h) => {
  const H = h / 2;
  const p = new Plate(app, 'OVHD_RIGHT_LOWER', SIDE_W, h, {
    outline: [[-73, H], [73, H], [73, -H + CHAMFER], [-73, -H]],
    screws: [[-67.5, H - 5.5], [67.5, H - 5.5], [-67.5, 40], [67.5, 40], [-67.5, -60], [67.5, -60], [-67.5, -H + 5.5], [67.5, -H + CHAMFER + 7]],
  });
  // CARGO VENT
  p.label('CARGO VENT', -3, H - 10, 2.8);
  p.line([[-3, 96], [-3, H - 16]], 0.6);
  p.pb('CARGO_VENT_AFT_ISOL', 47, 121, { label: 'AFT ISOL VALVE' });
  // CARGO SMOKE
  p.section('CARGO SMOKE', 80);
  for (const s of [-1, 1] as const) {
    const id = s < 0 ? 'CARGO_SMOKE_FWD_DISCH' : 'CARGO_SMOKE_AFT_DISCH';
    p.pb(id, s * 49, 52, { legends: [leg(id, 1)] });
    p.label('DISCH', s * 49, 69.5, 1.9);
    p.lamp(s * 25, 52, [leg(id, 0)], { w: 13, h: 13 });
    p.label(s < 0 ? 'FWD' : 'AFT', s * 25, 62.8, 1.9);
  }
  p.rpb('CARGO_SMOKE_TEST', 0, 52, 12, { label: 'TEST', labelDy: 11.5 });
  // VENTILATION
  p.section('VENTILATION', 28);
  p.pb('VENT_BLOWER', -51, 0, { label: 'BLOWER' });
  p.vtext('AUTO', -37, 0, 1.7);
  p.pb('VENT_EXTRACT', -19, 0, { label: 'EXTRACT' });
  p.vtext('AUTO', -5, 0, 1.7);
  p.line([[30, -11], [30, 17]], 0.6);
  p.pb('VENT_CAB_FANS', 48, 0, { label: 'CAB FANS' });
  // ENG
  p.section('', -19);
  p.label(['ENG', 'MAN START'], -35.5, -26.3, 2.0);
  p.label(['ENG', 'N1 MODE'], 33, -26.3, 2.0);
  p.pb('ENG_MAN_START1', -52, -48, { label: '1' });
  p.pb('ENG_MAN_START2', -19, -48, { label: '2' });
  p.line([[-1.5, -60], [-1.5, -37]], 0.6);
  p.pb('ENG_N1_MODE1', 17, -48, { label: '1' });
  p.pb('ENG_N1_MODE2', 49, -48, { label: '2' });
  // WIPER + RAIN RPLNT (F/O)
  p.section('', -66);
  p.label('WIPER', -33, -73.5, 2.2);
  p.rot('WIPER_FO', -33, -98, { white: true, size: 9, angles: [-10, 42, 90], pos: [['OFF', -3, 19.5], ['SLOW', 15.5, 13.5, 'left'], ['FAST', 20.5, -0.5, 'left']] });
  scaleArc(p, -33, -98, 13, -10, 90, [42]);
  p.label('RAIN RPLNT', 16, -74.5, 2.4);
  p.rpb('RAIN_RPLNT_FO', 16, -88, 15);
  return p.finish();
};

/* ================================================================== */

export function buildForward(app: App, root: THREE.Group): void {
  // centre column
  stack(app, root, COL_X.C, Y_AFT, [
    [CTR_H[0], blank('OVHD_C_TOP', CTR_W)],
    [CTR_H[1], fire],
    [CTR_H[2], hydFuel],
    [CTR_H[3], elec],
    [CTR_H[4], airCond],
    [CTR_H[5], lower],
  ]);
  // left column: 20 + 45 + 128 + 34 + 48 + lower
  const lTop = [20, 45, 128, 34, 48];
  const lLow = SIDE_D - lTop.reduce((a, b) => a + b, 0) - GAP * lTop.length;
  stack(app, root, COL_X.L, Y_AFT, [
    [lTop[0], (a, h) => new Plate(a, 'OVHD_L_TOP', SIDE_W, h, { screws: [[-67.5, 0], [67.5, 0]] }).finish()],
    [lTop[1], paVideo],
    [lTop[2], adirs],
    [lTop[3], blank('OVHD_L_BLANK', SIDE_W)],
    [lTop[4], fltCtlL],
    [lLow, leftLower],
  ]);
  // right column: 90 + 80 + 100 + 48 + lower
  const rTop = [90, 80, 100, 48];
  const rLow = SIDE_D - rTop.reduce((a, b) => a + b, 0) - GAP * rTop.length;
  stack(app, root, COL_X.R, Y_AFT, [
    [rTop[0], acp3],
    [rTop[1], blank('OVHD_R_BLANK1', SIDE_W)],
    [rTop[2], blank('OVHD_R_BLANK2', SIDE_W)],
    [rTop[3], fltCtlR],
    [rLow, rightLower],
  ]);
}
