/**
 * Flat-section pedestal panels: lighting (captain / F/O with AIDS & DFDR), WX radar, ATC / TCAS, cockpit door,
 * RUD TRIM, PARKING BRK plate, gravity gear extension, printer. Positions in mm from each plate centre.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { Plate, toggle, m, pedMats, DEG, canvasTexture, extrudeZ } from './lib';
import { XPDR_CANVAS, RUD_CANVAS } from './displays';

/** Knob scale ticks + labels helper: angle in degrees clockwise from 12 o'clock. */
function tick(pl: Plate, x: number, y: number, a: number, r0: number, r1: number, w = 0.45): void {
  const s = Math.sin(a * DEG), c = Math.cos(a * DEG);
  pl.line([[x + s * r0, y + c * r0], [x + s * r1, y + c * r1]], w);
}
function atAngle(pl: Plate, t: string, x: number, y: number, a: number, r: number, size = 1.8): void {
  pl.label(t, x + Math.sin(a * DEG) * r, y + Math.cos(a * DEG) * r, size);
}

/** Lighting knob (light grey knurled) with the OFF → BRT arc and arrow. */
function lightKnob(pl: Plate, id: string, x: number, y: number): void {
  const PM = pedMats();
  pl.pot(id, x, y, { style: 'round', size: 7.2, from: -135, to: 135, material: PM.knobGreyKnurl });
  const r = 11.5;
  pl.arc(x, y, r, -128, 128, 0.55);
  pl.arrowHead(x + Math.sin(128 * DEG) * r, y + Math.cos(128 * DEG) * r, 218, 2);
  pl.label('OFF', x - 11.5, y - 12.5, 2.0);
  pl.label('BRT', x + 11.5, y - 12.5, 2.0);
}

export function buildLightingCapt(app: App): THREE.Group {
  const pl = new Plate(app, 'PED_LIGHTING', 146, 47.6);
  pl.label('FLOOD LT', -42.8, 18.6, 2.9);
  pl.label('MAIN PNL', -42.8, 13.4, 2.0);
  lightKnob(pl, 'FLOOD_MAIN_PNL', -42.8, -2.2);
  pl.label('INTEG LT', -1.5, 18.6, 2.9);
  pl.label('MAIN PNL & PED', -1.5, 13.4, 2.0);
  lightKnob(pl, 'INTEG_MAIN_PNL_PED', -1.5, -2.2);
  return pl.finish();
}

export function buildLightingFo(app: App): THREE.Group {
  const pl = new Plate(app, 'PED_LIGHTING_FO', 146, 47.6);
  pl.label('FLOOD LT', -42.8, 18.6, 2.9);
  pl.label('PED', -42.8, 13.4, 2.0);
  lightKnob(pl, 'FLOOD_PED', -42.8, -2.2);
  pl.line([[-17.9, -19], [-17.9, 20]], 0.55);
  pl.line([[22, -19], [22, 20]], 0.55);
  pl.label('AIDS', 2.2, 18.6, 2.9);
  pl.label('PRINT', 2.2, 13.4, 2.0);
  pl.rpb('AIDS_PRINT', 2.2, -3.5, 12.5);
  pl.label('DFDR', 44, 18.6, 2.9);
  pl.label('EVENT', 44, 13.4, 2.0);
  pl.rpb('DFDR_EVENT', 44, -3.5, 12.5);
  return pl.finish();
}

export function buildWxr(app: App): THREE.Group {
  const pl = new Plate(app, 'PED_WXR', 146, 66.7);
  // GAIN (CAL at 12 o'clock)
  const gx = -45, gy = 4.5;
  pl.pot('WXR_GAIN', gx, gy, { style: 'round', size: 6.4, from: -135, to: 135 });
  pl.label('GAIN', gx, gy + 20.5, 2.6);
  const gains: Array<[string, number]> = [['-12', -102], ['-9', -78], ['-6', -54], ['-3', -28], ['CAL', 0], ['+4', 30], ['+8', 58], ['+12', 88]];
  for (const [t, a] of gains) { tick(pl, gx, gy, a, 8.6, 10.2, 0.5); atAngle(pl, t, gx, gy, a, 13.4, 1.8); }
  pl.label('MIN', gx - 11, gy - 13.5, 2.1);
  pl.label('MAX', gx + 11, gy - 13.5, 2.1);
  tick(pl, gx, gy, -135, 8.6, 10.6, 0.6);
  tick(pl, gx, gy, 135, 8.6, 10.6, 0.6);
  // GCS
  toggle(pl, 'WXR_GCS', 0, 20, { angles: [24, -24], horizontal: true, length: 11 });
  pl.label('GCS', 0, 28.2, 2.4);
  pl.label('OFF', -9.5, 20, 1.9, { align: 'right' });
  pl.label('AUTO', 9.5, 20, 1.9, { align: 'left' });
  // TILT (0 at 9 o'clock, UP clockwise toward 1:30, DN counter-clockwise toward 4:30)
  const tx = 40, ty = 4.5;
  pl.pot('WXR_TILT', tx, ty, { style: 'round', size: 6.4, from: -225, to: 45 });
  pl.label('TILT', tx, ty + 20.5, 2.6);
  for (let t = -15; t <= 15; t++) {
    const a = -90 + t * 9;
    const major = t % 5 === 0;
    tick(pl, tx, ty, a, 8.6, major ? 10.8 : 9.8, major ? 0.55 : 0.4);
  }
  atAngle(pl, '15', tx, ty, 45, 13.6, 1.8);
  atAngle(pl, '5', tx, ty, -45, 13.2, 1.8);
  atAngle(pl, '0', tx, ty, -90, 13.2, 1.8);
  atAngle(pl, '5', tx, ty, -135, 13.2, 1.8);
  atAngle(pl, '15', tx, ty, -225, 13.6, 1.8);
  pl.label('UP', tx + 16, ty + 2.4, 1.9, { align: 'left' });
  pl.label('DN', tx + 16, ty - 2.4, 1.9, { align: 'left' });
  // MODE
  const mx = -1.5, my = -9;
  pl.rot('WXR_MODE', mx, my, { size: 7, angles: [-90, -45, 0, 45], ticks: false, pos: [
    ['WX', -15.5, 0, 'right'], ['WX+T', -11.5, 9.5, 'right'], ['TURB', 0, 13.8], ['MAP', 11.5, 9.5, 'left'],
  ] });
  for (const a of [-90, -45, 0, 45]) tick(pl, mx, my, a, 9.2, 11, 0.5);
  pl.label('MODE', mx, my + 19.5, 2.6);
  // SYS 1 / OFF / 2
  toggle(pl, 'WXR_SYS', -27.5, -22, { angles: [-24, 0, 24], horizontal: true, length: 11 });
  pl.label('1', -36, -22, 2.1);
  pl.label('2', -19, -22, 2.1);
  pl.label('OFF', -27.5, -13.8, 2.0);
  pl.label('SYS', -27.5, -29.5, 2.4);
  // PWS
  toggle(pl, 'WXR_PWS', 26, -22, { angles: [24, -24], horizontal: true, length: 11 });
  pl.label('OFF', 16.5, -22, 1.9, { align: 'right' });
  pl.label('AUTO', 35.5, -22, 1.9, { align: 'left' });
  pl.label('PWS', 26, -29.5, 2.4);
  return pl.finish();
}

export function buildAtc(app: App): THREE.Group {
  const pl = new Plate(app, 'PED_ATC', 146, 66.7);
  pl.vtext('ATC', -66.5, 1, 2.6, 3.6);
  pl.vtext('TCAS', 67, 1, 2.6, 3.6);
  // mode STBY / AUTO / ON
  const kx = -50;
  pl.rot('XPDR_MODE', kx, 17, { white: true, size: 5.8, angles: [-55, 0, 55], ticks: false, pos: [['STBY', -8.5, 5.5, 'right'], ['AUTO', 0, 9.8], ['ON', 8.5, 5.5, 'left']] });
  pl.rot('XPDR_SYS', kx, -1, { white: true, size: 5.8, angles: [-45, 45], ticks: false, pos: [['1', -8, 5.8], ['2', 8, 5.8]] });
  pl.rot('XPDR_ALT_RPTG', kx, -19, { white: true, size: 5.8, angles: [45, -45], ticks: false, pos: [['OFF', -8.5, 5.8, 'right'], ['ON', 8.5, 5.8, 'left'], ['ALT RPTG', 0, -10.4]] });
  // keyboard
  const cx = [-32, -16.4, -0.8];
  const cy = [10.8, -4.8, -20.4];
  const keys = ['1', '2', '3', '4', '5', '6', '7', '0', 'CLR'];
  keys.forEach((k, i) => pl.key(`XPDR_KEY_${k}`, cx[i % 3], cy[Math.floor(i / 3)], 11.4, 10.4, { depth: 4.5, small: k === 'CLR' }));
  // ATC FAIL
  pl.label('ATC', -19.5, 24.2, 2.2, { align: 'right' });
  pl.ann('XPDR_FAIL', -9.8, 24.2, 11, 5.4);
  // code window
  const ww = 36, wh = ww * (XPDR_CANVAS.h / XPDR_CANVAS.w);
  pl.window7('XPDR', 33, 13, ww, wh, [0, 1, 0, 1], { w: ww + 8, h: wh + 7 });
  // IDENT
  pl.rpb('XPDR_IDENT', 22.5, -4.2, 8.5);
  pl.label('IDENT', 30.5, -4.2, 2.3, { align: 'left' });
  // TCAS traffic THRT / ALL / ABV / BLW, TCAS mode STBY / TA / TA-RA
  pl.rot('TCAS_TRAFFIC', 17, -20.5, { white: true, size: 5.2, angles: [-67, -22, 22, 67], ticks: false, pos: [
    ['THRT', -8.8, 4.6, 'right'], ['ALL', -3.6, 8.9], ['ABV', 3.8, 8.9], ['BLW', 8.8, 4.6, 'left'],
  ] });
  pl.rot('TCAS_MODE', 47, -20.5, { white: true, size: 5.2, angles: [-55, 0, 55], ticks: false, pos: [
    ['STBY', -8, 4.6, 'right'], ['TA', 0, 9], ['TA/RA', 7.6, 4.6, 'left'],
  ] });
  return pl.finish();
}

export function buildCockpitDoor(app: App): THREE.Group {
  const M = materials();
  const pl = new Plate(app, 'PED_DOOR', 146, 57.15);
  pl.label('COCKPIT DOOR', -26, 19.5, 2.9);
  // FAULT / OPEN window
  const lx = -56, ly = -7.5;
  pl.addStatic(geo.rectRing(m(18.6), m(20.6), m(15.6), m(17.6), 0.0024, 0.0008), M.bezel, lx, ly, 0);
  pl.ann('DOOR_CKPT_FAULT', lx, ly + 4.3, 15, 8.4, false);
  pl.ann('DOOR_CKPT_OPEN', lx, ly - 4.3, 15, 8.4, false);
  // switch in its black housing
  const sx = -30, sy = -7.5;
  pl.addStatic(geo.rectRing(m(24), m(26), m(17), m(19), 0.0068, 0.002), M.knob, sx, sy, 0);
  pl.addStatic(geo.box(m(17), m(19), 0.0006), M.bezel, sx, sy, 0.0003);
  toggle(pl, 'DOOR_CKPT', sx, sy, { angles: [26, 0, -26], springFrom: [0, 2], rest: 1, length: 13, boss: false });
  pl.label('UNLOCK', -14, 3.6, 2.2, { align: 'left' });
  pl.label('NORM', -14, -7.5, 2.2, { align: 'left' });
  pl.label('LOCK', -14, -18.6, 2.2, { align: 'left' });
  return pl.finish();
}

export function buildRudTrim(app: App): THREE.Group {
  const pl = new Plate(app, 'PED_RUDTRIM', 91, 95.25);
  pl.label('RUD TRIM', 18, 38.5, 2.9);
  // position window
  const ww = 25.5, wh = ww * (RUD_CANVAS.h / RUD_CANVAS.w);
  pl.window7('RUD_TRIM', -21.5, 24, ww, wh, [0, 1, 0, 1], { w: ww + 6.5, h: wh + 6 });
  pl.label('RESET', -21.5, 7.2, 2.3);
  pl.rpb('RUD_TRIM_RESET', -21.5, -5.5, 13);
  // rotary switch, spring loaded to neutral
  const kx = 20, ky = 0;
  pl.rot('RUD_TRIM', kx, ky, { white: true, size: 10.5, angles: [-38, 0, 38], ticks: false, pos: [
    ['NOSE', -14.5, 20, 'center'], ['L', -14.5, 15.8, 'center'], ['NOSE', 14.5, 20, 'center'], ['R', 14.5, 15.8, 'center'],
  ] });
  pl.arc(kx, ky, 17, -22, 22, 0.55);
  tick(pl, kx, ky, 0, 15.4, 18.6, 0.6);
  pl.line([[-43, -29], [43, -29]], 0.55);
  return pl.finish();
}

/** PARKING BRK plate (the handle itself is built in levers.ts). */
export function buildParkBrkPlate(app: App, hx: number, hy: number): THREE.Group {
  const pl = new Plate(app, 'PED_PARKBRK', 91, 85.7);
  pl.label('PARKING BRK', -19, 30.5, 2.9);
  pl.label('PULL & TURN', -19, 24.8, 2.1);
  const r = 25;
  pl.arc(hx, hy, r, 0, 90, 0.6);
  pl.arrowHead(hx + r, hy - 0.2, 180, 2.2);
  pl.label('OFF', hx - 7.5, hy + r + 1, 2.3);
  pl.label('ON', hx + r + 1.5, hy - 5, 2.3);
  // round well of the handle
  const M = materials();
  pl.addStatic(geo.latheZ('pedPbrkWell', [[m(9), -0.001], [m(12.5), 0], [m(12.5), 0.0012], [m(9), 0.0016]], 40), M.bezel, hx, hy, 0);
  return pl.finish();
}

/** Gravity gear extension crank (decorative: not simulated in this game). */
export function buildGravityGear(app: App): THREE.Group {
  const M = materials();
  const PM = pedMats();
  const pl = new Plate(app, 'PED_GRAVITY_GEAR', 91, 79.4);
  pl.addStatic(geo.latheZ('pedGgWell', [[m(26), 0], [m(29.5), 0], [m(29.5), 0.0015], [m(26), 0.0015]], 56), M.bezel, 0, 3, 0);
  pl.addStatic(geo.cylZ(m(26), m(26), 0.0006, 56), M.black, 0, 3, 0.0001);
  // curved arrows + GEAR
  for (const s of [-1, 1]) {
    pl.arc(0, 3, 33.5, s < 0 ? -150 : 30, s < 0 ? -30 : 150, 0.6);
    pl.vtext('GEAR', s * 40.5, 3, 2.2, 3.1);
  }
  pl.arrowHead(Math.sin(-30 * DEG) * 33.5, 3 + Math.cos(-30 * DEG) * 33.5, 60, 2.2);
  pl.arrowHead(Math.sin(150 * DEG) * 33.5, 3 + Math.cos(150 * DEG) * 33.5, 240, 2.2);
  // folded crank handle: red plate with the legend, black hub
  const tex = canvasTexture(128, 320, (c) => {
    c.fillStyle = '#a8120e';
    c.fillRect(0, 0, 128, 320);
    c.fillStyle = '#f4f1ec';
    c.textAlign = 'center';
    c.font = '600 20px "Barlow Semi Condensed"';
    c.fillText('GRAVITY', 64, 36);
    c.font = '700 32px "Barlow Semi Condensed"';
    c.fillText('GEAR', 64, 100);
    c.fillText('EXTN', 64, 138);
    c.font = '600 24px "Barlow Semi Condensed"';
    c.fillText('PULL', 64, 222);
    c.fillText('&', 64, 250);
    c.fillText('TURN', 64, 278);
  });
  const handleMat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.3 });
  const hg = new THREE.Group();
  const body = new THREE.Mesh(extrudeZ(roundedRectPts(m(23), m(58), m(3.5)), 0, 0.009, 0.0012), PM.gearRed);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(m(21), m(55)), handleMat);
  face.position.z = 0.0091;
  const hub = new THREE.Mesh(geo.cylZ(m(9), m(10), 0.006, 32), M.knob);
  hub.position.set(0, m(18), -0.002);
  hg.add(hub, body, face);
  hg.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  pl.add(hg, 0, 0, 0.5);
  app.interaction.addBlocker(hg);
  return pl.finish();
}

function roundedRectPts(w: number, h: number, r: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const cs: Array<[number, number, number]> = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= 6; i++) { const a = (a0 + (i * 90) / 6) * DEG; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}

/** Printer: paper exit slot with tear bar, door with handle, FEED / TEST keys, paper strip driven by S:PRINTER_PAPER. */
export function buildPrinter(app: App): THREE.Group {
  const M = materials();
  const PM = pedMats();
  const kit = app.kit;
  const H = 171.45;
  const pl = new Plate(app, 'PED_PRINTER', 146, H, { screws: [[-67.5, H / 2 - 5.5], [67.5, H / 2 - 5.5], [-67.5, 33], [67.5, 33], [-67.5, -H / 2 + 5.5], [67.5, -H / 2 + 5.5]] });
  // paper exit: dark recess + tear bar
  const sy = 58;
  pl.addStatic(geo.rectRing(m(128), m(24), m(122), m(18), 0.003, 0.0015), M.bezel, 0, sy, 0);
  pl.addStatic(geo.box(m(122), m(18), 0.0006), PM.cavity, 0, sy, 0.0002);
  pl.addStatic(geo.roundedBox(m(118), m(2.2), 0.0026, 0.0006), M.alu, 0, sy - 7.2, 1.4);
  pl.line([[-66, 36], [66, 36]], 0.6, 0.6);
  // door handle (U bar)
  const path = new THREE.CurvePath<THREE.Vector3>();
  const hy = -50;
  const P = (x: number, z: number) => new THREE.Vector3(m(x), m(hy), m(z));
  path.add(new THREE.LineCurve3(P(-55, 0), P(-55, 8)));
  path.add(new THREE.QuadraticBezierCurve3(P(-55, 8), P(-55, 13), P(-50, 13)));
  path.add(new THREE.LineCurve3(P(-50, 13), P(50, 13)));
  path.add(new THREE.QuadraticBezierCurve3(P(50, 13), P(55, 13), P(55, 8)));
  path.add(new THREE.LineCurve3(P(55, 8), P(55, 0)));
  const tube = new THREE.TubeGeometry(path, 48, m(3), 12, false);
  pl.addStatic(tube, PM.gripBlack, 0, 0, 0);
  for (const x of [-55, 55]) pl.addStatic(geo.cylZ(m(4.8), m(5.2), 0.0015, 20), M.bezel, x, hy, 0);
  // FEED (rectangular) and TEST (round) keys
  pl.pb('PRINTER_FEED', -34, -71, { w: 16, h: 8.5, capText: 'FEED' });
  pl.rpb('PRINTER_TEST', 6, -71, 10.5, { label: 'TEST', labelDy: 9 });
  // paper strip leaving the slot (length from the printer logic)
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(m(112), 1), PM.paper);
  paper.geometry.translate(0, 0.5, 0);
  const pg = new THREE.Group();
  pg.position.set(0, m(sy + 1), 0.001);
  pg.add(paper);
  pg.rotation.x = 100 * DEG; // the strip leaves the slot upward, leaning aft
  pl.p.group.add(pg);
  paper.visible = false;
  let last = -1;
  kit.addInstance({
    id: 'PRINTER_PAPER',
    sync: (sim) => {
      const len = sim.get('S:PRINTER_PAPER');
      if (len === last) return;
      last = len;
      paper.visible = len > 0.002;
      paper.scale.y = Math.max(0.001, len);
    },
  });
  kit.interactive(paper, {
    id: 'PRINTER_PAPER',
    ref: pg,
    cursor: 'push',
    onDown: () => { app.sim.emit('printer:tear'); kit.sfx('pull', 'PRINTER_FEED', pg); },
    describe: () => ({ name: 'Printer paper', fr: 'Papier imprimante — clic = déchirer', id: 'PRINTER_PAPER' }),
  });
  return pl.finish();
}
