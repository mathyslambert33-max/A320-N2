/**
 * Primary Flight Display (A320 LCD DU, 1024 x 1024).
 * Drawn in a 158.75-unit square (1 unit ≈ 1 mm of the 6.25" active area).
 * Layout after FCOM DSC-31-40 (PFD), proportions cross-checked with the FlyByWire A32NX PFD.
 */
import type { Sim } from '../../../core/sim';
import { baroAlt, sideData, angDiff, fmgcAvailable, type Side, type SideData } from '../logic/sources';
import { toInHg } from '../logic/fcu';
import { LAT_ARMED, LAT_MODE, THR_MODE, VERT_ARMED, VERT_MODE } from '../logic/fg';
import { C, type Ctx, Flasher, line, pad, poly, txt, outlined, fillRect } from './common';

export const PFD_UNITS = 158.75;
const CX = 68.906;
const CY = 80.823;
// Stroke widths
const SW = { small: 0.378, normal: 0.605, thick: 0.83, huge: 1.21 };
// Font sizes
const F = { largest: 7, large: 6.5, medium: 6, mediumSmaller: 5.4, small: 5, smallest: 4.5, tiny: 4 };

/** Horizon offset (units) for a pitch angle (deg): linear to 20°, compressed beyond. */
export function pitchOffset(p: number): number {
  if (p > -5 && p <= 20) return p * 1.8;
  if (p > 20 && p <= 30) return -0.04 * p * p + 3.4 * p - 16;
  if (p > 30) return 20 + p;
  if (p <= -5 && p >= -15) return 0.04 * p * p + 2.2 * p + 1;
  return p - 8;
}

/** V/S needle vertical offset (units, + down) for a vertical speed (ft/min). */
export function vsOffset(vs: number): number {
  const a = Math.abs(vs);
  const s = Math.sign(vs);
  if (a < 1000) return (vs / 1000) * -27.22;
  if (a < 2000) return ((vs - s * 1000) / 1000) * -10.1 - s * 27.22;
  if (a < 6000) return ((vs - s * 2000) / 4000) * -10.1 - s * 37.32;
  return s * -47.37;
}

function spherePath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(32.138, 101.25);
  ctx.bezierCurveTo(39.55, 114.61, 53.63, 122.9, 68.906, 122.9);
  ctx.bezierCurveTo(84.18, 122.9, 98.26, 114.61, 105.674, 101.25);
  ctx.lineTo(105.674, 60.391);
  ctx.bezierCurveTo(98.26, 47.03, 84.18, 38.739, 68.906, 38.739);
  ctx.bezierCurveTo(53.63, 38.739, 39.55, 47.03, 32.138, 60.391);
  ctx.closePath();
}

interface PfdCtx {
  sim: Sim;
  side: Side;
  d: SideData;
  t: number;
  fl: Flasher;
}

export function drawPfd(ctx: Ctx, sim: Sim, side: Side, t: number, fl: Flasher, sizePx: number): void {
  const k = sizePx / PFD_UNITS;
  ctx.save();
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p: PfdCtx = { sim, side, d: sideData(sim, side), t, fl };
  attitude(ctx, p);
  speedTape(ctx, p);
  altitudeTape(ctx, p);
  vsi(ctx, p);
  headingTape(ctx, p);
  fma(ctx, p);
  landingSystem(ctx, p);
  ctx.restore();
}

/* ------------------------------------------------------------------ attitude */

function attitude(ctx: Ctx, p: PfdCtx): void {
  const { d, sim, side } = p;
  if (!d.attValid) {
    if (p.fl.show('ATT', true, p.t)) txt(ctx, 'ATT', 75.893, 83.137, C.red, F.largest, 'right');
    return;
  }
  p.fl.show('ATT', false, p.t);
  const pitch = d.pitch;
  const roll = d.roll;
  ctx.save();
  spherePath(ctx);
  ctx.clip();
  ctx.translate(CX, CY);
  ctx.rotate((-roll * Math.PI) / 180);
  ctx.translate(0, pitchOffset(pitch));
  fillRect(ctx, -80, -240, 160, 240, C.sky);
  fillRect(ctx, -80, 0, 160, 240, C.earth);
  line(ctx, -80, 0, 80, 0, C.white, SW.normal);
  // Heading marks on the horizon (every 10°).
  if (d.hdgValid) {
    const hdg = d.hdgMag;
    for (let h = Math.ceil((hdg - 25) / 10) * 10; h <= hdg + 25; h += 10) {
      const x = (angDiff(h, hdg) * 15) / 10;
      line(ctx, x, 0, x, 1.8, C.white, SW.normal);
    }
  }
  // Pitch scale.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-40, -pitchOffset(pitch) - 38, 80, 70);
  ctx.clip();
  const marks = [-80, -50, -30, -27.5, -25, -22.5, -20, -17.5, -15, -12.5, -10, -7.5, -5, -2.5, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 50, 80];
  for (const m of marks) {
    if (Math.abs(m - pitch) > 24) continue;
    const y = -pitchOffset(m);
    const a = Math.abs(m);
    const half = a === 80 ? 21 : a === 50 ? 16 : a === 30 ? 13 : a % 10 === 0 ? 9.5 : a % 5 === 0 ? 4.5 : 2.5;
    line(ctx, -half, y, half, y, C.white, SW.normal);
    if (a % 10 === 0) {
      txt(ctx, String(a), -half - 3.7, y + 2.1, C.white, F.smallest, 'right');
      txt(ctx, String(a), half + 3.9, y + 2.1, C.white, F.smallest, 'left');
    }
  }
  ctx.restore();
  ctx.restore();

  // Roll scale (fixed) and roll / sideslip index.
  ctx.save();
  ctx.translate(CX, CY);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = SW.normal;
  ctx.beginPath();
  ctx.arc(0, 0, 42.15, (-90 - 31.4) * (Math.PI / 180), (-90 + 31.4) * (Math.PI / 180));
  ctx.stroke();
  for (const a of [-45, -30, -20, -10, 10, 20, 30, 45]) {
    const r2 = Math.abs(a) === 45 ? 46.2 : Math.abs(a) === 30 ? 45.8 : 44.8;
    const r1 = Math.abs(a) === 45 ? 42.15 : 42.15;
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    line(ctx, s * r1, -c * r1, s * r2, -c * r2, C.white, SW.normal);
  }
  // Bank angle protection marks (67°), green.
  for (const sgn of [-1, 1]) {
    const a = (sgn * 67 * Math.PI) / 180;
    for (const dr of [-0.8, 0.8]) {
      const r = 42.15 + dr;
      const x = Math.sin(a) * r;
      const y = -Math.cos(a) * r;
      const tx = Math.cos(a) * 0.9;
      const ty = Math.sin(a) * 0.9;
      line(ctx, x - tx, y - ty, x + tx, y + ty, C.green, SW.normal);
    }
  }
  // Fixed zero-bank index (yellow triangle above the scale).
  poly(ctx, [0, -42.17, -2.518, -45.87, 2.518, -45.87], C.yellow, SW.normal, true);
  // Moving roll index + sideslip index.
  ctx.rotate((-roll * Math.PI) / 180);
  poly(ctx, [0, -41.9, -2.3, -38.6, 2.3, -38.6], C.yellow, SW.normal, true);
  poly(ctx, [-2.6, -37.9, 2.6, -37.9, 3.3, -36.4, -3.3, -36.4], C.yellow, SW.normal, true);
  ctx.restore();

  // FD bars / yaw bar.
  const fdEng = sim.getB(`S:FG_FD${side}_ENGAGED`);
  const vert = sim.get('S:FG_VERT_ACTIVE');
  const lat = sim.get('S:FG_LAT_ACTIVE');
  if (fdEng && vert > 0) {
    const y = CY + sim.get('S:FG_FD_PITCH') * 1.8;
    outlined(ctx, () => { ctx.beginPath(); ctx.moveTo(49.263, y); ctx.lineTo(88.55, y); }, C.green, SW.thick, SW.huge * 1.6);
  }
  if (fdEng && lat > 0) {
    if (lat === LAT_MODE.RWY && p.d.onGround) {
      // Yaw bar (ground roll guidance).
      const x = CX + sim.get('S:FG_FD_YAW');
      outlined(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(x - 1.007, 82.536); ctx.lineTo(x - 1.007, 95.94); ctx.lineTo(x + 1.007, 95.94); ctx.lineTo(x + 1.007, 82.536);
        ctx.lineTo(x, 80.82); ctx.closePath();
      }, C.green, SW.normal);
    } else if (lat > 0) {
      const x = CX + sim.get('S:FG_FD_ROLL') * 1.0;
      outlined(ctx, () => { ctx.beginPath(); ctx.moveTo(x, 61.672); ctx.lineTo(x, 99.974); }, C.green, SW.thick, SW.huge * 1.6);
    }
  }
  // FD flag: FD pb ON but FD not available.
  const fdFlag = sim.getB('S:FCU_POWERED') && sim.getB(`S:FCU_FD${side}`) && !fdEng;
  if (p.fl.show('FD', fdFlag, p.t)) txt(ctx, 'FD', 52.703, 56.065, C.red, F.largest, 'right');

  // Aircraft symbol (fixed).
  const wing = (pts: number[]) => poly(ctx, pts, C.yellow, SW.normal, true, C.black);
  wing([34.153, 79.563, 49.263, 79.563, 49.263, 86.115, 46.745, 86.115, 46.745, 82.083, 34.153, 82.083]);
  wing([88.55, 86.114, 91.068, 86.114, 91.068, 82.083, 103.66, 82.083, 103.66, 79.563, 88.55, 79.563]);
  wing([67.647, 82.083, 67.647, 79.563, 70.165, 79.563, 70.165, 82.083]);

  // Radio altitude (below 2500 ft).
  if (d.raValid && d.ra <= 2500) {
    const ra = d.ra;
    const v = ra < 5 ? Math.round(ra) : ra <= 50 ? Math.round(ra / 5) * 5 : Math.round(ra / 10) * 10;
    const col = ra <= 400 ? C.amber : C.green;
    txt(ctx, String(Math.max(0, v)), CX, 121.2, col, F.largest, 'center');
  }
}

/* ------------------------------------------------------------------ speed */

function speedTape(ctx: Ctx, p: PfdCtx): void {
  const { d, sim } = p;
  if (!d.adrValid) {
    line(ctx, 1.9058, 38.086, 23.765, 38.086, C.red, SW.normal);
    line(ctx, 1.9058, 123.56, 23.765, 123.56, C.red, SW.normal);
    line(ctx, 19.031, 38.086, 19.031, 123.56, C.red, SW.normal);
    if (p.fl.show('SPD', true, p.t)) txt(ctx, 'SPD', 17.756, 83.386, C.red, F.largest, 'right');
    return;
  }
  p.fl.show('SPD', false, p.t);
  const spd = Math.max(30, d.ias);
  const yOf = (v: number) => CY - (v - spd);
  fillRect(ctx, 1.9058, 38.086, 17.125, 85.473, C.tape);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 38.086, 30, 85.473);
  ctx.clip();
  for (let v = Math.max(30, Math.floor((spd - 50) / 10) * 10); v <= spd + 50; v += 10) {
    const y = yOf(v);
    line(ctx, 19.031, y, 16.21, y, C.white, SW.normal);
    if (v % 20 === 0) txt(ctx, pad(v, 3), 8.035, y + 2.118, C.white, F.medium, 'center');
  }
  // V1 (take-off phase)
  const phase = sim.get('S:FMGS_PHASE');
  const v1 = sim.get('S:FMGS_V1');
  if (v1 > 0 && phase <= 1 && fmgcAvailable(sim)) {
    const y = yOf(v1);
    if (y >= 38.086 + 2) txt(ctx, '1', 21.27, y + 1.5, C.cyan, F.medium, 'left');
  }
  // Speed target
  const tgt = sim.get('S:FG_SPD_TARGET');
  const managed = sim.getB('S:FG_SPD_TARGET_MANAGED');
  const tcol = managed ? C.magenta : C.cyan;
  if (tgt > 0) {
    const y = yOf(tgt);
    if (y >= 38.086 && y <= 123.56) poly(ctx, [19.274, y, 24.632, y + 1.951, 24.632, y - 2.0964, 19.274, y - 0.0], tcol, SW.normal, true);
  }
  ctx.restore();
  if (tgt > 0) {
    const y = yOf(tgt);
    if (y < 38.086) txt(ctx, String(Math.round(tgt)), 24.079, 36.67, tcol, F.small, 'right');
    else if (y > 123.56) txt(ctx, String(Math.round(tgt)), 24.079, 128.8, tcol, F.small, 'right');
  }
  if (v1 > 0 && phase <= 1 && fmgcAvailable(sim) && yOf(v1) < 40) txt(ctx, String(Math.round(v1)), 21.27, 43.23, C.cyan, F.tiny, 'left');
  if (!sim.getB('S:FCU_POWERED')) txt(ctx, 'SPD SEL', 24.079, 36.67, C.red, F.small, 'right');
  // Outline and speed reference
  line(ctx, 1.9058, 38.086, 21.76, 38.086, C.white, SW.normal);
  line(ctx, 1.9058, 123.56, 21.76, 123.56, C.white, SW.normal);
  line(ctx, 19.031, 38.086, 19.031, 123.56, C.white, SW.normal);
  poly(ctx, [13.994, 80.46, 13.994, 81.186, 20.542, 81.186, 23.665, 82.335, 23.665, 79.311, 20.542, 80.46], C.black, SW.small * 0.6, true, C.yellow);
  fillRect(ctx, 0.0926, 80.46, 2.0147, 0.7257, C.yellow);
  // Mach (> .50)
  if (d.mach > 0.5) txt(ctx, `.${pad(Math.round(d.mach * 1000), 3).slice(0, 3)}`, 5.567, 137.03, C.green, F.largest, 'left');
}

/* ------------------------------------------------------------------ altitude */

function baroSetting(sim: Sim, side: Side): number {
  return sim.getB(`S:EFIS${side}_BARO_STD`) ? 1013.25 : sim.get(`S:EFIS${side}_BARO_HPA`) || 1013.25;
}

function altitudeTape(ctx: Ctx, p: PfdCtx): void {
  const { d, sim, side } = p;
  const std = sim.getB(`S:EFIS${side}_BARO_STD`);
  // Baro reference (bottom of the tape) — FCU data, independent of the ADR.
  if (std) {
    poly(ctx, [124.79, 131.74, 137.886, 131.74, 137.886, 138.796, 124.79, 138.796], C.yellow, SW.normal, true);
    txt(ctx, 'STD', 125.758, 137.36, C.cyan, F.medium, 'left');
    if (sim.getB(`S:EFIS${side}_BARO_PRESEL`)) {
      const hpa = sim.get(`S:EFIS${side}_BARO_HPA`);
      const s = sim.getB(`S:EFIS${side}_BARO_INHG`) ? toInHg(hpa).toFixed(2) : String(Math.round(hpa));
      txt(ctx, s, 131.3, 145.3, C.cyan, F.small, 'center');
    }
  } else {
    const hpa = sim.get(`S:EFIS${side}_BARO_HPA`);
    const s = sim.getB(`S:EFIS${side}_BARO_INHG`) ? toInHg(hpa).toFixed(2) : String(Math.round(hpa));
    txt(ctx, 'QNH', 118.231, 138.113, C.white, F.medium, 'left');
    txt(ctx, s, 141.256, 138.09, C.cyan, F.medium, 'center');
  }
  if (!d.adrValid) {
    poly(ctx, [117.75, 123.56, 130.85, 123.56, 130.85, 38.086, 117.75, 38.086], C.red, SW.normal, false);
    if (p.fl.show('ALT', true, p.t)) txt(ctx, 'ALT', 131.168, 83.433, C.red, F.largest, 'right');
    return;
  }
  p.fl.show('ALT', false, p.t);
  const alt = baroAlt(d.ps, baroSetting(sim, side));
  const yOf = (a: number) => CY - (a - alt) * 0.075;
  fillRect(ctx, 117.75, 38.086, 13.1, 85.474, C.tape);
  ctx.save();
  ctx.beginPath();
  ctx.rect(110, 38.086, 30, 85.474);
  ctx.clip();
  for (let a = Math.floor((alt - 700) / 100) * 100; a <= alt + 700; a += 100) {
    const y = yOf(a);
    line(ctx, 130.85, y, 128.835, y, C.white, SW.normal);
    if (a % 500 === 0) {
      txt(ctx, pad(Math.abs(a) / 100, 3), 123.288, y + 1.82, C.white, F.medium, 'center');
    }
  }
  // Ground reference (red ribbon) below 570 ft RA.
  if (d.raValid && d.ra < 570) {
    const yg = yOf(alt - d.ra);
    if (yg < 123.56) fillRect(ctx, 130.85, yg, 1.7, 123.56 - yg, C.red);
  }
  // Selected altitude on the tape.
  const fcuAlt = sim.get('S:FCU_ALT');
  const fcuOk = sim.getB('S:FCU_POWERED');
  if (fcuOk && Math.abs(fcuAlt - alt) <= 570) {
    const y = yOf(fcuAlt);
    poly(ctx, [117.75, y - 4.2, 128.3, y - 4.2, 128.3, y - 2.2, 130.85, y - 2.2, 130.85, y + 2.2, 128.3, y + 2.2, 128.3, y + 4.2, 117.75, y + 4.2], C.cyan, SW.normal, true, C.black);
    txt(ctx, pad(Math.round(fcuAlt / 100) % 1000, 3), 123.0, y + 2.1, C.cyan, F.medium, 'center');
  }
  ctx.restore();
  if (fcuOk && Math.abs(fcuAlt - alt) > 570) {
    const s = std ? `FL${pad(Math.round(fcuAlt / 100), 3)}` : String(Math.round(fcuAlt));
    if (fcuAlt > alt) txt(ctx, s, 136.2, 36.6, C.cyan, F.medium, 'right');
    else txt(ctx, s, 136.2, 129.8, C.cyan, F.medium, 'right');
  }
  if (!fcuOk) txt(ctx, 'ALT SEL', 136.23, 37.25, C.red, F.small, 'right');
  // Tape outline
  line(ctx, 117.75, 123.56, 135.58, 123.56, C.white, SW.normal);
  line(ctx, 117.75, 38.086, 135.58, 38.086, C.white, SW.normal);
  line(ctx, 130.846, 38.086, 130.846, 123.56, C.white, SW.normal);

  // Altitude readout (drum)
  poly(ctx, [117.75, 76.337, 130.85, 76.337, 130.85, 73.666, 139.715, 73.666, 139.715, 87.979, 130.85, 87.979, 130.85, 85.308, 117.75, 85.308], C.yellow, SW.normal, true, C.black);
  const neg = alt < 0;
  const a = Math.abs(alt);
  const hundreds = Math.floor(a / 100);
  const digits = pad(hundreds, 3, ' ');
  const dx = [120.252, 124.934, 129.385];
  for (let i = 0; i < 3; i++) {
    let ch = digits[i];
    if (i === 2 && ch === ' ') ch = '0';
    txt(ctx, ch, dx[i], 83.437, C.green, F.largest, 'center');
  }
  if (neg) txt(ctx, 'NEG', 118.4, 75.2, C.white, F.tiny, 'left');
  ctx.save();
  ctx.beginPath();
  ctx.rect(130.85, 73.666, 8.865, 14.313);
  ctx.clip();
  const tens = a % 100;
  const base = Math.floor(tens / 20) * 20;
  for (let v = base - 40; v <= base + 60; v += 20) {
    const y = 82.9 - ((v - tens) / 20) * 4.7;
    const vv = ((v % 100) + 100) % 100;
    txt(ctx, pad(vv, 2), 135.4, y, C.green, F.mediumSmaller, 'center');
  }
  ctx.restore();
  // Metric altitude
  if (sim.getB('S:FCU_METRIC_ALT')) {
    poly(ctx, [116.56, 140.22, 145.773, 140.22, 145.773, 147.276, 116.56, 147.276], C.yellow, SW.normal, true);
    txt(ctx, String(Math.round((alt * 0.3048) / 10) * 10 || 0), 128.647, 145.862, C.green, F.medium, 'center');
    txt(ctx, 'M', 142.035, 145.869, C.cyan, F.medium, 'center');
    if (fcuOk) {
      txt(ctx, String(Math.round((fcuAlt * 0.3048) / 10) * 10), 94.089, 37.927, C.cyan, F.smallest, 'center');
      txt(ctx, 'M', 105.258, 37.873, C.cyan, F.smallest, 'center');
    }
  }
}

/* ------------------------------------------------------------------ V/S */

function vsi(ctx: Ctx, p: PfdCtx): void {
  const { d } = p;
  const vsValid = d.attValid;
  if (!vsValid) {
    if (p.fl.show('VS', true, p.t)) {
      txt(ctx, 'V', 153.132, 77.501, C.red, F.largest, 'right');
      txt(ctx, '/', 153.134, 83.211, C.red, F.largest, 'right');
      txt(ctx, 'S', 152.994, 88.871, C.red, F.largest, 'right');
    }
    return;
  }
  p.fl.show('VS', false, p.t);
  poly(ctx, [151.84, 131.72, 155.97, 116.097, 155.97, 45.541, 151.84, 29.918, 146.3, 29.918, 146.3, 131.72], C.tape, 0, true, C.tape);
  const marks: Array<[number, boolean]> = [[1000, true], [2000, true], [6000, true], [500, false], [1500, false], [4000, false]];
  for (const [v, big] of marks) {
    for (const s of [-1, 1]) {
      const y = CY + vsOffset(s * v);
      if (big) fillRect(ctx, 149.92, y - 0.73, 1.915, 1.46, C.white);
      else line(ctx, 149.92, y, 151.84, y, C.white, SW.normal);
      if (big) txt(ctx, String(v / 1000), 148.3, y + 1.0, C.white, F.smallest, 'center');
    }
  }
  fillRect(ctx, 145.79, 80.067, 6.0476, 1.5119, C.yellow);
  const vs = d.vs;
  const yo = vsOffset(vs);
  const col = Math.abs(vs) >= 6000 ? C.amber : C.green;
  ctx.save();
  ctx.beginPath();
  ctx.rect(146.3, 29.9, 12.4, 101.8);
  ctx.clip();
  const x1 = 149.92, y1 = CY + yo, x2 = 162.74, y2 = CY;
  outlined(ctx, () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }, col, SW.thick, SW.huge * 1.4);
  ctx.restore();
  if (Math.abs(vs) >= 200) {
    const s = Math.sign(vs);
    const ty = CY + yo - s * 2.4;
    fillRect(ctx, 151.35, ty - 2.6, 7.05, 4.4, C.black);
    const h = Math.round(Math.abs(vs) / 100);
    txt(ctx, pad(h, 2), 155.14, ty + 1.7, col, F.smallest, 'center');
  }
}

/* ------------------------------------------------------------------ heading */

function headingTape(ctx: Ctx, p: PfdCtx): void {
  const { d, sim, side } = p;
  if (!d.hdgValid) {
    poly(ctx, [32.138, 156.23, 32.138, 145.344, 105.674, 145.344, 105.674, 156.23], C.red, SW.normal);
    if (p.fl.show('HDG', true, p.t)) txt(ctx, 'HDG', 75.926, 151.955, C.red, F.largest, 'right');
    return;
  }
  p.fl.show('HDG', false, p.t);
  const hdg = d.hdgMag;
  const xOf = (h: number) => CX + (angDiff(h, hdg) * 7.555) / 5;
  fillRect(ctx, 32.138, 145.34, 73.536, 10.382, C.tape);
  ctx.save();
  ctx.beginPath();
  ctx.rect(32.138, 140, 73.536, 16);
  ctx.clip();
  for (let h = Math.ceil((hdg - 30) / 5) * 5; h <= hdg + 30; h += 5) {
    const x = xOf(h);
    const hh = ((h % 360) + 360) % 360;
    if (hh % 10 === 0) {
      line(ctx, x, 145.34, x, 149.34, C.white, SW.normal);
      const big = hh % 30 === 0;
      txt(ctx, String(hh / 10), x, 154.642, C.white, big ? F.medium : F.smallest, 'center');
    } else line(ctx, x, 145.34, x, 147.02, C.white, SW.normal);
  }
  // Selected heading
  const fcuOk = sim.getB('S:FCU_POWERED');
  if (fcuOk && !sim.getB('S:FCU_HDG_DASHES') && !sim.getB('S:FCU_TRK_FPA')) {
    const sel = sim.get('S:FCU_HDG');
    const dlt = angDiff(sel, hdg);
    if (Math.abs(dlt) < 24) {
      const x = xOf(sel);
      poly(ctx, [x + 1.072, 145.1, x + 3.022, 139.739, x - 3.022, 139.739, x - 1.072, 145.1], C.cyan, SW.normal);
    }
  }
  // Track diamond (moving)
  if (d.gs > 30) {
    const x = xOf(d.trkMag);
    poly(ctx, [x, 145.75, x - 1.259, 147.514, x, 149.278, x + 1.259, 147.514], C.green, SW.thick, true);
  }
  // ILS course
  const ls = sim.getB(`S:FCU_LS${side}`);
  const ilsCrs = sim.get('S:NAV_ILS_CRS');
  if (ls && sim.get('S:NAV_ILS_FREQ') > 0) {
    const dlt = angDiff(ilsCrs, hdg);
    if (Math.abs(dlt) < 24) {
      const x = xOf(ilsCrs);
      outlined(ctx, () => { ctx.beginPath(); ctx.moveTo(x - 1.914, 152.82); ctx.lineTo(x + 1.914, 152.82); ctx.moveTo(x, 146.27); ctx.lineTo(x, 155.72); }, C.magenta, SW.thick);
    }
  }
  ctx.restore();
  if (fcuOk && !sim.getB('S:FCU_HDG_DASHES') && !sim.getB('S:FCU_TRK_FPA')) {
    const sel = sim.get('S:FCU_HDG');
    const dlt = angDiff(sel, hdg);
    if (Math.abs(dlt) >= 24) txt(ctx, pad(Math.round(sel) % 360, 3), dlt > 0 ? 101.704 : 36.418, 144.348, C.cyan, F.smallest, 'center');
  }
  if (ls && sim.get('S:NAV_ILS_FREQ') > 0 && Math.abs(angDiff(ilsCrs, hdg)) >= 24) {
    const right = angDiff(ilsCrs, hdg) > 0;
    const bx = right ? 100.57 : 26.094;
    poly(ctx, [bx, 149.68, bx + 12.088, 149.68, bx + 12.088, 156.23, bx, 156.23], C.white, SW.normal, true, C.black);
    txt(ctx, pad(Math.round(ilsCrs) % 360, 3), bx + 6.04, 155.22, C.magenta, F.medium, 'center');
  }
  poly(ctx, [32.138, 156.23, 32.138, 145.344, 105.674, 145.344, 105.674, 156.23], C.white, SW.normal);
  fillRect(ctx, 68.098, 139.247, 1.512, 8.063, C.yellow);
}

/* ------------------------------------------------------------------ FMA */

function boxIfNew(ctx: Ctx, sim: Sim, tVar: string, x: number, y: number, w: number, h: number): void {
  const t0 = sim.get(tVar);
  if (sim.has(tVar) && sim.time - t0 < 10 && sim.time >= t0) poly(ctx, [x, y, x + w, y, x + w, y + h, x, y + h], C.white, SW.normal, true);
}

function fma(ctx: Ctx, p: PfdCtx): void {
  const { sim } = p;
  ctx.strokeStyle = C.grey;
  for (const x of [33.117, 66.241, 102.52, 133.72]) line(ctx, x, 0.337, x, 21.201, C.grey, SW.normal);
  if (!fmgcAvailable(sim) && !sim.getB('S:FCU_POWERED')) return;
  const apFd = sim.getB('S:FG_FD1_ENGAGED') || sim.getB('S:FG_FD2_ENGAGED') || sim.getB('S:FCU_AP1') || sim.getB('S:FCU_AP2');

  // Column 1: A/THR mode
  const thr = sim.get('S:FG_THR_MODE');
  if (thr === THR_MODE.MAN_TOGA || thr === THR_MODE.MAN_MCT) {
    poly(ctx, [25.114, 1.814, 25.114, 15.32, 8.162, 15.32, 8.162, 1.814], C.white, SW.normal, true);
    txt(ctx, 'MAN', 17.052, 7.128, C.white, F.medium, 'center');
    txt(ctx, thr === THR_MODE.MAN_TOGA ? 'TOGA' : 'MCT', 16.869, 14.352, C.white, F.medium, 'center');
  } else if (thr === THR_MODE.MAN_FLX) {
    poly(ctx, [30.521, 1.814, 30.521, 15.32, 3.304, 15.32, 3.304, 1.814], C.white, SW.normal, true);
    txt(ctx, 'MAN', 17.052, 7.128, C.white, F.medium, 'center');
    txt(ctx, 'FLX', 9.669, 14.352, C.white, F.medium, 'center');
    const flx = Math.round(sim.get('S:FG_FLX_TEMP'));
    txt(ctx, `${flx >= 0 ? '+' : ''}${flx}`, 24.099, 14.352, C.cyan, F.medium, 'center');
  }

  if (apFd) {
    // Column 2: vertical modes
    const vert = sim.get('S:FG_VERT_ACTIVE');
    const vnames: Record<number, string> = { [VERT_MODE.SRS]: 'SRS', [VERT_MODE.CLB]: 'CLB', [VERT_MODE.OP_CLB]: 'OP CLB', [VERT_MODE.ALT]: 'ALT', [VERT_MODE.VS]: 'V/S' };
    if (vert) {
      txt(ctx, vnames[vert] ?? '', 49.715, 6.889, C.green, F.medium, 'center');
      boxIfNew(ctx, sim, 'S:FG_T_VERT', 35.756, 1.814, 27.918, 6.048);
    }
    const varm = sim.get('S:FG_VERT_ARMED');
    if (varm === VERT_ARMED.CLB) txt(ctx, 'CLB', 49.715, 13.63, C.cyan, F.mediumSmaller, 'center');
    else if (varm === VERT_ARMED.ALT) txt(ctx, 'ALT', 49.715, 13.63, C.cyan, F.mediumSmaller, 'center');
    // Column 3: lateral modes
    const lat = sim.get('S:FG_LAT_ACTIVE');
    const lnames: Record<number, string> = { [LAT_MODE.RWY]: 'RWY', [LAT_MODE.RWY_TRK]: 'RWY TRK', [LAT_MODE.HDG]: 'HDG', [LAT_MODE.TRK]: 'TRACK', [LAT_MODE.NAV]: 'NAV' };
    if (lat) {
      txt(ctx, lnames[lat] ?? '', 84.357, 6.987, C.green, F.medium, 'center');
      boxIfNew(ctx, sim, 'S:FG_T_LAT', 68.845, 1.814, 31.025, 6.048);
    }
    if (sim.get('S:FG_LAT_ARMED') === LAT_ARMED.NAV) txt(ctx, 'NAV', 84.234, 13.63, C.cyan, F.mediumSmaller, 'center');
  }

  // Column 5: AP / FD / A-THR engagement status
  const ap1 = sim.getB('S:FCU_AP1');
  const ap2 = sim.getB('S:FCU_AP2');
  if (ap1 || ap2) {
    txt(ctx, ap1 && ap2 ? 'AP1+2' : ap1 ? 'AP1' : 'AP2', 145.615, 6.956, C.white, F.medium, 'center');
    boxIfNew(ctx, sim, 'S:FG_T_AP', 135.32, 1.814, 20.81, 6.048);
  }
  const fd1 = sim.getB('S:FG_FD1_ENGAGED');
  const fd2 = sim.getB('S:FG_FD2_ENGAGED');
  if (fd1 || fd2) {
    txt(ctx, `${fd1 ? '1' : '-'} FD ${fd2 ? '2' : '-'}`, 145.95, 14.418, C.white, F.medium, 'center');
  }
  const athr = sim.get('S:FCU_ATHR');
  if (athr > 0) {
    txt(ctx, 'A/THR', 145.756, 21.6, athr === 1 ? C.cyan : C.white, F.medium, 'center');
    boxIfNew(ctx, sim, 'S:FG_T_ATHR', 135.32, 16.329, 20.81, 6.048);
  }
}

/* ------------------------------------------------------------------ LS */

function landingSystem(ctx: Ctx, p: PfdCtx): void {
  const { sim, side } = p;
  if (!sim.getB(`S:FCU_LS${side}`) || !p.d.attValid) return;
  // Deviation scales (white dots), localizer below the sphere, glide slope on the right.
  ctx.strokeStyle = C.white;
  ctx.lineWidth = SW.normal;
  for (const dx of [-30.82, -15.41, 15.41, 30.82]) {
    ctx.beginPath(); ctx.arc(CX + dx, 125.3, 0.9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(110.7, CY + dx, 0.9, 0, Math.PI * 2); ctx.stroke();
  }
  line(ctx, CX, 123.4, CX, 127.2, C.yellow, SW.thick);
  line(ctx, 108.6, CY, 112.8, CY, C.yellow, SW.thick);
  const freq = sim.get('S:NAV_ILS_FREQ');
  if (freq > 0) {
    const fm = sim.services.fmgs as any;
    let ident = '';
    try { ident = fm?.tunedNavaids?.()?.ils?.ident ?? ''; } catch { ident = ''; }
    txt(ctx, ident, 1.4, 145.6, C.magenta, F.medium, 'left');
    txt(ctx, freq.toFixed(2), 1.4, 151.8, C.magenta, F.medium, 'left');
  }
}
