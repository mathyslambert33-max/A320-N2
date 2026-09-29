/**
 * Engine / Warning Display (upper ECAM), A320ceo CFM56-5B, EIS2 (LCD) layout.
 * Drawn in a 768 x 768 design space scaled to the 1024 x 1024 canvas.
 */
import type { Sim } from '../../../core/sim';
import type { EcamCore } from '../logic/ecam';
import { EWD_LINES } from '../logic/fwc';
import {
  C, arcC, circle, clamp, dirOf, drawEcamLine, gaugeAngle, line, poly, rect, relPoly, splitNumber, tx,
} from './common';

const S = 1024 / 768;

// ------------------------------------------------------------------ constants (CFM56-5B4/P)
const N1_MIN = 16;
const N1_MAX = 110;
const N1_RED = 104;
const N1_START = 220; // compass degrees
const N1_END = 70;
const N1_R = 66;

const EGT_MIN = 0;
const EGT_MAX = 1200;
const EGT_RED = 950;
const EGT_START = 270;
const EGT_END = 90;
const EGT_R = 61;

export function drawEwd(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, t: number): void {
  ctx.save();
  ctx.scale(S, S);
  const flashOn = Math.floor(t * 2) % 2 === 0;

  drawEngines(ctx, sim, core, flashOn);
  drawThrustLimit(ctx, sim);
  drawFob(ctx, sim);
  drawSlatsFlaps(ctx, sim);

  // separators
  line(ctx, 4, 520, 444, 520, C.grey, 4, 'round');
  line(ctx, 522, 520, 764, 520, C.grey, 4, 'round');
  line(ctx, 484, 540, 484, 730, C.grey, 4, 'round');

  drawMemoArea(ctx, core, flashOn);
  ctx.restore();
}

/* ================================================================== ENGINES */

function drawEngines(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, _flashOn: boolean): void {
  // centre labels
  tx(ctx, 'N1', 387, 122, C.W, 26, 'center');
  tx(ctx, '%', 384, 141, C.C, 20, 'center');
  tx(ctx, 'EGT', 385, 232, C.W, 26, 'center');
  tx(ctx, '°C', 379, 254, C.C, 20, 'center');
  tx(ctx, 'N2', 386, 308, C.W, 26, 'center');
  tx(ctx, '%', 385, 328, C.C, 20, 'center');
  line(ctx, 311, 312, 343, 303, C.grey, 4, 'round');
  line(ctx, 424, 303, 456, 312, C.grey, 4, 'round');
  tx(ctx, 'FF', 386, 370, C.W, 26, 'center');
  tx(ctx, 'KG/H', 385, 390, C.C, 22, 'center');
  line(ctx, 311, 369, 343, 360, C.grey, 4, 'round');
  line(ctx, 424, 360, 456, 369, C.grey, 4, 'round');

  for (const n of [1, 2] as const) {
    const e = core.fwc.a.eng[n - 1];
    const { fadec, n1, n2, egt, ff, state } = e;
    const starting = (state === 1 || state === 2) && n2 < 58;
    const cx1 = n === 1 ? 234 : 534;
    drawN1(ctx, sim, core, n, cx1, 96, fadec, n1);
    drawEgt(ctx, sim, n === 1 ? 234 : 533, 248, fadec, egt, starting);
    // N2
    const nx = n === 1 ? 192 : 493;
    if (!fadec) tx(ctx, 'XX', nx + 60, 320, C.A, 26, 'right');
    else {
      if (starting) rect(ctx, nx - 9, 297, 80, 25, C.grey, 0, '#5a5a5a');
      const col = n2 > 105 ? C.R : C.G;
      splitNumber(ctx, clamp(n2, 0, 199.9), nx + 70, 320, col, 26, 20);
    }
    // FF (kg/h, 20 kg steps)
    const fx = n === 1 ? 273 : 576;
    if (!fadec) tx(ctx, 'XX', fx - 20, 380, C.A, 26, 'right');
    else tx(ctx, String(Math.round(ff / 20) * 20), fx, 380, C.G, 26, 'right');
  }
}

function toN1FromTla(sim: Sim, tla: number, toga: number): number {
  const idle = sim.has('S:ENG_IDLE_N1') ? sim.get('S:ENG_IDLE_N1') : 19.5;
  if (tla <= 0) return idle;
  const clb = toga * 0.9;
  const mct = toga * 0.96;
  if (tla <= 25) return idle + ((clb - idle) * tla) / 25;
  if (tla <= 35) return clb + ((mct - clb) * (tla - 25)) / 10;
  return mct + ((toga - mct) * Math.min(10, tla - 35)) / 10;
}

function drawN1(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, n: 1 | 2, x: number, y: number, fadec: boolean, n1: number): void {
  if (!fadec) {
    arcC(ctx, x, y, N1_R, N1_START, N1_END, C.A, 2);
    tx(ctx, 'XX', x + 48, y + 46, C.A, 22, 'right');
    return;
  }
  const ang = (v: number) => gaugeAngle(v, N1_MIN, N1_MAX, N1_START, N1_END);
  // scale
  arcC(ctx, x, y, N1_R, N1_START, ang(N1_RED), C.W, 2);
  arcC(ctx, x, y, N1_R, ang(N1_RED), N1_END, C.R, 3);
  for (const v of [20, 50, 60, 70, 80, 90, 100]) {
    const [dx, dy] = dirOf(ang(v));
    line(ctx, x + dx * N1_R * 0.9, y + dy * N1_R * 0.9, x + dx * N1_R, y + dy * N1_R, C.W, 2);
  }
  {
    const [dx, dy] = dirOf(N1_END);
    line(ctx, x + dx * N1_R * 0.9, y + dy * N1_R * 0.9, x + dx * N1_R, y + dy * N1_R, C.R, 2);
  }
  const lab = (v: number, s: string, nx: number, ny: number) => {
    const [dx, dy] = dirOf(ang(v));
    tx(ctx, s, x + dx * N1_R * 0.9 + nx, y + dy * N1_R * 0.9 + ny, C.W, 20, 'center');
  };
  lab(50, '5', 8, 17);
  lab(100, '10', -28, 15);

  // N1 max (amber mark): TOGA limit computed by the FADEC
  const toga = sim.has('S:ENG_TOGA_N1') ? sim.get('S:ENG_TOGA_N1')
    : sim.get('S:ENG_THR_LIMIT_TYPE') === 0 && sim.get('S:ENG_THR_LIMIT_N1') > 50 ? sim.get('S:ENG_THR_LIMIT_N1') : 99.3;
  {
    const a = ang(toga);
    const [dx, dy] = dirOf(a);
    line(ctx, x + dx * N1_R * 0.85, y + dy * N1_R * 0.85, x + dx * N1_R, y + dy * N1_R, C.A, 3);
    // small filled amber marker outside the arc
    ctx.save();
    ctx.translate(x + dx * N1_R, y + dy * N1_R);
    ctx.rotate(((a - 90) * Math.PI) / 180);
    ctx.fillStyle = C.A;
    ctx.fillRect(0, -2, 7, 4);
    ctx.restore();
  }
  // digital N1 box
  rect(ctx, x - 17, y + 18, 96, 34, C.grey, 2);
  const col = n1 > N1_RED ? C.R : C.G;
  splitNumber(ctx, clamp(n1, 0, 199.9), x + 72, y + 46, col, 30, 22);

  // needle
  const [nx, ny] = dirOf(ang(clamp(n1, N1_MIN, N1_MAX)));
  line(ctx, x, y, x + nx * N1_R * 1.15, y + ny * N1_R * 1.15, col, 3, 'round');

  // thrust lever position (cyan donut)
  const tla = sim.get(`C:THR_LEVER${n}`);
  if (tla >= -0.5) {
    const [tdx, tdy] = dirOf(ang(clamp(toN1FromTla(sim, tla, toga), N1_MIN, N1_MAX)));
    circle(ctx, x + tdx * N1_R * 1.03 * 1.12, y + tdy * N1_R * 1.03 * 1.12, 4, C.C, 2);
  }

  // AVAIL (10 s after the engine reached idle) / REV
  const rev = sim.get(`S:ENG${n}_REV`);
  const avail = core.fwc.engAvail[n - 1] > 0;
  if (avail || rev > 0.02) {
    rect(ctx, x - 17, y - 16, 96, 34, C.grey, 2, '#000');
    if (avail) tx(ctx, 'AVAIL', x + 79 - 3, y + 13, C.G, 28, 'right');
    else tx(ctx, 'REV', x + 34, y + 13, rev > 0.95 ? C.G : C.A, 28, 'center');
  }
}

function drawEgt(ctx: CanvasRenderingContext2D, sim: Sim, x: number, y: number, fadec: boolean, egt: number, starting: boolean): void {
  if (!fadec) {
    arcC(ctx, x, y, EGT_R, EGT_START, EGT_END, C.A, 2);
    tx(ctx, 'XX', x + 20, y + 6, C.A, 26, 'right');
    return;
  }
  const ang = (v: number) => gaugeAngle(v, EGT_MIN, EGT_MAX, EGT_START, EGT_END);
  arcC(ctx, x, y, EGT_R, EGT_START, ang(EGT_RED), C.W, 2);
  arcC(ctx, x, y, EGT_R, ang(EGT_RED), EGT_END, C.R, 3);
  // ticks: start (inward), 600 (top), end (red, inward)
  for (const [v, col] of [[0, C.W], [600, C.W]] as const) {
    const [dx, dy] = dirOf(ang(v));
    line(ctx, x + dx * EGT_R * 0.85, y + dy * EGT_R * 0.85, x + dx * EGT_R, y + dy * EGT_R, col, 2);
  }
  {
    const [dx, dy] = dirOf(EGT_END);
    line(ctx, x + dx * EGT_R * 0.85, y + dy * EGT_R * 0.85, x + dx * EGT_R, y + dy * EGT_R, C.R, 2);
  }
  // EGT max (amber index): 725 degC during start, 915 degC (MCT) otherwise, not shown at T.O / GA thrust
  const tla = Math.max(sim.get('C:THR_LEVER1'), sim.get('C:THR_LEVER2'));
  const toThrust = tla > 33.3;
  const amberLimit = starting ? 725 : 915;
  if (!toThrust || starting) {
    const a = ang(amberLimit);
    const [dx, dy] = dirOf(a);
    line(ctx, x + dx * EGT_R * 0.85, y + dy * EGT_R * 0.85, x + dx * EGT_R, y + dy * EGT_R, C.A, 3);
    ctx.save();
    ctx.translate(x + dx * EGT_R, y + dy * EGT_R);
    ctx.rotate(((a - 90) * Math.PI) / 180);
    ctx.fillStyle = C.A;
    ctx.fillRect(0, -2, 7, 4);
    ctx.restore();
  }
  const col = egt > EGT_RED ? C.R : egt > amberLimit ? C.A : C.G;
  rect(ctx, x - 34, y - 16, 69, 24, C.grey, 2);
  tx(ctx, String(Math.round(egt)), x + 35 - 2, y + 6, col, 26, 'right');
  const [nx, ny] = dirOf(ang(clamp(egt, EGT_MIN, EGT_MAX)));
  line(ctx, x + nx * EGT_R * 0.6, y + ny * EGT_R * 0.6, x + nx * EGT_R * 1.08, y + ny * EGT_R * 1.08, col, 3, 'round');
}

/* ================================================================== THRUST LIMIT (top right) */

function drawThrustLimit(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const x = 698;
  const y = 28;
  const fadec = sim.getB('S:ENG1_FADEC_ON') || sim.getB('S:ENG2_FADEC_ON');
  if (!fadec) {
    tx(ctx, 'XX', x, y, C.A, 26, 'center');
    tx(ctx, 'XX', x, y + 28, C.A, 26, 'center');
    return;
  }
  const flexT = sim.has('S:ENG_FLX_TEMP') && sim.get('S:ENG_FLX_TEMP') > 0 ? sim.get('S:ENG_FLX_TEMP') : sim.get('S:FMGS_FLEX');
  let type: number;
  let n1: number;
  if (sim.has('S:ENG_THR_LIMIT_TYPE')) {
    type = sim.get('S:ENG_THR_LIMIT_TYPE');
    n1 = sim.get('S:ENG_THR_LIMIT_N1');
  } else {
    type = flexT > 0 ? 1 : 0;
    n1 = type === 1 ? 90.1 : 99.3;
  }
  const names = ['TOGA', 'FLX', 'MCT', 'CLB', 'MREV'];
  tx(ctx, names[type] ?? '', x, y - 1, C.C, 30, 'center');
  splitNumber(ctx, n1, x + 34, y + 28, C.G, 30, 22);
  tx(ctx, '%', x + 49, y + 27, C.C, 20, 'right');
  if (type === 1 && flexT > 0) tx(ctx, `${Math.round(flexT)}°C`, x - 23, y + 57, C.C, 22, 'left');
}

/* ================================================================== FOB */

function drawFob(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const x = 40;
  const y = 490;
  const fob = sim.has('S:FUEL_FOB_KG') ? sim.get('S:FUEL_FOB_KG')
    : sim.get('S:FUEL_LO_KG') + sim.get('S:FUEL_LI_KG') + sim.get('S:FUEL_C_KG') + sim.get('S:FUEL_RI_KG') + sim.get('S:FUEL_RO_KG');
  tx(ctx, 'FOB', x - 1, y, C.W, 30, 'center');
  tx(ctx, ':', x + 52, y, C.W, 30, 'center');
  const valid = sim.getB('S:ELEC_AC_ESS_BUS') || sim.getB('S:ELEC_AC1_BUS') || sim.getB('S:ELEC_DC_ESS_BUS');
  if (valid) tx(ctx, String(Math.round(fob / 20) * 20), x + 172, y, C.G, 30, 'right');
  else tx(ctx, 'XX', x + 172, y, C.A, 30, 'right');
  tx(ctx, 'KG', x + 212, y - 1, C.C, 22, 'center');
}

/* ================================================================== SLATS / FLAPS */

/** Slat angle (deg) → position value along the slat track (FBW-derived geometry). */
function slatValue(deg: number): number {
  const k: Array<[number, number]> = [[0, 0], [18, 7.75], [22, 14.92], [27, 22.12]];
  return interp(k, deg);
}
function flapValue(deg: number): number {
  const k: Array<[number, number]> = [[0, 0], [10, 9.69], [15, 17.9], [20, 25.9], [40, 34.1]];
  return interp(k, deg);
}
function interp(k: Array<[number, number]>, v: number): number {
  if (v <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (v <= k[i][0]) {
      const [x0, y0] = k[i - 1];
      const [x1, y1] = k[i];
      return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
    }
  }
  return k[k.length - 1][1];
}

function drawSlatsFlaps(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const lever = Math.round(sim.get('C:FLAPS_LEVER'));
  const slatsTarget = [0, 18, 22, 22, 27][lever] ?? 0;
  const flapsTarget = [0, 10, 15, 20, 40][lever] ?? 0;
  const slats = sim.has('S:FCTL_SLATS') ? sim.get('S:FCTL_SLATS') : slatsTarget;
  const flaps = sim.has('S:FCTL_FLAPS') ? sim.get('S:FCTL_FLAPS') : flapsTarget;
  const powered = sim.getB('S:ELEC_DC_ESS_BUS') || sim.getB('S:ELEC_DC2_BUS') || sim.getB('S:ELEC_AC_ESS_BUS');
  const lineCol = powered ? C.G : C.A;
  ctx.save();
  ctx.translate(539, 442);
  // wing root
  relPoly(ctx, 0, 0, [-18, 0, -4, 14, 28, 1], C.grey, 2, true);
  const slatsMoving = Math.abs(slats - slatsTarget) > 0.3;
  const flapsMoving = Math.abs(flaps - flapsTarget) > 0.3;
  const out = slats > 0.5 || flaps > 0.5 || lever !== 0;
  if (out) {
    const inMotion = slatsMoving || flapsMoving;
    const conf = ['0', '1+F', '2', '3', 'FULL'][lever];
    // CONF 1 (flaps retracted, slats 18) when the flaps auto-retract / lever 1 in flight
    const conf1 = lever === 1 && flapsTarget === 0;
    tx(ctx, conf1 ? '1' : conf, -3, 59, inMotion ? C.C : C.G, 30, 'center');
    tx(ctx, 'S', -101, 15, powered ? C.W : C.A, 22, 'center');
    tx(ctx, 'F', 105, 15, powered ? C.W : C.A, 22, 'center');
    // white position indexes
    for (const [x, y] of [[-63, 19], [-96, 30], [-129, 41]]) relPoly(ctx, x, y, [-7, 2, -1, 4, 7, -2], C.W, 2, true);
    for (const [x, y] of [[58, 17], [95, 25], [133, 33], [170, 41]]) relPoly(ctx, x, y, [3, 5, 5, 1, 0, -4], C.W, 2, true);
    // cyan target indexes while moving
    if (slatsMoving) {
      const tp: Record<number, [number, number]> = { 0: [-26, 23], 18: [-63, 34], 22: [-96, 45], 27: [-129, 56] };
      const p = tp[slatsTarget];
      if (p) relPoly(ctx, p[0], p[1], [-7, 2, -1, 4, 7, -2], C.C, 2, true);
    }
    if (flapsMoving) {
      const tp: Record<number, [number, number]> = { 0: [12, 23], 10: [58, 32], 15: [95, 40], 20: [133, 48], 40: [170, 56] };
      const p = tp[flapsTarget];
      if (p) relPoly(ctx, p[0], p[1], [3, 5, 5, 1, 0, -4], C.C, 2, true);
    }
  }
  // slat and flap surfaces (green)
  const sv = slatValue(slats);
  const sx = -4.5766 * sv - 18;
  const sy = 1.519 * sv;
  relPoly(ctx, sx, sy, [-22, 7, -5, 14, 23, -8], lineCol, 2, true);
  line(ctx, -18, 0, sx, sy, lineCol, 2);
  const fv = flapValue(flaps);
  const fx = 4.71 * fv;
  const fy = 0.97 * fv + 1;
  relPoly(ctx, fx, fy, [24.5, 6, 0, 13.5, -18, -4], lineCol, 2, true);
  line(ctx, 0, 0, fx, fy, lineCol, 2);
  ctx.restore();
}

/* ================================================================== MEMO / WARNING AREA */

const PITCH = 16;
const TEXT_PX = 24;

function drawMemoArea(ctx: CanvasRenderingContext2D, core: EcamCore, flashOn: boolean): void {
  const fwc = core.fwc;
  if (!fwc.powered) return;
  let y = 554;
  for (const l of fwc.leftLines) {
    drawEcamLine(ctx, l, 14, y, PITCH, TEXT_PX, flashOn);
    y += 30;
  }
  if (fwc.leftOverflow) drawOverflowArrow(ctx, 452, 700);
  y = 554;
  for (const l of fwc.rightLines) {
    drawEcamLine(ctx, l, 520, y, PITCH, TEXT_PX, flashOn);
    y += 30;
  }
  if (fwc.rightOverflow) drawOverflowArrow(ctx, 752, 700);
  // STS reminder (status page content not displayed)
  if (fwc.stsReminder && core.sd.page !== 12) {
    drawEcamLine(ctx, [{ t: 'STS', c: 'W' }], 520, 554 + (EWD_LINES - 1) * 30, PITCH, TEXT_PX, flashOn);
  }
}

/** Green down arrow indicating more lines than the area can show. */
function drawOverflowArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  poly(ctx, [x, y, x, y + 24], C.G, 3);
  poly(ctx, [x - 7, y + 14, x, y + 26, x + 7, y + 14], C.G, 0, true, C.G);
}
