/**
 * SD CAB PRESS page (600 design space): LDG ELEV, delta P, cabin V/S, cabin altitude, active system,
 * outflow valve, safety valve, avionics ventilation inlet / outlet, packs.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, arcC, circle, dirOf, gaugeAngle, line, pageTitle, poly, splitNumber, tx } from '../common';
import { triangle } from './hyd';

const K = 1024 / 600;

export function drawPressPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, t: number): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  const ph = core.fwc.phase;
  const valid = a.sdac1 || a.sdac2;
  const auto = !a.pressModeMan;
  pageTitle(ctx, 'CAB PRESS', 6, 24, 24);

  // landing elevation
  if (auto) {
    const ldgMan = a.ldgElevMan;
    const le = sim.has('S:PRESS_LDG_ELEV') ? sim.get('S:PRESS_LDG_ELEV') : sim.has('S:FMGS_DEST_ELEV') ? sim.get('S:FMGS_DEST_ELEV') : -6000;
    tx(ctx, 'LDG ELEV', 280, 25, C.W, 20, 'center');
    tx(ctx, ldgMan ? 'MAN' : 'AUTO', 350, 25, C.G, 20);
    tx(ctx, le > -5000 ? String(Math.round(le / 50) * 50) : 'XX', 510, 25, le > -5000 ? C.G : C.A, 20, 'right');
    tx(ctx, 'FT', 525, 25, C.C, 16);
  } else tx(ctx, 'MAN', 420, 340, C.G, 20);

  const y = 165;
  const R = 50;
  // ---- delta P
  {
    const x = 110;
    const dp = sim.get('S:PRESS_DELTA_P');
    const amber = dp < -0.4 || dp >= 8.5;
    tx(ctx, 'ΔP', x - 5, 80, C.W, 20, 'center');
    tx(ctx, 'PSI', x - 5, 100, C.C, 16, 'center');
    const ang = (v: number) => gaugeAngle(v, -1, 9, 210, 50);
    arcC(ctx, x, y, R, 210, 50, C.W, 2);
    arcC(ctx, x, y, R, 40, 50, C.A, 2);
    arcC(ctx, x, y, R, 210, 218, C.A, 2);
    tick(ctx, x, y, R, ang(8)); tick(ctx, x, y, R, ang(4)); tick(ctx, x, y, R, ang(0));
    lbl(ctx, x, y, R, ang(8), '8', 0, 10);
    lbl(ctx, x, y, R, ang(0), '0', 5, -10);
    if (valid) {
      needle(ctx, x, y, R, ang(Math.max(-1, Math.min(9, dp))), amber ? C.A : C.G);
      splitNumber(ctx, Math.max(-9.9, Math.min(9.9, dp)), x + 63, y + 25, amber ? C.A : C.G, 24, 17);
    } else tx(ctx, 'XX', x + 53, y + 25, C.A, 17, 'right');
  }
  // ---- cabin V/S
  {
    const x = 275;
    const vs = sim.get('S:PRESS_CAB_VS');
    const v50 = Math.round(Math.max(-6350, Math.min(6350, vs)) / 50) * 50;
    const pulse = Math.abs(v50) > 1750 && Math.floor(t) % 2 === 0;
    tx(ctx, 'V/S', x + 15, 80, C.W, 20, 'center');
    tx(ctx, 'FT/MIN', x + 20, 100, C.C, 16, 'center');
    arcC(ctx, x, y, R, 170, 10, C.W, 2);
    const ang = (v: number) => gaugeAngle(v, -2, 2, 180, 0);
    for (const v of [2, 1, 0, -1, -2]) tick(ctx, x, y, R, ang(v));
    lbl(ctx, x, y, R, ang(2), '2', 0, 10);
    lbl(ctx, x, y, R, ang(0), '0', 10, 0);
    lbl(ctx, x, y, R, ang(-2), '2', 0, -10);
    if (valid) {
      needle(ctx, x, y, R, ang(Math.max(-2.25, Math.min(2.25, v50 / 1000))), pulse ? C.dimG : C.G);
      tx(ctx, String(v50), x + 85, y + 5, pulse ? C.dimG : C.G, 24, 'right');
    } else tx(ctx, 'XX', x + 85, y + 5, C.A, 24, 'right');
  }
  // ---- cabin altitude
  {
    const x = 455;
    const alt = sim.get('S:PRESS_CAB_ALT');
    const a50 = Math.round(alt / 50) * 50;
    const red = a50 >= 9550;
    const pulse = a50 >= 8800 && !red && Math.floor(t) % 2 === 0;
    const col = red ? C.R : pulse ? C.dimG : C.G;
    tx(ctx, 'CAB ALT', x + 15, 80, C.W, 20, 'center');
    tx(ctx, 'FT', x + 20, 100, C.C, 16, 'center');
    const ang = (v: number) => gaugeAngle(v, -0.625, 10.625, 210, 50);
    arcC(ctx, x, y, R, 210, 50, C.W, 2);
    arcC(ctx, x, y, R, 30, 50, C.R, 2);
    tick(ctx, x, y, R, ang(10)); tick(ctx, x, y, R, ang(5)); tick(ctx, x, y, R, ang(0));
    lbl(ctx, x, y, R, ang(10), '10', 0, 15);
    lbl(ctx, x, y, R, ang(0), '0', 5, -10);
    if (valid) {
      needle(ctx, x, y, R, ang(Math.max(-0.625, Math.min(10.625, Math.round(alt / 25) * 25 / 1000))), col);
      tx(ctx, String(Math.round(Math.max(-9950, Math.min(32750, alt)) / 50) * 50), x + 85, y + 25, col, 24, 'right');
    } else tx(ctx, 'XX', x + 85, y + 25, C.A, 24, 'right');
  }

  // ---- systems
  const activeSys = sim.has('S:PRESS_ACTIVE_SYS') ? sim.get('S:PRESS_ACTIVE_SYS') : 1;
  if (auto && activeSys === 1) tx(ctx, 'SYS 1', 180, 290, C.G, 20);
  if (auto && activeSys === 2) tx(ctx, 'SYS 2', 350, 290, C.G, 20);

  // ---- vessel outline
  ctx.save();
  ctx.translate(-5, -25);
  poly(ctx, [140, 460, 140, 450, 75, 450, 75, 280, 540, 280, 540, 300], C.W, 2);
  poly(ctx, [180, 457, 180, 450, 265, 450, 265, 457], C.W, 2);
  poly(ctx, [305, 460, 305, 450, 380, 450], C.W, 2);
  poly(ctx, [453, 450, 540, 450, 540, 380, 550, 380], C.W, 2);
  line(ctx, 540, 340, 547, 340, C.W, 2);
  ctx.restore();

  // ---- safety valve
  const safety = sim.get('S:PRESS_SAFETY_VALVE');
  const sOpen = safety >= 0.2;
  tx(ctx, 'SAFETY', 490, 305, sOpen ? C.A : C.W, 20);
  {
    const ang = gaugeAngle(sOpen ? 1 : 2, 0, 2, 90, 180);
    const [dx, dy] = dirOf(ang);
    line(ctx, 545, 315, 545 + dx * 34 * 1.15, 315 + dy * 34 * 1.15, sOpen ? C.A : C.G, 2);
    circle(ctx, 545, 315, 3, C.W, 2);
  }
  // ---- avionics ventilation inlet / outlet
  tx(ctx, 'VENT', 185, 380, C.W, 20);
  {
    const inlet = sim.get('S:VENT_INLET_VALVE');
    const pos = inlet > 0.99 ? 0 : inlet > 0.01 ? 1 : 2;
    const amberText = inlet > 0.99 && ph >= 5 && ph <= 7;
    tx(ctx, 'INLET', 120, 417, amberText ? C.A : C.W, 20);
    const [dx, dy] = dirOf(gaugeAngle(pos, 0, 2, 180, 270));
    line(ctx, 175, 434, 175 + dx * 34 * 1.15, 434 + dy * 34 * 1.15, pos === 1 || amberText ? C.A : C.G, 2);
    circle(ctx, 175, 434, 3, C.W, 2);
  }
  {
    const outlet = sim.get('S:VENT_EXTRACT_VALVE');
    const pos = outlet > 0.95 ? 2 : outlet > 0.01 ? 1 : 0;
    tx(ctx, 'OUTLET', 240, 417, C.W, 20);
    const [dx, dy] = dirOf(gaugeAngle(pos, 0, 2, 90, 180));
    line(ctx, 260, 434, 260 + dx * 34 * 1.15, 434 + dy * 34 * 1.15, C.G, 2);
    circle(ctx, 260, 434, 3, C.W, 2);
  }
  // ---- outflow valve
  {
    const ofx = 448;
    const ofy = 425;
    const pct = Math.max(0, Math.min(100, sim.get('S:PRESS_OUTFLOW') * 100));
    arcC(ctx, ofx, ofy, 72, 270 + (pct / 100) * 90, 360, C.W, 2);
    arcC(ctx, ofx, ofy, 72, 355.5, 360, C.A, 2);
    for (const v of [25, 50, 75]) {
      const [dx, dy] = dirOf(gaugeAngle(v, 0, 100, 270, 360));
      line(ctx, ofx + dx * 72, ofy + dy * 72, ofx + dx * 72 * 1.1, ofy + dy * 72 * 1.1, C.W, 2);
    }
    const [dx, dy] = dirOf(gaugeAngle(pct, 0, 100, 270, 360));
    line(ctx, ofx, ofy, ofx + dx * 72, ofy + dy * 72, ph >= 5 && ph <= 7 && pct > 95 ? C.A : C.G, 2);
    circle(ctx, ofx, ofy, 3, C.W, 2);
  }
  // ---- packs
  for (const n of [1, 2] as const) {
    const x = n === 1 ? 47 : 478;
    const open = sim.getB(`S:PACK${n}_VALVE`);
    const amber = !open && a.eng[n - 1].n2 >= 60;
    triangle(ctx, x + 38, 495 - 45, amber ? C.A : C.G, false, 0);
    tx(ctx, `PACK ${n}`, x, 495, amber ? C.A : C.W, 20);
  }
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number): void {
  const [dx, dy] = dirOf(ang);
  line(ctx, x + dx * r * 0.85, y + dy * r * 0.85, x + dx * r, y + dy * r, C.W, 2);
}
function lbl(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number, s: string, nx: number, ny: number): void {
  const [dx, dy] = dirOf(ang);
  tx(ctx, s, x + dx * r * 0.85 + nx, y + dy * r * 0.85 + ny, C.W, 17, 'center');
}
function needle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number, col: string): void {
  const [dx, dy] = dirOf(ang);
  line(ctx, x, y, x + dx * r * 1.15, y + dy * r * 1.15, col, 3, 'round');
}
